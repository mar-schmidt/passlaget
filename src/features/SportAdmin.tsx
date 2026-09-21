import { useEffect, useState } from 'react';
import { api, isDemo } from '../client';
import type { PortalState } from '../domain/model';
import { attendanceWarnings } from '../domain/logic';
import { dateLabel } from '../ui';
interface Profile {
  clubId: number;
  clubName: string;
  groupId: number;
  memberId: number;
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
}
export default function SportAdminPanel({
  state,
  refresh,
}: {
  state: PortalState;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<Integration>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState('');
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
        setNotice(result.integration.error || 'Uppgifterna är uppdaterade.');
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
  const normal = (s: string) =>
    s.toLocaleLowerCase('sv').normalize('NFC').trim().replace(/\s+/g, ' ');
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
                {data.selected.clubName} · grupp {data.selected.groupId}
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
              {data.rosterStatus === 'verification_required'
                ? 'Kontot har ledarbehörighet. Spelarinventeringen behöver verifieras innan automatisk avaktivering kan aktiveras.'
                : 'Spelarinventeringen väntar på ledarbehörighet för laget. Inga barn markeras som slutade på grund av ett saknat kallelsesvar.'}
            </p>
            <button className="text-button" disabled={busy} onClick={() => void act('disconnect')}>
              Koppla från SportAdmin
            </button>
          </section>
          {data.selected && (
            <>
              <section className="panel">
                <h2>Koppla spelarna</h2>
                <p>
                  Hämta spelare från en aktivitet. Koppla varje namn till rätt barn i Passlaget.
                  Detta behöver normalt bara göras en gång.
                </p>
                <label>
                  Hämta spelare från
                  <select value={preview} onChange={(e) => setPreview(e.target.value)}>
                    <option value="">Välj aktivitet</option>
                    {data.activities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {dateLabel(a.startsAt)} · {a.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={busy || !preview}
                  onClick={() => void act('preview', { activityId: Number(preview) })}
                >
                  Hämta spelare
                </button>
                {data.players.length > 0 && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void act('map_exact')}
                  >
                    Koppla entydiga namnträffar
                  </button>
                )}
                {data.players.length > 0 && (
                  <div className="sa-mappings">
                    {state.children
                      .filter((c) => c.active || data.mapping[c.id])
                      .map((child) => {
                        const suggestions = data.players.filter(
                          (p) => normal(p.name) === normal(child.name),
                        );
                        return (
                          <label key={child.id}>
                            <span>
                              {child.name}
                              {!child.active ? ' (inaktiv)' : ''}
                            </span>
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
                              <option value="">
                                Inte kopplad
                                {suggestions.length === 1
                                  ? ` – förslag: ${suggestions[0].name}`
                                  : ''}
                              </option>
                              {data.players.map((p) => (
                                <option
                                  key={p.id}
                                  value={p.id}
                                  disabled={Object.entries(data.mapping).some(
                                    ([id, member]) => id !== child.id && member === p.id,
                                  )}
                                >
                                  {p.name}
                                  {p.birthYear ? ` (${p.birthYear})` : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                  </div>
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
