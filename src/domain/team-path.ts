export const defaultTeamSlug = 'landvetter-p2018';

export function teamPathSegment(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new Error('Ogiltigt lag.');
  return slug === defaultTeamSlug ? 'LandvetterISP2018' : slug;
}

export function teamPortalUrl(base: string, slug: string) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${teamPathSegment(slug)}`;
  return url.toString();
}
