export const AREAS = ['A', 'B多', 'B少', 'C', 'D'];
export const SHIFTS = ['中午', '下午', '晚上'];
export const WEEKDAYS = '日一二三四五六';
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function localDate(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index ? String(part).padStart(2, '0') : part).join('-');
}

export function validDate(value) {
  if (!DATE_FORMAT.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

export function weekday(date) {
  return validDate(date) ? new Date(`${date}T00:00:00Z`).getUTCDay() : -1;
}

export function addDays(date, days) {
  if (!validDate(date)) return '';
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatDate(value, showWeekday = true) {
  if (!validDate(value)) return '';
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日${showWeekday ? `周${WEEKDAYS[weekday(value)]}` : ''}`;
}

export function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function names(value) {
  return unique(String(value ?? '').replace(/([\p{Script=Han}·])[ \u3000]+(?=[\p{Script=Han}·](?:[、，,；;|/／\n]|$))/gu, '$1')
    .split(/[、，,；;|/／\s]+/).map((name) => name.trim())
    .filter((name) => /^[\p{Script=Han}·]{2,8}$/u.test(name) && !/^(?:空班|待定|暂无|休息|组长|组员|请假|值班人员|值班组长|无安排)$/.test(name)));
}

function shiftOf(label) {
  return String(label).match(/中午|午间|下午|晚上|晚间|晚班|上午|早上|早班/)?.[0]
    .replace('午间', '中午').replace(/晚间|晚班/, '晚上').replace(/早上|早班/, '上午');
}

function dateOf(label, year) {
  const text = String(label ?? '').trim();
  const match = text.match(/^(?:(20\d{2})\s*[年./-]\s*)?(\d{1,2})\s*[月./-]\s*(\d{1,2})(?:日|(?=\D|$))(?!\s*周值班表)/);
  if (!match) return '';
  const result = `${match[1] || year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return validDate(result) ? result : '';
}

function weekdayOf(label) {
  const match = String(label).match(/(?:周|星期|礼拜)([日天一二三四五六])/);
  return match ? WEEKDAYS.indexOf(match[1].replace('天', '日')) : -1;
}

const areaHeader = (value) => {
  const label = value.normalize('NFKC').toUpperCase().replace(/\s/g, '').replace(/(?:座|区|组|人员|岗)+$/, '');
  return AREAS.includes(label) ? label : '';
};

function headerOf(row) {
  const values = row.map((value) => value.toLowerCase().replace(/\s/g, ''));
  const find = (pattern) => values.findIndex((value) => pattern.test(value));
  const time = find(/^(?:日期|值班日期|时间|值班时间|星期|周几)$/);
  const shift = find(/^(?:班次|时段|值班班次)$/);
  const leader = find(/^(?:值班组长|组长|负责人|总结人)$/);
  const members = find(/^(?:值班人员|队员|人员|组员|成员|名单)$/);
  const expected = find(/^(?:应到|应到人数|人数)$/);
  const areas = Object.fromEntries(values.map((value, index) => [areaHeader(value), index]).filter(([label]) => label));
  return (time >= 0 || shift >= 0) && (members >= 0 || leader >= 0 || Object.keys(areas).length)
    ? { time, shift, leader, members, expected, areas } : null;
}

function cleanLeader(cell) {
  return names(String(cell || '').replace(/\s*[（(]\s*\d+\s*(?:人\s*)?[）)]\s*/g, ''))[0] || '';
}

function numberOf(value) {
  const text = String(value ?? '').trim();
  return /^\d{1,3}$/.test(text) ? +text : null;
}

function scheduleRow({ label, shiftText, leaderText, memberText, areaCells = {}, expectedText, heldDate, heldWeekday, year }) {
  const date = dateOf(label, year) || heldDate;
  const day = date ? weekday(date) : weekdayOf(label) >= 0 ? weekdayOf(label) : heldWeekday;
  const shift = shiftOf(shiftText || label);
  if (day < 0 || !shift) return null;
  const leader = cleanLeader(leaderText);
  const areas = Object.fromEntries(AREAS.map((area) => [area, names(areaCells[area])]));
  const members = unique([leader, ...names(memberText), ...Object.values(areas).flat()]);
  if (!members.length) return null;
  const declared = numberOf(expectedText) ?? numberOf(String(leaderText ?? '').match(/[（(]\s*(\d+)\s*(?:人\s*)?[）)]/)?.[1]);
  return { date, weekday: day, shift, leader, members, areas, declared };
}

export function parseScheduleTables(sheets, title, year = new Date().getFullYear()) {
  const sessions = [];
  for (const sheet of sheets) {
    let header = null;
    let heldDate = '';
    let heldWeekday = -1;
    for (const rawRow of sheet.rows) {
      const row = rawRow.map((cell) => String(cell ?? '').trim());
      const nextHeader = headerOf(row);
      if (nextHeader) { header = nextHeader; heldDate = ''; heldWeekday = -1; continue; }
      if (!header) continue;
      const label = row[header.time] || '';
      if (label) {
        heldDate = dateOf(label, year);
        heldWeekday = weekdayOf(label);
      }
      const result = scheduleRow({
        label, shiftText: row[header.shift], leaderText: row[header.leader], memberText: row[header.members],
        expectedText: row[header.expected], areaCells: Object.fromEntries(Object.entries(header.areas).map(([area, index]) => [area, row[index]])),
        heldDate, heldWeekday, year,
      });
      if (result) sessions.push(result);
    }
  }
  return scheduleResult(sessions, title);
}

function scheduleResult(sessions, title) {
  if (!sessions.length) throw new Error('没有识别到值班人员。请使用含值班时间、组长、人员的表格，或下载标准导入模板。');
  const errors = [];
  const keys = new Set();
  for (const session of sessions) {
    const label = `${session.date ? formatDate(session.date) : `周${WEEKDAYS[session.weekday]}`}${session.shift}班`;
    const key = `${session.date || session.weekday}/${session.shift}`;
    if (keys.has(key)) errors.push(`${label}有重复记录`);
    keys.add(key);
    if (session.declared !== null && session.declared !== session.members.length) {
      errors.push(`${label}标注 ${session.declared} 人，识别到 ${session.members.length} 个姓名`);
    }
    const areaNames = Object.values(session.areas).flat();
    if (areaNames.length !== new Set(areaNames).size) errors.push(`${label}有人员被安排到多个区域`);
  }
  return { title, sessions, warnings: errors };
}

export function scheduleRange(sessions, today) {
  const dates = sessions.map((session) => session.date).filter(Boolean).sort();
  if (dates.length === sessions.length) return { start: dates[0], end: dates.at(-1) };
  const day = weekday(today);
  const start = addDays(today, -((day + 6) % 7));
  return { start, end: addDays(start, 6) };
}

function effectiveSessions(schedules, date) {
  const day = weekday(date);
  for (const schedule of schedules) {
    if (date < schedule.start || date > schedule.end) continue;
    const dated = schedule.sessions.filter((session) => session.date === date);
    if (dated.length) return { schedule, sessions: dated };
    const weekly = schedule.sessions.filter((session) => !session.date);
    if (weekly.length) return { schedule, sessions: weekly.filter((session) => session.weekday === day) };
  }
  return null;
}

export function sessionFor(schedules, date, shift) {
  const effective = effectiveSessions(schedules, date);
  const session = effective?.sessions.find((item) => item.shift === shift);
  return session ? { ...session, source: effective.schedule.name } : null;
}

export function rosterPeopleFor(schedules, date, shift) {
  const session = sessionFor(schedules, date, shift);
  const allSessions = schedules.flatMap((schedule) => schedule.sessions);
  const leaders = unique([session?.leader, ...allSessions.map((item) => item.leader)]);
  const currentMembers = new Set(session?.members);
  const periods = schedules.filter((schedule) => schedule.start <= date && date <= schedule.end);
  const members = new Set();
  const otherMembers = new Set();

  if (!periods.length) {
    for (const item of allSessions) for (const name of item.members) members.add(name);
    return { leaders, members, otherMembers };
  }

  // Single-day updates can overlap a weekly roster. Resolve each day using the
  // same import priority as the current shift, within the periods covering it.
  const start = periods.reduce((first, period) => period.start < first ? period.start : first, date);
  const end = periods.reduce((last, period) => period.end > last ? period.end : last, date);
  for (const day of rosterSampleDates(schedules, start, end, date)) {
    const slots = effectiveSessions(schedules, day)?.sessions || [];
    const seenShifts = new Set();
    for (const item of slots) {
      if (seenShifts.has(item.shift)) continue;
      seenShifts.add(item.shift);
      for (const name of item.members) {
        members.add(name);
        if ((day !== date || item.shift !== shift) && !currentMembers.has(name)) otherMembers.add(name);
      }
    }
  }
  return { leaders, members, otherMembers };
}

function rosterSampleDates(schedules, start, end, currentDate) {
  // Between effective-date boundaries the same weekly shifts repeat.
  const boundaries = new Set([start, currentDate, addDays(currentDate, 1)]);
  for (const schedule of schedules) {
    if (schedule.start > end || schedule.end < start) continue;
    boundaries.add(schedule.start);
    boundaries.add(addDays(schedule.end, 1));
    for (const { date } of schedule.sessions) {
      if (date >= schedule.start && date <= schedule.end) {
        boundaries.add(date);
        boundaries.add(addDays(date, 1));
      }
    }
  }
  const starts = [...boundaries].filter((date) => start <= date && date <= end).sort();
  return starts.flatMap((first, index) => {
    const dates = [];
    const next = starts[index + 1];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(first, offset);
      if (!date || date > end || (next && date >= next)) break;
      dates.push(date);
    }
    return dates;
  });
}
