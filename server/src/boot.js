// Entry point. Loads DB-stored integration secrets into process.env FIRST (so every
// route module captures them at import), then starts the app. Robust: if secrets can't
// load (e.g. DB not ready yet), it logs and boots on .env alone.
import { loadSecretsIntoEnv } from './secrets.js';

try {
  const n = await loadSecretsIntoEnv();
  if (n) console.log(`[boot] loaded ${n} secret(s) from the database`);
} catch (e) {
  console.error('[boot] secrets load failed, using .env:', (e && e.message) || e);
}

await import('./index.js');
