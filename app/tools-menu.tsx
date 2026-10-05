'use client';

import { useEffect, useRef } from 'react';

export type ToolGroup = { label: string; items: Array<{ label: string; detail: string; run: () => void }> };

export function ToolsMenu({ open, onClose, groups, summary }: {
  open: boolean; onClose: () => void; groups: ToolGroup[]; summary: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="tools-menu" aria-labelledby="tools-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="tools-content">
      <header><div><h2 id="tools-title">Tools</h2><p>Go a little further when you want to.</p></div><button className="tools-close" type="button" onClick={onClose} aria-label="Close tools">×</button></header>
      <div className="tools-groups">{groups.map((group) => <section key={group.label}><h3>{group.label}</h3>{group.items.map((item) => <button type="button" key={item.label} onClick={() => { onClose(); item.run(); }}><strong>{item.label}</strong><span>{item.detail}</span></button>)}</section>)}</div>
      <p className="tools-summary">{summary}</p>
    </div>
  </dialog>;
}
