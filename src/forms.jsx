import React, { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button, Chips, Field, InlineAdd, Modal, NameInput, SelectField } from './components.jsx';
import { CHANGES, GUEST_ACTIONS, incomingProblem, LOST_ITEMS } from './domain/report.js';
import { formatDate, scheduleRange, unique, validDate, WEEKDAYS } from './domain/roster.js';

const CUSTOM = '自定义';
const labelOf = (session) => `${session.date ? formatDate(session.date) : `周${WEEKDAYS[session.weekday]}`}${session.shift}班`;
export const roleKey = (role) => JSON.stringify([role.department, role.position]);

export function ChangeForm({ type: initial, outgoingOptions, incomingOptions, blocked, externalMembers, onClose, onSave }) {
  const [type, setType] = useState(initial);
  const [outgoing, setOutgoing] = useState('');
  const [incoming, setIncoming] = useState('');
  const [manual, setManual] = useState(false);
  const [converted, setConverted] = useState(false);
  const [countExpected, setCountExpected] = useState(false);
  const [countActual, setCountActual] = useState(true);
  const hasOutgoing = type !== '增补到岗';
  const hasIncoming = type !== '请假';
  const name = incoming.trim();
  const problem = hasIncoming && incomingProblem(name, blocked, externalMembers);
  const valid = (!hasOutgoing || outgoingOptions.includes(outgoing))
    && (!hasIncoming || (name && !problem && (manual || incomingOptions.includes(name))));
  const save = (event) => {
    event.preventDefault();
    if (!valid) return;
    onSave({
      type, outgoing: hasOutgoing ? outgoing : '', incoming: hasIncoming ? name : '',
      incomingSource: hasIncoming ? (manual ? 'manual' : 'roster') : undefined,
      converted: type === '请假' && converted, countExpected: type === '增补到岗' && countExpected, countActual,
    });
  };
  return <Modal title="记录人员变动" onClose={onClose}>
    <form onSubmit={save} className="dialog-body">
      <Chips label="变动类型" values={CHANGES} selected={[type]} onClick={(value) => { setType(value); setIncoming(''); setOutgoing(''); setManual(false); }} />
      {hasOutgoing && <SelectField label={type === '请假' ? '请假人员' : '原排班人员'} value={outgoing} items={outgoingOptions} onChange={setOutgoing}
        disabled={!outgoingOptions.length} placeholder={outgoingOptions.length ? '选择本班人员' : '没有可选的本班人员'} />}
      {hasIncoming && <div className="person-picker">
        {manual ? <Field label="本岗人员姓名"><input value={incoming} maxLength={30} autoComplete="off" onChange={(event) => setIncoming(event.target.value)} /></Field>
          : <SelectField label="实际到岗人员" value={incoming} items={incomingOptions} onChange={setIncoming} disabled={!incomingOptions.length}
            placeholder={incomingOptions.length ? '选择其他班次人员' : '没有可选的其他班次人员'} />}
        <button type="button" className="text-button" onClick={() => { setManual(!manual); setIncoming(''); }}>{manual ? '从值班表选择' : '手动填写'}</button>
      </div>}
      {problem && <div className="form-error">{problem}</div>}
      {type === '请假' && <label className="checkline"><input type="checkbox" checked={converted} onChange={(event) => setConverted(event.target.checked)} />预请假转请假</label>}
      {type === '增补到岗' && <div className="form-grid two"><label className="checkline"><input type="checkbox" checked={countActual} onChange={(event) => setCountActual(event.target.checked)} />计入实到人数</label><label className="checkline"><input type="checkbox" checked={countExpected} onChange={(event) => setCountExpected(event.target.checked)} />计入应到人数</label></div>}
      <div className="dialog-actions"><Button onClick={onClose}>取消</Button><button className="button primary" type="submit" disabled={!valid}>保存变动</button></div>
    </form>
  </Modal>;
}

export function GuestForm({ directory, initial = {}, onClose, onSave, directoryOnly = false, saving = false, saveError }) {
  const [action, setAction] = useState(initial.action || '查岗');
  const [department, setDepartment] = useState(initial.department || (directory.length ? '' : CUSTOM));
  const [position, setPosition] = useState(initial.position || (directory.length ? '' : CUSTOM));
  const [customDepartment, setCustomDepartment] = useState('');
  const [customPosition, setCustomPosition] = useState('');
  const [person, setPerson] = useState(initial.person || '');
  const departments = unique(directory.map((role) => role.department));
  const positions = directory.filter((role) => role.department === department);
  const suggestions = positions.find((role) => role.position === position)?.people || [];
  const resolvedDepartment = department === CUSTOM ? customDepartment.trim() : department;
  const resolvedPosition = position === CUSTOM ? customPosition.trim() : position;
  const valid = !!(resolvedDepartment && resolvedPosition && person.trim());
  const choosePosition = (value) => {
    setPosition(value);
    const options = positions.find((role) => role.position === value)?.people || [];
    setPerson(!directoryOnly && options.length === 1 ? options[0] : '');
  };
  const chooseDepartment = (value) => {
    setDepartment(value);
    const roles = directory.filter((role) => role.department === value);
    const preferred = roles.filter((role) => role.actions?.includes(action));
    const available = preferred.length ? preferred : roles;
    if (available.length === 1 && !directoryOnly) {
      setPosition(available[0].position);
      setPerson(available[0].people.length === 1 ? available[0].people[0] : '');
    } else {
      setPosition(value === CUSTOM ? CUSTOM : '');
      setPerson('');
    }
  };
  const preferredDepartments = unique(directory.filter((role) => role.actions?.includes(action)).map((role) => role.department));
  const departmentItems = unique([...preferredDepartments, ...departments, CUSTOM]);
  return <Modal title={directoryOnly ? '添加来访人员' : '添加来访备注'} onClose={onClose}>
    <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); if (valid && !saving) onSave({ department: resolvedDepartment, position: resolvedPosition, person: person.trim(), action }); }}>
      {!directoryOnly && <Chips label="来访事项" values={GUEST_ACTIONS} selected={[action]} onClick={setAction} />}
      <div className="form-grid two">
        <SelectField label="部门或队伍" placeholder="请选择" value={department} items={departmentItems} onChange={chooseDepartment} />
        <SelectField label="岗位" placeholder="请选择" value={position} items={[...positions.map((role) => role.position), CUSTOM]} onChange={choosePosition} disabled={!department} />
      </div>
      {department === CUSTOM && <Field label="部门或队伍名称"><input maxLength={40} value={customDepartment} onChange={(event) => setCustomDepartment(event.target.value)} /></Field>}
      {position === CUSTOM && <Field label="岗位名称"><input maxLength={25} value={customPosition} onChange={(event) => setCustomPosition(event.target.value)} /></Field>}
      <NameInput label="姓名" value={person} items={suggestions} onChange={setPerson} />
      {suggestions.length > 0 && <Chips label="已保存的姓名" values={suggestions} selected={[person]} onClick={setPerson} />}
      {saveError && <div className="form-error" role="alert">{saveError}</div>}
      <div className="dialog-actions"><Button onClick={onClose}>取消</Button><button type="submit" className="button primary" disabled={!valid || saving}>{saving ? '保存中…' : directoryOnly ? '保存' : '添加备注'}</button></div>
    </form>
  </Modal>;
}

export function MemberForm({ title, items, selected, onClose, onSave, custom = true, externalMembers }) {
  const [values, setValues] = useState(selected);
  const [error, setError] = useState('');
  const extra = values.filter((name) => !items.includes(name));
  function add(name) {
    const problem = incomingProblem(name, new Set(), externalMembers);
    setError(problem);
    if (!problem) setValues((current) => unique([...current, name]));
  }
  function toggle(value) {
    setValues((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }
  return <Modal title={title} onClose={onClose}>
    <div className="dialog-body">
      <Chips label={title} values={items} selected={values} onClick={toggle} />
      {extra.length > 0 && <div className="records">{extra.map((name) => <div key={name} className="record"><span>{name}</span><button type="button" className="icon-button" aria-label={`移除${name}`} onClick={() => toggle(name)}><X size={15} /></button></div>)}</div>}
      {custom && <InlineAdd label="补录姓名" onAdd={add} />}
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-actions"><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={() => onSave(values)}>确定{values.length ? `（${values.length} 人）` : ''}</Button></div>
    </div>
  </Modal>;
}

export function LostForm({ onSave, onClose }) {
  const [type, setType] = useState('校园卡');
  const [count, setCount] = useState(1);
  const [place, setPlace] = useState('');
  const [custom, setCustom] = useState('');
  const valid = Number.isInteger(+count) && +count > 0 && +count <= 999 && (type !== '其他' || !!custom.trim());
  return <Modal title="添加失物" onClose={onClose}>
    <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ type, count: +count, place: place.trim(), custom: custom.trim() }); }}>
      <Chips label="失物种类" values={LOST_ITEMS} selected={[type]} onClick={setType} />
      {type === '其他' && <Field label="物品名称"><input value={custom} maxLength={40} onChange={(event) => setCustom(event.target.value)} /></Field>}
      <div className="form-grid two"><Field label="数量"><span className="stepper"><button type="button" aria-label="减少数量" disabled={+count <= 1} onClick={() => setCount(Math.max(1, +count - 1))}>−</button><input type="number" min="1" max="999" value={count} onChange={(event) => setCount(event.target.value)} /><button type="button" aria-label="增加数量" disabled={+count >= 999} onClick={() => setCount(Math.min(999, +count + 1))}>+</button></span></Field>
        <Field label="拾获地点（选填）"><input value={place} maxLength={30} onChange={(event) => setPlace(event.target.value)} /></Field></div>
      <div className="dialog-actions"><Button onClick={onClose}>取消</Button><button type="submit" className="button primary" disabled={!valid}>添加失物</button></div>
    </form>
  </Modal>;
}

export function UploadForm({ file, today, onClose, onSave, saving, saveError }) {
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [importId, setImportId] = useState('');
  const [parsed, setParsed] = useState(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    let closed = false;
    async function readFile() {
      try {
        if (file.size > 12 * 1024 ** 2) throw new Error('请选择 12 MB 以内的值班表。');
        const { parseScheduleFile } = await import('./domain/readers.js');
        const pdfWorker = /\.pdf$/i.test(file.name)
          ? (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
          : undefined;
        const result = await parseScheduleFile(file, { year: +today.slice(0, 4), pdfWorker });
        if (closed) return;
        const range = scheduleRange(result.sessions, today);
        setImportId(crypto.randomUUID());
        setStart(range.start);
        setEnd(range.end);
        setParsed(result);
      } catch (cause) {
        if (!closed) setError(cause.message || '无法读取该文件。');
      } finally {
        if (!closed) setPending(false);
      }
    }
    void readFile();
    return () => { closed = true; };
  }, [file, today]);

  const inRange = parsed?.sessions.some((session) => !session.date || (session.date >= start && session.date <= end));
  const valid = !saving && parsed && validDate(start) && validDate(end) && start <= end && inRange && !parsed.warnings.length;
  return <Modal title="上传值班表" onClose={onClose} wide>
    <div className="dialog-body">
      {pending && <p role="status">读取中…</p>}
      {error && <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div>}
      {parsed && <>
        <div className="form-grid two">
          <Field label="生效日期"><input type="date" value={start} disabled={saving} onChange={(event) => { setStart(event.target.value); setImportId(crypto.randomUUID()); }} /></Field>
          <Field label="结束日期"><input type="date" value={end} min={start} disabled={saving} onChange={(event) => { setEnd(event.target.value); setImportId(crypto.randomUUID()); }} /></Field>
        </div>
        {(!inRange || start > end) && <div className="form-error" role="alert">所选日期范围内没有排班。</div>}
        {parsed.warnings.length > 0 && <div className="form-error" role="alert">{parsed.warnings.join('。')}。请核对原表后重新上传。</div>}
        <div className="import-table" aria-label="值班表预览">
          {parsed.sessions.map((session, index) => <div key={index} className="import-row"><strong>{labelOf(session)}</strong><span>{session.leader || '—'}</span><span>{session.members.join('、')}</span><b>{session.members.length} 人</b></div>)}
        </div>
      </>}
      {saveError && <div className="form-error" role="alert">{saveError}</div>}
      <div className="dialog-actions"><Button onClick={onClose}>取消</Button>{parsed && <Button kind="primary" disabled={!valid} onClick={() => onSave({ id: importId, start, end, sessions: parsed.sessions })}>{saving ? '保存中…' : '保存'}</Button>}</div>
    </div>
  </Modal>;
}
