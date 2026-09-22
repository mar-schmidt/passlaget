// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { rememberedFamily, resolveTeamRoute, teamPath, teamSlugFromPath } from './team-routing';
import { teamPortalUrl } from './domain/team-path';

const landvetter = { slug: 'landvetter-p2018', name: 'P2018', clubName: 'Landvetter IS' };
const other = { slug: 'another-team', name: 'P2019', clubName: 'Testklubben' };
afterEach(() => localStorage.clear());

describe('team addresses', () => {
  it('redirects the old root only for exactly one team', () => {
    for (const root of ['/passlaget', '/passlaget/', '/passlaget/index.html']) {
      expect(resolveTeamRoute(root, '/passlaget/', [landvetter]).pathname).toBe(
        '/passlaget/LandvetterISP2018',
      );
      expect(resolveTeamRoute(root, '/passlaget/', [landvetter, other]).team).toBeUndefined();
      expect(resolveTeamRoute(root, '/passlaget/', []).team).toBeUndefined();
    }
    expect(resolveTeamRoute('/passlaget/', '/passlaget/', [other]).pathname).toBe(
      '/passlaget/another-team',
    );
  });
  it('selects the exact team on direct visits and reloads with or without a trailing slash', () => {
    for (const path of [
      '/passlaget/LandvetterISP2018',
      '/passlaget/LandvetterISP2018/',
      '/passlaget/landvetter-p2018',
    ]) {
      expect(resolveTeamRoute(path, '/passlaget/', [landvetter, other]).team).toEqual(landvetter);
      expect(teamSlugFromPath(path, '/passlaget/')).toBe(landvetter.slug);
    }
    expect(
      resolveTeamRoute('/passlaget/another-team', '/passlaget/', [landvetter, other]).team,
    ).toEqual(other);
    expect(teamPath(landvetter.slug, '/')).toBe('/LandvetterISP2018');
  });
  it('never routes an unknown address to the only team', () => {
    for (const path of [
      '/passlaget/typo',
      '/passlaget/LandvetterISP2018/extra',
      '/other',
      '/passlaget/%2f',
      '/passlaget/%ZZ',
    ]) {
      expect(resolveTeamRoute(path, '/passlaget/', [landvetter]).team).toBeUndefined();
    }
  });
  it('isolates remembered family choices and migrates the old choice only to Landvetter', () => {
    localStorage.setItem('passlaget-family', 'previous-family');
    expect(rememberedFamily(localStorage, other.slug)).toBe('');
    expect(rememberedFamily(localStorage, landvetter.slug)).toBe('previous-family');
    localStorage.setItem(`passlaget-family:${landvetter.slug}`, '');
    expect(rememberedFamily(localStorage, landvetter.slug)).toBe('');
  });
  it('builds mail links pointing to the assigned team', () => {
    expect(teamPortalUrl('https://example.test/passlaget/', landvetter.slug)).toBe(
      'https://example.test/passlaget/LandvetterISP2018',
    );
    expect(teamPortalUrl('https://example.test/passlaget/', other.slug)).toBe(
      'https://example.test/passlaget/another-team',
    );
    expect(() => teamPortalUrl('https://example.test/', '../other')).toThrow();
  });
});
