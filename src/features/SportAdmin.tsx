import { useEffect, useState } from 'react';
import { api, isDemo } from '../client';
import type { PortalState } from '../domain/model';
import { attendanceWarnings } from '../domain/logic';

interface Profile {
  clubId: number;
  clubName: string;
  groupId: number;
  memberId: number;
  groupName?: string;
}
export interface Integration {
  connected: boolean;
  selected?: Profile;
  profiles: Profile[];
  activities: { id: number; title: string; startsAt: string }[];
  players: { id: number; name: string; birthYear: string }[];
  mapping: Record<string, number>;
  links: Record<string, number>;
  lastSyncAt?: string;
  error?: string;
  rosterStatus?: string;
  inventoryEnabled?: boolean;
  rosterError?: string;
  inventory?: {
    checkedAt: string;
    groupName: string;
    active: number;
    departed: number;
    missingEmail: number;
  };
}
export default function SportAdminPanel({
  state,
  refresh,
  onEditFamily,
}: {
  state: PortalState;
  refresh: () => Promise<void>;
  onEditFamily?: (familyId?: string) => void;
}) {
  const [data, setData] = useState<Integration>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  async function act(operation: string, values: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ integration: Integration }>({
        action: 'sportadmin',
        operation,
        ...values,
      });
      setData(result.integration);
      if (operation !== 'status') {
        await refresh();
        setNotice(
          result.integration.rosterError ||
            result.integration.error ||
            'Uppgifterna är uppdaterade.',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!isDemo) void act('status');
  }, []);
  const children = state.children
    .filter(
      (c) =>
        (showInactive || c.active) &&
        c.name.toLocaleLowerCase('sv').includes(query.toLocaleLowerCase('sv')),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
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
                : 'Aktivera Spelarinventeringen när kontot har ledarbehörighet för laget.'}
            </p>
            <button className="text-button" disabled={busy} onClick={() => void act('disconnect')}>
              Koppla från SportAdmin
            </button>
          </section>
          {data.selected && (
            <>
              <section className="panel">
                <div className="page-heading">
                  <div>
                    <h2>Spelarinventeringen</h2>
                    <p>
                      SportAdmins register gäller för spelare med status <strong>synka</strong>.
                      Spelare med status <strong>manuell</strong> sköter du här i Passlaget.
                    </p>
                  </div>
                  {onEditFamily && (
                    <button
                      className="button primary add-player-button"
                      onClick={() => onEditFamily()}
                    >
                      Lägg till manuell spelare
                    </button>
                  )}
                </div>
                {!data.inventoryEnabled && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void act('inventory_sync')}
                  >
                    Aktivera Spelarinventeringen
                  </button>
                )}
                {data.inventory && (
                  <p className="muted">
                    {data.inventory.active} aktiva spelare i SportAdmin ·{' '}
                    {state.children.filter((c) => c.source === 'manual' && c.active).length}{' '}
                    manuella spelare. Senast läst:{' '}
                    {new Date(data.inventory.checkedAt).toLocaleString('sv-SE')}.
                  </p>
                )}
                {data.rosterError && (
                  <p role="alert" className="notice">
                    {data.rosterError} Senast sparade inventering behålls.
                  </p>
                )}
                {!!data.inventory?.missingEmail && (
                  <p className="notice">
                    Mejladress saknas för{' '}
                    {data.inventory.missingEmail === 1
                      ? 'en föräldrakontakt'
                      : `${data.inventory.missingEmail} föräldrakontakter`}
                    . Komplettera i SportAdmin och uppdatera här.
                  </p>
                )}
                <div className="inventory-toolbar">
                  <label>
                    Sök spelare
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Spelarens namn"
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                    />
                    Visa även slutade spelare
                  </label>
                </div>
                <div className="table-scroll">
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>Spelare</th>
                        <th>Status</th>
                        <th>I laget</th>
                        <th>Föräldrakontakter</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {children.map((child) => {
                        const synced = child.source === 'sportadmin' || !!data.mapping[child.id];
                        const parents = state.adults.filter(
                          (a) => a.active && a.familyIds.includes(child.familyId),
                        );
                        return (
                          <tr key={child.id}>
                            <td>
                              <strong>{child.name}</strong>
                            </td>
                            <td>
                              <span className={`badge ${synced ? 'confirmed' : 'exempt'}`}>
                                {synced ? 'synka' : 'manuell'}
                              </span>
                            </td>
                            <td>{child.active ? 'Aktiv' : 'Slutat'}</td>
                            <td>
                              {parents.length
                                ? parents.map((a) => a.name).join(', ')
                                : 'Inga aktiva kontakter'}
                              {parents.some((a) => !a.email) && (
                                <small className="inventory-missing">Mejladress saknas</small>
                              )}
                            </td>
                            <td>
                              {onEditFamily && (
                                <button
                                  className="text-button"
                                  onClick={() => onEditFamily(child.familyId)}
                                  aria-label={`Visa familjen för ${child.name}`}
                                >
                                  Visa familj
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!children.length && <p>Inga spelare matchar sökningen.</p>}
                {data.players.length > 0 && (
                  <details className="instructions">
                    <summary>Koppla en befintlig spelare till SportAdmin</summary>
                    <p>
                      Koppla namn som behöver rättas. Entydiga namnträffar kopplas automatiskt vid
                      inventeringen.
                    </p>
                    <div className="sa-mappings">
                      {state.children
                        .filter(
                          (c) => c.active && (!data.inventoryEnabled || c.source === 'manual'),
                        )
                        .map((child) => (
                          <label key={child.id}>
                            {child.name}
                            <select
                              aria-label={`SportAdmin-spelare för ${child.name}`}
                              disabled={busy}
                              value={data.mapping[child.id] || ''}
                              onChange={(e) =>
                                void act('map', {
                                  childId: child.id,
                                  memberId: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                            >
                              <option value="">Inte kopplad</option>
                              {data.players.map((p) => (
                                <option
                                  key={p.id}
                                  value={p.id}
                                  disabled={Object.entries(data.mapping).some(
                                    ([id, member]) => id !== child.id && member === p.id,
                                  )}
                                >
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                    </div>
                  </details>
                )}
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
