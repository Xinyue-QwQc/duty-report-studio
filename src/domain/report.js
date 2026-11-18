import { AREAS, formatDate, unique, weekday } from './roster.js';

export const AREA_LABELS = { A: 'A 座', B多: 'B 多', B少: 'B 少', C: 'C 座', D: 'D 座' };
export const GUEST_ACTIONS = ['查岗', '体验工作', '请假'];
export const CHANGES = ['请假', '替班', '换班', '增补到岗'];
export const NO = '无';
const NUMBERS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

export function newDraft() {
  return {
    reporter: '',
    manualMembers: [],
    assignments: {},
    ignoreScheduledAreas: false,
    changes: [],
    guests: [],
    lost: [],
    notes: '',
    discipline: '良好',
    excellent: [],
    audit: '',
    feedback: '',
    reflection: '',
    reminded: 'unset',
    played: false,
    teamBooks: [],
  };
}

export function incomingProblem(name, blocked, externalMembers) {
  if (blocked.has(name)) return '该人员已在本班排班或到岗。';
  if (externalMembers?.has(name)) return '该姓名已登记为外部门来访人员。';
  return '';
}

export function attendance(session, draft, { otherMembers, externalMembers } = {}) {
  const errors = [];
  const manualMembers = draft.manualMembers.filter((name) => {
    if (!externalMembers?.has(name)) return true;
    errors.push(`请核对补录的排班人员 ${name}。`);
    return false;
  });
  const planned = unique([...(session?.members || []), ...manualMembers]);
  const plannedNames = new Set(planned);
  let expected = planned.length;
  const list = planned.map((name) => ({ name, original: name }));
  const substitutions = [];
  const exchanges = [];
  const leaves = [];
  for (const change of draft.changes) {
    const index = list.findIndex(({ name, original }) => name === change.outgoing && name === original && plannedNames.has(name));
    const blocked = new Set([...planned, ...list.map(({ name }) => name)]);
    const problem = incomingProblem(change.incoming, blocked, externalMembers);
    const stale = change.incomingSource === 'roster' && otherMembers && !otherMembers.has(change.incoming);
    const canArrive = change.incoming && !problem && !stale;
    if (change.type === '请假' && index >= 0) {
      leaves.push(`${change.outgoing}${change.converted ? '预请假转请假' : ''}`);
      list.splice(index, 1);
    } else if (['替班', '换班'].includes(change.type) && index >= 0 && canArrive) {
      list[index] = { ...list[index], name: change.incoming };
      const changeText = `${change.incoming}${change.type === '替班' ? '替' : '换'}${change.outgoing}`;
      (change.type === '替班' ? substitutions : exchanges).push(changeText);
    } else if (change.type === '增补到岗' && canArrive) {
      list.push({ name: change.incoming, original: change.incoming, counted: change.countActual !== false });
      if (change.countExpected) expected += 1;
    } else {
      errors.push(`请核对${change.outgoing || change.incoming}的${change.type}记录${problem ? `：${problem}` : stale ? '：接班人员未列在当前值班表的其他班次。' : '。'}`);
    }
  }
  const areas = Object.fromEntries(AREAS.map((area) => [area, []]));
  const unassigned = [];
  const scheduledAreas = draft.ignoreScheduledAreas ? {} : Object.fromEntries(
    AREAS.flatMap((area) => (session?.areas?.[area] || []).map((name) => [name, area])),
  );
  for (const { name, original } of list) {
    const area = draft.assignments[name] || draft.assignments[original] || scheduledAreas[original];
    if (AREAS.includes(area)) areas[area].push(name);
    else unassigned.push(name);
  }
  return { list, planned, areas, unassigned, expected, actual: list.filter(({ counted }) => counted !== false).length, substitutions, exchanges, leaves, errors };
}

export function suggestAreas(history, date, shift, members) {
  const day = weekday(date);
  const known = new Set(members);
  const candidates = history.filter((sample) => sample.date < date && sample.shift === shift && weekday(sample.date) === day)
    .map((sample) => ({ date: sample.date, assignments: Object.fromEntries(Object.entries(sample.assignments).filter(([name]) => known.has(name))) }))
    .sort((a, b) => Object.keys(b.assignments).length - Object.keys(a.assignments).length || b.date.localeCompare(a.date));
  return candidates.find((sample) => Object.keys(sample.assignments).length) || null;
}

function value(text) { return String(text || '').trim() || NO; }
const linesOf = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const enumerated = (list) => list.map((line, index) => `${NUMBERS[index] || `${index + 1}. `}${line}`).join('\n');

function field(label, items, number = false) {
  const list = Array.isArray(items) ? items : linesOf(items);
  if (!list.length) return `${label}：无`;
  if (list.length === 1 && !number) return `${label}：${list[0]}`;
  return `${label}：\n${enumerated(list.map((line) => line.replace(/^[①-⑳]\s*/, '')))}`;
}

const UNIT = { 校园卡: '张', 身份证: '张', 银行卡: '张', 手机: '部', 平板: '台', 笔记本电脑: '台', 钱包: '个', 户口簿: '本', 充电宝: '个', 其他: '件' };
export const LOST_ITEMS = Object.keys(UNIT);

export function lostText(item) {
  const place = item.place.trim();
  return `${place ? `${place} ` : ''}${item.type === '其他' ? item.custom : item.type}${item.count}${UNIT[item.type] || '件'}`;
}

export function composeReport(date, shift, draft, counts) {
  const guestNotes = draft.guests.map(({ department, position, person, action }) => `${department}${position}${person}${action}`);
  const teamBooks = draft.teamBooks.map((name) => name.trim()).filter(Boolean);
  const attendees = new Set(counts.list.map(({ name }) => name));
  return [
    `${draft.reporter.trim() || '〔总结人〕'}${formatDate(date)}${shift}班`,
    `本班应到 ${counts.expected}人，实到 ${counts.actual}人`,
    '值班区域与人员分配',
    ...AREAS.map((area) => `${area}：${counts.areas[area].join('、') || NO}`),
    `替班：${counts.substitutions.join('、') || NO}`,
    `换班：${counts.exchanges.join('、') || NO}`,
    `请假：${counts.leaves.join('、') || NO}`,
    '值班情况：',
    `①纪律情况：${value(draft.discipline)}`,
    `②优秀队员：${draft.excellent.filter((name) => attendees.has(name)).join('、') || NO}`,
    field('失物', draft.lost.map(lostText)),
    field('备注', [...guestNotes, ...linesOf(draft.notes)], true),
    field('纪律条例抽查', draft.audit),
    field('意见反馈', draft.feedback),
    field('感想', draft.reflection),
    ...(['omit', 'unset'].includes(draft.reminded) ? [] : [draft.reminded === 'yes' ? '已在值班前两小时提醒队员值班' : '未在值班前两小时提醒队员值班']),
    `本班次${draft.played ? '已' : '未'}玩游戏`,
    teamBooks.length ? `收到${teamBooks.join('、')}队谱` : '未收到队谱',
  ].join('\n');
}

export function reportIssue(date, draft, counts) {
  if (!formatDate(date)) return '请选择值班日期。';
  if (!draft.reporter.trim()) return '请选择总结人。';
  if (counts.errors.length) return counts.errors[0];
  if (!counts.expected && !counts.actual) return '请添加值班人员。';
  if (counts.unassigned.length) return `还有 ${counts.unassigned.length} 人需要分配区域。`;
  if (draft.reminded === 'unset') return '请选择值班提醒情况。';
  return '';
}