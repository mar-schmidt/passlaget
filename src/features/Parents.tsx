import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  HeartHandshake,
  Mail,
  MapPin,
  Phone,
  Search,
  Users,
} from 'lucide-react';
import { api, isDemo, mailEnabled, readPortal } from '../client';
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
  Empty,
  familyAdults,
  familyLabel,
  Modal,
  Notice,
  roleEmoji,
  Status,
  timeRange,
} from '../ui';

type Selection = { event: PortalEvent; shift: Shift; slot: Slot };
interface Props {
  state: PortalState;
  familyId: string;
  setFamilyId: (id: string) => void;
  mutate: (command: PortalCommand) => Promise<PortalState>;
  tell: (text: string, error?: boolean) => void;
}
export default function Parents({ state, familyId, setFamilyId, mutate, tell }: Props) {
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [eventId, setEventId] = useState('');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Selection | null>(null);
  const [request, setRequest] = useState<Selection | null>(null);
  const [calendar, setCalendar] = useState<CalendarEvent | null>(null);
  const [mail, setMail] = useState(false);
  const [loadingCalendar, setLoadingCalendar] = useState('');
  const published = state.events
    .filter((e) => e.published)
    .sort((a, b) => a.published!.startDate.localeCompare(b.published!.startDate));
  const visibleEvents = published.filter((e) => !eventId || e.id === eventId);
  const allAssignments = published.flatMap((event) =>
    event.published!.shifts.flatMap((shift) =>
      shift.slots
        .filter(
          (slot) => slot.familyId === familyId && slot.status !== 'cancelled' && !event.cancelled,
        )
        .map((slot) => ({ event, shift, slot })),
    ),
  );
  const assignments = allAssignments
    .filter((a) => a.slot.status !== 'completed' && a.slot.status !== 'absent')
    .sort((a, b) => a.shift.startsAt.localeCompare(b.shift.startsAt));
  const pending = assignments.filter((a) => a.slot.status === 'pending').length;
  const familyOptions = state.families.filter(
    (f) => f.active && familyLabel(state, f.id).toLowerCase().includes(query.toLowerCase()),
  );
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
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TILLSAMMANS RUNT LAGET</p>
          <h1>Lagets bemanning</h1>
          <p className="muted">Se ditt uppdrag, bekräfta ditt pass och hjälp laget på vägen.</p>
        </div>
        <span className="team-pill">
          <span className="club-mark">LIS</span>
          {state.team.name}
        </span>
      </div>
      <section className="family-select-card">
        <div className="family-select-icon">
          <Users size={25} />
        </div>
        <div className="family-select-copy">
          <h2>Vilken familj tillhör du?</h2>
          <p>Syskon delar på familjens uppdrag.</p>
        </div>
        <div className="family-picker">
          <label className="sr-only" htmlFor="family">
            Välj barn eller familj
          </label>
          <select id="family" value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
            <option value="">Välj barn eller familj</option>
            {state.families
              .filter((f) => f.active)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {familyLabel(state, f.id)}
                </option>
              ))}
          </select>
          <ChevronDown size={18} />
        </div>
      </section>
      <div className="toolbar">
        <div className="segmented" aria-label="Visa uppdrag">
          <button className={tab === 'mine' ? 'selected' : ''} onClick={() => setTab('mine')}>
            Familjens pass {familyId && <span>{assignments.length}</span>}
          </button>
          <button className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')}>
            Hela schemat
          </button>
        </div>
        {familyId && mailEnabled && (
          <button className="button ghost" onClick={() => setMail(true)}>
            <Mail size={17} />
            Mejlpåminnelser
          </button>
        )}
      </div>
      {tab === 'mine' ? (
        !familyId ? (
          <section className="panel">
            <Empty icon={<HeartHandshake size={42} />} title="Alla insatser gör skillnad">
              Välj ditt barn ovan för att se familjens pass. Du kan också titta på hela schemat.
            </Empty>
            <div className="family-search">
              <Search size={17} />
              <input
                aria-label="Sök bland familjer"
                placeholder="Sök barnets namn"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="family-options">
              {familyOptions.slice(0, 8).map((f) => (
                <button key={f.id} onClick={() => setFamilyId(f.id)}>
                  {familyLabel(state, f.id)}
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            {pending > 0 && (
              <div className="action-banner">
                <span className="number-circle">{pending}</span>
                <div>
                  <strong>
                    {pending === 1
                      ? 'Ett pass väntar på ditt svar'
                      : `${pending} pass väntar på ditt svar`}
                  </strong>
                  <p>Bekräfta att ni kan ta uppdragen och ange vem som kommer.</p>
                </div>
              </div>
            )}
            <div className="section-title">
              <h2>Familjens kommande pass</h2>
              <span className="muted">{familyLabel(state, familyId)}</span>
            </div>
            {assignments.length === 0 ? (
              <section className="panel">
                <Empty icon={<Check size={36} />} title="Inga nya pass just nu">
                  Nästa tilldelning dyker upp här när schemat publiceras.
                </Empty>
              </section>
            ) : (
              <div className="assignment-list">
                {assignments.map((item) => (
                  <article
                    key={item.slot.id}
                    className={`assignment-card ${item.slot.status === 'pending' ? 'needs-response' : ''}`}
                  >
                    <div className="date-tile">
                      <span>{dateLabel(item.shift.startsAt, { month: 'short' })}</span>
                      <strong>{dateLabel(item.shift.startsAt, { day: 'numeric' })}</strong>
                      <small>{dateLabel(item.shift.startsAt, { weekday: 'short' })}</small>
                    </div>
                    <div className="assignment-main">
                      <div className="card-topline">
                        <span className="overline">{item.event.published!.title}</span>
                        <Status slot={item.slot} />
                      </div>
                      <h3>{item.shift.roleName}</h3>
                      <div className="meta-row">
                        <span>
                          <CalendarDays size={15} />
                          {timeRange(item.shift)}
                        </span>
                        <span>
                          <MapPin size={15} />
                          {item.event.published!.location}
                        </span>
                      </div>
                      <p className="assignment-person">
                        {item.slot.adultName ? (
                          <>
                            <strong>{item.slot.adultName}</strong> tar passet
                          </>
                        ) : (
                          'Välj vilken vuxen som kommer när du bekräftar.'
                        )}
                      </p>
                      {item.shift.instructions && (
                        <details className="instructions">
                          <summary>Det här gör du under passet</summary>
                          <p>{item.shift.instructions}</p>
                        </details>
                      )}
                      <div className="assignment-actions">
                        <button
                          className={`button ${item.slot.status === 'confirmed' ? 'secondary' : 'primary'}`}
                          onClick={() => setConfirm(item)}
                        >
                          <Check size={17} />
                          {item.slot.status === 'confirmed'
                            ? 'Visa / ändra ansvarig'
                            : 'Bekräfta passet'}
                        </button>
                        <BusyButton
                          className="button ghost"
                          busy={loadingCalendar === item.slot.id}
                          onClick={() => openCalendar(item)}
                        >
                          <CalendarDays size={17} />
                          Lägg till i kalender
                        </BusyButton>
                        <button className="text-button" onClick={() => setRequest(item)}>
                          Jag behöver hjälp att byta
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <>
          <div className="event-filter">
            <label htmlFor="event-filter">Evenemang</label>
            <select id="event-filter" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Alla publicerade evenemang</option>
              {published.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.published!.title}
                </option>
              ))}
            </select>
          </div>
          {visibleEvents.length === 0 && (
            <section className="panel">
              <Empty title="Inget schema är publicerat ännu">
                Kom tillbaka när planeringen är klar.
              </Empty>
            </section>
          )}
          {visibleEvents.map((event) => (
            <section className="panel schedule-panel" key={event.id}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">
                    {dateLabel(event.published!.startDate, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </p>
                  <h2>{event.published!.title}</h2>
                  <p className="muted">
                    <MapPin size={15} />
                    {event.published!.location}
                  </p>
                </div>
                {event.cancelled && <span className="badge cancelled">Inställt</span>}
              </div>
              {event.published!.description && (
                <p className="event-description">{event.published!.description}</p>
              )}
              <div className="schedule-list">
                {event.published!.shifts.map((shift) => (
                  <div className="schedule-row" key={shift.id}>
                    <div className="role-icon">{roleEmoji(shift.roleName)}</div>
                    <div className="schedule-role">
                      <strong>{shift.roleName}</strong>
                      <span>
                        {dateLabel(shift.startsAt, { day: 'numeric', month: 'short' })} ·{' '}
                        {timeRange(shift)}
                      </span>
                      {shift.instructions && (
                        <details className="instructions">
                          <summary>Instruktioner</summary>
                          <p>{shift.instructions}</p>
                        </details>
                      )}
                    </div>
                    <div className="schedule-people">
                      {shift.externalTeam ? (
                        <span className="external-team">Bemannas av {shift.externalTeam}</span>
                      ) : (
                        shift.slots.map((slot) => (
                          <div
                            key={slot.id}
                            className={`schedule-person ${familyId && slot.familyId === familyId ? 'your-family' : ''}`}
                          >
                            <div>
                              <strong>{slot.adultName || familyLabel(state, slot.familyId)}</strong>
                              {slot.familyId && (
                                <small>
                                  {slot.adultName
                                    ? familyLabel(state, slot.familyId)
                                    : 'Ansvarig vuxen inte angiven'}
                                </small>
                              )}
                              {slot.adultPhone && (
                                <a href={`tel:${slot.adultPhone.replace(/[^+\d]/g, '')}`}>
                                  <Phone size={13} />
                                  {slot.adultPhone}
                                </a>
                              )}
                            </div>
                            <Status slot={slot} />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      <div className="contact-strip">
        <HeartHandshake size={22} />
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
      </div>
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
      {mail && mailEnabled && (
        <MailModal state={state} familyId={familyId} onClose={() => setMail(false)} tell={tell} />
      )}
    </>
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
function MailModal({
  state,
  familyId,
  onClose,
  tell,
}: {
  state: PortalState;
  familyId: string;
  onClose: () => void;
  tell: (message: string, error?: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [adultId, setAdultId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Påminnelser till din mejl" onClose={onClose}>
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (isDemo) {
              tell('Detta är en demonstration. Inga mejl skickas.');
            } else {
              await api({
                action: 'subscribe',
                familyId,
                adultId: adultId || undefined,
                email,
                scope: adultId ? 'adult' : 'family',
              });
              tell(
                'Om adressen kan registreras skickas ett mejl för att bekräfta prenumerationen.',
              );
            }
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>Få information när ett pass tilldelas eller ändras och en påminnelse inför uppdraget.</p>
        <label>
          Vilka pass?
          <select value={adultId} onChange={(e) => setAdultId(e.target.value)}>
            <option value="">Alla familjens pass</option>
            {familyAdults(state, familyId).map((a) => (
              <option key={a.id} value={a.id}>
                Pass där {a.name} ansvarar
              </option>
            ))}
          </select>
        </label>
        <label>
          Din mejladress
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
        </label>
        <p className="hint">
          Adressen visas inte i schemat. Du aktiverar påminnelserna via ett mejl och kan avsluta dem
          med länken i varje utskick.
        </p>
        {isDemo && <div className="demo-note">Demoläge: inga mejl skickas.</div>}
        {error && <Notice text={error} error />}
        <BusyButton type="submit" className="button primary" busy={busy}>
          <Mail size={17} />
          Aktivera påminnelser
        </BusyButton>
      </form>
    </Modal>
  );
}
