import { lazy, Suspense, useEffect, useState } from 'react';
import { readTeamDirectory } from './team-directory';
import { resolveTeamRoute, teamPath, type DirectoryTeam } from './team-routing';
import './team-entry.css';

// Load Auth only after the URL is resolved, so recovery fragments reach App intact.
const App = lazy(() => import('./App'));
const base = import.meta.env.BASE_URL;

export default function TeamEntry() {
  const [teams, setTeams] = useState<DirectoryTeam[] | null>(null);
  const [selected, setSelected] = useState<DirectoryTeam>();
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void readTeamDirectory(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        const route = resolveTeamRoute(location.pathname, base, items);
        if (route.pathname && route.pathname !== location.pathname)
          history.replaceState(history.state, '', route.pathname + location.search + location.hash);
        setTeams(items);
        setSelected(route.team);
        setMissing(!route.root && !route.team);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Lagen kunde inte hämtas. Försök igen.');
      });
    return () => controller.abort();
  }, [attempt]);

  if (selected)
    return (
      <Suspense
        fallback={
          <p className="team-loading" role="status">
            Hämtar laget…
          </p>
        }
      >
        <App />
      </Suspense>
    );
  if (!teams && !error)
    return (
      <p className="team-loading" role="status">
        Hämtar laget…
      </p>
    );
  return (
    <main className="team-entry">
      <p className="team-entry-brand">Passlaget</p>
      <h1>{missing ? 'Laget finns inte på den här adressen' : 'Välj ditt lag'}</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="button primary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Försök igen
          </button>
        </>
      ) : !teams ? (
        <p role="status">Hämtar lag…</p>
      ) : (
        <>
          <p>
            {teams.length
              ? 'Här hittar du familjens uppdrag och lagets bemanning.'
              : 'Det finns inga lag att visa ännu.'}
          </p>
          <nav aria-label="Välj lag">
            {teams.map((team) => (
              <a key={team.slug} href={teamPath(team.slug, base) + location.search + location.hash}>
                <strong>
                  {team.clubName} {team.name}
                </strong>
                <span aria-hidden="true">→</span>
              </a>
            ))}
          </nav>
        </>
      )}
    </main>
  );
}
