import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import gate from '../pages/_worker.js';

const host = 'https://duty-test.pages.dev';
const password = randomBytes(24).toString('base64url');
const proofFor = (key) => createHmac('sha256', key).update('duty-workbench:access:v1').digest('hex');
const env = {
  DUTY_ACCESS_PROOF: proofFor(password),
  DUTY_SESSION_KEY: randomBytes(32).toString('hex'),
  ASSETS: { fetch(request) {
    assert.equal(request.headers.get('Cookie'), null);
    return new Response(`Asset ${new URL(request.url).pathname}`, { headers: { 'Cache-Control': 'public' } });
  } },
};

const send = (path, init, bindings = env, origin = host) => gate.fetch(new Request(origin + path, init), bindings);
const login = (key, origin = host) => send('/__access/login', { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ key }) });

test('Pages invokes authentication for every route and denies files without credentials', async () => {
  const routes = JSON.parse(await readFile(new URL('../pages/_routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(routes, { version: 1, include: ['/*'], exclude: [] });
  const home = await send('/');
  assert.equal(home.status, 401);
  assert.match(await home.text(), /访问密钥/);
  for (const path of ['/index.html', '/assets/app.js', '/assets/importer.mjs', '/_worker.js']) {
    assert.equal((await send(path)).status, 401);
    assert.equal((await send(path, { method: 'HEAD' })).status, 401);
  }
  const pendingSetup = await send('/assets/app.js', {}, { ...env, DUTY_SESSION_KEY: undefined });
  assert.equal(pendingSetup.status, 503);
  assert.match(await pendingSetup.text(), /README/);
});

test('login form accepts and submits a Chinese access key', async () => {
  const key = '用于验证中文输入的访问密钥';
  const home = await send('/');
  const { window } = new JSDOM(await home.text(), { url: host });
  try {
    const form = window.document.querySelector('form');
    const input = form.elements.namedItem('key');
    assert.equal(input.type, 'text');
    assert.equal(input.getAttribute('inputmode'), 'text');
    assert.equal(input.getAttribute('autocomplete'), 'off');
    input.value = key;
    const response = await gate.fetch(new Request(form.action, {
      method: form.method.toUpperCase(),
      headers: { Origin: host },
      body: new URLSearchParams(new window.FormData(form)),
    }), { ...env, DUTY_ACCESS_PROOF: proofFor(key) });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('Set-Cookie'), /^__Host-duty_session=/);
  } finally {
    window.close();
  }
});

test('correct access key starts a host-bound session and protects asset responses', async () => {
  const wrong = await login('incorrect');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('Set-Cookie'), null);
  const response = await login(password);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const header = response.headers.get('Set-Cookie');
  assert.match(header, /^__Host-duty_session=\d+\.[0-9a-f]{64}; Max-Age=2592000; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
  const cookie = header.split(';')[0];
  assert.ok(!cookie.includes(password));
  const assetResponse = await send('/assets/app.js', { headers: { Cookie: cookie } });
  assert.equal(await assetResponse.text(), 'Asset /assets/app.js');
  assert.equal(assetResponse.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await send('/assets/app.js', { headers: { Cookie: cookie + 'a' } })).status, 401);
  assert.equal((await send('/', { headers: { Cookie: cookie } }, { ...env, DUTY_ACCESS_PROOF: proofFor('replacement key') })).status, 401);
  assert.equal((await send('/', { headers: { Cookie: cookie } }, env, 'https://preview.duty-test.pages.dev')).status, 401);
  const past = Math.floor(Date.now() / 1000) - 5;
  const pastSig = createHmac('sha256', Buffer.from(env.DUTY_SESSION_KEY, 'hex')).update(`${host}|${env.DUTY_ACCESS_PROOF}|${past}`).digest('hex');
  assert.equal((await send('/', { headers: { Cookie: `__Host-duty_session=${past}.${pastSig}` } })).status, 401);
});

test('login and logout require a same-origin POST and logout clears the cookie', async () => {
  assert.equal((await login(password, 'https://unrelated.example')).status, 403);
  assert.equal((await login('x'.repeat(1024))).status, 401);
  assert.equal((await send('/__access/logout')).status, 405);
  assert.equal((await send('/__access/logout', { method: 'POST' })).status, 403);
  assert.equal((await send('/__access/login', { method: 'POST', headers: { Origin: host }, body: new FormData() })).status, 415);
  const logout = await send('/__access/logout', { method: 'POST', headers: { Origin: host } });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('Set-Cookie'), /^__Host-duty_session=; Max-Age=0;/);
});
