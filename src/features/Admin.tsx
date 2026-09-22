import PlayerSync from './PlayerSync';
import SportAdminPanel, { type Integration } from './SportAdmin';
import { attendanceEligible, attendanceWarnings } from '../domain/logic';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  FileUp,
  HeartHandshake,
  LockKeyhole,
  Mail,
  MapPin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  Adult,
  Child,
  EventDetails,
  Family,
  HistoryEntry,
  PortalCommand,
  PortalEvent,
  PortalState,
  Role,
  Shift,
  Slot,
} from '../domain/model';
import {
  assignmentContacts,
  autoPlan,
  balances,
  familyHasStaffingPass,
  familyPassLimitErrors,
  validateEvent,
} from '../domain/logic';
import { api, isDemo, mailEnabled, mailStatus, type MailStatus } from '../client';
import {
  BusyButton,
  dateLabel,
  download,
  Empty,
  familyAdults,
  familyLabel,
  Modal,
  Notice,
  PlayerSourceChip,
  roleEmoji,
  Status,
  timeRange,
  toIso,
  toLocal,
  uid,
} from '../ui';

type Page =
  'foraldrar' | 'oversikt' | 'evenemang' | 'familjer' | 'fordelning' | 'paminnelser' | 'sportadmin';
type Mutate = (command: PortalCommand, expectedVersion?: number) => Promise<PortalState>;
type Tell = (text: string, error?: boolean) => void;
interface Props {
  state: PortalState;
  refresh?: () => Promise<void>;
  page: Page;
  navigate: (page: Page) => void;
  mutate: Mutate;
  tell: Tell;
}
const today = () => toLocal(new Date().toISOString()).slice(0, 10);
const eventSlots = (event: PortalEvent, live = false) =>
  ((live ? event.published : event.draft)?.shifts || [])
    .filter((s) => !s.externalTeam)
    .flatMap((s) => s.slots);
const eventCounts = (event: PortalEvent) => {
  const slots = eventSlots(event);
  return {
    total: slots.length,
    filled: slots.filter((s) => s.familyId && s.status !== 'cancelled').length,
    confirmed: slots.filter((s) => s.status === 'confirmed' || s.status === 'completed').length,
  };
};
function newEvent(state: PortalState): PortalEvent {
  return {
    id: uid(),
    draft: {
      title: '',
      location: 'Landvetter IP',
      startDate: today(),
      endDate: today(),
      description: '',
      shifts: state.roles.slice(0, 3).map((role) => newShift(role, today())),
    },
    publication: 0,
    cancelled: false,
    updatedAt: new Date().toISOString(),
  };
}
function newShift(role: Role | undefined, date: string): Shift {
  return {
    id: uid(),
    roleId: role?.id || '',
    roleName: role?.name || 'Uppdrag',
    instructions: role?.instructions || '',
    startsAt: toIso(`${date}T09:00`),
    endsAt: toIso(`${date}T11:00`),
    slots: [newSlot()],
  };
}
function newSlot(): Slot {
  return { id: uid(), locked: false, revision: 1, status: 'pending' };
}
const hasDraft = (event: PortalEvent) =>
  !!event.published && JSON.stringify(event.draft) !== JSON.stringify(event.published);

export default function Admin({
  state,
  page,
  navigate,
  mutate,
  tell,
  refresh = async () => {},
}: Props) {
  const [editing, setEditing] = useState<PortalEvent | null>(null);
  const [completion, setCompletion] = useState<string | null>(null);
  const [copying, setCopying] = useState<PortalEvent | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const upcoming = state.events
    .filter((e) => !e.cancelled && e.draft.endDate >= today())
    .sort((a, b) => a.draft.startDate.localeCompare(b.draft.startDate));
  const openRequests = state.requests.filter((r) => r.status === 'open');
  const overdue = state.events.flatMap((event) =>
    event.cancelled
      ? []
      : (event.published?.shifts || []).flatMap((shift) =>
          shift.slots
            .filter(
              (slot) =>
                slot.familyId &&
                ['pending', 'confirmed'].includes(slot.status) &&
                new Date(shift.endsAt) < new Date(),
            )
            .map((slot) => ({ event, shift, slot })),
        ),
  );
  const inactiveAssignments = upcoming.flatMap((event) =>
    (event.published?.shifts || []).flatMap((shift) =>
      shift.slots
        .filter(
          (slot) =>
            slot.familyId &&
            state.families.some((f) => f.id === slot.familyId && !f.active) &&
            slot.status !== 'cancelled',
        )
        .map((slot) => ({ event, shift, slot })),
    ),
  );
  const activeSlots = upcoming.flatMap((e) => eventSlots(e));
  const totalFilled = activeSlots.filter((s) => s.familyId && s.status !== 'cancelled').length;
  async function act(command: PortalCommand, message: string) {
    try {
      await mutate(command);
      tell(message);
    } catch (e) {
      tell((e as Error).message, true);
    }
  }
  const heading = (title: string, description: string, action?: React.ReactNode) => (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
  const eventCard = (event: PortalEvent) => {
    const count = eventCounts(event);
    return (
      <article className="event-card" key={event.id}>
        <div className="event-card-top">
          <span
            className={`event-kind ${event.cancelled ? 'cancelled' : !event.published ? 'draft' : 'published'}`}
          >
            {event.cancelled
              ? 'Inställt'
              : !event.published
                ? 'Utkast'
                : hasDraft(event)
                  ? 'Opublicerade ändringar'
                  : 'Publicerat'}
          </span>
          <button
            className="icon-button"
            title="Kopiera evenemang"
            aria-label={`Kopiera ${event.draft.title}`}
            onClick={() => setCopying(event)}
          >
            <Copy size={17} />
          </button>
        </div>
        <div className="event-date">
          <CalendarDays size={16} />
          {dateLabel(event.draft.startDate)}
          {event.draft.endDate !== event.draft.startDate && ` – ${dateLabel(event.draft.endDate)}`}
        </div>
        <h3>{event.draft.title || 'Nytt evenemang'}</h3>
        <p className="event-location">
          <MapPin size={15} />
          {event.draft.location}
        </p>
        <div className="coverage-label">
          <span>Bemannade platser</span>
          <strong>
            {count.filled}
            <span> / {count.total}</span>
          </strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${count.total ? (count.filled / count.total) * 100 : 0}%` }} />
        </div>
        <div className="event-card-foot">
          <span>
            <Check size={15} />
            {count.confirmed} bekräftade
          </span>
          <button className="text-button" onClick={() => setEditing(structuredClone(event))}>
            Öppna planering
            <ArrowRight size={16} />
          </button>
        </div>
        {event.published && !event.cancelled && (
          <button className="followup-link" onClick={() => setCompletion(event.id)}>
            Svar & uppföljning
            <ChevronRight size={14} />
          </button>
        )}
      </article>
    );
  };
  return (
    <>
      {page === 'oversikt' && state.events.some((e) => attendanceWarnings(state, e).length > 0) && (
        <div className="notice" role="alert">
          <strong>Kontrollera kallelsesvaren</strong>
          {state.events
            .filter((e) => attendanceWarnings(state, e).length > 0)
            .map((e) => (
              <p key={e.id}>
                {e.draft.title}: {attendanceWarnings(state, e).join(', ')}. Befintliga pass ligger
                kvar.{' '}
                <button className="text-button" onClick={() => navigate('sportadmin')}>
                  Visa SportAdmin
                </button>
              </p>
            ))}
        </div>
      )}
      {page === 'oversikt' && (
        <>
          {heading(
            'Översikt',
            'Här ser du kommande evenemang, bemanning och förfrågningar från familjer.',
            <button className="button primary green" onClick={() => setEditing(newEvent(state))}>
              <Plus size={18} />
              Nytt evenemang
            </button>,
          )}
          <div className="stats-grid">
            <Stat
              label="Kommande evenemang"
              value={upcoming.length}
              icon={<CalendarDays />}
              detail="Att planera och genomföra"
            />
            <Stat
              label="Bemannade platser"
              value={`${totalFilled}/${activeSlots.length}`}
              icon={<Users />}
              detail={`${activeSlots.length - totalFilled} platser kvar att fördela`}
            />
            <Stat
              label="Väntar på svar"
              value={activeSlots.filter((s) => s.familyId && s.status === 'pending').length}
              icon={<Clock3 />}
              detail="Tilldelade, ännu inte bekräftade"
            />
            <Stat
              label="Önskemål om byte"
              value={openRequests.length}
              icon={<HeartHandshake />}
              detail={openRequests.length ? 'Behöver din hjälp' : 'Inget att hantera just nu'}
              alert={openRequests.length > 0}
            />
          </div>
          {overdue.length > 0 && (
            <div className="action-banner">
              <Clock3 size={23} />
              <div>
                <strong>{overdue.length} avslutade pass behöver följas upp</strong>
                <p>De är fortfarande reserverade i familjernas saldo.</p>
              </div>
              <button
                className="button secondary compact"
                onClick={() => setCompletion(overdue[0].event.id)}
              >
                Följ upp
              </button>
            </div>
          )}
          {inactiveAssignments.length > 0 && (
            <div className="hint-box warning">
              <CircleAlert size={21} />
              <p>
                {inactiveAssignments.length} kommande pass är tilldelade avslutade familjer.
                Omplanera innan evenemanget.
              </p>
              <button
                className="text-button"
                onClick={() => setEditing(structuredClone(inactiveAssignments[0].event))}
              >
                Öppna planeringen
              </button>
            </div>
          )}
          <div className="section-title">
            <h2>Nästa gemensamma insats</h2>
            <button className="text-button" onClick={() => navigate('evenemang')}>
              Alla evenemang
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="event-grid">
            {upcoming.slice(0, 3).map(eventCard)}
            {upcoming.length === 0 && (
              <section className="panel">
                <Empty title="Dags att planera nästa tillfälle">
                  Lägg upp en cup, en cafévecka eller något alldeles eget.
                </Empty>
              </section>
            )}
          </div>
          <section className="panel requests-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">HJÄLP MED BEMANNINGEN</p>
                <h2>
                  Förfrågningar från familjer{' '}
                  <span className="count-pill">{openRequests.length}</span>
                </h2>
              </div>
              <HeartHandshake size={23} />
            </div>
            {openRequests.length === 0 ? (
              <Empty title="Alla förfrågningar är hanterade">
                Nya önskemål om byten och förhinder visas här.
              </Empty>
            ) : (
              openRequests.map((request) => {
                const event = state.events.find((e) => e.id === request.eventId);
                const shift = event?.published?.shifts.find((s) =>
                  s.slots.some((slot) => slot.id === request.slotId),
                );
                return (
                  <div className="request-row" key={request.id}>
                    <span className="avatar">
                      {familyLabel(state, request.familyId).slice(0, 1)}
                    </span>
                    <div className="request-copy">
                      <strong>{familyLabel(state, request.familyId)}</strong>
                      <span className="muted">
                        {event?.published?.title} · {shift?.roleName}{' '}
                        {shift && dateLabel(shift.startsAt)}
                      </span>
                      <p>{request.message}</p>
                      <small>
                        {dateLabel(request.requestedAt, {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </div>
                    <div className="request-actions">
                      <button
                        className="button secondary compact"
                        disabled={!event}
                        onClick={() => event && setEditing(structuredClone(event))}
                      >
                        Ordna byte
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Har du genomfört och publicerat den överenskomna ändringen? Detta markerar bara förfrågan som hanterad.',
                            )
                          )
                            void act(
                              {
                                type: 'resolve_request',
                                requestId: request.id,
                                status: 'resolved',
                              },
                              'Förfrågan är markerad som hanterad.',
                            );
                        }}
                      >
                        Markera hanterad
                      </button>
                      <button
                        className="text-button muted"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Avslå förfrågan? Schemat ändras inte. Meddela familjen separat.',
                            )
                          )
                            void act(
                              {
                                type: 'resolve_request',
                                requestId: request.id,
                                status: 'declined',
                              },
                              'Förfrågan är avslagen.',
                            );
                        }}
                      >
                        Avslå
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>
          <div className="principle-card">
            <div className="principle-icon">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h3>Rättvist över tid</h3>
              <p>
                Varje pass räknas lika. Syskon delar familjens ansvar, och planerade pass reserveras
                i fördelningen.
              </p>
            </div>
            <button className="text-button" onClick={() => navigate('fordelning')}>
              Se fördelningen
              <ArrowRight size={17} />
            </button>
          </div>
        </>
      )}
      {page === 'evenemang' && (
        <>
          {heading(
            'Evenemang',
            'Här planerar du lagets evenemang, uppdrag och bemanning.',
            <button className="button primary green" onClick={() => setEditing(newEvent(state))}>
              <Plus size={18} />
              Nytt evenemang
            </button>,
          )}
          <div className="toolbar">
            <div className="search-input">
              <Search size={18} />
              <input
                placeholder="Sök evenemang"
                aria-label="Sök evenemang"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              aria-label="Filtrera evenemang"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Alla evenemang</option>
              <option value="upcoming">Kommande</option>
              <option value="draft">Utkast</option>
              <option value="past">Tidigare</option>
            </select>
          </div>
          <div className="event-grid">
            {state.events
              .filter(
                (e) =>
                  e.draft.title.toLowerCase().includes(query.toLowerCase()) &&
                  (filter === 'all' ||
                    (filter === 'draft' && !e.published) ||
                    (filter === 'upcoming' && e.draft.endDate >= today() && !e.cancelled) ||
                    (filter === 'past' && e.draft.endDate < today())),
              )
              .sort((a, b) => b.draft.startDate.localeCompare(a.draft.startDate))
              .map(eventCard)}
          </div>
          <RoleSettings state={state} mutate={mutate} tell={tell} />
        </>
      )}
      {page === 'familjer' && (
        <Families
          state={state}
          mutate={mutate}
          tell={tell}
          refresh={refresh}
          onOpenConnection={() => navigate('sportadmin')}
        />
      )}
      {page === 'fordelning' && <Fairness state={state} mutate={mutate} tell={tell} />}
      {page === 'sportadmin' && (
        <SportAdminPanel
          state={state}
          refresh={refresh}
          onOpenPlayers={() => navigate('familjer')}
        />
      )}
      {page === 'paminnelser' && <Reminders state={state} mutate={mutate} tell={tell} />}
      {editing && (
        <EventEditor
          initial={editing}
          state={state}
          mutate={mutate}
          tell={tell}
          onClose={() => setEditing(null)}
        />
      )}
      {copying && (
        <CopyEvent
          event={copying}
          mutate={mutate}
          tell={tell}
          onClose={() => setCopying(null)}
          onCreated={(e) => {
            setCopying(null);
            setEditing(e);
          }}
        />
      )}
      {completion && state.events.find((e) => e.id === completion) && (
        <Completion
          event={state.events.find((e) => e.id === completion)!}
          state={state}
          mutate={mutate}
          tell={tell}
          onClose={() => setCompletion(null)}
        />
      )}
    </>
  );
}
function Stat({
  label,
  value,
  icon,
  detail,
  alert = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  detail: string;
  alert?: boolean;
}) {
  return (
    <div className={`stat-card ${alert ? 'attention' : ''}`}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong className="stat-value">{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function EventEditor({
  initial,
  state,
  mutate,
  tell,
  onClose,
}: {
  initial: PortalEvent;
  state: PortalState;
  mutate: Mutate;
  tell: Tell;
  onClose: () => void;
}) {
  const [event, setEvent] = useState(() => structuredClone(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [explanations, setExplanations] = useState<string[]>([]);
  const [tab, setTab] = useState<'details' | 'shifts'>(initial.draft.title ? 'shifts' : 'details');
  const baseVersion = useRef(state.version);
  const [sportadmin, setSportadmin] = useState<Integration>();
  const [sportadminError, setSportadminError] = useState('');
  const [sportadminLoading, setSportadminLoading] = useState(!isDemo);
  const [activityId, setActivityId] = useState<number | null | undefined>(null);
  const [savedActivityId, setSavedActivityId] = useState<number | null | undefined>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  useEffect(() => {
    if (isDemo) return;
    let active = true;
    setSportadminLoading(true);
    setSportadminError('');
    api<{ integration: Integration }>({ action: 'sportadmin', operation: 'status' })
      .then((result) => {
        if (!active) return;
        if (!result?.integration) throw new Error('SportAdmin kunde inte hämtas.');
        setSportadmin(result.integration);
        const linkedId =
          result.integration.links[initial.id] ?? (initial.attendance ? undefined : null);
        setActivityId(linkedId);
        setSavedActivityId(linkedId);
      })
      .catch(() => {
        if (active)
          setSportadminError(
            'SportAdmin kunde inte hämtas. Befintlig koppling behålls när du sparar.',
          );
      })
      .finally(() => {
        if (active) setSportadminLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initial.id, lookupAttempt]);
  const linkChanged = activityId !== savedActivityId;
  const selectionEvent =
    linkChanged && activityId === null ? { ...event, attendance: undefined } : event;
  const details = event.draft;
  const dirty = JSON.stringify(event) !== saved || linkChanged;
  const currentCount = eventCounts(event);
  const live = state.events.find((e) => e.id === event.id);
  const patch = (value: Partial<EventDetails>) =>
    setEvent((e) => ({ ...e, draft: { ...e.draft, ...value } }));
  const patchShift = (id: string, value: Partial<Shift>) =>
    patch({ shifts: details.shifts.map((s) => (s.id === id ? { ...s, ...value } : s)) });
  function assign(shift: Shift, index: number, familyId: string) {
    if (
      familyId &&
      shift.kind !== 'task' &&
      familyHasStaffingPass(details, familyId, shift.slots[index].id)
    ) {
      setError('Familjen har redan ett bemanningspass på evenemanget. Välj en annan familj.');
      return;
    }
    const slots = shift.slots.map((slot, i) =>
      i === index
        ? {
            ...slot,
            familyId: familyId || undefined,
            adultId: undefined,
            adultName: undefined,
            adultPhone: undefined,
            answer: undefined,
            status: 'pending' as const,
          }
        : slot,
    );
    patchShift(shift.id, { slots });
  }
  function assignAdult(shift: Shift, index: number, adultId: string) {
    const adult = state.adults.find((a) => a.id === adultId);
    patchShift(shift.id, {
      slots: shift.slots.map((slot, i) =>
        i === index
          ? { ...slot, adultId: adult?.id, adultName: adult?.name, adultPhone: adult?.phone }
          : slot,
      ),
    });
  }
  function changeCount(shift: Shift, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 40) return;
    if (
      count < shift.slots.length &&
      shift.slots.slice(count).some((s) => s.familyId) &&
      !window.confirm('Platser som redan har en familj tas bort ur utkastet. Fortsätta?')
    )
      return;
    patchShift(shift.id, {
      slots:
        count > shift.slots.length
          ? [...shift.slots, ...Array.from({ length: count - shift.slots.length }, newSlot)]
          : shift.slots.slice(0, count),
    });
  }
  function close() {
    if (busy) return;
    if (!dirty || window.confirm('Stäng utan att spara dina ändringar?')) onClose();
  }
  async function save(mode: 'save' | 'auto' | 'publish') {
    setBusy(mode);
    setError('');
    setProblems([]);
    try {
      if (state.version !== baseVersion.current)
        throw new Error(
          'Uppgifterna har ändrats sedan du öppnade planeringen. Stäng och öppna den igen för att få senaste versionen.',
        );
      if (!details.title.trim())
        throw new Error('Ange ett namn på evenemanget under Grunduppgifter.');
      let next = await mutate(
        {
          type: 'save_event',
          event,
          ...(linkChanged ? { sportadminActivityId: activityId } : {}),
        },
        baseVersion.current,
      );
      setSavedActivityId(activityId);
      baseVersion.current = next.version;
      let updated = next.events.find((e) => e.id === event.id)!;
      setEvent(structuredClone(updated));
      setSaved(JSON.stringify(updated));
      if (mode === 'auto') {
        setExplanations(autoPlan(next, event.id).notices);
        next = await mutate({ type: 'auto_plan', eventId: event.id }, baseVersion.current);
        baseVersion.current = next.version;
        updated = next.events.find((e) => e.id === event.id)!;
        setEvent(structuredClone(updated));
        setSaved(JSON.stringify(updated));
        const vacant = eventSlots(updated).filter((s) => !s.familyId).length;
        tell(
          vacant
            ? `Förslaget är sparat. ${vacant} platser återstår – kontrollera familjernas tillgänglighet.`
            : 'Bemanningsförslaget är sparat. Kontrollera det innan du publicerar.',
        );
      } else if (mode === 'publish') {
        const issues = validateEvent(next, event.id);
        if (issues.length) {
          setProblems(issues);
          throw new Error('Utkastet är sparat. Åtgärda nedanstående innan du publicerar.');
        }
        next = await mutate({ type: 'publish_event', eventId: event.id }, baseVersion.current);
        baseVersion.current = next.version;
        updated = next.events.find((e) => e.id === event.id)!;
        setEvent(structuredClone(updated));
        setSaved(JSON.stringify(updated));
        tell('Schemat är publicerat och synligt för familjerna.');
        onClose();
      } else tell('Utkastet är sparat.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal title={initial.draft.title || 'Nytt evenemang'} onClose={close} wide>
      <div className="editor-top">
        <div className="segmented">
          <button onClick={() => setTab('details')} className={tab === 'details' ? 'selected' : ''}>
            Grunduppgifter
          </button>
          <button onClick={() => setTab('shifts')} className={tab === 'shifts' ? 'selected' : ''}>
            Pass & bemanning <span>{currentCount.total}</span>
          </button>
        </div>
        <span className="muted editor-status">
          {dirty ? 'Osparade ändringar' : event.published ? 'Publicerat schema finns' : 'Utkast'}
        </span>
      </div>
      <fieldset disabled={!!busy} className="modal-body event-editor editor-fieldset">
        <div className="event-sportadmin-link">
          <label>
            Koppla till SportAdmin
            <select
              value={activityId === undefined ? 'keep' : (activityId ?? '')}
              disabled={sportadminLoading || !sportadmin || !!sportadminError}
              onChange={(e) =>
                setActivityId(
                  e.target.value === 'keep'
                    ? undefined
                    : e.target.value
                      ? Number(e.target.value)
                      : null,
                )
              }
            >
              <option value="">
                {sportadminLoading ? 'Hämtar aktiviteter…' : 'Ingen koppling'}
              </option>
              {savedActivityId === undefined && (
                <option value="keep">Behåll befintlig koppling – behöver återställas</option>
              )}
              {typeof savedActivityId === 'number' &&
                !sportadmin?.activities.some((a) => a.id === savedActivityId) && (
                  <option value={savedActivityId}>
                    {initial.attendance?.title || 'Nuvarande aktivitet'}
                  </option>
                )}
              {sportadmin?.activities.map((a) => (
                <option key={a.id} value={a.id} disabled={!sportadmin.connected}>
                  {dateLabel(a.startsAt)} · {a.title}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            {sportadminError ||
              (isDemo
                ? 'Anslut SportAdmin i den riktiga portalen för att välja aktivitet.'
                : sportadmin && !sportadmin.connected
                  ? 'Anslut laget under SportAdmin för att välja en aktivitet. Du kan fortfarande ta bort en befintlig koppling.'
                  : 'Välj aktiviteten som barnen ska delta i. Bara familjer med ett aktivt barn som svarat ja kan få nya pass. Kopplingen sparas med evenemanget.')}
          </p>
          {sportadminError && (
            <button
              type="button"
              className="text-button"
              onClick={() => setLookupAttempt((n) => n + 1)}
            >
              Försök igen
            </button>
          )}
          {linkChanged && activityId !== null && (
            <p className="hint">
              Spara kopplingen innan du väljer familjer manuellt. Du kan också trycka på Fördela
              lediga pass för att spara och fördela direkt.
            </p>
          )}
          {(typeof activityId === 'number' || (activityId === undefined && event.attendance)) && (
            <div className="manual-participants">
              <h3>Manuella spelare som deltar</h3>
              <p className="hint">
                Markera de manuella spelare som ska vara med. Då kan deras familjer få pass på detta
                evenemang.
              </p>
              {state.children
                .filter((c) => c.active && c.source === 'manual')
                .map((child) => (
                  <label className="check-label" key={child.id}>
                    <input
                      type="checkbox"
                      checked={event.manualParticipantIds?.includes(child.id) || false}
                      onChange={(e) =>
                        setEvent((old) => ({
                          ...old,
                          manualParticipantIds: e.target.checked
                            ? [...(old.manualParticipantIds || []), child.id]
                            : (old.manualParticipantIds || []).filter((id) => id !== child.id),
                        }))
                      }
                    />
                    {child.name}
                  </label>
                ))}
              {!state.children.some((c) => c.active && c.source === 'manual') && (
                <p className="hint">Inga aktiva manuella spelare finns i laget.</p>
              )}
            </div>
          )}
        </div>
        {tab === 'details' && (
          <div className="form-stack">
            <label>
              Hur bokas uppdragen?
              <select
                value={details.bookingMode || 'admin'}
                onChange={(e) => patch({ bookingMode: e.target.value as 'admin' | 'self' })}
              >
                <option value="admin">Jag tilldelar familjer</option>
                <option value="self">Föräldrar bokar lediga platser själva</option>
              </select>
              <span className="hint">
                Du kan alltid tilldela kvarvarande platser. Föräldrar kan boka när schemat är
                publicerat.
              </span>
            </label>
            <label>
              Evenemangets namn
              <input
                required
                maxLength={140}
                placeholder="Till exempel Höstcupen"
                value={details.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            <div className="form-row">
              <label>
                Första dagen
                <input
                  type="date"
                  required
                  value={details.startDate}
                  onChange={(e) =>
                    patch({
                      startDate: e.target.value,
                      endDate: details.endDate < e.target.value ? e.target.value : details.endDate,
                    })
                  }
                />
              </label>
              <label>
                Sista dagen
                <input
                  type="date"
                  required
                  min={details.startDate}
                  value={details.endDate}
                  onChange={(e) => patch({ endDate: e.target.value })}
                />
              </label>
            </div>
            <p className="hint">
              Vid flera dagar anger du datum och tider för varje pass. Ändrat evenemangsdatum
              flyttar inte befintliga pass.
            </p>
            <label>
              Plats
              <input
                maxLength={200}
                required
                value={details.location}
                onChange={(e) => patch({ location: e.target.value })}
              />
            </label>
            <label>
              Information till familjerna
              <textarea
                maxLength={3000}
                rows={4}
                placeholder="Samling, kontakt på plats eller annan praktisk information"
                value={details.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
          </div>
        )}
        {tab === 'shifts' && (
          <>
            <div className="editor-intro">
              <div>
                <strong>
                  {currentCount.filled} av {currentCount.total} platser bemannade
                </strong>
                <p>Välj familj själv eller låt Passlaget fördela de lediga platserna.</p>
                <p>Högst ett bemanningspass per familj och evenemang.</p>
                {details.shifts.some((s) => s.kind === 'task') && (
                  <p>
                    {details.shifts
                      .filter((s) => s.kind !== 'task')
                      .reduce((n, s) => n + s.slots.length, 0)}{' '}
                    bemanningsplatser ·{' '}
                    {details.shifts
                      .filter((s) => s.kind === 'task')
                      .reduce((n, s) => n + s.slots.length, 0)}{' '}
                    förberedelser
                  </p>
                )}
              </div>
              <BusyButton
                busy={busy === 'auto'}
                disabled={!!busy || event.cancelled}
                className="button secondary"
                onClick={() => save('auto')}
              >
                <Sparkles size={17} />
                Fördela lediga pass
              </BusyButton>
            </div>
            {familyPassLimitErrors(state, details).map((message) => (
              <Notice key={message} error text={message} />
            ))}
            {
              <label className="quick-title">
                Evenemangets namn
                <input
                  placeholder="Till exempel Höstcupen"
                  value={details.title}
                  maxLength={140}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
            }
            {details.shifts.map((shift, index) => (
              <section className="shift-editor" key={shift.id}>
                <div className="shift-editor-head">
                  <span className="role-icon">{roleEmoji(shift.roleName)}</span>
                  <strong>
                    {shift.title || `Pass ${index + 1}`}
                    {shift.group ? ` · ${shift.group}` : ''}
                  </strong>
                  <button
                    className="icon-button"
                    aria-label={`Ta bort pass ${index + 1}`}
                    onClick={() => {
                      if (
                        !shift.slots.some((s) => s.familyId) ||
                        window.confirm('Ta bort passet och dess tilldelning ur utkastet?')
                      )
                        patch({ shifts: details.shifts.filter((s) => s.id !== shift.id) });
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="form-row">
                  <label>
                    Stationens namn (valfritt)
                    <input
                      maxLength={200}
                      value={shift.title || ''}
                      placeholder="Till exempel Post 2 eller Fiskedamm"
                      onChange={(e) => patchShift(shift.id, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    Grupp (valfritt)
                    <input
                      maxLength={200}
                      value={shift.group || ''}
                      placeholder="Till exempel Skogen eller A-plan"
                      onChange={(e) => patchShift(shift.id, { group: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Typ av uppdrag
                  <select
                    value={shift.kind || 'shift'}
                    onChange={(e) => {
                      const task = e.target.value === 'task';
                      patchShift(shift.id, {
                        kind: task ? 'task' : 'shift',
                        countsTowardBalance: !task,
                        endIsApproximate: false,
                        endsAt: task
                          ? shift.startsAt
                          : new Date(
                              new Date(shift.startsAt).getTime() + 2 * 3600000,
                            ).toISOString(),
                      });
                    }}
                  >
                    <option value="shift">Bemanningspass på plats</option>
                    <option value="task">Frivillig förberedelse med deadline</option>
                  </select>
                </label>
                <div className="shift-fields">
                  <label>
                    Uppdrag
                    <select
                      value={shift.roleId}
                      onChange={(e) => {
                        const role = state.roles.find((r) => r.id === e.target.value);
                        if (role)
                          patchShift(shift.id, {
                            roleId: role.id,
                            roleName: role.name,
                            instructions: role.instructions,
                          });
                      }}
                    >
                      {state.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {shift.kind === 'task' ? 'Klart / lämnas senast' : 'Börjar'}
                    <input
                      aria-label={`Pass ${index + 1} börjar`}
                      type="datetime-local"
                      required
                      value={toLocal(shift.startsAt)}
                      onChange={(e) => {
                        if (e.target.value)
                          patchShift(shift.id, {
                            startsAt: toIso(e.target.value),
                            ...(shift.kind === 'task' ? { endsAt: toIso(e.target.value) } : {}),
                          });
                      }}
                    />
                  </label>
                  {shift.kind !== 'task' && (
                    <label>
                      Slutar
                      <input
                        aria-label={`Pass ${index + 1} slutar`}
                        type="datetime-local"
                        required
                        value={toLocal(shift.endsAt)}
                        onChange={(e) => {
                          if (e.target.value)
                            patchShift(shift.id, { endsAt: toIso(e.target.value) });
                        }}
                      />
                    </label>
                  )}
                  <label>
                    Antal vuxna
                    <input
                      aria-label={`Antal vuxna pass ${index + 1}`}
                      type="number"
                      min={1}
                      max={40}
                      disabled={!!shift.externalTeam}
                      value={shift.slots.length || 1}
                      onChange={(e) => changeCount(shift, Number(e.target.value))}
                    />
                  </label>
                </div>
                {shift.kind !== 'task' ? (
                  <div className="form-row">
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={!!shift.endIsApproximate}
                        onChange={(e) =>
                          patchShift(shift.id, { endIsApproximate: e.target.checked })
                        }
                      />
                      Ungefärlig sluttid
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={shift.countsTowardBalance !== false}
                        onChange={(e) =>
                          patchShift(shift.id, { countsTowardBalance: e.target.checked })
                        }
                      />
                      Räknas som ett pass i fördelningen
                    </label>
                  </div>
                ) : (
                  <p className="hint">
                    Förberedelser räknas inte som pass och fylls genom självbokning eller manuell
                    tilldelning.
                  </p>
                )}
                <details className="instructions edit-instructions">
                  <summary>Instruktioner, frågor till föräldrar & annat lag</summary>
                  <label>
                    Instruktioner för passet
                    <textarea
                      rows={3}
                      maxLength={3000}
                      value={shift.instructions}
                      onChange={(e) => patchShift(shift.id, { instructions: e.target.value })}
                    />
                  </label>
                  <label>
                    Gemensam fråga för stationen
                    <input
                      maxLength={200}
                      placeholder="Till exempel Tema"
                      value={shift.sharedPrompt || ''}
                      onChange={(e) => patchShift(shift.id, { sharedPrompt: e.target.value })}
                    />
                  </label>
                  {shift.sharedPrompt && (
                    <label>
                      {shift.sharedPrompt}
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={shift.sharedAnswer || ''}
                        onChange={(e) => patchShift(shift.id, { sharedAnswer: e.target.value })}
                      />
                      <span className="hint">
                        De bokade föräldrarna kan uppdatera svaret tillsammans.
                      </span>
                    </label>
                  )}
                  <label>
                    Individuell fråga till den som bokar
                    <input
                      maxLength={200}
                      placeholder="Till exempel Vad bakar du?"
                      value={shift.answerPrompt || ''}
                      onChange={(e) => patchShift(shift.id, { answerPrompt: e.target.value })}
                    />
                  </label>
                  <label>
                    Bemannas av ett annat lag
                    <input
                      placeholder="Lämna tomt när ert lag bemannar"
                      maxLength={120}
                      value={shift.externalTeam || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (
                          value &&
                          !shift.externalTeam &&
                          shift.slots.some((s) => s.familyId) &&
                          !window.confirm(
                            'Byta till ett annat lag och ta bort familjernas tilldelning för detta pass?',
                          )
                        )
                          return;
                        patchShift(shift.id, {
                          externalTeam: value || undefined,
                          slots: value ? [] : shift.slots.length ? shift.slots : [newSlot()],
                        });
                      }}
                    />
                  </label>
                </details>
                {!shift.externalTeam && (
                  <div className="allocation-list">
                    {shift.slots.map((slot, i) => (
                      <div className="allocation-row" key={slot.id}>
                        <span className="place-number">{i + 1}</span>
                        <label>
                          <span className="sr-only">Familj för plats {i + 1}</span>
                          <select
                            value={slot.familyId || ''}
                            disabled={linkChanged && activityId !== null && !slot.familyId}
                            onChange={(e) => assign(shift, i, e.target.value)}
                          >
                            <option value="">Välj familj · ledig plats</option>
                            {state.families
                              .filter(
                                (f) =>
                                  (f.active &&
                                    (!linkChanged || activityId === null) &&
                                    (shift.kind === 'task' ||
                                      !familyHasStaffingPass(details, f.id, slot.id)) &&
                                    attendanceEligible(state, selectionEvent, f.id)) ||
                                  f.id === slot.familyId,
                              )
                              .map((f) => (
                                <option key={f.id} value={f.id}>
                                  {familyLabel(state, f.id)}
                                  {f.exempt ? ' · undantagen' : ''}
                                  {!f.active
                                    ? ' · inaktiv'
                                    : !attendanceEligible(state, selectionEvent, f.id)
                                      ? ' · kontrollera kallelsesvar'
                                      : ''}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          <span className="sr-only">Ansvarig vuxen för plats {i + 1}</span>
                          <select
                            disabled={!slot.familyId}
                            value={slot.adultId || ''}
                            onChange={(e) => assignAdult(shift, i, e.target.value)}
                          >
                            <option value="">Familjen väljer vuxen</option>
                            {familyAdults(state, slot.familyId).map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className={`icon-button lock-button ${slot.locked ? 'locked' : ''}`}
                          aria-label={
                            slot.locked
                              ? 'Lås upp plats'
                              : 'Lås plats för automatisk fördelning och självbokning'
                          }
                          title={slot.locked ? 'Platsen är låst' : 'Lås denna plats'}
                          onClick={() =>
                            patchShift(shift.id, {
                              slots: shift.slots.map((s, n) =>
                                n === i ? { ...s, locked: !s.locked } : s,
                              ),
                            })
                          }
                        >
                          <LockKeyhole size={17} />
                        </button>
                        <Status slot={slot} />
                        {shift.answerPrompt && slot.familyId && (
                          <label className="allocation-answer">
                            {shift.answerPrompt}
                            <textarea
                              rows={2}
                              maxLength={2000}
                              value={slot.answer || ''}
                              onChange={(e) =>
                                patchShift(shift.id, {
                                  slots: shift.slots.map((s) =>
                                    s.id === slot.id ? { ...s, answer: e.target.value } : s,
                                  ),
                                })
                              }
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
            <button
              className="add-shift"
              onClick={() =>
                patch({ shifts: [...details.shifts, newShift(state.roles[0], details.startDate)] })
              }
            >
              <Plus size={18} />
              Lägg till pass
            </button>
            <p className="hint">
              Alla tider är svensk tid. Redan tilldelade eller låsta platser behålls vid automatisk
              fördelning. Frivilliga bidrag lämnas för självbokning eller manuell tilldelning.
            </p>
          </>
        )}
        {explanations.length > 0 && (
          <details className="instructions planning-explanations" open>
            <summary>Så fördelades passen</summary>
            <ul>
              {explanations.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          </details>
        )}
        {event.cancelled && (
          <Notice text="Evenemanget är inställt. Kopiera det för att planera ett nytt tillfälle." />
        )}
        {error && <Notice text={error} error />}
        {problems.length > 0 && (
          <ul className="validation-list">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </fieldset>
      <div className="modal-footer">
        <div>
          {live?.published && !event.cancelled && (
            <button
              disabled={!!busy}
              className="text-button danger"
              onClick={async () => {
                if (
                  !window.confirm(
                    'Ställa in hela evenemanget? Familjerna ser att det är inställt och pass tas bort ur den framtida fördelningen.',
                  )
                )
                  return;
                setBusy('cancel');
                try {
                  await mutate({ type: 'cancel_event', eventId: event.id });
                  tell('Evenemanget är inställt.');
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              Ställ in evenemang
            </button>
          )}
        </div>
        <div className="button-row">
          {tab === 'details' && (
            <button className="button secondary" onClick={() => setTab('shifts')}>
              Till bemanning
              <ArrowRight size={16} />
            </button>
          )}
          <BusyButton
            busy={busy === 'save'}
            disabled={!!busy || event.cancelled}
            className="button secondary"
            onClick={() => save('save')}
          >
            Spara utkast
          </BusyButton>
          <BusyButton
            busy={busy === 'publish'}
            disabled={!!busy || event.cancelled}
            className="button primary"
            onClick={() => save('publish')}
          >
            Publicera schema
            <ArrowRight size={17} />
          </BusyButton>
        </div>
      </div>
    </Modal>
  );
}

function CopyEvent({
  event,
  mutate,
  tell,
  onClose,
  onCreated,
}: {
  event: PortalEvent;
  mutate: Mutate;
  tell: Tell;
  onClose: () => void;
  onCreated: (event: PortalEvent) => void;
}) {
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Kopiera evenemang" onClose={onClose}>
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const id = uid();
            const next = await mutate({
              type: 'copy_event',
              eventId: event.id,
              newId: id,
              startDate: date,
            });
            tell('Ett nytt utkast har skapats utan tidigare tilldelningar.');
            onCreated(next.events.find((x) => x.id === id)!);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Uppdrag, antal platser och tider kopieras från <strong>{event.draft.title}</strong>.
          Familjer och bekräftelser följer inte med.
        </p>
        <label>
          Nytt startdatum
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {error && <Notice text={error} error />}
        <BusyButton type="submit" busy={busy} className="button primary">
          <Copy size={16} />
          Skapa kopia
        </BusyButton>
      </form>
    </Modal>
  );
}
function Completion({
  event,
  state,
  mutate,
  tell,
  onClose,
}: {
  event: PortalEvent;
  state: PortalState;
  mutate: Mutate;
  tell: Tell;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const assignments = event
    .published!.shifts.filter((s) => !s.externalTeam)
    .flatMap((shift) =>
      shift.slots
        .filter((slot) => slot.familyId && slot.status !== 'cancelled')
        .map((slot) => ({ shift, slot })),
    );
  const ended = assignments
    .filter(({ shift }) => new Date(shift.endsAt) <= new Date())
    .map(({ slot }) => slot.id);
  async function complete(slotIds: string[], completed: boolean, key: string) {
    setBusy(key);
    try {
      await mutate(
        { type: 'complete_slots', eventId: event.id, slotIds, completed },
        state.version,
      );
      setSelected([]);
      tell(
        `${slotIds.length} pass är markerade som ${completed ? 'genomförda' : 'ej genomförda'}.`,
      );
    } catch (e) {
      tell((e as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title="Svar & uppföljning"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="modal-body">
        <p className="muted">
          {event.published!.title} · Bekräftelse räknas inte som genomförande.
        </p>
        <div className="toolbar">
          <label className="check-label">
            <input
              type="checkbox"
              disabled={!!busy || !ended.length}
              checked={!!ended.length && ended.every((id) => selected.includes(id))}
              onChange={(e) => setSelected(e.target.checked ? ended : [])}
            />
            Välj alla avslutade pass
          </label>
          <BusyButton
            className="button primary compact"
            busy={busy === 'bulk'}
            disabled={!!busy || !selected.length}
            onClick={() => complete(selected, true, 'bulk')}
          >
            <Check size={16} />
            Markera {selected.length || ''} genomförda
          </BusyButton>
        </div>
        <div className="completion-list">
          {assignments.map(({ shift, slot }) => (
            <div className="completion-row" key={slot.id}>
              <input
                type="checkbox"
                aria-label={`Välj ${familyLabel(state, slot.familyId)}, ${shift.title || shift.roleName}`}
                disabled={!!busy || !ended.includes(slot.id)}
                checked={selected.includes(slot.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, slot.id]
                      : selected.filter((id) => id !== slot.id),
                  )
                }
              />
              <div>
                <strong>
                  {familyLabel(state, slot.familyId)} · {shift.title || shift.roleName}
                </strong>
                <span>
                  {dateLabel(shift.startsAt)} · {timeRange(shift)} ·{' '}
                  {slot.adultName || 'Vuxen ej angiven'}
                </span>
              </div>
              <Status slot={slot} />
              <div className="button-row">
                {slot.status === 'pending' && new Date(shift.startsAt) > new Date() && (
                  <ConfirmationReminder
                    state={state}
                    event={event}
                    slot={slot}
                    mutate={mutate}
                    tell={tell}
                  />
                )}
                {ended.includes(slot.id) &&
                  [true, false].map((completed) => (
                    <BusyButton
                      key={String(completed)}
                      busy={busy === slot.id + String(completed)}
                      disabled={!!busy || !ended.includes(slot.id)}
                      className={`button compact ${slot.status === (completed ? 'completed' : 'absent') ? 'primary' : 'secondary'}`}
                      onClick={() => complete([slot.id], completed, slot.id + String(completed))}
                    >
                      {completed ? 'Genomfört' : 'Ej genomfört'}
                    </BusyButton>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <p className="hint">
          Uppföljning blir tillgänglig när passets sluttid har passerat. Du kan korrigera ett
          tidigare val.
        </p>
      </div>
    </Modal>
  );
}

function ConfirmationReminder({
  state,
  event,
  slot,
  mutate,
  tell,
}: {
  state: PortalState;
  event: PortalEvent;
  slot: Slot;
  mutate: Mutate;
  tell: Tell;
}) {
  const [busy, setBusy] = useState(false);
  const recipients = assignmentContacts(state, slot);
  const recent =
    slot.reminderRevision === slot.revision &&
    !!slot.reminderRequestedAt &&
    Date.now() - Date.parse(slot.reminderRequestedAt) < 10 * 60 * 1000;
  const reason = !recipients.length
    ? 'Mejladress saknas – lägg till under Spelare & föräldrar.'
    : !mailEnabled
      ? 'Mejlutskick är inte aktiverade ännu.'
      : recent
        ? 'Påminnelse begärd. Du kan påminna igen om tio minuter.'
        : '';
  return (
    <div className="confirmation-reminder">
      <BusyButton
        className="button secondary compact"
        busy={busy}
        disabled={!!reason}
        onClick={async () => {
          setBusy(true);
          try {
            await mutate(
              {
                type: 'remind_confirmation',
                eventId: event.id,
                slotId: slot.id,
                familyId: slot.familyId!,
                revision: slot.revision,
              },
              state.version,
            );
            tell(
              isDemo
                ? 'Påminnelsen visas i demot. Inget mejl skickas.'
                : 'Påminnelsen är lagd i utskickskön.',
            );
          } catch (e) {
            tell((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Mail size={15} />
        {recent ? 'Påminnelse begärd' : 'Påminn via mejl'}
      </BusyButton>
      <span className="hint">
        {reason || `Till ${recipients.map((a) => a.name).join(' och ')}`}
      </span>
    </div>
  );
}

function Families({
  state,
  mutate,
  tell,
  refresh,
  onOpenConnection,
}: {
  state: PortalState;
  mutate: Mutate;
  tell: Tell;
  refresh: () => Promise<void>;
  onOpenConnection: () => void;
}) {
  const [query, setQuery] = useState('');
  const [membership, setMembership] = useState<'active' | 'inactive' | 'all'>('active');
  const [source, setSource] = useState<'all' | 'sportadmin' | 'manual'>('all');
  const [staffing, setStaffing] = useState<'all' | 'exempt' | 'included'>('all');
  const [editing, setEditing] = useState<Family | null>(null);
  const counts = balances(state);
  const search = query.trim().toLocaleLowerCase('sv');
  const rows = state.families
    .filter((family) => staffing === 'all' || family.exempt === (staffing === 'exempt'))
    .map((family) => {
      const parentMatches = familyAdults(state, family.id)
        .flatMap((adult) => [adult.name, adult.phone, adult.email || ''])
        .join(' ')
        .toLocaleLowerCase('sv')
        .includes(search);
      const children = state.children.filter((child) => {
        const active = child.active && family.active;
        return (
          child.familyId === family.id &&
          (membership === 'all' || active === (membership === 'active')) &&
          (source === 'all' || (child.source || 'manual') === source) &&
          (!search || parentMatches || child.name.toLocaleLowerCase('sv').includes(search))
        );
      });
      return { family, children };
    })
    .filter((row) => row.children.length > 0)
    .sort((a, b) => a.children[0].name.localeCompare(b.children[0].name, 'sv'));
  const visibleCount = rows.reduce((count, row) => count + row.children.length, 0);
  const filtersChanged =
    !!query || membership !== 'active' || source !== 'all' || staffing !== 'all';
  function resetFilters() {
    setQuery('');
    setMembership('active');
    setSource('all');
    setStaffing('all');
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Spelare & föräldrar</h1>
          <p className="muted">Här hittar du lagets spelare och deras föräldrar.</p>
        </div>
        <button
          className="button primary green"
          onClick={() =>
            setEditing({ id: uid(), label: '', active: true, exempt: false, unavailable: [] })
          }
        >
          <Plus size={18} />
          Lägg till spelare
        </button>
      </div>
      <PlayerSync state={state} refresh={refresh} onOpenConnection={onOpenConnection} />
      <div className="player-directory-filters" role="group" aria-label="Filtrera spelare">
        <div className="search-input">
          <Search size={18} />
          <input
            aria-label="Sök barn eller förälder"
            placeholder="Sök barn eller förälder"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label>
          I laget
          <select
            value={membership}
            onChange={(e) => setMembership(e.target.value as typeof membership)}
          >
            <option value="all">Alla</option>
            <option value="active">Aktiva</option>
            <option value="inactive">Avslutade</option>
          </select>
        </label>
        <label>
          Registerstatus
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">Alla</option>
            <option value="sportadmin">Synkade</option>
            <option value="manual">Manuella</option>
          </select>
        </label>
        <label>
          Bemanning
          <select value={staffing} onChange={(e) => setStaffing(e.target.value as typeof staffing)}>
            <option value="all">Alla</option>
            <option value="exempt">Undantagna</option>
            <option value="included">Ej undantagna</option>
          </select>
        </label>
      </div>
      <div className="player-filter-summary">
        <p className="hint" role="status">
          Visar {visibleCount} av {state.children.length} spelare.
        </p>
        {filtersChanged && (
          <button className="text-button" onClick={resetFilters}>
            Återställ filter
          </button>
        )}
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="player-directory-table">
            <thead>
              <tr>
                <th>Spelare</th>
                <th>Föräldrar & kontakt</th>
                <th>Pass per familj</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ family: f, children }) => (
                <tr key={f.id}>
                  <td>
                    <div className="directory-children">
                      {children.map((child) => (
                        <div key={child.id} className="directory-player">
                          <strong>{child.name}</strong>
                          <div className="player-statuses">
                            <span
                              className={`player-source-chip ${child.active && f.active ? 'synced' : 'inactive'}`}
                            >
                              {child.active && f.active ? 'AKTIV' : 'AVSLUTAD'}
                            </span>
                            <PlayerSourceChip synced={child.source === 'sportadmin'} />
                            {f.exempt && (
                              <span className="player-source-chip exempt">UNDANTAGEN</span>
                            )}
                          </div>
                        </div>
                      ))}
                      {state.children.filter((c) => c.familyId === f.id).length > 1 && (
                        <small>Syskon · gemensamt ansvar</small>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="contact-list">
                      {familyAdults(state, f.id).map((a) => (
                        <div key={a.id}>
                          <strong>{a.name}</strong>
                          <span>{a.phone}</span>
                          {a.email && <span>{a.email}</span>}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <strong className="table-number">
                      {counts.find((c) => c.familyId === f.id)?.completed || 0}
                    </strong>
                  </td>
                  <td>
                    <button className="button ghost compact" onClick={() => setEditing(f)}>
                      {state.children
                        .filter((c) => c.familyId === f.id)
                        .every((c) => c.source === 'sportadmin')
                        ? 'Visa & bemanning'
                        : 'Redigera'}
                      <ChevronRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <Empty title="Inga spelare matchar filtren">
            Prova en annan kombination eller återställ filtren.
          </Empty>
        )}
      </section>
      <div className="hint-box">
        <ShieldCheck size={20} />
        <p>
          En undantagen familj deltar inte i automatisk fördelning. Du kan fortfarande ge familjen
          pass manuellt. Avslutade familjers historik finns kvar.
        </p>
      </div>
      {editing && (
        <FamilyEditor
          family={editing}
          state={state}
          mutate={mutate}
          tell={tell}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
function FamilyEditor({
  family,
  state,
  mutate,
  tell,
  onClose,
}: {
  family: Family;
  state: PortalState;
  mutate: Mutate;
  tell: Tell;
  onClose: () => void;
}) {
  const baseVersion = useRef(state.version);
  const [draft, setDraft] = useState<Family>(() => structuredClone(family));
  const [children, setChildren] = useState<Child[]>(() =>
    structuredClone(state.children.filter((c) => c.familyId === family.id)),
  );
  const [adults, setAdults] = useState<Adult[]>(() =>
    structuredClone(state.adults.filter((a) => a.familyIds.includes(family.id))),
  );
  const hasSynced = children.some((c) => c.source === 'sportadmin');
  const manualFamily = !children.length || children.some((c) => c.source !== 'sportadmin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patchChild = (id: string, value: Partial<Child>) =>
    setChildren((old) => old.map((c) => (c.id === id ? { ...c, ...value } : c)));
  const patchAdult = (id: string, value: Partial<Adult>) =>
    setAdults((old) => old.map((a) => (a.id === id ? { ...a, ...value } : a)));
  return (
    <Modal
      title={
        family.label
          ? manualFamily
            ? 'Redigera familj'
            : 'Familj & bemanning'
          : 'Lägg till spelare'
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (!children.some((c) => c.name.trim())) throw new Error('Ange minst ett barn.');
            await mutate(
              {
                type: 'save_family',
                family: {
                  ...draft,
                  label: draft.label.trim() || children.map((c) => c.name).join(' & '),
                },
                children,
                adults,
              },
              baseVersion.current,
            );
            tell('Familjens uppgifter har sparats.');
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-stack">
          {hasSynced && (
            <p className="hint">
              Synkade spelar- och kontaktuppgifter ändras i SportAdmin. Här kan du ändra familjens
              undantag och tillgänglighet.
            </p>
          )}
          {!hasSynced && (
            <label>
              Familjens namn
              <input
                value={draft.label}
                maxLength={140}
                placeholder="Till exempel familjen Andersson"
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
          )}
          <div className="form-section">
            <h3>Barn i familjen</h3>
            {manualFamily && (
              <p className="hint">Syskon och tvillingar läggs till i samma familj.</p>
            )}
            {children.map((child) =>
              child.source === 'sportadmin' ? (
                <div className="synced-person" key={child.id}>
                  <strong>{child.name}</strong>
                  <div className="player-statuses">
                    <PlayerSourceChip synced />
                    <span className={`player-source-chip ${child.active ? 'synced' : 'inactive'}`}>
                      {child.active ? 'AKTIV' : 'AVSLUTAD'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="person-edit-row" key={child.id}>
                  <label>
                    Namn
                    <input
                      required
                      maxLength={120}
                      value={child.name}
                      onChange={(e) => patchChild(child.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={child.active}
                      onChange={(e) => patchChild(child.id, { active: e.target.checked })}
                    />
                    Aktiv i laget
                  </label>
                  <PlayerSourceChip synced={false} />
                </div>
              ),
            )}
            {manualFamily && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setChildren([
                    ...children,
                    { id: uid(), name: '', familyId: family.id, active: true, source: 'manual' },
                  ])
                }
              >
                <Plus size={16} />
                Lägg till barn
              </button>
            )}
          </div>
          <div className="form-section">
            <h3>Vuxna</h3>
            {adults.map((adult) =>
              adult.source === 'sportadmin' ? (
                <div className="synced-person" key={adult.id}>
                  <strong>{adult.name}</strong>
                  <PlayerSourceChip synced />
                  <span>{adult.phone}</span>
                  <span>{adult.email || 'Mejladress saknas i SportAdmin'}</span>
                  {!adult.active && <span className="hint">Avslutad kontakt</span>}
                </div>
              ) : (
                <div className="person-edit-row adults" key={adult.id}>
                  <label>
                    Namn
                    <input
                      required
                      maxLength={120}
                      value={adult.name}
                      onChange={(e) => patchAdult(adult.id, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    Telefon
                    <input
                      type="tel"
                      required
                      maxLength={30}
                      value={adult.phone}
                      onChange={(e) => patchAdult(adult.id, { phone: e.target.value })}
                    />
                  </label>
                  <label>
                    Mejladress
                    <input
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      value={adult.email || ''}
                      onChange={(e) => patchAdult(adult.id, { email: e.target.value })}
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={adult.active}
                      onChange={(e) => patchAdult(adult.id, { active: e.target.checked })}
                    />
                    Aktiv
                  </label>
                </div>
              ),
            )}
            {manualFamily && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setAdults([
                    ...adults,
                    { id: uid(), name: '', phone: '', familyIds: [family.id], active: true },
                  ])
                }
              >
                <Plus size={16} />
                Lägg till vuxen
              </button>
            )}
            <p className="hint">
              Mejladresser visas bara här för administratören och används för tilldelningar och
              påminnelser. Uppgifter med status <PlayerSourceChip synced /> ändras i SportAdmin och
              uppdateras sedan här.
            </p>
          </div>
          <div className="form-section form-stack">
            <h3>Fördelning & status</h3>
            {!hasSynced && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                <span>Familjen är aktiv i laget</span>
              </label>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.exempt}
                onChange={(e) => setDraft({ ...draft, exempt: e.target.checked })}
              />
              <span>Undanta familjen från automatisk tilldelning, exempelvis ledarfamilj</span>
            </label>
          </div>
          <details className="instructions">
            <summary>Perioder då familjen inte kan delta</summary>
            <div className="form-stack unavailable-list">
              {(draft.unavailable || []).map((period, index) => (
                <div className="form-row" key={index}>
                  <label>
                    Från
                    <input
                      type="datetime-local"
                      required
                      value={toLocal(period.startsAt)}
                      onChange={(e) => {
                        if (e.target.value)
                          setDraft({
                            ...draft,
                            unavailable: draft.unavailable!.map((x, i) =>
                              i === index ? { ...x, startsAt: toIso(e.target.value) } : x,
                            ),
                          });
                      }}
                    />
                  </label>
                  <label>
                    Till
                    <input
                      type="datetime-local"
                      required
                      value={toLocal(period.endsAt)}
                      onChange={(e) => {
                        if (e.target.value)
                          setDraft({
                            ...draft,
                            unavailable: draft.unavailable!.map((x, i) =>
                              i === index ? { ...x, endsAt: toIso(e.target.value) } : x,
                            ),
                          });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Ta bort period"
                    className="icon-button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        unavailable: draft.unavailable!.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    unavailable: [
                      ...(draft.unavailable || []),
                      { startsAt: toIso(`${today()}T00:00`), endsAt: toIso(`${today()}T23:59`) },
                    ],
                  })
                }
              >
                <Plus size={16} />
                Lägg till period
              </button>
            </div>
          </details>
          {error && <Notice text={error} error />}
        </div>
        <div className="modal-footer">
          <span className="hint">Historik bevaras när någon slutar.</span>
          <BusyButton busy={busy} type="submit" className="button primary">
            {hasSynced && !manualFamily ? 'Spara bemanning' : 'Spara familj'}
          </BusyButton>
        </div>
      </form>
    </Modal>
  );
}

function RoleSettings({ state, mutate, tell }: { state: PortalState; mutate: Mutate; tell: Tell }) {
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="panel role-settings">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">FÖRBERED FÖR NÄSTA TILLFÄLLE</p>
          <h2>Lagets uppdrag</h2>
        </div>
        <button
          className="button secondary compact"
          onClick={() => {
            setError('');
            setRole({ id: uid(), name: '', instructions: '' });
          }}
        >
          <Plus size={16} />
          Eget uppdrag
        </button>
      </div>
      <div className="role-chips">
        {state.roles.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              setError('');
              setRole({ ...r });
            }}
          >
            <span>{roleEmoji(r.name)}</span>
            {r.name}
            <Settings2 size={14} />
          </button>
        ))}
      </div>
      {role && (
        <Modal
          title={
            state.roles.some((r) => r.id === role.id) ? 'Redigera uppdrag' : 'Skapa eget uppdrag'
          }
          onClose={() => setRole(null)}
        >
          <form
            className="modal-body form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await mutate({ type: 'save_role', role });
                tell('Uppdraget finns nu att välja när du planerar.');
                setRole(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Namn på uppdrag
              <input
                required
                maxLength={100}
                value={role.name}
                placeholder="Till exempel Halloweenpyssel"
                onChange={(e) => setRole({ ...role, name: e.target.value })}
              />
            </label>
            <label>
              Instruktioner
              <textarea
                rows={6}
                maxLength={3000}
                value={role.instructions}
                onChange={(e) => setRole({ ...role, instructions: e.target.value })}
              />
            </label>
            <p className="hint">
              Instruktionerna kopieras till nya pass. Befintliga evenemang behåller sina
              instruktioner.
            </p>
            {error && <Notice text={error} error />}
            <BusyButton type="submit" className="button primary" busy={busy}>
              Spara uppdrag
            </BusyButton>
          </form>
        </Modal>
      )}
    </section>
  );
}

function Fairness({ state, mutate, tell }: { state: PortalState; mutate: Mutate; tell: Tell }) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const rows = balances(state)
    .filter((row) => includeInactive || state.families.find((f) => f.id === row.familyId)?.active)
    .sort(
      (a, b) =>
        b.total - a.total ||
        familyLabel(state, a.familyId).localeCompare(familyLabel(state, b.familyId), 'sv'),
    );
  const max = Math.max(1, ...rows.map((r) => r.total));
  const [showHistory, setShowHistory] = useState('');
  const [importing, setImporting] = useState(false);
  const verified = state.history.filter((h) => h.verified);
  const unverified = state.history.filter((h) => !h.verified);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Topplista</h1>
          <p className="muted">
            Här ser du familjernas genomförda och reserverade pass, sorterade efter totalt antal.
          </p>
        </div>
        <div className="button-row">
          <button className="button primary green" onClick={() => setImporting(true)}>
            <FileUp size={17} />
            Importera
          </button>
          <button
            className="button secondary"
            onClick={() =>
              download(
                JSON.stringify(
                  { exportedAt: new Date().toISOString(), format: 'passlaget-backup-v1', state },
                  null,
                  2,
                ),
                `passlaget-sakerhetskopia-${today()}.json`,
                'application/json',
              )
            }
          >
            <Download size={17} />
            Säkerhetskopia
          </button>
        </div>
      </div>
      <div className="stats-grid three">
        <Stat
          label="Genomförda pass"
          value={verified.length}
          icon={<Check />}
          detail="Kontrollerad historik för hela laget"
        />
        <Stat
          label="Reserverade pass"
          value={rows.reduce((n, r) => n + r.reserved, 0)}
          icon={<Clock3 />}
          detail="Planerade eller bekräftade uppdrag"
        />
        <Stat
          label="Familjer i fördelningen"
          value={state.families.filter((f) => f.active && !f.exempt).length}
          icon={<Users />}
          detail="Aktiva familjer utan undantag"
        />
      </div>
      <label className="check-label history-filter">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
        />
        Visa även avslutade familjer
      </label>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Pass per familj</h2>
            <p className="muted">
              Automatiken prioriterar lägst total, sedan längst tid sedan senaste pass.
            </p>
          </div>
          <div className="chart-legend">
            <span>
              <i className="done" />
              Genomförda
            </span>
            <span>
              <i className="reserved" />
              Reserverade
            </span>
          </div>
        </div>
        <div className="balance-list">
          {rows.map((row) => {
            const family = state.families.find((f) => f.id === row.familyId)!;
            return (
              <button
                className="balance-row"
                key={row.familyId}
                onClick={() => setShowHistory(row.familyId)}
              >
                <span className="balance-name">
                  <strong>{familyLabel(state, row.familyId)}</strong>
                  {!family.active ? (
                    <small>Avslutad familj</small>
                  ) : (
                    family.exempt && <small>Undantagen från automatik</small>
                  )}
                </span>
                <span className="balance-track">
                  <span
                    className="balance-done"
                    style={{ width: `${(row.completed / max) * 100}%` }}
                  />
                  <span
                    className="balance-reserved"
                    style={{ width: `${(row.reserved / max) * 100}%` }}
                  />
                </span>
                <span className="balance-count">
                  <strong>{row.total}</strong>
                  <small>
                    {row.completed} + {row.reserved}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            );
          })}
        </div>
      </section>
      {unverified.length > 0 && (
        <div className="hint-box warning">
          <CircleAlert size={20} />
          <p>
            {unverified.length} importerade poster väntar på kontroll och räknas ännu inte. Öppna
            familjens historik nedan för att granska dem.
          </p>
        </div>
      )}
      <section className="panel audit-panel">
        <div className="panel-heading">
          <h2>Senaste ändringar</h2>
          <span className="muted">Bara för administratörer</span>
        </div>
        {state.audit.length === 0 ? (
          <Empty title="Inga ändringar att visa ännu" />
        ) : (
          <div className="audit-list">
            {state.audit
              .slice(-12)
              .reverse()
              .map((a) => (
                <div key={a.id}>
                  <span className="audit-dot" />
                  <p>
                    {a.summary}
                    <small>
                      {a.actor === 'admin' ? 'Administratör' : 'Föräldrasida'} ·{' '}
                      {dateLabel(a.at, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </p>
                </div>
              ))}
          </div>
        )}
      </section>
      <p className="hint">
        Säkerhetskopian innehåller kontaktuppgifter och privat historik. Förvara den privat.
        Återställning av hela portalen beskrivs i projektets driftguide.
      </p>
      {showHistory && (
        <HistoryModal
          familyId={showHistory}
          state={state}
          mutate={mutate}
          tell={tell}
          onClose={() => setShowHistory('')}
        />
      )}{' '}
      {importing && (
        <ImportModal
          state={state}
          mutate={mutate}
          tell={tell}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
function HistoryModal({
  familyId,
  state,
  mutate,
  tell,
  onClose,
}: {
  familyId: string;
  state: PortalState;
  mutate: Mutate;
  tell: Tell;
  onClose: () => void;
}) {
  const rows = state.history
    .filter((h) => h.familyId === familyId)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const [busy, setBusy] = useState('');
  const [newEntry, setNewEntry] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Café');
  const [date, setDate] = useState(today());
  async function verify(entry: HistoryEntry, verified = true) {
    if (
      !window.confirm(
        verified
          ? 'Bekräfta att passet verkligen genomfördes av denna familj. Det börjar då räknas i fördelningen.'
          : 'Markera posten som okontrollerad igen? Den sparas i historiken men slutar räknas i fördelningen.',
      )
    )
      return;
    setBusy(entry.id);
    try {
      await mutate({ type: 'review_history', historyId: entry.id, verified });
      tell(
        verified ? 'Historikposten är kontrollerad.' : 'Historikposten behöver kontrolleras igen.',
      );
    } catch (e) {
      tell((e as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal title={`Historik · ${familyLabel(state, familyId)}`} onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          Endast kontrollerade, genomförda pass räknas. Ett pass räknas en gång.
        </p>
        {rows.length === 0 && <Empty title="Inga genomförda pass registrerade" />}
        <div className="history-list">
          {rows.map((entry) => (
            <div className="history-row" key={entry.id}>
              <span className={`history-check ${entry.verified ? 'verified' : ''}`}>
                <Check size={18} />
              </span>
              <div>
                <strong>
                  {entry.eventTitle} · {entry.roleName}
                </strong>
                <span>
                  {dateLabel(entry.startsAt)} ·{' '}
                  {entry.source === 'import' ? 'Importerad historik' : 'Registrerat i Passlaget'}
                </span>
              </div>
              {entry.verified ? (
                <div className="history-review">
                  <span className="badge completed">Räknas</span>
                  {entry.source === 'import' && (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => verify(entry, false)}
                    >
                      Ångra granskning
                    </button>
                  )}
                </div>
              ) : (
                <BusyButton
                  className="button secondary compact"
                  busy={busy === entry.id}
                  disabled={!!busy}
                  onClick={() => verify(entry)}
                >
                  Bekräfta genomförande
                </BusyButton>
              )}
            </div>
          ))}
        </div>
        {!newEntry ? (
          <button className="text-button" onClick={() => setNewEntry(true)}>
            <Plus size={16} />
            Registrera ett äldre genomfört pass
          </button>
        ) : (
          <form
            className="form-stack history-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy('new');
              try {
                const id = uid();
                await mutate({
                  type: 'import_data',
                  families: [],
                  children: [],
                  adults: [],
                  history: [
                    {
                      id,
                      familyId,
                      assignmentId: `manual:${id}`,
                      eventTitle: name,
                      roleName: role,
                      startsAt: toIso(`${date}T12:00`),
                      endsAt: toIso(`${date}T13:00`),
                      source: 'import',
                      verified: true,
                    },
                  ],
                });
                setNewEntry(false);
                tell('Det genomförda passet är registrerat.');
              } catch (e) {
                tell((e as Error).message, true);
              } finally {
                setBusy('');
              }
            }}
          >
            <label>
              Evenemang
              <input
                required
                maxLength={140}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                Uppdrag
                <input
                  required
                  value={role}
                  maxLength={100}
                  onChange={(e) => setRole(e.target.value)}
                />
              </label>
              <label>
                Datum
                <input
                  required
                  type="date"
                  max={today()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            <p className="hint">
              Registrera bara ett pass du vet genomfördes. Klockslag används inte för att vikta
              insatsen.
            </p>
            <BusyButton type="submit" busy={busy === 'new'} className="button primary">
              Registrera genomfört pass
            </BusyButton>
          </form>
        )}
      </div>
    </Modal>
  );
}

type ImportCandidate = {
  families: Family[];
  children: Child[];
  adults: Adult[];
  history: HistoryEntry[];
};
function ImportModal({
  state,
  mutate,
  tell,
  onClose,
}: {
  state: PortalState;
  mutate: Mutate;
  tell: Tell;
  onClose: () => void;
}) {
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function readFile(file: File) {
    setError('');
    setCandidate(null);
    setAck(false);
    try {
      if (file.size > 5_000_000) throw new Error('Filen är för stor. Högst 5 MB.');
      const value = JSON.parse(await file.text());
      if (value.format === 'passlaget-backup-v1')
        throw new Error(
          'Detta är en fullständig säkerhetskopia. Följ driftguiden för återställning. Här importeras familjeregister och historik.',
        );
      const required = ['families', 'children', 'adults', 'history'];
      if (!required.every((k) => Array.isArray(value[k])))
        throw new Error(
          'Filen ska innehålla familjer, barn, vuxna och historik i Passlagets importformat.',
        );
      setCandidate({
        families: value.families,
        children: value.children,
        adults: value.adults,
        history: value.history.map((h: HistoryEntry) => ({
          ...h,
          verified: state.history.some((existing) => existing.id === h.id && existing.verified),
        })),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="Importera register & historik" onClose={onClose} wide>
      <div className="modal-body form-stack">
        <p>
          Läs in den privata importfilen från PDF-underlaget, eller en egen fil i samma format.
          Kontrollera familjekopplingar och namn innan du sparar.
        </p>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          aria-label="Välj importfil"
          onChange={(e) => {
            if (e.target.files?.[0]) void readFile(e.target.files[0]);
          }}
        />
        {candidate && (
          <>
            <div className="import-counts">
              <span>
                <strong>{candidate.families.length}</strong> familjer
              </span>
              <span>
                <strong>{candidate.children.length}</strong> barn
              </span>
              <span>
                <strong>{candidate.adults.length}</strong> vuxna
              </span>
              <span>
                <strong>{candidate.history.length}</strong> pass
              </span>
            </div>
            <div className="import-preview">
              {candidate.families.map((f) => (
                <div key={f.id}>
                  <strong>{f.label}</strong>
                  <span>
                    {candidate.children
                      .filter((c) => c.familyId === f.id)
                      .map((c) => c.name)
                      .join(' & ')}
                  </span>
                  <small>
                    {candidate.adults
                      .filter((a) => a.familyIds.includes(f.id))
                      .map((a) => `${a.name} · ${a.phone}`)
                      .join(' / ')}
                  </small>
                  {state.families.some((x) => x.id === f.id) && (
                    <span className="badge pending">Uppdaterar befintlig familj</span>
                  )}
                </div>
              ))}
            </div>
            <div className="hint-box">
              <CircleAlert size={19} />
              <p>
                Alla importerade historikposter behöver därefter kontrolleras per familj innan de
                påverkar fördelningen. Befintliga poster med samma ID uppdateras.
              </p>
            </div>
            <label className="check-label">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                Jag har granskat registret och familjekopplingarna och vill spara dessa uppgifter.
              </span>
            </label>
          </>
        )}
        {error && <Notice text={error} error />}
        <BusyButton
          busy={busy}
          className="button primary"
          disabled={!candidate || !ack}
          onClick={async () => {
            if (!candidate) return;
            setBusy(true);
            try {
              await mutate({ type: 'import_data', ...candidate });
              tell('Registret är importerat. Granska historiken per familj innan den räknas.');
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FileUp size={17} />
          Spara granskad import
        </BusyButton>
      </div>
    </Modal>
  );
}

function Reminders({ state, mutate, tell }: { state: PortalState; mutate: Mutate; tell: Tell }) {
  const teamBaseVersion = useRef(state.version);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [error, setError] = useState('');
  const [team, setTeam] = useState(() => structuredClone(state.team));
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState('');
  const activeMail = mailEnabled && (isDemo || status?.enabled === true);
  const workerFresh =
    !!status?.lastWorkerAt && Date.now() - Date.parse(status.lastWorkerAt) < 15 * 60 * 1000;
  const load = () => {
    setError('');
    void mailStatus()
      .then(setStatus)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);
  async function resolve(id: string, outcome: 'sent' | 'retry' | 'suppress') {
    const text = {
      sent: 'Markera som skickat efter att du själv kontrollerat att mejlet kom fram?',
      retry:
        'Lägga mejlet i kön igen? Kontrollera först att det inte redan levererats. Annars kan mottagaren få ett dubbelt mejl.',
      suppress: 'Stoppa detta mejl permanent?',
    }[outcome];
    if (!window.confirm(text)) return;
    setResolving(id);
    try {
      await api({ action: 'mail_resolve', id, outcome });
      load();
      tell('Mejlets status har uppdaterats.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving('');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{mailEnabled ? 'Mejl & drift' : 'Kontakt & drift'}</h1>
          <p className="muted">
            {activeMail
              ? 'Här hanterar du kontaktuppgifter, mejlpåminnelser och status för lagets utskick.'
              : 'Här hanterar du lagets kontaktuppgifter och ser status för mejlutskick.'}
          </p>
        </div>
        <button className="button primary green" onClick={load}>
          Uppdatera status
        </button>
      </div>
      {isDemo && (
        <div className="hint-box">
          <Mail size={21} />
          <p>
            Detta är en demonstration. Inga mejl skickas. När portalen är ansluten visas kö och
            leveransstatus här.
          </p>
        </div>
      )}
      {error && <Notice text={error} error />}
      {!activeMail && (
        <div className="hint-box">
          <Mail size={21} />
          <p>
            {status?.enabled === false ? (
              <>
                <strong>Mejl aktiveras senare.</strong> Inga nya utskick köas.
              </>
            ) : status?.enabled === true ? (
              <>
                <strong>Utskick är aktiverade.</strong> Föräldrasidans mejlfunktion är ännu inte
                tillgänglig.
              </>
            ) : (
              <strong>
                {error ? 'Utskicksstatus kunde inte hämtas.' : 'Hämtar utskicksstatus…'}
              </strong>
            )}{' '}
            Familjerna ser och bekräftar sina pass i portalen och kan lägga till dem i kalendern.
          </p>
        </div>
      )}
      <div className="stats-grid three">
        <Stat
          label="I kö"
          value={(status?.counts.queued || 0) + (status?.counts.leased || 0)}
          icon={<Clock3 />}
          detail={
            status?.enabled === true
              ? 'Väntar på utskick'
              : status?.enabled === false
                ? 'Eventuella tidigare utskick är pausade'
                : 'Utskicksstatus är okänd'
          }
        />
        <Stat
          label="Skickade"
          value={status?.counts.sent || 0}
          icon={<Mail />}
          detail={
            status?.lastSentAt
              ? `Senast ${dateLabel(status.lastSentAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : 'Inget utskick registrerat'
          }
        />
        <Stat
          label="Behöver kontrolleras"
          value={(status?.counts.failed || 0) + (status?.counts.uncertain || 0)}
          icon={<CircleAlert />}
          detail="Fel eller oklar leveransstatus"
          alert={!!((status?.counts.failed || 0) + (status?.counts.uncertain || 0))}
        />
      </div>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>{activeMail ? 'Kontaktperson & påminnelser' : 'Kontaktperson'}</h2>
            <Settings2 size={21} />
          </div>
          <form
            className="panel-body form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const next = await mutate({ type: 'update_team', team }, teamBaseVersion.current);
                teamBaseVersion.current = next.version;
                tell('Lagets inställningar har sparats.');
              } catch (e) {
                tell((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-row">
              <label>
                Förening
                <input
                  required
                  maxLength={100}
                  value={team.clubName}
                  onChange={(e) => setTeam({ ...team, clubName: e.target.value })}
                />
              </label>
              <label>
                Lag
                <input
                  required
                  maxLength={100}
                  value={team.name}
                  onChange={(e) => setTeam({ ...team, name: e.target.value })}
                />
              </label>
            </div>
            <label>
              Kontaktperson
              <input
                maxLength={120}
                value={team.contactName}
                onChange={(e) => setTeam({ ...team, contactName: e.target.value })}
              />
            </label>
            <label>
              Telefonnummer
              <input
                type="tel"
                maxLength={30}
                value={team.contactPhone}
                onChange={(e) => setTeam({ ...team, contactPhone: e.target.value })}
              />
            </label>
            {activeMail && (
              <fieldset className="reminder-options">
                <legend>Påminn om obekräftade pass</legend>
                {[7, 3, 1].map((day) => (
                  <label key={day} className="check-label">
                    <input
                      type="checkbox"
                      checked={team.reminderDays.includes(day)}
                      onChange={(e) =>
                        setTeam({
                          ...team,
                          reminderDays: e.target.checked
                            ? [...team.reminderDays, day].sort((a, b) => b - a)
                            : team.reminderDays.filter((d) => d !== day),
                        })
                      }
                    />
                    {day === 1 ? '24 timmar' : `${day} dagar`}
                  </label>
                ))}
              </fieldset>
            )}
            <BusyButton busy={busy} type="submit" className="button primary green">
              Spara inställningar
            </BusyButton>
          </form>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>{activeMail ? 'Så fungerar utskicken' : 'Information till familjerna'}</h2>
            <ShieldCheck size={21} />
          </div>
          <div className="panel-body form-stack">
            {activeMail ? (
              <>
                <div className="service-status">
                  <span className={`service-dot ${workerFresh ? 'online' : ''}`} />
                  <div>
                    <strong>
                      {workerFresh
                        ? 'Utskicksrutinen har kontakt'
                        : status?.lastWorkerAt
                          ? 'Kontakten med utskicksrutinen behöver kontrolleras'
                          : 'Ingen kontakt registrerad'}
                    </strong>
                    <p>
                      {status?.lastWorkerAt
                        ? `Senaste kontroll: ${dateLabel(status.lastWorkerAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
                        : 'Anslut den kostnadsfria mejlrutinen enligt driftguiden.'}
                    </p>
                  </div>
                </div>
                <p>
                  Mejladressen sparas när föräldern bekräftar ett pass. Du kan också lägga till den
                  under Spelare & föräldrar. Adressen visas inte för andra familjer.
                </p>
                <p>
                  Utskick läggs i kö när uppdrag publiceras eller ändras. Automatiska påminnelser
                  skickas bara om passet fortfarande saknar bekräftelse. Ett bekräftat pass får inga
                  fler påminnelser.
                </p>
                <p>
                  Under Svar & uppföljning kan du påminna om ett enskilt pass som saknar
                  bekräftelse.
                </p>
                <p className="hint">
                  Vid osäker leverans stoppas automatisk omsändning. Kontrollera mottagaren eller
                  avsändarkontot innan du beslutar att skicka igen.
                </p>
              </>
            ) : (
              <p>
                Dela portalens gemensamma länk med familjerna. Där kan de se sina uppdrag, bekräfta
                vem som kommer och meddela förhinder.
              </p>
            )}
            <p className="hint">
              En kalenderknapp sparar en enskild kopia. Den uppdateras inte automatiskt när schemat
              ändras.
            </p>
          </div>
        </section>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>Senaste mejlen</h2>
          <span className="muted">Bara för administratörer</span>
        </div>
        {!status?.messages.length ? (
          <Empty icon={<Mail size={30} />} title="Inga utskick ännu">
            {activeMail
              ? 'Mejl visas här när uppdrag publiceras till familjer med registrerad mejladress.'
              : status?.enabled === false
                ? 'Mejlfunktionen är inte aktiverad.'
                : status
                  ? 'Inga utskick registrerade.'
                  : 'Väntar på uppgifter från servern.'}
          </Empty>
        ) : (
          <div className="mail-list">
            {status.messages.map((message) => (
              <div className="mail-row" key={message.id}>
                <Mail size={19} />
                <div>
                  <strong>{message.subject}</strong>
                  <span>
                    {message.to} ·{' '}
                    {dateLabel(message.createdAt, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {message.error && <p className="error-text">{message.error}</p>}
                </div>
                <span className={`badge ${message.status === 'sent' ? 'completed' : 'pending'}`}>
                  {{
                    queued: 'I kö',
                    leased: 'Behandlas',
                    sent: 'Skickat',
                    failed: 'Fel',
                    uncertain: 'Osäkert',
                    suppressed: 'Stoppat',
                  }[message.status] || message.status}
                </span>
                {activeMail && ['failed', 'uncertain'].includes(message.status) && (
                  <div className="button-row">
                    <button
                      disabled={!!resolving}
                      className="button compact secondary"
                      onClick={() => resolve(message.id, 'sent')}
                    >
                      Redan skickat
                    </button>
                    <button
                      disabled={!!resolving}
                      className="button compact secondary"
                      onClick={() => resolve(message.id, 'retry')}
                    >
                      Försök igen
                    </button>
                    <button
                      disabled={!!resolving}
                      className="text-button danger"
                      onClick={() => resolve(message.id, 'suppress')}
                    >
                      Stoppa
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
