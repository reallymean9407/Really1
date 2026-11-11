import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

// Run production authentication and routes against generated SQLite migrations.
// Replace only Cloudflare/Next request context and the outbound mail transport.
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const load = source => import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`);
globalThis.__authTestEnv = {};
globalThis.__authTestHeaders = new Headers();
globalThis.__authTestPlatform = null;
const authSource = (await readFile(new URL('../app/auth.ts', import.meta.url), 'utf8'))
  .replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__authTestEnv;')
  .replace("import { headers } from 'next/headers';", 'const headers = async () => globalThis.__authTestHeaders;')
  .replace("import { getChatGPTUser } from './chatgpt-auth';", 'const getChatGPTUser = async () => globalThis.__authTestPlatform;');
const auth = await load(authSource);
globalThis.__authTestModule = auth;
const routeSource = (await readFile(new URL('../app/api/auth/route.ts', import.meta.url), 'utf8'))
  .replace(/import \{([^}]+)\} from '\.\.\/\.\.\/auth';/, 'const {$1} = globalThis.__authTestModule;');
const route = await load(routeSource);
const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
const migrationSql = (await Promise.all(migrations.map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')))).join('\n');

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(migrationSql); }
  barrier(count) {
    let arrivals = 0, release;
    const pending = new Promise(resolve => { release = resolve; });
    this.tokenReadBarrier = async () => { if (++arrivals === count) { this.tokenReadBarrier = undefined; release(); } await pending; };
  }
  prepare(sql) {
    const statement = (params = []) => ({
      sql, params,
      bind(...next) { return statement(next); },
      first: async () => {
        const row = this.sqlite.prepare(sql).get(...params) ?? null;
        if (sql.startsWith('SELECT user_id FROM auth_tokens') && this.tokenReadBarrier) await this.tokenReadBarrier();
        return row;
      },
      all: async () => ({ results: this.sqlite.prepare(sql).all(...params), success: true }),
      run: async () => ({ success: true, meta: this.sqlite.prepare(sql).run(...params) }),
    });
    return statement();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN TRANSACTION');
    try {
      const rows = statements.map(statement => ({ success: true, meta: this.sqlite.prepare(statement.sql).run(...statement.params) }));
      this.sqlite.exec('COMMIT');
      return rows;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  count(table) { return this.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n; }
}

const origin = 'https://auth-test.example';
const password = 'test-only-password-123';
const changedPassword = 'changed-test-password-456';
const realFetch = globalThis.fetch;
let db, mails, mailStatus;
beforeEach(() => {
  db?.sqlite.close(); db = new LocalD1();
  globalThis.__authTestEnv.DB = db;
  globalThis.__authTestEnv.RESEND_API_KEY = 'local-mail-stub';
  globalThis.__authTestEnv.MAIL_FROM = 'Onki Test <test@example.invalid>';
  globalThis.__authTestHeaders = new Headers();
  globalThis.__authTestPlatform = null;
  mails = []; mailStatus = 200;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.method, 'POST');
    mails.push(JSON.parse(options.body));
    return new Response('{}', { status: mailStatus });
  };
});
after(() => { db?.sqlite.close(); globalThis.fetch = realFetch; });

const post = (input, headers = {}) => route.POST(new Request(`${origin}/api/auth`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'cf-connecting-ip': '192.0.2.1', ...headers }, body: JSON.stringify(input),
}));
const seed = async (id = 'email:local-a', email = 'a@example.invalid', verified = true) => {
  const salt = auth.opaqueToken();
  db.sqlite.prepare('INSERT INTO auth_accounts(id,email,password_hash,password_salt,verified_at,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, email, await auth.passwordHash(password, salt), salt, verified ? new Date().toISOString() : null, new Date().toISOString());
  return { id, email };
};
const addSession = async (id, expires = new Date(Date.now() + 86400000).toISOString()) => {
  const token = auth.opaqueToken();
  db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(await auth.digest(token), id, expires);
  return token;
};
const addToken = async (id, kind = 'verify', expires = new Date(Date.now() + 86400000).toISOString()) => {
  const token = auth.opaqueToken();
  db.sqlite.prepare('INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)').run(await auth.digest(token), id, kind, expires);
  return token;
};
const mailToken = index => new URL(mails[index].text.match(/https:\/\/\S+/)[0]).hash.match(/token=([a-f0-9]{64})/)[1];
const sessionCookie = response => response.headers.get('set-cookie').split(';')[0];
const useCookie = cookie => { globalThis.__authTestHeaders = new Headers({ cookie }); };

test('missing, spoofed, unknown, expired and unverified session cookies cannot authenticate', async () => {
  const member = await seed();
  for (const cookie of ['', 'onki_session=email:local-a', 'onki_session=a@example.invalid', `onki_session=${'a'.repeat(64)}`, `onki_session=${'G'.repeat(64)}`, `onki_session=${'a'.repeat(63)}`]) {
    useCookie(cookie); assert.equal(await auth.currentUser(), null);
  }
  const expired = await addSession(member.id, '2000-01-01T00:00:00.000Z');
  useCookie(`onki_session=${expired}`); assert.equal(await auth.currentUser(), null);
  const unverified = await seed('email:unverified', 'unverified@example.invalid', false);
  const token = await addSession(unverified.id);
  useCookie(`other=value; onki_session=${token}`); assert.equal(await auth.currentUser(), null);
});

test('verified opaque session authenticates only its owner and stores no raw session token', async () => {
  const member = await seed();
  const token = await addSession(member.id);
  assert.match(token, /^[a-f0-9]{64}$/);
  useCookie(`irrelevant=value; onki_session=${token}; other=value`);
  assert.deepEqual(await auth.currentUser(), { ...member, name: 'a' });
  const row = db.sqlite.prepare('SELECT token_hash FROM auth_sessions').get();
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash, await auth.digest(token));
  const response = await route.GET();
  const body = await response.json();
  assert.deepEqual(Object.keys(body.user).sort(), ['email', 'id', 'name']);
  assert.equal(body.emailReady, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('platform identity uses a separate namespace and session spoofing never creates platform identity', async () => {
  globalThis.__authTestPlatform = { userId: 'account-1', email: 'platform@example.invalid', displayName: '투자자' };
  useCookie('onki_session=account-2');
  assert.deepEqual(await auth.currentUser(), { id: 'gpt:account-1', email: 'platform@example.invalid', name: '투자자' });
  globalThis.__authTestPlatform = null;
  assert.equal(await auth.currentUser(), null);
});

test('email signup stays disabled without mail settings and creates no credentials or tokens', async () => {
  for (const missing of ['RESEND_API_KEY', 'MAIL_FROM']) {
    const value = globalThis.__authTestEnv[missing]; delete globalThis.__authTestEnv[missing];
    const response = await post({ action: 'signup', email: 'new@example.invalid', password });
    assert.equal(response.status, 503);
    assert.equal(db.count('auth_accounts'), 0); assert.equal(db.count('auth_tokens'), 0);
    globalThis.__authTestEnv[missing] = value;
  }
  assert.equal(mails.length, 0);
});

test('signup, email verification and login use one-use hashed tokens and HttpOnly secure cookies', async () => {
  const signup = await post({ action: 'signup', email: '  NEW@Example.invalid ', password });
  assert.equal(signup.status, 200);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['new@example.invalid']);
  const token = mailToken(0);
  const account = db.sqlite.prepare('SELECT * FROM auth_accounts').get();
  assert.equal(account.email, 'new@example.invalid'); assert.equal(account.verified_at, null);
  assert.notEqual(account.password_hash, password);
  assert.match(account.password_salt, /^[a-f0-9]{64}$/);
  assert.equal(db.sqlite.prepare('SELECT token_hash FROM auth_tokens').get().token_hash, await auth.digest(token));
  assert.equal((await post({ action: 'login', email: account.email, password })).status, 403);
  assert.equal((await post({ action: 'verify', token })).status, 200);
  assert.equal((await post({ action: 'verify', token })).status, 400);
  assert.equal(db.count('auth_tokens'), 0);
  const login = await post({ action: 'login', email: account.email, password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^onki_session=[a-f0-9]{64};/);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  useCookie(sessionCookie(login)); assert.equal((await auth.currentUser()).id, account.id);
});

test('wrong credentials and unknown addresses return the same login rejection and no sessions', async () => {
  await seed();
  for (const email of ['a@example.invalid', 'unknown@example.invalid']) {
    const response = await post({ action: 'login', email, password: 'wrong-password-123' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: '이메일 또는 비밀번호를 확인해 주세요.' });
  }
  assert.equal(db.count('auth_sessions'), 0);
});

test('forgot-password response does not enumerate addresses and reset revokes every previous session', async () => {
  const account = await seed();
  const tokenA = await addSession(account.id), tokenB = await addSession(account.id);
  const oldSalt = db.sqlite.prepare('SELECT password_salt FROM auth_accounts WHERE id=?').get(account.id).password_salt;
  const known = await post({ action: 'forgot', email: account.email });
  const unknown = await post({ action: 'forgot', email: 'unknown@example.invalid' });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(mails.length, 1);
  const token = mailToken(0);
  assert.equal((await post({ action: 'reset', token, password: changedPassword })).status, 200);
  assert.equal(db.count('auth_sessions'), 0); assert.equal(db.count('auth_tokens'), 0);
  for (const oldToken of [tokenA, tokenB]) { useCookie(`onki_session=${oldToken}`); assert.equal(await auth.currentUser(), null); }
  assert.notEqual(db.sqlite.prepare('SELECT password_salt FROM auth_accounts WHERE id=?').get(account.id).password_salt, oldSalt);
  assert.equal((await post({ action: 'reset', token, password })).status, 400);
  assert.equal((await post({ action: 'login', email: account.email, password })).status, 401);
  assert.equal((await post({ action: 'login', email: account.email, password: changedPassword })).status, 200);
});

test('wrong-kind, expired and malformed verification/reset links never change credentials', async () => {
  const account = await seed('email:unverified', 'unverified@example.invalid', false);
  const before = db.sqlite.prepare('SELECT * FROM auth_accounts').get();
  const resetToken = await addToken(account.id, 'reset');
  const verifyToken = await addToken(account.id, 'verify');
  const expired = await addToken(account.id, 'reset', '2000-01-01T00:00:00.000Z');
  for (const [action, token] of [['verify', resetToken], ['reset', verifyToken], ['reset', expired], ['verify', 'bad'], ['reset', 'a'.repeat(64)]]) {
    assert.equal((await post({ action, token, password: changedPassword })).status, 400);
  }
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM auth_accounts').get(), before);
});

test('concurrent verification consumes its token exactly once', async () => {
  const account = await seed('email:pending', 'pending@example.invalid', false);
  const token = await addToken(account.id);
  db.barrier(2);
  const responses = await Promise.all([post({ action: 'verify', token }), post({ action: 'verify', token })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  assert.ok(db.sqlite.prepare('SELECT verified_at FROM auth_accounts WHERE id=?').get(account.id).verified_at);
  assert.equal(db.count('auth_tokens'), 0);
});

test('concurrent reset consumes its token once and the winning password matches the response', async () => {
  const account = await seed();
  await addSession(account.id);
  const token = await addToken(account.id, 'reset');
  db.barrier(2);
  const passwords = ['concurrent-password-one', 'concurrent-password-two'];
  const responses = await Promise.all(passwords.map(password => post({ action: 'reset', token, password })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  assert.equal(db.count('auth_sessions'), 0);
  const current = db.sqlite.prepare('SELECT password_hash,password_salt FROM auth_accounts WHERE id=?').get(account.id);
  for (const [index, response] of responses.entries()) assert.equal(await auth.passwordHash(passwords[index], current.password_salt) === current.password_hash, response.status === 200);
});

test('logout revokes only the current email session and clears its cookie even while mail is disabled', async () => {
  const account = await seed();
  const token = await addSession(account.id), remaining = await addSession(account.id);
  delete globalThis.__authTestEnv.RESEND_API_KEY;
  const response = await post({ action: 'logout' }, { Cookie: `onki_session=${token}` });
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(db.count('auth_sessions'), 1);
  useCookie(`onki_session=${token}`); assert.equal(await auth.currentUser(), null);
  useCookie(`onki_session=${remaining}`); assert.equal((await auth.currentUser()).id, account.id);
});

test('cross-origin, oversized and invalid input requests cannot create accounts', async () => {
  const signup = { action: 'signup', email: 'new@example.invalid', password };
  assert.equal((await post(signup, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await post(signup, { 'Content-Length': '4097' })).status, 413);
  assert.equal((await post({ ...signup, password: 'a'.repeat(4097) })).status, 413);
  assert.equal((await post({ ...signup, password: 'short' })).status, 400);
  assert.equal((await post({ ...signup, email: 'invalid' })).status, 400);
  assert.equal((await route.POST(new Request(`${origin}/api/auth`, { method: 'POST', body: '{' }))).status, 400);
  assert.equal(db.count('auth_accounts'), 0); assert.equal(mails.length, 0);
});

test('streamed auth bodies enforce the byte limit without trusting Content-Length and cancel the reader', async () => {
  for (const declaredLength of [null, '1']) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.enqueue(new Uint8Array(2048));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { cancelled = true; },
    });
    const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json' });
    if (declaredLength !== null) headers.set('Content-Length', declaredLength);
    const request = new Request(`${origin}/api/auth`, { method: 'POST', headers, body, duplex: 'half' });
    assert.equal(request.headers.get('content-length'), declaredLength);
    const response = await route.POST(request);
    assert.equal(response.status, 413);
    assert.equal(cancelled, true);
  }
  assert.equal(db.count('auth_accounts'), 0);
  assert.equal(db.count('auth_tokens'), 0);
  assert.equal(db.count('auth_rate_limits'), 0);
  assert.equal(mails.length, 0);
});

test('mail provider rejection removes the undelivered token and never signs a user in', async () => {
  mailStatus = 503;
  const response = await post({ action: 'signup', email: 'new@example.invalid', password });
  assert.equal(response.status, 400);
  assert.equal(db.count('auth_tokens'), 0); assert.equal(db.count('auth_sessions'), 0);
  assert.equal(db.sqlite.prepare('SELECT verified_at FROM auth_accounts').get().verified_at, null);
});

test('thrown mail network failures clean the pending token and preserve an unsigned unverified account', async () => {
  let transportCalled = false;
  globalThis.fetch = async (url, options) => {
    transportCalled = true;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(db.count('auth_tokens'), 1, 'token exists only while delivery is pending');
    assert.ok(options.signal instanceof AbortSignal, 'mail transport has an abort deadline');
    throw new TypeError('Simulated offline mail transport');
  };
  const response = await post({ action: 'signup', email: 'offline@example.invalid', password });
  assert.equal(response.status, 400);
  assert.equal(transportCalled, true);
  assert.equal(db.count('auth_tokens'), 0);
  assert.equal(db.count('auth_sessions'), 0);
  assert.equal(db.sqlite.prepare('SELECT verified_at FROM auth_accounts').get().verified_at, null);
  assert.doesNotMatch(JSON.stringify(await response.json()), /Simulated|offline mail transport/);
});

test('login rate limit blocks repeated attempts without exposing credentials', async () => {
  for (let i = 0; i < 12; i++) assert.equal((await post({ action: 'login', email: 'unknown@example.invalid', password })).status, 401);
  const blocked = await post({ action: 'login', email: 'unknown@example.invalid', password });
  assert.equal(blocked.status, 429);
  assert.equal(db.count('auth_sessions'), 0);
});

test('independent visitors do not share a global anonymous email-verification quota', async () => {
  for (let i = 0; i < 13; i++) {
    const id = `email:pending-${i}`;
    db.sqlite.prepare('INSERT INTO auth_accounts(id,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?)').run(id, `pending-${i}@example.invalid`, 'unused', 'unused', new Date().toISOString());
    const token = await addToken(id);
    const response = await post({ action: 'verify', token }, { 'cf-connecting-ip': `192.0.2.${i + 1}` });
    assert.equal(response.status, 200, `independent verification ${i + 1} should not hit another user's quota`);
  }
});
