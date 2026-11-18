import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';

export function Button({ children, icon: Icon, className = '', kind = 'secondary', ...props }) {
  return <button type="button" className={`button ${kind} ${className}`} {...props}>{Icon && <Icon size={17} />}{children}</button>;
}

export function Panel({ title, icon: Icon, action, children, className = '', id }) {
  return <section className={`panel ${className}`} id={id}>
    <div className="panel-head"><h2>{Icon && <span className="panel-icon"><Icon size={18} /></span>}{title}</h2>{action}</div>
    {children}
  </section>;
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => { if (!ref.current.open) ref.current.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={id} className={`dialog ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    <div className="dialog-shell">
      <div className="dialog-head"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={21} /></button></div>
      {children}
    </div>
  </dialog>;
}

export function SelectField({ label, value, items, onChange, placeholder, disabled }) {
  return <label className="field"><span>{label}</span><span className="select-wrap">
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      {placeholder && <option value="">{placeholder}</option>}
      {items.map((item) => { const option = typeof item === 'string' ? { value: item, label: item } : item; return <option key={option.value} value={option.value}>{option.label}</option>; })}
    </select><ChevronDown size={16} />
  </span></label>;
}

export function NameInput({ label, items, value, onChange, placeholder = '选择或填写姓名' }) {
  const id = useId();
  return <label className="field"><span>{label}</span>
    <input aria-label={label} list={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={30} autoComplete="off" />
    <datalist id={id}>{items.map((item) => <option value={item} key={item} />)}</datalist>
  </label>;
}

export function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Chips({ values, selected = [], onClick, label }) {
  return <div className="chips" aria-label={label}>{values.map((value) => <button key={value} type="button" className={`chip ${selected.includes(value) ? 'selected' : ''}`} aria-pressed={selected.includes(value)} onClick={() => onClick(value)}>{selected.includes(value) && <Check size={13} />}{value}</button>)}</div>;
}

export function RuleRow({ label, children }) {
  return <div className="rule-row"><span>{label}</span><div className="rule-control">{children}</div></div>;
}

export function InlineAdd({ onAdd, label }) {
  const [text, setText] = useState('');
  return <form className="inline-add" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { onAdd(text.trim()); setText(''); } }}>
    <input aria-label={label} value={text} maxLength={30} onChange={(event) => setText(event.target.value)} placeholder={label} />
    <button type="submit" className="icon-button" aria-label="添加" disabled={!text.trim()}><Plus size={18} /></button>
  </form>;
}

export function downloadText(name, text) {
  const blob = new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}