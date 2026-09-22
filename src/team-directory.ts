import type { DirectoryTeam } from './team-routing';
import { defaultTeamSlug, teamPathSegment } from './domain/team-path';

export async function readTeamDirectory(signal?: AbortSignal): Promise<DirectoryTeam[]> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return [{ slug: defaultTeamSlug, name: 'P2018', clubName: 'Landvetter IS' }];
  const response = await fetch(`${url}/functions/v1/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ action: 'teams' }),
    signal,
  });
  const result = await response.json();
  if (!response.ok || !Array.isArray(result.teams))
    throw new Error('Lagen kunde inte hämtas. Försök igen.');
  return result.teams.map((team: DirectoryTeam) => {
    teamPathSegment(team.slug);
    if (typeof team.name !== 'string' || typeof team.clubName !== 'string')
      throw new Error('Lagen kunde inte hämtas. Försök igen.');
    return { slug: team.slug, name: team.name, clubName: team.clubName };
  });
}
