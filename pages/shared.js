import { AREAS, SHIFTS, names, validDate, weekday } from '../src/domain/roster.js';

export const SHARED_PATH = '/__shared';
const MAX_BODY = 512 * 1024;
const calendarShifts = [...SHIFTS, '上午'];
const shape = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const calendarDate = (date) => typeof date === 'string' && validDate(date);
const rosterName = (name) => typeof name === 'string' && names(name)[0] === name;

function validSchedule(value) {
  if (!shape(value, ['id', 'start', 'end', 'sessions'])) return false;
  const { id, start, end, sessions } = value;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)
      || !calendarDate(start) || !calendarDate(end) || start > end || !Array.isArray(sessions) || !sessions.length) return false;
  const keys = new Set();
  let applicable = false;
  for (const entry of sessions) {
    if (!shape(entry, ['date', 'weekday', 'shift', 'leader', 'members', 'areas', 'declared'])) return false;
    if (!calendarShifts.includes(entry.shift) || !Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6
        || (entry.date !== '' && (!calendarDate(entry.date) || weekday(entry.date) !== entry.weekday))) return false;
    const { members, leader, areas, declared } = entry;
    if (!Array.isArray(members) || !members.length || !members.every(rosterName) || (leader !== '' && !members.includes(leader))
        || (declared !== null && declared !== members.length) || !shape(areas, AREAS)) return false;
    const listed = new Set(members);
    if (listed.size !== members.length) return false;
    const assigned = new Set();
    for (const area of AREAS) {
      if (!Array.isArray(areas[area])) return false;
      for (const person of areas[area]) {
        if (!listed.has(person) || assigned.has(person)) return false;
        assigned.add(person);
      }
    }
    const key = (entry.date || entry.weekday) + '/' + entry.shift;
    if (keys.has(key)) return false;
    keys.add(key);
    if (!entry.date || (entry.date >= start && entry.date <= end)) applicable = true;
  }
  return applicable;
}

function validPerson(record) {
  const field = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
    && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
  return shape(record, ['department', 'position', 'person']) && field(record.department, 40)
    && field(record.position, 25) && field(record.person, 30);
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return JSON.parse(text + decoder.decode());
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
}

function listDirectory(rows) {
  const roles = new Map();
  for (const { department, position, person } of rows) {
    const key = JSON.stringify([department, position]);
    if (!roles.has(key)) roles.set(key, { department, position, people: [] });
    roles.get(key).people.push(person);
  }
  return [...roles.values()];
}

async function sharedSnapshot(db, changes) {
  const [schedules, directory] = (await db.batch([
    ...changes,
    db.prepare('SELECT id, start_date, end_date, sessions_json FROM shared_schedules ORDER BY rowid DESC'),
    db.prepare('SELECT department, position, person FROM shared_directory ORDER BY department, position, person'),
  ])).slice(-2);
  return {
    schedules: schedules.results.map(({ id, start_date, end_date, sessions_json }) => ({
      id, start: start_date, end: end_date, name: '共用值班表', sessions: JSON.parse(sessions_json),
    })),
    directory: listDirectory(directory.results),
  };
}

export function isSharedPath(path) {
  return path === SHARED_PATH || path.startsWith(SHARED_PATH + '/');
}

export async function handleShared(request, db) {
  const url = new URL(request.url);
  const method = request.method;
  const isSnapshot = url.pathname === SHARED_PATH;
  const isSchedule = url.pathname === SHARED_PATH + '/schedules';
  const isDirectory = url.pathname === SHARED_PATH + '/directory';
  if (!isSnapshot && !isSchedule && !isDirectory) return new Response(null, { status: 404 });
  const allowed = isSnapshot ? ['GET'] : isSchedule ? ['POST'] : ['POST', 'DELETE'];
  if (!allowed.includes(method)) return new Response(null, { status: 405, headers: { Allow: allowed.join(', ') } });
  if (!db) return new Response(null, { status: 503 });
  const changes = [];
  if (!isSnapshot) {
    if (request.headers.get('Origin') !== url.origin) return new Response(null, { status: 403 });
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return new Response(null, { status: 415 });
    }
    const body = await readJson(request);
    if (isSchedule) {
      if (!validSchedule(body)) return new Response(null, { status: 400 });
      changes.push(db.prepare('INSERT INTO shared_schedules (id, start_date, end_date, sessions_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(body.id, body.start, body.end, JSON.stringify(body.sessions)));
    } else {
      if (!validPerson(body)) return new Response(null, { status: 400 });
      const sql = method === 'POST'
        ? 'INSERT OR IGNORE INTO shared_directory (department, position, person) VALUES (?, ?, ?)'
        : 'DELETE FROM shared_directory WHERE department = ? AND position = ? AND person = ?';
      changes.push(db.prepare(sql).bind(body.department, body.position, body.person));
    }
  }
  return Response.json(await sharedSnapshot(db, changes), { headers: { 'Cache-Control': 'private, no-store' } });
}
