import type { ReactNode } from 'react';
import type { PortalEvent, PortalState, Shift, Slot } from '../domain/model';
import { dateLabel, Empty, familyLabel, Notice, Status, timeRange } from '../ui';
import './event-confirmations.css';

function ReplyCounts({ slots, label }: { slots: Slot[]; label: string }) {
  const counts = [
    {
      label: 'bekräftade',
      count: slots.filter((s) => s.familyId && s.status === 'confirmed').length,
    },
    {
      label: 'inväntar svar',
      count: slots.filter((s) => s.familyId && s.status === 'pending').length,
    },
    { label: 'lediga', count: slots.filter((s) => !s.familyId && s.status !== 'cancelled').length },
    { label: 'genomförda', count: slots.filter((s) => s.status === 'completed').length },
    { label: 'ej genomförda', count: slots.filter((s) => s.status === 'absent').length },
    { label: 'inställda', count: slots.filter((s) => s.status === 'cancelled').length },
  ];
  return (
    <div className="reply-counts" role="group" aria-label={label}>
      {counts
        .filter((count, index) => count.count || index < 2)
        .map((count) => (
          <span key={count.label}>
            {count.label[0].toUpperCase() + count.label.slice(1)}: <strong>{count.count}</strong>
          </span>
        ))}
    </div>
  );
}

export default function EventConfirmations({
  event,
  state,
  unpublishedChanges,
  refreshError,
  renderReminder,
}: {
  event: PortalEvent;
  state: PortalState;
  unpublishedChanges: boolean;
  refreshError: boolean;
  renderReminder: (slot: Slot) => ReactNode;
}) {
  const details = event.published || event.draft;
  const groups = new Map<string, { name: string; shifts: Shift[] }>();
  for (const shift of details.shifts) {
    const name = [shift.group, shift.title || shift.roleName].filter(Boolean).join(' · ');
    const group = groups.get(name) || { name, shifts: [] };
    group.shifts.push(shift);
    groups.set(name, group);
  }
  const statusSlot = (slot: Slot): Slot =>
    event.cancelled ? { ...slot, status: 'cancelled' } : slot;
  const slots = details.shifts
    .filter((shift) => !shift.externalTeam)
    .flatMap((shift) => shift.slots.map(statusSlot));
  return (
    <section className="event-confirmations" aria-label="Bekräftelser per station och pass">
      <div className="reply-intro">
        <h2>Vem har bekräftat?</h2>
        <p className="muted">
          {event.published
            ? 'Familjernas svar på det publicerade schemat, grupperade per station och pass.'
            : event.confirmationImport
              ? 'Sparat utkast. Bekräftelser som importerats visas här; övriga familjer kan svara efter publicering.'
              : 'Sparat utkast. Familjerna kan bekräfta sina pass efter publicering.'}
        </p>
        {unpublishedChanges && (
          <p className="hint">
            Ändringar i planeringen visas här först när du{' '}
            {event.published ? 'publicerar schemat' : 'sparar utkastet'}.
          </p>
        )}
        {refreshError && (
          <Notice
            text="De senaste svaren kunde inte hämtas. Ett nytt försök görs automatiskt."
            error
          />
        )}
        <ReplyCounts slots={slots} label="Sammanställning för evenemanget" />
      </div>
      {groups.size === 0 && (
        <Empty title="Inga pass ännu">Lägg till pass under Pass & bemanning.</Empty>
      )}
      {[...groups.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true }))
        .map((group) => (
          <section className="reply-station" key={group.name} aria-label={`Station: ${group.name}`}>
            <h3>{group.name}</h3>
            {[...group.shifts]
              .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
              .map((shift) => (
                <article
                  className="reply-shift"
                  key={shift.id}
                  aria-label={`${group.name}, ${dateLabel(shift.startsAt)}, ${timeRange(shift)}`}
                >
                  <header className="reply-shift-head">
                    <h4>
                      {shift.kind === 'task' ? (
                        timeRange(shift)
                      ) : (
                        <>
                          {dateLabel(shift.startsAt, {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                          <span>{timeRange(shift)}</span>
                        </>
                      )}
                    </h4>
                    {!shift.externalTeam && (
                      <ReplyCounts
                        slots={shift.slots.map(statusSlot)}
                        label="Sammanställning för passet"
                      />
                    )}
                  </header>
                  {shift.externalTeam ? (
                    <p className="muted reply-external">Bemannas av {shift.externalTeam}</p>
                  ) : (
                    <ul className="reply-people">
                      {shift.slots.map((slot, index) => (
                        <li key={slot.id}>
                          <div className="reply-person">
                            <strong>
                              {slot.familyId
                                ? familyLabel(state, slot.familyId)
                                : `Ledig plats ${index + 1}`}
                            </strong>
                            {slot.familyId && <span>{slot.adultName || 'Vuxen ej angiven'}</span>}
                          </div>
                          {statusSlot(slot).status === 'cancelled' ? (
                            <span className="badge cancelled">
                              <span />
                              Inställt
                            </span>
                          ) : (
                            <Status slot={slot} />
                          )}
                          {!!event.published &&
                            !event.cancelled &&
                            slot.familyId &&
                            slot.status === 'pending' &&
                            Date.parse(shift.startsAt) > Date.now() &&
                            renderReminder(slot)}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
          </section>
        ))}
    </section>
  );
}
