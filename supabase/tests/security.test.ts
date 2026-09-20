import { describe, expect, it } from 'vitest';
import {
  configuredUrl,
  normalizeEmail,
  portalLink,
  readToken,
  secretMatches,
  signToken,
} from '../functions/_shared/security';

describe('public gateway security helpers', () => {
  it('rejects email header injection and normalizes addresses', () => {
    expect(normalizeEmail(' A@Example.test ')).toBe('a@example.test');
    expect(() => normalizeEmail('a@example.test\r\nBcc:evil@example.test')).toThrow();
    for (const value of [
      'a@example.test,b',
      'a@example.test;other',
      'Name <a@example.test>',
      'a,b@example.test',
      'a@example.test\0',
      'a..b@example.test',
    ])
      expect(() => normalizeEmail(value)).toThrow();
  });
  it('signs unsubscribe IDs without granting portal or admin access', async () => {
    const id = 'dd43b2b8-b571-4a3e-bf87-76a8e23d7edb',
      secret = 'x'.repeat(64);
    const token = await signToken(id, secret);
    expect(await readToken(token, secret)).toBe(id);
    await expect(readToken(token.replace('dd43', 'ee43'), secret)).rejects.toThrow();
    await expect(readToken(token, 'different'.repeat(8))).rejects.toThrow();
  });
  it('only accepts configured safe redirect bases and encodes query token before hash route', () => {
    expect(() => configuredUrl('https://evil.example/?next=foo')).toThrow();
    expect(() => configuredUrl('http://public.example/')).toThrow();
    expect(portalLink('https://team.github.io/passlaget/', 'subscription', 'a&b')).toBe(
      'https://team.github.io/passlaget/?subscription=a%26b',
    );
  });
  it('fails closed on short secrets and prefix matches', () => {
    expect(secretMatches('short', 'short')).toBe(false);
    expect(secretMatches('a'.repeat(32) + 'x', 'a'.repeat(32))).toBe(false);
    expect(secretMatches('a'.repeat(32), 'a'.repeat(32))).toBe(true);
  });
});
