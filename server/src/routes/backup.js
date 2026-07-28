// backup.js — on-demand + nightly Postgres backups to R2 (object storage).
//
// Why this exists: Postgres lives in ONE Docker volume on ONE droplet — a single point of
// failure. Artwork already survives a box loss (it's in R2); the DATABASE did not. This
// dumps it to the SAME R2 bucket, nightly and on demand, so "the droplet died" becomes a
// 10-minute restore instead of a catastrophe.
//
// Reuses storage.js — the app's proven, dependency-free R2 signer — for the upload and the
// time-limited download link. No new SDK, the same credentials that already move artwork.
//
// Requires `pg_dump` in the API image (added to server/Dockerfile as postgresql16-client,
// matching the Postgres 16 server). If it's missing, the routes report that plainly rather
// than failing silently — rebuild with `docker compose up -d --build`.

import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { q } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { audit } from '../audit.js';

const PREFIX = 'backups/db';                     // R2 key prefix — sits beside artwork in the bucket
const KEEP_AUTO = 14;                            // nightly backups to retain; older AUTO ones are pruned
const AUTO_EVERY_MS = 60 * 60 * 1000;            // wake hourly to check whether a nightly is due
const AUTO_MIN_GAP_MS = 23 * 60 * 60 * 1000;     // ...but only actually back up if the last success is this old

// ── table (created idempotently at route load, like the other settings tables) ──
let _ready = null;
function ensureTable() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists db_backups (
    id          bigserial primary key,
    r2_key      text,
    size_bytes  bigint,
    kind        text not null default 'manual',   -- manual | auto
    status      text not null default 'running',  -- running | done | failed
    error       text,
    created_by  text,
    created_at  timestamptz default now(),
    finished_at timestamptz
  )`).catch((e) => { _ready = null; throw e; });
  return _ready;
}

// ── pg_dump availability (cached): undefined=unknown, string=version, null=missing ──
let _pgDump;
function pgDumpVersion() {
  if (_pgDump !== undefined) return Promise.resolve(_pgDump);
  return new Promise((res) => {
    try {
      const p = spawn('pg_dump', ['--version']);
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => { _pgDump = null; res(null); });
      p.on('close', (code) => { _pgDump = code === 0 ? out.trim() : null; res(_pgDump); });
    } catch { _pgDump = null; res(null); }
  });
}

// Run pg_dump into a local file. Password rides in the environment (PGPASSWORD), never in
// argv — argv is world-readable via `ps`, and this is a live credential.
function pgDumpToFile(dbUrl, file) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(dbUrl); } catch { return reject(new Error('DATABASE_URL is malformed')); }
    const env = {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || '5432',
      PGUSER: decodeURIComponent(u.username || ''),
      PGPASSWORD: decodeURIComponent(u.password || ''),
    };
    const db = (u.pathname || '').replace(/^\//, '') || 'egfulfill';
    // -Fc: custom format — compressed and restorable with pg_restore.
    const p = spawn('pg_dump', ['-Fc', '-f', file, db], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('pg_dump exited ' + code + ': ' + err.slice(0, 300)))));
  });
}

// One backup at a time — pg_dump is I/O heavy and a double-run wastes the box.
let _running = false;

async function runBackup({ kind, actorEmail, req }) {
  if (_running) throw new Error('A backup is already running.');
  if (!storageEnabled()) throw new Error('Object storage (R2) is not configured — set SPACES_* to enable backups.');
  if (!(await pgDumpVersion())) throw new Error('pg_dump is not installed in the API image — rebuild with postgresql-client (docker compose up -d --build).');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set.');

  _running = true;
  await ensureTable();
  // 2026-07-28_03-00-00 — sortable, filename-safe.
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-').replace('T', '_');
  const key = `${PREFIX}/egfulfill-${stamp}-${kind}.dump`;
  const tmp = path.join(os.tmpdir(), `egfulfill-backup-${randomUUID()}.dump`);

  const ins = await q(
    `insert into db_backups (r2_key, kind, status, created_by) values ($1,$2,'running',$3) returning *`,
    [key, kind, actorEmail || null]);
  const row = ins.rows[0];

  try {
    await pgDumpToFile(dbUrl, tmp);
    const buf = await readFile(tmp);
    await putObject(key, buf, 'application/octet-stream', 'private');   // private — never public-read
    await q(`update db_backups set status='done', size_bytes=$2, finished_at=now() where id=$1`, [row.id, buf.length]);
    if (req) audit(req, 'backup.created', { entityType: 'db_backup', entityId: String(row.id), after: { key, size: buf.length, kind } });
    if (kind === 'auto') await pruneAuto();
    return { ...row, status: 'done', size_bytes: buf.length };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await q(`update db_backups set status='failed', error=$2, finished_at=now() where id=$1`, [row.id, msg.slice(0, 500)]).catch(() => {});
    throw e;
  } finally {
    _running = false;
    unlink(tmp).catch(() => {});
  }
}

// Keep the newest KEEP_AUTO nightly backups; delete the rest from R2 and the table. Manual
// backups are never auto-pruned — a human made them on purpose.
async function pruneAuto() {
  const old = await q(
    `select id, r2_key from db_backups where kind='auto' and status='done' order by created_at desc offset $1`,
    [KEEP_AUTO]);
  for (const r of old.rows) {
    if (r.r2_key) await deleteObject(r.r2_key).catch(() => {});
    await q('delete from db_backups where id=$1', [r.id]).catch(() => {});
  }
}

// ── nightly scheduler (in-process; the container has restart: unless-stopped) ──
async function maybeAutoBackup() {
  try {
    if (!storageEnabled() || !(await pgDumpVersion())) return;
    await ensureTable();
    const last = await q(`select max(created_at) as t from db_backups where status='done'`);
    const t = last.rows[0] && last.rows[0].t ? new Date(last.rows[0].t).getTime() : 0;
    if (Date.now() - t < AUTO_MIN_GAP_MS) return;
    await runBackup({ kind: 'auto', actorEmail: 'system' });
  } catch { /* recorded on the row; swallow so the timer survives to the next tick */ }
}

let _started = false;
function startScheduler() {
  if (_started) return;
  _started = true;
  setTimeout(() => { maybeAutoBackup(); }, 45 * 1000);       // one check shortly after boot
  const t = setInterval(() => { maybeAutoBackup(); }, AUTO_EVERY_MS);  // then hourly
  if (t.unref) t.unref();                                     // don't keep the process alive on its own
}

export function backupRoutes(app, requireAdmin) {
  ensureTable().catch(() => {});   // best-effort at load; handlers re-ensure. Never rejects boot.
  startScheduler();

  // The panel state: recent backups + why a backup might not be possible right now.
  app.get('/api/backups', { preHandler: requireAdmin }, async () => {
    await ensureTable();
    const r = await q(`select id, r2_key, size_bytes, kind, status, error, created_by, created_at, finished_at
                       from db_backups order by created_at desc limit 60`);
    const pg = await pgDumpVersion();
    return {
      backups: r.rows,
      storageConfigured: storageEnabled(),
      pgDumpAvailable: !!pg,
      pgDumpVersion: pg || null,
      running: _running,
      keepAuto: KEEP_AUTO,
    };
  });

  // Back up now. Fires and returns — the list endpoint reports progress via `status`, so a
  // slow dump never outlives the HTTP request.
  app.post('/api/backups/run', { preHandler: requireAdmin }, async (req, reply) => {
    if (!storageEnabled()) { reply.code(503); return { error: 'Object storage (R2) is not configured. Set SPACES_* first.' }; }
    if (!(await pgDumpVersion())) { reply.code(503); return { error: 'pg_dump is missing from the API image. Rebuild: docker compose up -d --build.' }; }
    if (_running) { reply.code(409); return { error: 'A backup is already running.' }; }
    runBackup({ kind: 'manual', actorEmail: req.user && req.user.email, req })
      .catch((e) => app.log.error({ err: e }, 'manual backup failed'));
    return { ok: true, status: 'running' };
  });

  // A short-lived signed link straight to R2 (5 min). The bytes never pass back through the API.
  app.get('/api/backups/:id/download', { preHandler: requireAdmin }, async (req, reply) => {
    await ensureTable();
    const r = await q(`select r2_key, status from db_backups where id=$1::bigint`, [String(req.params.id)]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (row.status !== 'done' || !row.r2_key) { reply.code(409); return { error: 'Backup is not ready to download.' }; }
    const url = presignGet(row.r2_key, 300);
    if (!url) { reply.code(503); return { error: 'Object storage not configured.' }; }
    return { url };
  });

  app.delete('/api/backups/:id', { preHandler: requireAdmin }, async (req, reply) => {
    await ensureTable();
    const r = await q(`select r2_key from db_backups where id=$1::bigint`, [String(req.params.id)]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (row.r2_key) await deleteObject(row.r2_key).catch(() => {});
    await q('delete from db_backups where id=$1::bigint', [String(req.params.id)]);
    audit(req, 'backup.deleted', { entityType: 'db_backup', entityId: String(req.params.id) });
    return { ok: true };
  });
}
