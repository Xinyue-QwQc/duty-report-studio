import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList,
  Copy, FileSpreadsheet, LayoutGrid, Plus, RefreshCw, ShieldCheck, Sparkles, Upload, Users, X } from 'lucide-react';
import { Button, Chips, Field, Modal, Panel, RuleRow, SelectField, downloadText } from './components.jsx';
import { ChangeForm, GuestForm, LostForm, MemberForm, UploadForm, roleKey } from './forms.jsx';
import { addDays, AREAS, formatDate, localDate, rosterPeopleFor, sessionFor, SHIFTS, unique, validDate, WEEKDAYS } from './domain/roster.js';
import { AREA_LABELS, attendance, CHANGES, composeReport, lostText, newDraft, reportIssue, suggestAreas } from './domain/report.js';

import { emptyShared, readPersonal, schedulePayload, sharedRequest, writePersonal } from './domain/storage.js';

const toggle = (items, item) => items.includes(item) ? items.filter((value) => value !== item) : [...items, item];

function shiftOnDate(schedules, date, current) {
  const currentIsSelectable = SHIFTS.includes(current);
  if (currentIsSelectable && sessionFor(schedules, date, current)) return current;
  return SHIFTS.find((shift) => sessionFor(schedules, date, shift)) ?? (currentIsSelectable ? current : SHIFTS[0]);
}

function rememberGuest(directory, record) {
  const existing = directory.find((role) => roleKey(role) === roleKey(record));
  const entry = {
    department: record.department, position: record.position,
    people: unique([record.person, ...(existing?.people || [])]),
    actions: unique([record.action, ...(existing?.actions || [])]),
  };
  return existing ? directory.map((role) => roleKey(role) === roleKey(record) ? entry : role) : [...directory, entry];
}

function TextForm({ title, value, onClose, onSave }) {
  const [text, setText] = useState(value);
  return <Modal title={title} onClose={onClose}>
    <div className="dialog-body">
      <Field label="正文"><textarea rows="4" value={text} onChange={(event) => setText(event.target.value)} placeholder="每条单独一行" /></Field>
      <div className="dialog-actions"><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={() => onSave(text.trim())}>确定</Button></div>
    </div>
  </Modal>;
}

function SmallRecords({ items, onRemove }) {
  if (!items.length) return null;
  return <div className="records">{items.map((item, index) => <div className="record" key={`${index}-${item}`}><span>{item}</span><button type="button" className="icon-button" onClick={() => onRemove(index)} aria-label={`移除${item}`}><X size={15} /></button></div>)}</div>;
}

function DateSetup({ date, shift, reporter, leaders, session, schedules, onDate, onShift, onReporter, onUpload }) {
  return <Panel title="班次信息" icon={CalendarDays} className="date-panel" action={
    <span className={`source-status ${session ? 'matched' : ''}`}><span className="status-dot" />{session ? '已匹配值班表' : '手动班次'}</span>
  }>
    <div className="form-grid meta-grid">
      <div className="leader-field-wrap">
        <SelectField label="总结人（组长）" value={reporter} items={leaders} onChange={onReporter}
          disabled={!leaders.length} placeholder={leaders.length ? '选择组长' : '值班表未列组长'} />
      </div>
      <Field label="值班日期"><input value={date} type="date" onChange={(event) => { if (validDate(event.target.value)) onDate(event.target.value); }} /></Field>
      <SelectField label="班次" value={shift} onChange={onShift} items={SHIFTS.map((item) => ({ value: item, label: `${item}班${sessionFor(schedules, date, item) ? '' : '（无排班）'}` }))} />
    </div>
    <div className="date-footer">
      <div className="date-browse">
        <button type="button" className="icon-button icon-small" aria-label="前一天" onClick={() => onDate(addDays(date, -1))}><ChevronLeft size={17} /></button>
        <button type="button" className="text-button" onClick={() => onDate(localDate())}>今天</button>
        <button type="button" className="icon-button icon-small" aria-label="后一天" onClick={() => onDate(addDays(date, 1))}><ChevronRight size={17} /></button>
      </div>
      <span className="roster-source" title={session?.source || ''}><FileSpreadsheet size={14} />{session ? session.source : '所选日期及班次无排班'}</span>
      {!session && <button type="button" className="text-button" onClick={onUpload}>导入</button>}
    </div>
  </Panel>;
}

function Staffing({ session, date, shift, history, draft, counts, patch, modal, notice, refreshing, onRefresh }) {
  const [selected, setSelected] = useState([]);
  const activeNames = counts.list.map(({ name }) => name);
  const activeSelection = selected.filter((name) => activeNames.includes(name));
  const suggestion = suggestAreas(history, date, shift, activeNames);
  const selectionNote = activeSelection.length ? `已选 ${activeSelection.length} 人，点击下方区域分配` : '先选择人员，再点击下方的区域名称。';
  const countRows = [{ label: '应到', value: counts.expected }, { label: '实到', value: counts.actual }, { label: '待分区', value: counts.unassigned.length }];

  const applySuggestion = () => {
    const remaining = new Set(counts.unassigned);
    const applicable = Object.entries(suggestion.assignments).filter(([name]) => remaining.has(name));
    patch({ assignments: { ...draft.assignments, ...Object.fromEntries(applicable) } });
    notice(`已为 ${applicable.length} 人填入历史分区`);
  };
  const move = (area) => {
    if (!activeSelection.length) return;
    patch({ assignments: { ...draft.assignments, ...Object.fromEntries(activeSelection.map((name) => [name, area])) } });
    setSelected([]);
  };
  return <Panel title="人员与分区" icon={Users} action={<div className="staffing-actions">
    {(!session || draft.manualMembers.length > 0) && <Button icon={Plus} onClick={() => modal('members')} className="small">{session ? '编辑补录人员' : '选择排班人员'}</Button>}
    <Button icon={RefreshCw} onClick={onRefresh} disabled={refreshing} className="small" title="重新读取服务器上的共用排班">{refreshing ? '刷新中…' : '刷新'}</Button>
  </div>}>
    <div className="attendance-strip">{countRows.map(({ label, value }, index) => <div key={label} className={`attendance-metric ${index === 2 && value ? 'pending-metric' : ''}`}><span>{label}</span><strong>{value}</strong><small>人</small></div>)}</div>
    <div className="assign-head"><span>{selectionNote}</span>{suggestion && counts.unassigned.some((name) => suggestion.assignments[name]) && <Button icon={Sparkles} kind="soft" className="small" title={`历史来源 ${formatDate(suggestion.date)}`} onClick={applySuggestion}>套用历史分区</Button>}</div>
    {counts.unassigned.length > 0 && <Chips label="待分区人员" values={counts.unassigned} selected={activeSelection} onClick={(name) => setSelected((current) => toggle(current, name))} />}
    {!activeNames.length && <p className="muted empty-line">选择排班人员后即可分配区域。</p>}
    <div className="area-grid" aria-label="值班区域">
      {AREAS.map((area, index) => <div className={`area area-${index} ${activeSelection.length ? 'can-assign' : ''}`} key={area}>
        <button type="button" className="area-label" onClick={() => move(area)} disabled={!activeSelection.length} aria-label={`分配至${AREA_LABELS[area]}`}><span>{AREA_LABELS[area]}</span><small>{counts.areas[area].length}</small></button>
        {counts.areas[area].length ? <Chips label={`${AREA_LABELS[area]}人员`} values={counts.areas[area]} selected={activeSelection} onClick={(name) => setSelected((current) => toggle(current, name))} /> : <span className="area-empty">—</span>}
      </div>)}
    </div>
    <div className="minor-head"><h3>人员变动</h3><div className="action-cluster">
      {CHANGES.map((type) => <Button key={type} icon={Plus} kind="ghost" className="small" onClick={() => modal('change', type)}>{type}</Button>)}
    </div></div>
    <SmallRecords items={draft.changes.map((change) => change.type === '请假'
      ? `${change.outgoing} · ${change.converted ? '预请假转请假' : '请假'}` : change.type === '增补到岗' ? `${change.incoming} · 增补到岗` : `${change.incoming}${change.type === '替班' ? '替' : '换'}${change.outgoing}`)}
      onRemove={(index) => patch({ changes: draft.changes.filter((_, i) => i !== index) })} />
    {counts.errors.length > 0 && <div className="form-error">{counts.errors.join(' ')}</div>}
  </Panel>;
}

function WorkLog({ draft, patch, modal }) {
  const briefFields = [['audit', '纪律条例抽查'], ['feedback', '意见反馈'], ['reflection', '感想']];
  return <>
    <Panel title="值班情况" icon={ShieldCheck} className="log-panel" id="work-log">
      <RuleRow label="纪律情况"><button type="button" className="status-button" onClick={() => modal('text', ['discipline', '纪律情况'])}><span className="status-dot" />{draft.discipline || '填写'}<ChevronRight size={15} /></button></RuleRow>
      <RuleRow label="优秀队员"><button type="button" className="status-button" onClick={() => modal('excellent')}>{draft.excellent.join('、') || '无'}<ChevronRight size={15} /></button></RuleRow>
      <RuleRow label="值班前两小时提醒"><div className="segments"><button type="button" className={draft.reminded === 'yes' ? 'active' : ''} onClick={() => patch({ reminded: 'yes' })}>已提醒</button><button type="button" className={draft.reminded === 'no' ? 'active' : ''} onClick={() => patch({ reminded: 'no' })}>未提醒</button><button type="button" className={draft.reminded === 'omit' ? 'active' : ''} onClick={() => patch({ reminded: 'omit' })}>省略</button></div></RuleRow>
      <RuleRow label="班次游戏"><div className="segments"><button type="button" className={!draft.played ? 'active' : ''} onClick={() => patch({ played: false })}>未玩</button><button type="button" className={draft.played ? 'active' : ''} onClick={() => patch({ played: true })}>已玩</button></div></RuleRow>
      <RuleRow label="收到队谱"><button type="button" className="status-button" onClick={() => modal('teamBooks')}>{draft.teamBooks.join('、') || '未收到'}<ChevronRight size={15} /></button></RuleRow>
    </Panel>
    <Panel title="失物与备注" icon={ClipboardList}>
      <div className="minor-head sub"><h3>失物</h3><Button icon={Plus} kind="ghost" className="small" onClick={() => modal('lost')}>添加失物</Button></div>
      {draft.lost.length ? <SmallRecords items={draft.lost.map(lostText)} onRemove={(index) => patch({ lost: draft.lost.filter((_, i) => i !== index) })} /> : <p className="muted empty-line">无</p>}
      <div className="minor-head sub"><h3>来访备注</h3><div className="action-cluster"><Button kind="ghost" icon={Plus} className="small" onClick={() => modal('guest', '查岗')}>查岗</Button><Button kind="ghost" icon={Plus} className="small" onClick={() => modal('guest', '体验工作')}>体验工作</Button></div></div>
      {draft.guests.length ? <SmallRecords items={draft.guests.map(({ department, position, person, action }) => `${department}${position}${person}${action}`)} onRemove={(index) => patch({ guests: draft.guests.filter((_, i) => i !== index) })} /> : <p className="muted empty-line">无</p>}
      <RuleRow label="其他备注"><button type="button" className="status-button" onClick={() => modal('text', ['notes', '其他备注'])}>{draft.notes || '无'}<ChevronRight size={15} /></button></RuleRow>
      {briefFields.map(([key, label]) => <RuleRow label={label} key={key}><button type="button" className="status-button" onClick={() => modal('text', [key, label])}>{draft[key] || '无'}<ChevronRight size={15} /></button></RuleRow>)}
    </Panel>
  </>;
}

function Preview({ text, issue, date, shift, copy, goToForm }) {
  const [headline, ...rest] = text.split('\n');
  const highlighted = new Set(['值班区域与人员分配', '值班情况：']);
  return <aside className="preview" id="summary-preview" aria-label="总结预览">
    <div className="preview-head"><div><span className="preview-icon"><ClipboardList size={19} /></span><h2>总结预览</h2></div><span className={`ready-chip ${issue ? '' : 'ready'}`}><span className="status-dot" />{issue ? '待完善' : '可复制'}</span></div>
    <div className="preview-sheet">
      <div className="sheet-content" aria-label="总结正文"><strong>{headline}</strong>{rest.map((line, index) => <div key={index} className={highlighted.has(line) ? 'preview-subtitle' : ''}>{line || ' '}</div>)}</div>
    </div>
    <div className="preview-foot">
      {issue && <button type="button" className="preview-status" onClick={goToForm}>{issue}<ArrowRight size={15} /></button>}
      <div className="preview-actions"><Button icon={ArrowDownToLine} disabled={!!issue} onClick={() => downloadText(`${date}-${shift}班-日工作总结.txt`, text)} className="download" aria-label="下载 TXT">TXT</Button><Button kind="primary" icon={Copy} disabled={!!issue} onClick={() => copy(text)}>复制总结</Button></div>
    </div>
  </aside>;
}

function FirstUse({ onUpload, onRefresh, refreshing }) {
  return <Panel title="首次使用" icon={ClipboardList} className="first-use" action={<Button icon={RefreshCw} onClick={onRefresh} disabled={refreshing} className="small">{refreshing ? '刷新中…' : '刷新'}</Button>}>
    <p>导入值班表后，即可按日期和班次选用组长及值班人员。</p>
    <ol>
      <li>选择 DOCX、文字 PDF、Excel 或 CSV 值班表。</li>
      <li>核对班次和名单，设置生效日期，再保存值班表。</li>
      <li>选择值班日期和班次，填写并复制日工作总结。</li>
    </ol>
    <Button icon={Upload} kind="primary" onClick={onUpload}>导入值班表</Button>
  </Panel>;
}

function SchedulePage({ schedules, onTake }) {
  return <div className="stack manage-page">{schedules.map((schedule) => <Panel key={schedule.id} title={schedule.name} icon={FileSpreadsheet}>
    <p className="muted calendar-range">{schedule.start} 至 {schedule.end} · {schedule.sessions.length} 条排班</p>
    <div className="schedule-table" role="table" aria-label={schedule.name}>
      <div className="schedule-line table-header" role="row"><span role="columnheader">班次</span><span role="columnheader">组长</span><span role="columnheader">值班人员</span><span role="columnheader">应到</span></div>
      {schedule.sessions.map((session, index) => {
        const day = session.date ? formatDate(session.date) : `周${WEEKDAYS[session.weekday]}`;
        const label = `${day}${session.shift}班`;
        return <div className="schedule-line" key={index} role="row">
          <span role="cell">{SHIFTS.includes(session.shift)
            ? <button type="button" className="text-button" onClick={() => onTake(schedule, session)}>{label}</button>
            : label}</span>
          <span role="cell">{session.leader || '—'}</span>
          <span role="cell">{session.members.filter((name) => name !== session.leader).join('、') || '—'}</span>
          <strong role="cell">{session.members.length} 人</strong>
        </div>;
      })}
    </div>
  </Panel>)}</div>;
}

function DirectoryPage({ directory, onAdd, onRemove, busy }) {
  const departments = unique(directory.map((entry) => entry.department));
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const filtered = query ? directory.filter((role) => `${role.department}${role.position}${role.people.join('')}`.toLowerCase().includes(query)) : directory;
  return <div className="stack manage-page">
    <div className="directory-controls"><input type="search" aria-label="搜索来访人员" placeholder="搜索部门、岗位或姓名" value={filter} onChange={(event) => setFilter(event.target.value)} /><Button kind="primary" icon={Plus} disabled={busy} onClick={() => onAdd({})}>添加共用姓名</Button></div>
    {!filtered.length && <p className="muted">没有匹配的姓名或岗位。</p>}
    {departments.filter((department) => filtered.some((role) => role.department === department)).map((department) => <Panel title={department} icon={Users} key={department}>
      {filtered.filter((role) => role.department === department).map((role) => <div className="directory-role" key={role.position}><h3>{role.position}</h3><div className="records">{role.people.map((person) => <div className="record" key={person}><span>{person}</span><button type="button" className="icon-button" disabled={busy} onClick={() => onRemove(role, person)} aria-label={`移除${person}`}><X size={15} /></button></div>)}<Button icon={Plus} kind="ghost" className="small" disabled={busy} onClick={() => onAdd(role)}>补录</Button></div></div>)}
    </Panel>)}
  </div>;
}

export default function App() {
  const [data, setData] = useState(readPersonal);
  const [shared, setShared] = useState(null);
  const { schedules, directory } = shared || emptyShared;
  const [sharedBusy, setSharedBusy] = useState(false);
  const [sharedError, setSharedError] = useState('');
  const sharedLock = useRef(false);
  const today = localDate();
  const [date, setDate] = useState(localDate);
  const viewedDate = useRef(date);
  const [shift, setShift] = useState(SHIFTS[0]);
  const [tab, setTab] = useState('report');
  const [opened, setOpened] = useState(null);
  const [toast, setToast] = useState('');
  const [storeError, setStoreError] = useState(false);
  const draftKey = `${date}|${shift}`;
  const session = sessionFor(schedules, date, shift);
  const roster = useMemo(() => rosterPeopleFor(schedules, date, shift), [schedules, date, shift]);
  const guestDirectory = useMemo(() => {
    const entries = new Map(directory.map((role) => [roleKey(role), role]));
    for (const role of data.directory) {
      const key = roleKey(role);
      const sharedPeople = entries.get(key)?.people || [];
      entries.set(key, { ...role, people: unique([...role.people, ...sharedPeople]) });
    }
    return [...entries.values()];
  }, [directory, data.directory]);
  const externalMembers = new Set(guestDirectory.flatMap(({ people }) => people).filter((name) => !roster.members.has(name)));
  const history = useMemo(() => Object.entries(data.drafts).map(([key, saved]) => {
    const [date, shift] = key.split('|');
    return { date, shift, assignments: saved?.assignments || {} };
  }), [data.drafts]);
  const hasDrafts = Object.keys(data.drafts).length > 0;
  const canFill = schedules.length > 0 || hasDrafts;
  const savedDraft = data.drafts[draftKey] || newDraft();
  const reporter = roster.leaders.includes(savedDraft.reporter) ? savedDraft.reporter : session?.leader || '';
  const draft = { ...savedDraft, reporter };
  const counts = attendance(session, draft, { otherMembers: roster.otherMembers, externalMembers });
  const text = composeReport(date, shift, draft, counts);
  const issue = reportIssue(date, draft, counts);
  const attendees = counts.list.map(({ name }) => name);
  const blocked = new Set([...counts.planned, ...attendees]);
  const outgoingOptions = counts.planned.filter((name) => attendees.includes(name));
  const incomingOptions = [...roster.otherMembers].filter((name) => !blocked.has(name));

  const updateShared = useCallback(async ({ path, method, body, updateShift } = {}) => {
    if (sharedLock.current) return null;
    sharedLock.current = true;
    setSharedBusy(true);
    setSharedError('');
    try {
      const snapshot = await sharedRequest(path, method, body);
      setShared(snapshot);
      if (updateShift) setShift((current) => shiftOnDate(snapshot.schedules, viewedDate.current, current));
      return snapshot;
    } catch (error) {
      setSharedError(error instanceof TypeError ? '网络连接失败，请重试。' : error.message);
      return null;
    } finally {
      sharedLock.current = false;
      setSharedBusy(false);
    }
  }, []);
  useEffect(() => { void updateShared({ updateShift: true }); }, [updateShared]);
  useEffect(() => {
    try { writePersonal(data); setStoreError(false); }
    catch { setStoreError(true); }
  }, [data]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);
  const notice = (message) => setToast(message);
  const refreshShared = async () => {
    if (await updateShared({ updateShift: true })) notice('已刷新共用资料');
  };
  const patch = (delta) => setData((previous) => ({
    ...previous,
    drafts: { ...previous.drafts, [draftKey]: { ...(previous.drafts[draftKey] || newDraft()), ...delta } },
  }));
  const modal = (kind, value) => {
    if (kind === 'upload' || kind === 'directoryGuest') setSharedError('');
    setOpened({ kind, value });
  };
  const close = () => setOpened(null);
  const changeDate = (newDate) => {
    viewedDate.current = newDate;
    setDate(newDate);
    setShift((current) => shiftOnDate(schedules, newDate, current));
  };
  const switchTab = (value) => { setTab(value); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const copy = async (content) => {
    try { await navigator.clipboard.writeText(content); notice('已复制总结'); }
    catch { notice('剪贴板不可用，可下载 TXT。'); }
  };
  const addGuest = (record) => {
    setData((previous) => ({
      ...previous,
      directory: rememberGuest(previous.directory, record),
      drafts: { ...previous.drafts, [draftKey]: { ...savedDraft, guests: [...draft.guests.filter((item) => !(item.person === record.person && item.action === record.action && roleKey(item) === roleKey(record))), record] } },
    }));
    close();
    notice('已添加来访备注');
  };
  const editSharedPerson = async ({ department, position, person }, method = 'POST') => {
    if (await updateShared({ path: '/directory', method, body: { department, position, person } })) {
      if (method === 'POST') setOpened((current) => current === opened ? null : current);
      notice(method === 'POST' ? '已保存共用姓名' : '已移除共用姓名');
    }
  };
  const spotlight = () => {
    const section = !draft.reporter ? '.date-panel' : !counts.expected || counts.unassigned.length || counts.errors.length ? '#staffing' : '#work-log';
    const target = document.querySelector(section);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const saveRoster = async (schedule, legacy = false) => {
    const snapshot = await updateShared({ path: '/schedules', method: 'POST', body: schedulePayload(schedule), updateShift: true });
    if (!snapshot) return;
    if (legacy) {
      setData((previous) => ({ ...previous, legacySchedules: previous.legacySchedules.filter(({ id }) => id !== schedule.id) }));
      notice('已同步旧值班表');
      return;
    }
    setOpened((current) => current === opened ? null : current);
    switchTab('report');
    notice(`已保存 ${schedule.sessions.length} 条共用排班`);
  };

  return <>
    <header className="topbar"><div className="topbar-inner">
      <button type="button" className="brand" onClick={() => switchTab('report')}><span className="brand-mark" aria-hidden="true"><ClipboardList size={23} /></span><span>值班工作台<small>日工作总结</small></span></button>
      <nav className="nav" aria-label="主导航">
        {[[LayoutGrid, 'report', '填写总结'], [FileSpreadsheet, 'schedule', '值班表'], [Users, 'directory', '来访人员']].map(([Icon, value, label]) => <button key={value} type="button" className={tab === value ? 'current' : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => switchTab(value)}><Icon size={17} />{label}</button>)}
      </nav>
      <div className="topbar-action"><Button icon={Upload} onClick={() => modal('upload')}>导入值班表</Button></div>
    </div></header>
    <main className="main">
      <div className="page-intro">
        <div><h1>{tab === 'report' ? '日工作总结' : tab === 'schedule' ? '值班表' : '来访人员'}</h1>{tab !== 'report' && <p>{tab === 'schedule' ? '查看班次名单，或导入新一轮值班安排。' : '按部门和岗位维护团队共用的来访人员名录。'}</p>}</div>
        {tab === 'report' && canFill && <div className="intro-side"><div className="day-label"><CalendarDays size={17} />{formatDate(date)}</div><a className="mobile-preview" href="#summary-preview">查看预览 <ArrowRight size={13} /></a></div>}
      </div>
      {storeError && <div className="form-error" role="alert">无法保存到当前浏览器。本次改动仅保留到页面关闭。</div>}
      {sharedError && !opened && <div className="form-error" role="alert">{sharedError} <Button kind="ghost" className="small" onClick={refreshShared}>重试</Button></div>}
      {sharedBusy && !shared && <p className="muted" role="status">正在读取共用资料…</p>}
      {tab !== 'directory' && shared && !schedules.length && <FirstUse onUpload={() => modal('upload')} onRefresh={refreshShared} refreshing={sharedBusy} />}
      {tab === 'schedule' && data.legacySchedules.length > 0 && <Panel title="本浏览器保存的旧值班表" icon={FileSpreadsheet}>
        <p className="muted">请核对日期，选择仍需供团队使用的值班表。</p>
        {data.legacySchedules.map((schedule) => <div className="legacy-roster" key={schedule.id}>
          <span>{schedule.name || '旧值班表'} · {schedule.start} 至 {schedule.end}</span>
          <Button icon={Upload} className="small" disabled={sharedBusy} onClick={() => saveRoster(schedule, true)}>同步给团队</Button>
        </div>)}
      </Panel>}
      {tab === 'report' && data.legacySchedules.length > 0 && <p className="muted legacy-link"><button type="button" className="text-button" onClick={() => switchTab('schedule')}>查看本浏览器保存的旧值班表</button></p>}
      {tab === 'report' && canFill && <div className="workbench">
        <div className="stack work-form">
          <DateSetup date={date} shift={shift} reporter={reporter} leaders={roster.leaders} session={session} schedules={schedules}
            onDate={changeDate} onShift={setShift} onReporter={(value) => patch({ reporter: value })} onUpload={() => modal('upload')} />
          <div id="staffing"><Staffing key={draftKey} session={session} date={date} shift={shift} history={history} draft={draft} counts={counts} patch={patch} modal={modal} notice={notice} refreshing={sharedBusy} onRefresh={refreshShared} /></div>
          <WorkLog draft={draft} patch={patch} modal={modal} />
        </div>
        <Preview text={text} issue={issue} date={date} shift={shift} copy={copy} goToForm={spotlight} />
      </div>}
      {tab === 'schedule' && schedules.length > 0 && <SchedulePage schedules={schedules} onTake={(schedule, entry) => {
        const startDay = new Date(`${schedule.start}T00:00:00Z`).getUTCDay();
        const first = entry.date || addDays(schedule.start, (entry.weekday - startDay + 7) % 7);
        let found = first;
        while (!entry.date && found < today && addDays(found, 7) <= schedule.end) found = addDays(found, 7);
        viewedDate.current = found;
        setDate(found); setShift(entry.shift); switchTab('report');
      }} />}
      {tab === 'directory' && <DirectoryPage directory={directory} busy={sharedBusy}
        onAdd={(role) => modal('directoryGuest', role)} onRemove={(role, person) => editSharedPerson({ ...role, person }, 'DELETE')} />}
      <footer className="footer">
        <span>值班表和共用来访人员名录由服务器保存。个人草稿、历史填写和从备注记住的姓名仅保存在当前浏览器。</span>
        {import.meta.env.MODE === 'pages' && <form action="/__access/logout" method="post"><button type="submit" className="text-button">退出登录</button></form>}
      </footer>
    </main>
    {opened?.kind === 'upload' && <UploadForm today={today} onClose={close} onSave={saveRoster} saving={sharedBusy} saveError={sharedError} />}
    {opened?.kind === 'change' && <ChangeForm type={opened.value} outgoingOptions={outgoingOptions} incomingOptions={incomingOptions} blocked={blocked}
      externalMembers={externalMembers} onClose={close} onSave={(change) => { patch({ changes: [...draft.changes, change] }); close(); }} />}
    {opened?.kind === 'lost' && <LostForm onClose={close} onSave={(item) => { patch({ lost: [...draft.lost, item] }); close(); }} />}
    {opened?.kind === 'guest' && <GuestForm directory={guestDirectory} initial={{ action: opened.value }} onClose={close} onSave={addGuest} />}
    {opened?.kind === 'directoryGuest' && <GuestForm directory={directory} initial={opened.value} onClose={close} onSave={editSharedPerson} saving={sharedBusy} saveError={sharedError} directoryOnly />}
    {opened?.kind === 'members' && <MemberForm title={session ? '编辑补录人员' : '选择本班排班人员'} items={[...roster.members].filter((name) => !session?.members.includes(name))}
      selected={draft.manualMembers} externalMembers={externalMembers} onClose={close} onSave={(members) => { patch({ manualMembers: members }); close(); }} />}
    {opened?.kind === 'excellent' && <MemberForm title="选择优秀队员" items={attendees} selected={draft.excellent.filter((name) => attendees.includes(name))} custom={false} onClose={close} onSave={(excellent) => { patch({ excellent }); close(); }} />}
    {opened?.kind === 'teamBooks' && <MemberForm title="选择已交队谱人员" items={unique([...attendees, ...roster.members])} selected={draft.teamBooks}
      externalMembers={externalMembers} onClose={close} onSave={(teamBooks) => { patch({ teamBooks }); close(); }} />}
    {opened?.kind === 'text' && <TextForm title={opened.value[1]} value={draft[opened.value[0]]} onClose={close} onSave={(value) => { patch({ [opened.value[0]]: value }); close(); }} />}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
  </>;
}