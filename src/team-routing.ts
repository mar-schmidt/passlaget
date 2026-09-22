import { defaultTeamSlug, teamPathSegment } from './domain/team-path';

export interface DirectoryTeam {
  slug: string;
  name: string;
  clubName: string;
}

export function teamPath(slug: string, base: string) {
  return `${base.replace(/\/$/, '')}/${teamPathSegment(slug)}`;
}

function pathSegment(pathname: string, base: string): string | null {
  const root = base.replace(/\/$/, '');
  if (pathname === root || pathname === `${root}/` || pathname === `${root}/index.html`) return '';
  if (!pathname.startsWith(`${root}/`)) return null;
  try {
    const segment = decodeURIComponent(pathname.slice(root.length + 1).replace(/\/$/, ''));
    return segment && !segment.includes('/') ? segment : null;
  } catch {
    return null;
  }
}

export function teamSlugFromPath(pathname: string, base: string) {
  const segment = pathSegment(pathname, base);
  if (segment === teamPathSegment(defaultTeamSlug)) return defaultTeamSlug;
  return segment && /^[a-z0-9][a-z0-9-]{0,79}$/.test(segment) ? segment : undefined;
}

export function resolveTeamRoute(pathname: string, base: string, teams: DirectoryTeam[]) {
  const segment = pathSegment(pathname, base);
  const root = segment === '';
  const team = root
    ? teams.length === 1
      ? teams[0]
      : undefined
    : teams.find((item) => segment === teamPathSegment(item.slug) || segment === item.slug);
  return { team, root, pathname: team ? teamPath(team.slug, base) : undefined };
}

export function rememberedFamily(storage: Storage, slug: string) {
  const current = storage.getItem(`passlaget-family:${slug}`);
  if (current !== null) return current;
  // Only the original team may inherit the choice saved before team URLs existed.
  const legacy = slug === defaultTeamSlug ? storage.getItem('passlaget-family') || '' : '';
  if (legacy) storage.setItem(`passlaget-family:${slug}`, legacy);
  return legacy;
}
