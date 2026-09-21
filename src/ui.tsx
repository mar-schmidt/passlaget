import { X, LoaderCircle, Check, AlertCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { ReactNode } from 'react';
import type { Family, PortalState, Slot, Shift } from './domain/model';
export const uid = () => crypto.randomUUID();
export const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...options }).format(
    new Date(date.length === 10 ? `${date}T12:00:00Z` : date),
  );
export const timeLabel = (date: string) => dateLabel(date, { hour: '2-digit', minute: '2-digit' });
export const timeRange = (shift: Shift) =>
  shift.kind === 'task'
    ? `Senast ${dateLabel(shift.startsAt)} kl. ${timeLabel(shift.startsAt)}`
    : `${timeLabel(shift.startsAt)}–${shift.endIsApproximate ? 'ca ' : ''}${timeLabel(shift.endsAt)}`;
export const toLocal = (date: string) =>
  formatInTimeZone(new Date(date), 'Europe/Stockholm', "yyyy-MM-dd'T'HH:mm");
export const toIso = (local: string) => fromZonedTime(local, 'Europe/Stockholm').toISOString();
export function familyLabel(state: PortalState, id?: string) {
  const names = state.children.filter((c) => c.familyId === id && c.active).map((c) => c.name);
  return names.join(' & ') || state.families.find((f) => f.id === id)?.label || 'Ledig plats';
}
export function familyAdults(state: PortalState, family: Family | string | undefined) {
  const id = typeof family === 'string' ? family : family?.id;
  return state.adults.filter((a) => a.active && a.familyIds.includes(id || ''));
}
export function Status({ slot }: { slot: Slot }) {
  const text = !slot.familyId
    ? 'Obemannat'
    : (
        {
          pending: 'Inväntar svar',
          confirmed: 'Bekräftat',
          completed: 'Genomfört',
          absent: 'Ej genomfört',
          cancelled: 'Inställt',
        } as const
      )[slot.status];
  return (
    <span className={`badge ${!slot.familyId ? 'vacant' : slot.status}`}>
      <span />
      {text}
    </span>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const box = document.querySelector('[role="dialog"]');
        const items = Array.from(
          box?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,a[href]',
          ) || [],
        );
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(
      () => document.querySelector<HTMLElement>('[role="dialog"] button')?.focus(),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Stäng">
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function BusyButton({
  busy,
  children,
  ...props
}: { busy?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} disabled={busy || props.disabled}>
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
      {error ? <AlertCircle size={18} /> : <Check size={18} />}
      <span>{text}</span>
    </div>
  );
}
export function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const roleEmoji = (name: string) =>
  /park|p-värd/i.test(name)
    ? 'P'
    : /löp/i.test(name)
      ? '↗'
      : /café|cafe|kiosk/i.test(name)
        ? '☕'
        : /sarg/i.test(name)
          ? '▦'
          : '✦';
