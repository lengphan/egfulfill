# The dev server eats the machine

**Symptom:** fans loud, everything stutters, or macOS shows *"Your system has run out of
application memory."*

This has happened twice. It is **not** the runaway-loader bug in CLAUDE.md §2.8 — that one
is a React effect refetching in a loop inside the browser. This one is the Next.js dev
server leaking build workers on your Mac. Same symptom, unrelated cause, different fix.

Every command below is copy-paste safe: no inline `#` comments, because interactive zsh
here does not strip them and passes them along as arguments.

---

## 1. Confirm it is this

```bash
pgrep -f postcss.js | wc -l
```

Under ten is normal while a page compiles. **Hundreds means the pileup.** It has been seen
at 1,214.

```bash
sysctl vm.swapusage
```

`used` close to `total` is the danger sign. At the second crash it read
`total = 21504.00M  used = 21094.81M` — 409MB of headroom left.

```bash
memory_pressure -Q
```

Free percentage in single digits means minutes from a freeze.

Use `pgrep`, not `grep -c`. A `grep` counter matches its own command line and reports
processes that are not there.

## 2. Clear it

```bash
pkill -f 'dev/build/postcss.js'
```
```bash
pkill -f 'next dev'
```
```bash
pkill -f 'next-server'
```
```bash
pkill -f 'Chrome for Testing'
```

Or all four on one line:

```bash
pkill -f 'dev/build/postcss.js'; pkill -f 'next dev'; pkill -f 'next-server'; pkill -f 'Chrome for Testing'
```

Nothing here is precious. They are all restartable build processes — no unsaved work lives
in them.

## 3. Restart exactly one server

```bash
cd /Users/linhphan/Downloads/claude/web && npm run dev
```

Then **leave that tab alone.** It belongs to the server now; typing anything else into it
stops the server or does nothing. Open a second tab (⌘T) for git, curl and everything else.

## 4. Verify

```bash
pgrep -f postcss.js | wc -l
```
```bash
lsof -ti:3000
```
```bash
lsof -ti:3001
```

Workers in single digits, and only one of the two ports occupied.

---

## Why it happens

Next.js 16 Turbopack spawns a separate node process per PostCSS/Tailwind compile job and is
not reaping them in this project. Each one is ~40MB. They accumulate for as long as the
server runs, so a dev server left up all day is the whole failure.

**Duplicate servers multiply it.** When Next prints

```
Another next dev server is already running.
```

that is not noise — it means a previous Ctrl-C did not take and you now have two servers
each breeding workers. One server, one tab.

The stray `Chrome for Testing` processes are Puppeteer's, left behind by screenshot runs
(CLAUDE.md §7 requires screenshotting UI work). A script that exits without
`browser.close()` leaks one browser plus ~8 helper processes each time.

## Prevention

- One dev server, in its own tab. Stop it with Ctrl-C **in that tab**, not from elsewhere.
- Restart it when CSS edits start feeling slow. That sluggishness *is* the pileup starting.
- Check `pgrep -f postcss.js | wc -l` before a long session.
- Any Puppeteer script must close its browser in a `finally` block so an error or an
  interrupt still releases it.

---

## Mac or VPS — check the prompt first

Both mix-ups have already happened in one session, and one of them is dangerous.

| Command | Machine | Prompt |
|---|---|---|
| `npm run dev` | Mac | `linhphan@MacBook-Pro-cua-Linh` |
| `lsof -ti:3000 \| xargs kill -9` | **Mac only** | `linhphan@MacBook-Pro-cua-Linh` |
| `docker compose ...` | VPS | `root@srv1869283` |
| `git pull && docker compose up -d --build` | VPS | `root@srv1869283` |

**Never run a port-kill on the VPS.** Port 3000 there is the live Fastify API. It survived
being tried only because the `api` container exposes 3000 without publishing it, so `lsof`
on the host could not see it (CLAUDE.md §3). Publishing that port would make the same
command an outage.

There is no dev server on the VPS. Nothing there is ever restarted with `npm`.

VPS health check, which only works inside the SSH session:

```bash
docker compose exec -T caddy wget -qO- http://api:3000/health
```

---

## Why the machine FREEZES, and the guard that stops it

Third occurrence, 2026-08-13: **2,163 postcss workers**. This time the number was measured
against the limit that actually matters:

```bash
sysctl kern.maxprocperuid
```

It is **2,666** on this Mac. At 2,163 workers, plus Chrome, the editor and everything else,
the machine was out of PROCESS SLOTS — not only out of memory. That is why the symptom was
`echo` itself failing: nothing could `fork()`. A shell that cannot fork cannot run the kill
command that would fix it, which is the trap — the tool you need is the thing that stops
working first.

So the fix is a ceiling on the dev server's own shell, not vigilance:

```json
"dev": "ulimit -u 400; next dev",
"dev:unlimited": "next dev",
```

A capped shell hits `bash: fork: Resource temporarily unavailable` at 400 and stops there.
Verified: inside a `ulimit -u 120` subshell the storm walls itself while the parent shell
keeps working. 400 is far above a healthy compile (single digits) and far below the 2,666
that takes the Mac down. `dev:unlimited` exists for the day the cap is genuinely in the way.

**This does not fix the leak.** It stops the leak reaching the machine.

## What actually triggers it

The leak is Next's, but it is provoked. Both of the worst runs had the same shape:

- **A dev server left running while many files are edited.** Every save recompiles, and each
  recompile leaves workers behind. Twenty file edits with a server up is twenty batches.
- **Servers started and re-started across a long session.** If a kill doesn't land, the old
  one keeps watching the same directory, and the next save fans out across all of them.
  `lsof -ti:3000` returned FIVE pids right before the freeze.

Practical order of work, which costs nothing and avoids all of it:

1. Edit with **no dev server running**.
2. Start ONE server when there is something to look at.
3. Screenshot.
4. Stop it.

`pgrep -f postcss.js | wc -l` between steps, and paste it WITHOUT a trailing `# comment` —
interactive zsh passes the comment along as arguments, which is why the check itself errored
with `lsof: status error on #` the last time.
