import type { FormEvent, ReactNode } from 'react';
import { toast } from '@/components/ui/toast';
import type { AdminData, Row } from './data';

// What every tab gets from the admin shell.
export type TabProps = { data: AdminData; reload: () => Promise<void> };

// Modals stay mounted and toggle .open — the Playwright suite asserts that
// class. The form inside is keyed by the record being edited, so opening the
// modal for another record starts from fresh defaults.
export function Modal({ id, title, isOpen, formKey, onClose, onSave, children, buttons, className = '' }: {
  id: string; title: string; isOpen: boolean; formKey: string; onClose: () => void;
  onSave: (form: FormData) => void; children: ReactNode; buttons?: ReactNode; className?: string;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSave(new FormData(e.currentTarget));
  }
  return (
    <div className={`modal-overlay${isOpen ? ' open' : ''}`} id={id}>
      <div className={`dc-modal ${className}`}>
        <h3 id={id + 'Title'}>{title}</h3>
        <form key={formKey} onSubmit={submit}>
          {children}
          <div className="btn-row">
            {buttons}
            <button type="button" className="btn btn-ghost border border-white/10 btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-save">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Toggle({ id, label, defaultChecked }: { id: string; label: string; defaultChecked: boolean }) {
  return (
    <div className="dc-toggle">
      <input type="checkbox" className="toggle toggle-primary toggle-sm" id={id} name={id} defaultChecked={defaultChecked} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

// A scrolling list of checkboxes; checked values arrive as form.getAll(name).
export function CheckList({ id, items, checked, empty }: {
  id: string; items: { id: number; label: ReactNode }[]; checked: number[]; empty?: string;
}) {
  return (
    <div id={id} className="max-h-40 overflow-y-auto border border-white/10 rounded-md p-2 bg-white/[0.02]">
      {items.length === 0 && empty && <span className="opacity-50 text-[0.8rem]">{empty}</span>}
      {items.map((item) => (
        <label key={item.id} className="!block !text-[0.8rem] !m-0 !mb-1">
          <input type="checkbox" name={id} value={item.id} defaultChecked={checked.includes(item.id)} className="mr-1.5 accent-primary" /> {item.label}
        </label>
      ))}
    </div>
  );
}

export const checkedIds = (form: FormData, name: string) => form.getAll(name).map((v) => parseInt(String(v)));
export const text = (form: FormData, name: string) => String(form.get(name) ?? '');

export function TabHeader({ title, onNew, newLabel, children }: { title: string; onNew?: () => void; newLabel?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <h2 className="text-lg font-bold whitespace-nowrap">{title}</h2>
      {onNew && <button className="btn btn-primary" onClick={onNew}>{newLabel}</button>}
      {children}
    </div>
  );
}

export function Table({ head, bodyId, children }: { head: ReactNode; bodyId: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/5 bg-base-100">
      <table className="table table-sm">
        {head}
        <tbody id={bodyId}>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="opacity-40 text-center !py-6">{children}</td></tr>;
}

export function OnOff({ isOn }: { isOn: boolean }) {
  return <span className={`badge ${isOn ? 'badge-on' : 'badge-off'}`}>{isOn ? 'on' : 'off'}</span>;
}

export function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete: () => void }) {
  return (
    <td className="actions">
      {onEdit && <button onClick={onEdit}>Edit</button>}
      <button className="danger" onClick={onDelete}>Delete</button>
    </td>
  );
}

// Sends a write, toasts any API error, and reloads on success. Resolves to
// whether the write succeeded so the caller can close its modal.
export async function write(request: Promise<any>, reload: () => Promise<void>, success?: string) {
  try {
    const result = await request;
    if (result?.error) {
      toast.error(result.error);
      return false;
    }
    if (success) toast.success(success);
    await reload();
    return true;
  } catch (err: any) {
    toast.error(err.message);
    return false;
  }
}

// Modal state for a tab: null when closed, 'new' or the row being edited.
export type Editing = Row | 'new' | null;
export const editingRow = (editing: Editing) => (editing && editing !== 'new' ? editing : null);
export const editingKey = (editing: Editing) => (editing === 'new' ? 'new' : editing ? String(editing.id) : 'closed');
