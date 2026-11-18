import test from 'node:test';
import assert from 'node:assert/strict';
import { set_cptable, utils, write } from 'xlsx';
import * as codepages from 'xlsx/dist/cpexcel';
import { AREAS, formatDate, parseScheduleTables, rosterPeopleFor, scheduleRange, sessionFor, SHIFTS } from '../src/domain/roster.js';
import { parseScheduleFile } from '../src/domain/readers.js';
import { attendance, composeReport, newDraft, reportIssue, suggestAreas } from '../src/domain/report.js';

set_cptable(codepages);

function generate(date, shift, draft, session = null) {
  const counts = attendance(session, draft);
  return { text: composeReport(date, shift, draft, counts), counts, issue: reportIssue(date, draft, counts) };
}

test('shift selector uses only the three supported shifts', () => {
  assert.deepEqual(SHIFTS, ['中午', '下午', '晚上']);
});

test('a recurring schedule defaults to the current calendar week', () => {
  assert.deepEqual(scheduleRange([{ date: '', weekday: 3 }], '2099-06-03'), { start: '2099-06-01', end: '2099-06-07' });
});

test('attendance separates leave, cover, shift exchange, and people outside the total', () => {
  const original = { members: ['组长甲', '队员甲', '队员乙', '队员丙'], areas: { A: ['组长甲', '队员甲'], 'B多': ['队员乙'], C: ['队员丙'] } };
  const draft = {
    ...newDraft(), reporter: '组长甲', reminded: 'yes', assignments: { 队员丁: 'D' },
    changes: [
      { type: '请假', outgoing: '队员甲', converted: true },
      { type: '替班', outgoing: '队员乙', incoming: '队员戊' },
      { type: '换班', outgoing: '队员丙', incoming: '队员己' },
      { type: '增补到岗', incoming: '队员丁', countExpected: false, countActual: false },
    ],
    lost: [{ type: '平板', count: 1, place: '值班台', custom: '' }],
    guests: [{ department: '示例部门', position: '队长', person: '访客甲', action: '请假' }],
    excellent: ['组长甲'], audit: '抽查通过', feedback: '复习路线', reflection: '注意进度',
    teamBooks: ['队员己', '组长甲'], played: true,
  };
  const { text, issue } = generate('2026-11-18', '晚上', draft, original);
  assert.equal(issue, '');
  for (const line of ['本班应到 4人，实到 3人', 'A：组长甲', 'B多：队员戊', 'C：队员己', 'D：队员丁', '替班：队员戊替队员乙', '换班：队员己换队员丙', '请假：队员甲预请假转请假', '②优秀队员：组长甲', '失物：值班台 平板1台', '①示例部门队长访客甲请假', '纪律条例抽查：抽查通过', '意见反馈：复习路线', '感想：注意进度', '已在值班前两小时提醒队员值班', '本班次已玩游戏', '收到队员己、组长甲队谱']) assert.ok(text.split('\n').includes(line), line);
});

test('clearing zones returns roster presets and manual assignments to the unassigned list', () => {
  const session = { members: ['组长甲', '队员甲', '队员乙'], areas: { A: ['组长甲', '队员甲'] } };
  const draft = {
    ...newDraft(), assignments: { 队员乙: 'D' }, changes: [{ type: '请假', outgoing: '队员甲' }],
  };
  assert.deepEqual(attendance(session, draft).unassigned, []);
  const cleared = { ...draft, assignments: {}, ignoreScheduledAreas: true };
  const counts = attendance(session, cleared);
  assert.deepEqual(counts.unassigned, ['组长甲', '队员乙']);
  assert.deepEqual(counts.leaves, ['队员甲']);
  assert.ok(AREAS.every((area) => counts.areas[area].length === 0));
  const reassigned = attendance(session, { ...cleared, assignments: { 组长甲: 'B多' } });
  assert.deepEqual(reassigned.areas.B多, ['组长甲']);
  assert.deepEqual(reassigned.unassigned, ['队员乙']);
});

test('roster picks list only leads, prefer this shift, and limit relief to other effective shifts', () => {
  const weekly = {
    name: '周排班', start: '2026-11-16', end: '2026-11-22', sessions: [
      { weekday: 3, shift: '中午', leader: '原组长', members: ['原组长', '原队员'] },
      { weekday: 4, shift: '中午', leader: '周四组长', members: ['周四组长', '共同队员'] },
      { weekday: 5, shift: '中午', leader: '周五组长', members: ['周五组长', '旧队员'] },
    ],
  };
  const override = {
    name: '临时排班', start: '2026-11-18', end: '2026-11-20', sessions: [
      { date: '2026-11-18', shift: '中午', leader: '当班组长', members: ['当班组长', '共同队员'] },
      { date: '2026-11-18', shift: '晚上', leader: '晚班组长', members: ['晚班组长', '晚班队员'] },
      { date: '2026-11-20', shift: '下午', leader: '新组长', members: ['新组长', '新队员'] },
    ],
  };
  const expired = {
    name: '旧排班', start: '2026-11-09', end: '2026-11-15', sessions: [
      { weekday: 3, shift: '晚上', leader: '前期组长', members: ['前期组长', '前期队员'] },
    ],
  };
  const schedules = [weekly, override, expired];
  // The most recently imported table comes first.
  const effective = [override, weekly, expired];
  const roster = rosterPeopleFor(effective, '2026-11-18', '中午');
  assert.equal(roster.leaders[0], '当班组长');
  assert.deepEqual(new Set(roster.leaders), new Set(schedules.flatMap(({ sessions }) => sessions.map(({ leader }) => leader))));
  assert.deepEqual(roster.otherMembers, new Set(['晚班组长', '晚班队员', '周四组长', '新组长', '新队员']));
  assert.ok(roster.members.has('共同队员'));
  assert.ok(!roster.members.has('前期队员'));
  assert.equal(sessionFor(effective, '2026-11-20', '中午'), null);
  assert.equal(rosterPeopleFor(effective, '2026-11-30', '中午').otherMembers.size, 0);
});

test('attendance excludes this shift and active relief from changes, even when restoring old drafts', () => {
  const session = { members: ['组长甲', '队员甲', '队员乙', '队员丙'], areas: { A: ['组长甲', '队员甲', '队员乙', '队员丙'] } };
  const draft = {
    ...newDraft(), reporter: '组长甲', reminded: 'yes',
    changes: [
      { type: '请假', outgoing: '队员甲' },
      { type: '换班', outgoing: '队员乙', incoming: '队员甲' },
      { type: '替班', outgoing: '组长甲', incoming: '来访组长' },
      { type: '换班', outgoing: '队员乙', incoming: '旧表人员', incomingSource: 'roster' },
      { type: '替班', outgoing: '队员乙', incoming: '其他班员', incomingSource: 'roster' },
      { type: '请假', outgoing: '其他班员' },
      { type: '换班', outgoing: '队员丙', incoming: '其他班员', incomingSource: 'roster' },
      { type: '换班', outgoing: '队员丙', incoming: '本岗补录', incomingSource: 'manual' },
    ],
  };
  const counts = attendance(session, draft, { otherMembers: new Set(['其他班员']), externalMembers: new Set(['来访组长']) });
  assert.deepEqual(counts.planned, session.members);
  assert.deepEqual(counts.areas.A, ['组长甲', '其他班员', '本岗补录']);
  assert.equal(counts.expected, 4);
  assert.equal(counts.actual, 3);
  assert.deepEqual(counts.leaves, ['队员甲']);
  assert.deepEqual(counts.substitutions, ['其他班员替队员乙']);
  assert.deepEqual(counts.exchanges, ['本岗补录换队员丙']);
  assert.equal(counts.errors.length, 5);
  assert.equal(reportIssue('2026-11-18', draft, counts), counts.errors[0]);
});

test('the app flags incomplete rosters and asks for a reminder choice before export', () => {
  const draft = { ...newDraft(), reporter: '组长甲', manualMembers: ['组长甲'] };
  assert.equal(generate('2026-11-18', '中午', draft).issue, '还有 1 人需要分配区域。');
  draft.assignments = { 组长甲: 'A' };
  assert.equal(generate('2026-11-18', '中午', draft).issue, '请选择值班提醒情况。');
  draft.reminded = 'no';
  assert.match(generate('2026-11-18', '中午', draft).text, /未在值班前两小时提醒队员值班/);
});

test('historical area suggestions use earlier records for the same weekday and shift', () => {
  const history = [
    { date: '2026-11-04', shift: '中午', assignments: { 队员甲: 'A', 队员乙: 'D' } },
    { date: '2026-11-11', shift: '下午', assignments: { 队员甲: 'B多' } },
    { date: '2026-11-11', shift: '中午', assignments: { 队员甲: 'C', 队员丙: 'D' } },
    { date: '2026-11-18', shift: '中午', assignments: { 队员甲: 'B少' } },
  ];
  assert.deepEqual(suggestAreas(history, '2026-11-18', '中午', ['队员甲']), {
    date: '2026-11-11', assignments: { 队员甲: 'C' },
  });
  assert.equal(suggestAreas([], '2026-11-18', '中午', ['队员甲']), null);
});

for (const format of ['csv', 'xlsx', 'xls']) {
  test(`import a dated ${format.toUpperCase()} roster with complete area assignments`, async () => {
    const header = ['日期', '班次', '组长', '人员', ...AREAS];
    const rosterRow = ['2026-11-18', '中午', '组长甲', '队员甲、队员乙', '组长甲', '队员甲', '队员乙', '', ''];
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([header, rosterRow]), '排班');
    const buffer = format === 'csv' ? '\uFEFF' + [header, rosterRow].map((row) => row.join(',')).join('\n') : write(workbook, { type: 'array', bookType: format === 'xls' ? 'biff8' : 'xlsx' });
    const parsed = await parseScheduleFile(new File([buffer], `排班.${format}`), { year: 2026 });
    const session = parsed.sessions[0];
    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(session.members, ['组长甲', '队员甲', '队员乙']);
    assert.deepEqual(session.areas, { A: ['组长甲'], B多: ['队员甲'], B少: ['队员乙'], C: [], D: [] });
    assert.equal(session.date, '2026-11-18');
  });
}

test('malformed expected headcount and duplicates are flagged before import', () => {
  const rows = [
    ['值班时间', '值班组长', '值班人员'], ['周二中午', '组长甲（4）', '队员甲、队员乙'], ['周二中午', '组长甲（2）', '队员乙'],
  ];
  const result = parseScheduleTables([{ rows }], '测试');
  assert.deepEqual(result.warnings, ['周二中午班标注 4 人，识别到 3 个姓名', '周二中午班有重复记录']);
});