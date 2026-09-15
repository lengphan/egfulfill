/**
 * WHO DOES THIS IDENTIFIER DENOTE — executed, not read.
 *
 * Sign-in accepts an email OR a username, and for a while nothing stopped the two
 * namespaces from overlapping: `users_username_lower_idx` makes a username unique among
 * usernames and `users_email_key` makes an email unique among emails, and NEITHER can see
 * the case that actually locked someone out — a username equal to another account's bare
 * name in the email column ('linh', 'uyen', 'abdul', the staff provisioned before usernames
 * existed). Login matched the username row, that row's password didn't match, and the older
 * account was never looked at. The refusal read "Invalid email or password", which was true
 * of the row it checked and about the wrong row.
 *
 * Reading auth.js will not tell you whether that still holds — the old code looked correct
 * and had a comment asserting the fallback "costs nothing". So this EXECUTES login(),
 * signup() and identifierTaken() against a real Postgres, on the two rows that produced the
 * lockout.
 *
 *   createdb egtest && IDENTITY_TEST_DATABASE_URL=postgres://you@127.0.0.1:5432/egtest \
 *     node server/scripts/check-identity.mjs
 *
 * IT WRITES, INCLUDING `delete from users`, so it refuses to run anywhere that could be
 * real: the database must be named for testing AND its users table must already be empty.
 * Both, not either — a name is a convention and an empty table is a fact.
 */
const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (!url) {
  console.error('Set IDENTITY_TEST_DATABASE_URL to a THROWAWAY database. This script deletes from users.');
  process.exit(2);
}
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!/(^|[_-])test$|^egtest$/.test(dbName)) {
  console.error(`Refusing to run against "${dbName}" — name the database egtest or *_test.`);
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'identity-check';

const { q } = await import('../src/db.js');
const { login, signup, identifierTaken, hashPassword, ensureUsernameColumn } = await import('../src/auth.js');

await q(`create table if not exists users (
  id bigserial primary key, email text unique, password_hash text, role text default 'seller',
  name text, store_name text, active boolean default true, avatar_emoji text, avatar_color text,
  notify_sound boolean default true, plan text default 'starter', spydeck_addon boolean default false)`);
if (Number((await q('select count(*)::int n from users')).rows[0].n) > 0) {
  console.error(`Refusing to run: "${dbName}".users is not empty.`);
  process.exit(2);
}
await ensureUsernameColumn();

const pass = [], fail = [];
const t = async (label, fn, want) => {
  let got; try { got = await fn(); } catch (e) { got = 'ERR: ' + e.message; }
  (got === want ? pass : fail).push({ label, want, got });
};
const who = (r) => `${r.user.role}:${r.user.email}`;

// The exact shape that broke: a legacy admin whose EMAIL is a bare name, and a seller who
// later took that same string as a USERNAME.
await q("insert into users (email, password_hash, role, name) values ('linh',$1,'admin','Linh')", [await hashPassword('Mothai345!')]);
await q("insert into users (email, username, password_hash, role) values ('seller@x.com','linh',$1,'seller')", [await hashPassword('seller-pass-9')]);

await t('the shadowed admin can still sign in', async () => who(await login({ email: 'linh', password: 'Mothai345!' })), 'admin:linh');
await t('the seller holding the username can too', async () => who(await login({ email: 'linh', password: 'seller-pass-9' })), 'seller:seller@x.com');
await t('a wrong password is still refused', async () => who(await login({ email: 'linh', password: 'nope' })), 'ERR: Invalid email or password');
await t('the identifier is case-insensitive', async () => who(await login({ email: 'LINH', password: 'Mothai345!' })), 'admin:linh');
// A Google-only row has no hash; bcrypt.compare THROWS on undefined rather than returning
// false, which used to surface as a 400 carrying 'Illegal arguments'.
await q("insert into users (email, username, password_hash, role) values ('g@x.com','googleuser',null,'seller')");
await t('a password-less account refuses without throwing', async () => who(await login({ email: 'googleuser', password: 'x' })), 'ERR: Invalid email or password');

// THE DIRECTION NO INDEX CAN SEE: nobody holds 'uyen' as a username, only as a bare-name
// email, so users_username_lower_idx has nothing to collide with.
await q("insert into users (email, password_hash, role) values ('uyen',$1,'operator')", ['x']);
await t('a username cannot shadow a bare-name email',
  async () => (await signup({ email: 'new@x.com', password: 'Correct-Horse-9', username: 'uyen' })).user.username,
  'ERR: That username is taken — pick another.');
await t('nor can it shadow another username',
  async () => (await signup({ email: 'new2@x.com', password: 'Correct-Horse-9', username: 'linh' })).user.username,
  'ERR: That username is taken — pick another.');
await t('identifierTaken sees a bare-name email', () => identifierTaken('uyen'), true);
await t('identifierTaken sees a username', () => identifierTaken('LINH'), true);
await t('a free name is free', () => identifierTaken('babygoods'), false);
await t('your own username is not a conflict with itself', async () => {
  await q("insert into users (email, username, password_hash, role) values ('shop@x.com','babygoods','x','seller')");
  return identifierTaken('babygoods', (await q("select id from users where email='shop@x.com'")).rows[0].id);
}, false);
await t('but somebody else holding it is', () => identifierTaken('babygoods', 999999), true);

await q('delete from users');
for (const r of pass) console.log(`  PASS  ${r.label}`);
for (const r of fail) console.log(`  FAIL  ${r.label}\n        want ${JSON.stringify(r.want)}\n        got  ${JSON.stringify(r.got)}`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
