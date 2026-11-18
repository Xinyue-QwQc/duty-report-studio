import { AREAS } from './roster.js';

const DATA_KEY = 'duty-report-studio-v1';
const empty = { drafts: {} };
export const emptyShared = { schedules: [], directory: [] };

export function readPersonal() {
  try {
    const stored = JSON.parse(localStorage.getItem(DATA_KEY));
    return {
      drafts: stored?.drafts && typeof stored.drafts === 'object' && !Array.isArray(stored.drafts) ? stored.drafts : {},
    };
  } catch { return empty; }
}

export function writePersonal({ drafts }) {
  const saved = readPersonal();
  localStorage.setItem(DATA_KEY, JSON.stringify({ drafts: { ...saved.drafts, ...drafts } }));
}

export function schedulePayload({ id, start, end, sessions }) {
  return { id, start, end, sessions: sessions.map(({ date, weekday, shift, leader, members, areas, declared }) => ({
    date: date || '', weekday, shift, leader: leader || '', members,
    areas: Object.fromEntries(AREAS.map((area) => [area, areas?.[area] || []])), declared: declared ?? null,
  })) };
}

export async function sharedRequest(path = '', method = 'GET', body) {
  const response = await fetch('/__shared' + path, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) throw new Error('登录已过期，请重新登录。');
  if (response.status === 400) throw new Error('资料格式有误或内容过长。');
  if (!response.ok) throw new Error('暂时无法连接服务器。');
  const snapshot = await response.json();
  if (!Array.isArray(snapshot.schedules) || !Array.isArray(snapshot.directory)) throw new Error('无法读取值班资料。');
  return snapshot;
}
