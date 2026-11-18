import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import gate from '../pages/_worker.js';
import { sqliteBinding } from '../scripts/local-shared.mjs';
import { readPersonal, schedulePayload, writePersonal } from '../src/domain/storage.js';
import { AREAS, weekday } from '../src/domain/roster.js';

const origin = 'https://duty-test.pages.dev';
const schedule = {
  id: randomUUID(), start: '2099-06-01', end: '2099-06-01', name: '原文件名.docx', title: '原文标题',
  sessions: [{ date: '2099-06-01', weekday: weekday('2099-06-01'), shift: '中午', leader: '组长甲',
    declared: 1, members: ['组长甲'], areas: Object.fromEntries(AREAS.map((area) => [area, area === 'A' ? ['组长甲'] : []])) }],
};
const personal = { directory: [{ department: '部门甲', position: '岗位甲', people: ['仅本机'] }], drafts: { today: { feedback: '个人填写' } } };

function setup(t) {
  const key = 'test-key';
  const db = sqliteBinding(':memory:');
  t.after(() => db.close());
  const env = {
    DUTY_ACCESS_PROOF: createHmac('sha256', key).update('duty-workbench:access:v1').digest('hex'),
    DUTY_SESSION_KEY: 'aa'.repeat(32),
    SHARED_DB: db,
    ASSETS: { fetch: () => new Response('static') },
  };
  const send = (path, init) => gate.fetch(new Request(origin + path, init), env);
  const login = async () => {
    const response = await send('/__access/login', { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ key }) });
    assert.equal(response.status, 303);
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    return (path, method = 'GET', body, csrfOrigin = origin) => send(path, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json', Origin: csrfOrigin } : {}) },
      body: body && JSON.stringify(body),
    });
  };
  return { db, send, login };
}

test('two authorized browsers see common schedules and directory edits without storing source metadata', async (t) => {
  const { login } = setup(t);
  const [first, second] = await Promise.all([login(), login()]);
  assert.deepEqual(await (await second('/__shared')).json(), { schedules: [], directory: [] });
  const body = schedulePayload(schedule);
  assert.deepEqual(Object.keys(body), ['id', 'start', 'end', 'sessions']);
  const save = await first('/__shared/schedules', 'POST', body);
  assert.equal(save.status, 200);
  assert.equal(save.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await first('/__shared/schedules', 'POST', body)).status, 200);
  const person = { department: '部门甲', position: '岗位甲', person: '共用姓名' };
  assert.equal((await first('/__shared/directory', 'POST', person)).status, 200);
  const remote = await (await second('/__shared')).json();
  assert.deepEqual(remote, { schedules: [{ ...body, name: '共用值班表' }], directory: [{ department: person.department, position: person.position, people: [person.person] }] });
  assert.equal((await second('/__shared/directory', 'DELETE', person)).status, 200);
  assert.deepEqual((await (await first('/__shared')).json()).directory, []);
});

test('shared tables reject anonymous and cross-origin writes and accept only shared fields', async (t) => {
  const { login, send, db } = setup(t);
  assert.equal((await send('/__shared')).status, 401);
  const person = { department: '部门甲', position: '岗位甲', person: '共用姓名' };
  const post = { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(person) };
  assert.equal((await send('/__shared/directory', post)).status, 401);
  const call = await login();
  const body = schedulePayload(schedule);
  assert.equal((await call('/__shared/directory', 'POST', person, 'https://other.test')).status, 403);
  assert.equal((await call('/__shared/schedules', 'POST', { ...body, drafts: personal.drafts })).status, 400);
  assert.equal((await call('/__shared/schedules', 'POST', { ...body, sessions: [{ ...body.sessions[0], feedback: '个人填写' }] })).status, 400);
  assert.equal((await call('/__shared/directory', 'POST', { ...person, action: '查岗' })).status, 400);
  assert.equal((await call('/__shared/drafts', 'POST', personal)).status, 404);
  const counts = await db.batch([db.prepare('SELECT count(*) AS n FROM shared_schedules'), db.prepare('SELECT count(*) AS n FROM shared_directory')]);
  assert.deepEqual(counts.map((entry) => entry.results[0].n), [0, 0]);
});

test('browser storage retains personal history and removes legacy rosters after migration', (t) => {
  let stored = JSON.stringify({ ...personal, schedules: [schedule] });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Local storage should not make network requests'));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const loaded = readPersonal();
  assert.deepEqual(loaded, { ...personal, legacySchedules: [schedule] });
  writePersonal({ ...loaded, legacySchedules: [], schedules: [schedule], shared: { directory: [schedule] } });
  assert.deepEqual(JSON.parse(stored), personal);
});
