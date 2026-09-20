import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Download,
  ExternalLink,
  HeartHandshake,
  MapPin,
  Phone,
  Search,
} from 'lucide-react';
import { readPortal } from '../client';
import { googleCalendarUrl, toIcs } from '../domain/calendar';
import type {
  PortalState,
  PortalCommand,
  PortalEvent,
  Shift,
  Slot,
  CalendarEvent,
} from '../domain/model';
import {
  BusyButton,
  dateLabel,
  download,
  familyAdults,
  familyLabel,
  Modal,
  Notice,
  Status,
  timeRange,
} from '../ui';
import './parents-matchday.css';

type Selection = { event: PortalEvent; shift: Shift; slot: Slot };
interface Props {
  state: PortalState;
  familyId: string;
  setFamilyId: (id: string) => void;
  mutate: (command: PortalCommand) => Promise<PortalState>;
  tell: (text: string, error?: boolean) => void;
}
const stockholmsDate = (date: string) =>
  dateLabel(date, { year: 'numeric', month: '2-digit', day: '2-digit' });

function PublishedStatus({ slot }: { slot: Slot }) {
  return slot.status === 'cancelled' ? (
    <span className="badge cancelled">
      <span />
      Inställt
    </span>
  ) : (
    <Status slot={slot} />
  );
}

export default function Parents({ state, familyId, setFamilyId, mutate, tell }: Props) {
  const [eventId, setEventId] = useState('');
  const [query, setQuery] = useState('');
  const [choosingFamily, setChoosingFamily] = useState(false);
  const [showPublic, setShowPublic] = useState(false);
  const [confirm, setConfirm] = useState<Selection | null>(null);
  const [request, setRequest] = useState<Selection | null>(null);
  const [calendar, setCalendar] = useState<CalendarEvent | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState('');
  const family = state.families.find((f) => f.id === familyId && f.active);
  const now = Date.now();
  const today = stockholmsDate(new Date(now).toISOString());
  const published = state.events
    .filter((event) => event.published)
    .sort((a, b) => a.published!.startDate.localeCompare(b.published!.startDate));
  const allAssignments = family
    ? published
        .flatMap((event) =>
          event.published!.shifts.flatMap((shift) =>
            shift.externalTeam
              ? []
              : shift.slots
                  .filter((slot) => slot.familyId === family.id)
                  .map((slot) => ({ event, shift, slot })),
          ),
        )
        .sort((a, b) => a.shift.startsAt.localeCompare(b.shift.startsAt))
    : [];
  const upcomingAssignments = allAssignments.filter(
    (item) =>
      !item.event.cancelled &&
      ['pending', 'confirmed'].includes(item.slot.status) &&
      new Date(item.shift.endsAt).getTime() > now,
  );
  const pending = upcomingAssignments.filter((item) => item.slot.status === 'pending').length;
  const defaultEvent =
    upcomingAssignments[0]?.event ||
    published.find((event) => !event.cancelled && event.published!.endDate >= today) ||
    published.filter((event) => !event.cancelled).at(-1) ||
    published.at(-1);
  const event = published.find((item) => item.id === eventId) || defaultEvent;
  const details = event?.published;
  const ownAssignments = allAssignments.filter((item) => item.event.id === event?.id);
  const multiDay = Boolean(details && details.startDate !== details.endDate);
  const eventPast = Boolean(details && details.endDate < today);
  const showChooser = choosingFamily || (!family && !showPublic);
  const familyOptions = state.families.filter(
    (f) =>
      f.active &&
      familyLabel(state, f.id)
        .toLocaleLowerCase('sv')
        .includes(query.trim().toLocaleLowerCase('sv')),
  );
  const roleGroups = Array.from(
    (details?.shifts || [])
      .slice()
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .reduce((groups, shift) => {
        const key = `${shift.roleId}:${shift.roleName}`;
        const group = groups.get(key) || { key, name: shift.roleName, shifts: [] as Shift[] };
        group.shifts.push(shift);
        groups.set(key, group);
        return groups;
      }, new Map<string, { key: string; name: string; shifts: Shift[] }>())
      .values(),
  );
  function chooseFamily(id: string) {
    setFamilyId(id);
    setEventId('');
    setQuery('');
    setChoosingFamily(false);
    setShowPublic(false);
  }
  async function openCalendar(item: Selection) {
    setLoadingCalendar(item.slot.id);
    try {
      const latest = await readPortal();
      const event = latest.events.find((e) => e.id === item.event.id);
      const shift = event?.published?.shifts.find((s) => s.id === item.shift.id);
      const slot = shift?.slots.find((s) => s.id === item.slot.id);
      if (
        !event?.published ||
        event.cancelled ||
        !shift ||
        !slot?.familyId ||
        slot.familyId !== item.slot.familyId ||
        slot.status === 'cancelled'
      )
        throw new Error('Passet är inte längre aktuellt. Uppdatera schemat.');
      setCalendar({
        id: `${event.id}-${slot.id}`,
        title: `${shift.roleName} – ${state.team.clubName}`,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        location: event.published.location,
        description: `${event.published.title}\n${shift.instructions}\nAnsvarig: ${slot.adultName || familyLabel(latest, slot.familyId)}\nAktuell information finns i Passlaget.`,
        url: `${location.origin}${location.pathname}#/foraldrar`,
      });
    } catch (e) {
      tell((e as Error).message, true);
    } finally {
      setLoadingCalendar('');
    }
  }
  return (
    <div className="matchday-page">
      {showChooser ? (
        <section className="md-welcome" aria-labelledby="family-welcome-title">
          <p className="md-kicker">Tillsammans runt laget</p>
          <h1 id="family-welcome-title">Lagets bemanning</h1>
          <p className="md-lead">Vilket barn hejar du på?</p>
          <p className="md-muted">
            Välj barn eller familj för att se era uppdrag och berätta vem som kommer. Syskon delar
            på ansvaret.
          </p>
          <div className="md-family-search">
            <Search size={20} aria-hidden="true" />
            <label className="sr-only" htmlFor="matchday-family-search">
              Sök barn eller familj
            </label>
            <input
              id="matchday-family-search"
              type="search"
              autoComplete="off"
              placeholder="Sök barnets namn"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="md-family-options" aria-label="Välj familj">
            {familyOptions.map((item) => (
              <button key={item.id} type="button" onClick={() => chooseFamily(item.id)}>
                <span>{familyLabel(state, item.id)}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
          {familyOptions.length === 0 && (
            <p className="md-empty-copy" role="status">
              {state.families.some((item) => item.active)
                ? 'Inget namn matchar sökningen. Prova barnets förnamn.'
                : 'Inga familjer har lagts till ännu. Du kan ändå se publicerade evenemang.'}
            </p>
          )}
          <div className="md-chooser-actions">
            {(family || showPublic) && (
              <button
                type="button"
                className="md-link"
                onClick={() => {
                  setChoosingFamily(false);
                  setQuery('');
                }}
              >
                Avbryt
              </button>
            )}
            <button
              type="button"
              className="md-link"
              onClick={() => {
                setShowPublic(true);
                setChoosingFamily(false);
                setQuery('');
              }}
            >
              Visa hela schemat <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="md-identity">
            <p>
              {family ? (
                <>
                  Du visar <strong>{familyLabel(state, family.id)}</strong>
                </>
              ) : (
                'Du visar lagets gemensamma schema'
              )}
            </p>
            <button type="button" className="md-link" onClick={() => setChoosingFamily(true)}>
              {family ? 'Byt familj' : 'Välj familj'}
            </button>
          </div>
          {family && allAssignments.length > 0 && (
            <details className="md-family-agenda">
              <summary>
                <span>Familjens alla pass ({allAssignments.length})</span>
                {pending > 0 && <span className="md-awaiting">{pending} väntar på svar</span>}
              </summary>
              <ul>
                {allAssignments.map((item) => (
                  <li key={`${item.event.id}-${item.slot.id}`}>
                    <button
                      type="button"
                      onClick={(e) => {
                        setEventId(item.event.id);
                        const accordion = e.currentTarget.closest('details');
                        if (accordion) accordion.open = false;
                      }}
                    >
                      <span>
                        <strong>
                          {dateLabel(item.shift.startsAt, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}{' '}
                          · {timeRange(item.shift)}
                        </strong>
                        <span>
                          {item.shift.roleName} · {item.event.published!.title}
                        </span>
                      </span>
                      <PublishedStatus
                        slot={
                          item.event.cancelled ? { ...item.slot, status: 'cancelled' } : item.slot
                        }
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {published.length > 1 && (
            <div className="md-event-navigation">
              <label htmlFor="matchday-event">Evenemang</label>
              <select
                id="matchday-event"
                value={event?.id || ''}
                onChange={(e) => setEventId(e.target.value)}
              >
                {published.map((item) => (
                  <option key={item.id} value={item.id}>
                    {dateLabel(item.published!.startDate, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    · {item.published!.title}
                    {item.cancelled ? ' · Inställt' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {event && details ? (
            <>
              <header className="md-poster">
                <div className="md-date" aria-hidden="true">
                  <span className="md-day">{dateLabel(details.startDate, { day: '2-digit' })}</span>
                  <span className="md-month">
                    {dateLabel(details.startDate, { month: 'long' })}
                  </span>
                  <span className="md-weekday">
                    {dateLabel(details.startDate, { weekday: 'long' })}
                  </span>
                  <span className="md-year">
                    {dateLabel(details.startDate, { year: 'numeric' })}
                  </span>
                  {multiDay && (
                    <span className="md-date-end">
                      till {dateLabel(details.endDate, { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
                <div className="md-event-heading">
                  <p className="md-kicker">
                    {event.cancelled
                      ? 'Inställt evenemang'
                      : eventPast
                        ? 'Tidigare evenemang'
                        : 'Vi gör det tillsammans'}
                  </p>
                  <h1>{details.title}</h1>
                  <p className="sr-only">
                    {dateLabel(details.startDate, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    {multiDay &&
                      ` till ${dateLabel(details.endDate, { day: 'numeric', month: 'long', year: 'numeric' })}`}
                  </p>
                  <p className="md-place">
                    <MapPin size={17} aria-hidden="true" />
                    {details.location || 'Plats meddelas senare'}
                  </p>
                  {details.description && <p className="md-description">{details.description}</p>}
                </div>
              </header>
              {event.cancelled && (
                <p className="md-cancelled-notice" role="status">
                  Evenemanget är inställt. Ni behöver inte bemanna era pass. Ta bort eventuella
                  kopior från er egen kalender.
                </p>
              )}
              <div className={`md-day-layout ${family ? 'md-has-family' : ''}`}>
                {family && (
                  <section className="md-own" aria-label="Familjens uppdrag">
                    <div className="md-section-heading">
                      <h2>Din familjs uppdrag</h2>
                      <span>{ownAssignments.length} pass</span>
                    </div>
                    {ownAssignments.length === 0 ? (
                      <div className="md-no-assignment">
                        <Check size={23} aria-hidden="true" />
                        <p>
                          <strong>Inget pass för er här.</strong>
                          <span>Ni är inte inplanerade på det här evenemanget.</span>
                        </p>
                      </div>
                    ) : (
                      ownAssignments.map((item) => {
                        const cancelled = item.event.cancelled || item.slot.status === 'cancelled';
                        const ended = new Date(item.shift.endsAt).getTime() <= now;
                        const canAct =
                          !cancelled && ['pending', 'confirmed'].includes(item.slot.status);
                        const openRequest = state.requests.some(
                          (entry) =>
                            entry.eventId === item.event.id &&
                            entry.slotId === item.slot.id &&
                            entry.familyId === family.id &&
                            entry.status === 'open',
                        );
                        return (
                          <article
                            className={`md-assignment ${cancelled ? 'md-assignment-cancelled' : ''}`}
                            key={item.slot.id}
                          >
                            <div className="md-assignment-top">
                              <PublishedStatus
                                slot={cancelled ? { ...item.slot, status: 'cancelled' } : item.slot}
                              />
                              {multiDay && (
                                <span>
                                  {dateLabel(item.shift.startsAt, {
                                    weekday: 'short',
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                </span>
                              )}
                            </div>
                            <div className="md-assignment-main">
                              <div className="md-own-time">
                                {timeRange(item.shift)}
                                <small>{dateLabel(item.shift.startsAt, { weekday: 'long' })}</small>
                              </div>
                              <div>
                                <h3>{item.shift.roleName}</h3>
                                <p>
                                  {item.slot.adultName ? (
                                    <>
                                      <strong>{item.slot.adultName}</strong> tar passet
                                    </>
                                  ) : canAct ? (
                                    'Vem kommer från er?'
                                  ) : (
                                    familyLabel(state, family.id)
                                  )}
                                </p>
                                {item.slot.adultPhone && (
                                  <a
                                    className="md-phone"
                                    href={`tel:${item.slot.adultPhone.replace(/[^+\d]/g, '')}`}
                                  >
                                    <Phone size={14} aria-hidden="true" />
                                    {item.slot.adultPhone}
                                  </a>
                                )}
                              </div>
                            </div>
                            {stockholmsDate(item.shift.startsAt) !==
                              stockholmsDate(item.shift.endsAt) && (
                              <p className="md-muted">
                                Passet slutar{' '}
                                {dateLabel(item.shift.endsAt, {
                                  weekday: 'long',
                                  day: 'numeric',
                                  month: 'long',
                                })}
                                .
                              </p>
                            )}
                            {item.shift.instructions && (
                              <details className="md-instructions">
                                <summary>Det här gör du under passet</summary>
                                <p>{item.shift.instructions}</p>
                              </details>
                            )}
                            {canAct && (
                              <div className="md-assignment-actions">
                                <button
                                  className={`md-confirm-button ${item.slot.status === 'confirmed' ? 'md-confirmed-button' : ''}`}
                                  onClick={() => setConfirm(item)}
                                >
                                  <span>
                                    {item.slot.status === 'confirmed'
                                      ? 'Visa / ändra ansvarig'
                                      : 'Bekräfta passet'}
                                  </span>
                                  <ArrowRight size={18} aria-hidden="true" />
                                </button>
                                <div className="md-assignment-links">
                                  <BusyButton
                                    className="md-link"
                                    busy={loadingCalendar === item.slot.id}
                                    onClick={() => openCalendar(item)}
                                  >
                                    <CalendarDays size={17} aria-hidden="true" />
                                    Lägg till i kalender
                                  </BusyButton>
                                  <button className="md-link" onClick={() => setRequest(item)}>
                                    Jag behöver hjälp att byta
                                  </button>
                                </div>
                              </div>
                            )}
                            {openRequest && !cancelled && (
                              <p className="md-request-note">
                                Lagföräldern har fått er förfrågan. Nuvarande schema gäller tills en
                                ändring har godkänts.
                              </p>
                            )}
                            {ended && !cancelled && (
                              <p className="md-muted md-past-note">Det här passet har varit.</p>
                            )}
                          </article>
                        );
                      })
                    )}
                  </section>
                )}
                <section
                  className="md-roster"
                  aria-label={multiDay ? 'Evenemangets bemanning' : 'Dagens bemanning'}
                >
                  <h2>{multiDay ? 'Evenemangets bemanning' : 'Dagens bemanning'}</h2>
                  <p className="md-roster-intro">Ni hjälps åt runt laget.</p>
                  {roleGroups.length === 0 && (
                    <p className="md-empty-copy">
                      Inga pass är inlagda på det här evenemanget ännu.
                    </p>
                  )}
                  {roleGroups.map((group) => (
                    <div className="md-role-group" key={group.key}>
                      <h3>{group.name}</h3>
                      <div className="md-role-shifts">
                        {group.shifts.map((shift) => (
                          <div className="md-roster-shift" key={shift.id}>
                            <div className="md-roster-time">
                              {multiDay && (
                                <span>
                                  {dateLabel(shift.startsAt, { day: 'numeric', month: 'short' })}
                                </span>
                              )}
                              <time dateTime={shift.startsAt}>{timeRange(shift)}</time>
                              {stockholmsDate(shift.startsAt) !== stockholmsDate(shift.endsAt) && (
                                <small>
                                  till {dateLabel(shift.endsAt, { day: 'numeric', month: 'short' })}
                                </small>
                              )}
                            </div>
                            <div className="md-roster-people">
                              {shift.externalTeam ? (
                                <p className="md-external">
                                  Bemannas av <strong>{shift.externalTeam}</strong>
                                </p>
                              ) : shift.slots.length === 0 ? (
                                <p className="md-muted">Inga platser inlagda.</p>
                              ) : (
                                shift.slots.map((slot) => (
                                  <div
                                    key={slot.id}
                                    className={`md-person ${family && slot.familyId === family.id ? 'md-your-family' : ''}`}
                                  >
                                    <strong>
                                      {slot.adultName || familyLabel(state, slot.familyId)}
                                      {family && slot.familyId === family.id && (
                                        <span className="md-you"> · ni</span>
                                      )}
                                    </strong>
                                    {slot.familyId && (
                                      <small>
                                        {slot.adultName
                                          ? familyLabel(state, slot.familyId)
                                          : 'Ansvarig vuxen inte angiven'}
                                      </small>
                                    )}
                                    {slot.adultPhone && (
                                      <a
                                        className="md-phone"
                                        href={`tel:${slot.adultPhone.replace(/[^+\d]/g, '')}`}
                                      >
                                        <Phone size={13} aria-hidden="true" />
                                        {slot.adultPhone}
                                      </a>
                                    )}
                                    <PublishedStatus
                                      slot={
                                        event.cancelled ? { ...slot, status: 'cancelled' } : slot
                                      }
                                    />
                                  </div>
                                ))
                              )}
                              {shift.instructions && (
                                <details className="md-instructions">
                                  <summary>Instruktioner</summary>
                                  <p>{shift.instructions}</p>
                                </details>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            </>
          ) : (
            <section className="md-no-events">
              <p className="md-kicker">Tillsammans runt laget</p>
              <h1>Lagets bemanning</h1>
              <h2>Inget schema är publicerat ännu</h2>
              <p>Nästa tilldelning dyker upp här när planeringen är klar.</p>
            </section>
          )}
        </>
      )}
      <footer className="md-help">
        <HeartHandshake size={23} aria-hidden="true" />
        <div>
          <strong>Behöver du hjälp?</strong>
          <span>
            Kontakta {state.team.contactName || 'lagföräldern'}
            {state.team.contactPhone && (
              <>
                {' '}
                ·{' '}
                <a href={`tel:${state.team.contactPhone.replace(/[^+\d]/g, '')}`}>
                  {state.team.contactPhone}
                </a>
              </>
            )}
          </span>
        </div>
        <p>Tack för att ni är med.</p>
      </footer>
      {confirm && (
        <ConfirmModal
          item={confirm}
          state={state}
          onClose={() => setConfirm(null)}
          onSubmit={async (command) => {
            await mutate(command);
            setConfirm(null);
            tell('Tack! Passet är bekräftat.');
          }}
        />
      )}
      {request && (
        <RequestModal
          item={request}
          onClose={() => setRequest(null)}
          onSubmit={async (command) => {
            await mutate(command);
            setRequest(null);
            tell(
              'Din förfrågan är sparad. Nuvarande schema gäller tills lagföräldern har ordnat bytet.',
            );
          }}
        />
      )}
      {calendar && (
        <Modal title="Lägg till i kalender" onClose={() => setCalendar(null)}>
          <div className="modal-body">
            <div className="calendar-preview">
              <CalendarDays size={28} />
              <div>
                <strong>{calendar.title}</strong>
                <p>
                  {dateLabel(calendar.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}{' '}
                  · {timeLabelForCalendar(calendar)}
                </p>
                <p>{calendar.location}</p>
              </div>
            </div>
            <a
              className="button primary full"
              href={googleCalendarUrl(calendar)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={18} />
              Öppna Google Kalender
            </a>
            <button
              className="button secondary full"
              onClick={() =>
                download(
                  toIcs(calendar),
                  `passlaget-${calendar.id}.ics`,
                  'text/calendar;charset=utf-8',
                )
              }
            >
              <Download size={18} />
              Apple Kalender / kalenderfil
            </button>
            <p className="hint">
              En kopia sparas i din kalender. Om passet ändras eller ställs in behöver du uppdatera
              kalendern själv.
            </p>
            <details className="instructions">
              <summary>Om kalenderfilen inte öppnas på mobilen</summary>
              <p>
                Öppna sidan i Safari eller Chrome. Välj Google Kalender om du använder den, eller
                öppna den hämtade kalenderfilen i en kompatibel kalenderapp. Du slutför sparandet
                där.
              </p>
            </details>
          </div>
        </Modal>
      )}
    </div>
  );
}
const timeLabelForCalendar = (event: CalendarEvent) =>
  `${dateLabel(event.startsAt, { hour: '2-digit', minute: '2-digit' })}–${dateLabel(event.endsAt, { hour: '2-digit', minute: '2-digit' })}`;

function ConfirmModal({
  item,
  state,
  onClose,
  onSubmit,
}: {
  item: Selection;
  state: PortalState;
  onClose: () => void;
  onSubmit: (command: PortalCommand) => Promise<void>;
}) {
  const adults = familyAdults(state, item.slot.familyId);
  const initial =
    adults.find((a) => a.id === item.slot.adultId) || (item.slot.adultName ? undefined : adults[0]);
  const [adultId, setAdultId] = useState(initial?.id || '');
  const [name, setName] = useState(initial?.name || item.slot.adultName || '');
  const [phone, setPhone] = useState(item.slot.adultPhone || initial?.phone || '');
  const [email, setEmail] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Bekräfta familjens pass" onClose={onClose}>
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onSubmit({
              type: 'confirm',
              eventId: item.event.id,
              slotId: item.slot.id,
              revision: item.slot.revision,
              familyId: item.slot.familyId!,
              adultId: adultId || undefined,
              adultName: name.trim(),
              adultPhone: phone.trim(),
              adultEmail: email.trim(),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="compact-summary">
          <strong>{item.shift.roleName}</strong>
          <span>
            {dateLabel(item.shift.startsAt)} · {timeRange(item.shift)}
          </span>
        </div>
        {adults.length > 0 && (
          <label>
            Vem kommer?
            <select
              value={adultId}
              onChange={(e) => {
                setAdultId(e.target.value);
                const adult = adults.find((a) => a.id === e.target.value);
                setName(adult?.name || '');
                setPhone(adult?.phone || '');
                setEmail('');
              }}
            >
              {adults.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="">Ange annan ansvarig vuxen</option>
            </select>
          </label>
        )}
        <label>
          Namn
          <input
            required
            maxLength={120}
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setAdultId('');
            }}
          />
        </label>
        <label>
          Telefonnummer
          <input
            required
            type="tel"
            maxLength={30}
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <p className="hint">
          Namn och telefonnummer visas i evenemangets schema. Uppgifterna gäller detta pass.
        </p>
        <label>
          Mejladress
          <input
            required
            type="email"
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <p className="hint">
          Mejladressen sparas på den som kommer och används för tilldelningar och påminnelser. Den
          visas inte för andra föräldrar.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            required
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
          />
          <span>Jag har läst uppgiften och bekräftar att vi tar passet.</span>
        </label>
        {error && <Notice text={error} error />}
        <BusyButton busy={busy} className="button primary full" disabled={!accept} type="submit">
          <Check size={18} />
          Bekräfta passet
        </BusyButton>
      </form>
    </Modal>
  );
}
function RequestModal({
  item,
  onClose,
  onSubmit,
}: {
  item: Selection;
  onClose: () => void;
  onSubmit: (command: PortalCommand) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Be om hjälp med passet" onClose={onClose}>
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit({
              type: 'request_change',
              eventId: item.event.id,
              slotId: item.slot.id,
              revision: item.slot.revision,
              familyId: item.slot.familyId!,
              message: message.trim(),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="compact-summary">
          <strong>{item.shift.roleName}</strong>
          <span>
            {dateLabel(item.shift.startsAt)} · {timeRange(item.shift)}
          </span>
        </div>
        <label>
          Meddelande till lagföräldern
          <textarea
            required
            rows={4}
            maxLength={1000}
            placeholder="Beskriv vad du behöver hjälp med. Undvik känsliga personuppgifter."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <p className="hint">Du står kvar på passet tills lagföräldern har godkänt en ändring.</p>
        {error && <Notice text={error} error />}
        <BusyButton busy={busy} className="button primary" type="submit">
          Skicka förfrågan
        </BusyButton>
      </form>
    </Modal>
  );
}
