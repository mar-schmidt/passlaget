import { isDemo } from '../client';
import type { PortalState } from '../domain/model';
import { PlayerSourceChip, familyAdults } from '../ui';
import { useSportAdmin } from './useSportAdmin';

export default function PlayerSync({
  state,
  refresh,
  onOpenConnection,
}: {
  state: PortalState;
  refresh: () => Promise<void>;
  onOpenConnection: () => void;
}) {
  const { data, busy, error, notice, act } = useSportAdmin(refresh, state.version);
  const conflicts = data?.inventoryConflicts || [];
  return (
    <section className="panel player-sync" aria-label="Registersynkning">
      <div className="player-sync-heading">
        <div>
          <h2>Synkning från SportAdmin</h2>
          <p className="muted">
            {data?.inventory
              ? `Senaste synkning: ${new Date(data.inventory.checkedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}. Uppdateras automatiskt varje timme.`
              : isDemo
                ? 'Exempeldata – ingen SportAdmin-synkning.'
                : !data
                  ? 'Hämtar synkstatus…'
                  : 'Ingen registersynkning ännu.'}
          </p>
        </div>
        {data?.connected && data.selected ? (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void act(data.inventoryEnabled ? 'sync' : 'inventory_sync')}
          >
            {busy
              ? 'Uppdaterar…'
              : data.inventoryEnabled
                ? 'Synka nu'
                : 'Aktivera registersynkning'}
          </button>
        ) : (
          !isDemo && (
            <button className="text-button" onClick={onOpenConnection}>
              Öppna SportAdmin-anslutningen
            </button>
          )
        )}
      </div>
      <p className="hint">
        <PlayerSourceChip synced /> hämtar namn, kontakter och medlemsstatus från SportAdmin.{' '}
        <PlayerSourceChip synced={false} /> sköts här. Undantag och tillgänglighet gäller hela
        familjen.
      </p>
      {(error || data?.rosterError || data?.error) && (
        <p className="notice" role="alert">
          {error || data?.rosterError || data?.error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!!data?.inventory?.missingEmail && (
        <p className="hint">
          Mejladress saknas för{' '}
          {data.inventory.missingEmail === 1
            ? 'en föräldrakontakt'
            : `${data.inventory.missingEmail} föräldrakontakter`}{' '}
          i SportAdmin. Komplettera uppgifterna där.
        </p>
      )}
      {!!conflicts.length && (
        <div className="identity-matches">
          <h2>Är detta samma spelare?</h2>
          <p>
            SportAdmin har hittat namn som också finns bland dina manuella spelare. Granska
            kontakterna innan du väljer. Övriga spelare fortsätter synkas.
          </p>
          {conflicts.map((match) => {
            const child = state.children.find((c) => c.id === match.childId);
            if (!child) return null;
            const parents = familyAdults(state, child.familyId);
            return (
              <article
                className="identity-match"
                key={`${match.childId}:${match.memberId}`}
                aria-label={`Matchning för ${child.name}`}
              >
                <div className="identity-comparison">
                  <div>
                    <PlayerSourceChip synced={false} />
                    <h3>{child.name}</h3>
                    <p>{child.active ? 'Aktiv' : 'Avslutad'}</p>
                    {parents.map((p) => (
                      <p key={p.id}>
                        {p.name}
                        <br />
                        {[p.phone, p.email].filter(Boolean).join(' · ')}
                      </p>
                    ))}
                    {!parents.length && <p>Inga föräldrakontakter.</p>}
                  </div>
                  <div>
                    <PlayerSourceChip synced />
                    <h3>{match.name}</h3>
                    <p>{match.active ? 'Aktiv' : 'Avslutad'} i SportAdmin</p>
                    {match.guardians.map((p, i) => (
                      <p key={i}>
                        {p.name}
                        <br />
                        {[p.phone, p.email].filter(Boolean).join(' · ')}
                      </p>
                    ))}
                    {!match.guardians.length && <p>Inga föräldrakontakter.</p>}
                  </div>
                </div>
                <p className="hint">
                  Samma person? Ändra till synkad. Familjens historik och bokade pass behålls. Välj
                  ”Inte samma person” endast om det faktiskt är två olika spelare; då behålls båda.
                </p>
                <div className="identity-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void act('resolve_inventory_match', {
                        childId: child.id,
                        memberId: match.memberId,
                        resolution: 'sync',
                        expectedVersion: state.version,
                      })
                    }
                  >
                    Ändra till synkad
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void act('resolve_inventory_match', {
                        childId: child.id,
                        memberId: match.memberId,
                        resolution: 'different',
                        expectedVersion: state.version,
                      })
                    }
                  >
                    Inte samma person
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {data && !data.inventoryEnabled && data.players.length > 0 && (
        <details className="instructions">
          <summary>Koppla befintliga spelare före första registersynkningen</summary>
          <div className="sa-mappings">
            {state.children
              .filter((c) => c.active)
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
  );
}
