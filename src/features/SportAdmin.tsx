import { useState } from 'react';
import { isDemo } from '../client';
import type { PortalState } from '../domain/model';
import { attendanceWarnings } from '../domain/logic';
import { useSportAdmin } from './useSportAdmin';
export type { Integration } from './useSportAdmin';

export default function SportAdminPanel({
  state,
  refresh,
  onOpenPlayers,
}: {
  state: PortalState;
  refresh: () => Promise<void>;
  onOpenPlayers: () => void;
}) {
  const { data, busy, error, notice, act } = useSportAdmin(refresh, state.version);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="sportadmin-panel">
      <div className="page-heading">
        <div>
          <h1>SportAdmin</h1>
          <p className="muted">Bemanna med familjer vars barn ska vara med och spela.</p>
        </div>
        {data?.connected && (
          <button className="button primary" disabled={busy} onClick={() => void act('sync')}>
            {busy ? 'Uppdaterar…' : 'Uppdatera nu'}
          </button>
        )}
      </div>
      {isDemo && <p>SportAdmin ansluts i den riktiga portalen.</p>}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {data?.error && (
        <p role="alert" className="notice">
          {data.error}
        </p>
      )}
      {!isDemo && (!data?.connected || data.error) && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void act('connect', { email, password });
            setPassword('');
          }}
        >
          <h2>Anslut ditt konto</h2>
          <p>
            Inloggningen används bara för att läsa uppgifter. Ditt SportAdmin-lösenord sparas inte.
          </p>
          <label>
            Mejladress
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Lösenord till SportAdmin
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="button primary" disabled={busy}>
            Anslut SportAdmin
          </button>
        </form>
      )}
      {data?.connected && (
        <>
          <section className="panel">
            <h2>Anslutning</h2>
            <p>
              Uppdateras automatiskt varje timme. Senast uppdaterat:{' '}
              {data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('sv-SE') : 'inte ännu'}.
            </p>
            {data.selected ? (
              <p>
                {data.selected.clubName} ·{' '}
                {data.inventory?.groupName ||
                  data.selected.groupName ||
                  `grupp ${data.selected.groupId}`}
              </p>
            ) : (
              <label>
                Välj lag
                <select
                  disabled={busy}
                  value=""
                  onChange={(e) => {
                    const p = data.profiles[Number(e.target.value)];
                    if (p) void act('select', p as unknown as Record<string, unknown>);
                  }}
                >
                  <option value="">Välj ditt lag</option>
                  {data.profiles.map((p, i) => (
                    <option key={i} value={i}>
                      {p.clubName} · grupp {p.groupId}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="muted">
              {data.inventoryEnabled
                ? 'Spelare och föräldrakontakter uppdateras från SportAdmin. Integrationen kan enbart läsa.'
                : 'Aktivera registersynkningen under Spelare & föräldrar när kontot har ledarbehörighet för laget.'}
            </p>
            <button className="text-button" disabled={busy} onClick={() => void act('disconnect')}>
              Koppla från SportAdmin
            </button>
          </section>
          {data.selected && (
            <>
              <section className="panel">
                <h2>Spelare & föräldrar</h2>
                <p>
                  Spelarlistan, föräldrakontakter och registersynkningen finns samlade under Spelare
                  & föräldrar.
                </p>
                <button className="button secondary" onClick={onOpenPlayers}>
                  Öppna Spelare & föräldrar
                </button>
              </section>
              <section className="panel">
                <h2>Kopplade evenemang</h2>
                <p>
                  Välj SportAdmin-aktivitet när du skapar eller redigerar evenemanget under
                  Evenemang.
                </p>
                {state.events
                  .filter((e) => e.attendance)
                  .map((e) => (
                    <div className="sa-linked" key={e.id}>
                      <strong>{e.draft.title}</strong>
                      <p>{e.attendance!.title}</p>
                      {attendanceWarnings(state, e).length > 0 && (
                        <p role="alert">
                          Kontrollera befintliga pass för: {attendanceWarnings(state, e).join(', ')}
                          . Passen ligger kvar tills du ändrar dem.
                        </p>
                      )}
                      <p className="muted">
                        {e.attendance!.error ||
                          `Senast läst: ${e.attendance!.checkedAt ? new Date(e.attendance!.checkedAt).toLocaleString('sv-SE') : 'väntar på uppdatering'}`}
                      </p>
                    </div>
                  ))}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
