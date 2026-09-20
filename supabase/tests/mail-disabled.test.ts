import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoState } from '../../src/domain/demo.ts';
import { signToken } from '../functions/_shared/security.ts';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mock.rpc, auth: { getUser: mock.getUser } }),
}));

let handle: (request: Request) => Promise<Response>;
let current = demoState();
let member = true;
// No MAIL_ENABLED or mail secrets: the first deployment has no sender configured.
const settings: Record<string, string> = {
  APP_URL: 'https://team.example.test/passlaget/',
  PORTAL_ORIGINS: 'https://team.example.test',
  SUPABASE_URL: 'https://db.example.test',
  PORTAL_SUPABASE_SECRET_KEY: 'server-only-test-key',
};
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (name: string) => settings[name] }, serve: vi.fn() });
  ({ handle } = await import('../functions/portal/index.ts'));
});
beforeEach(() => {
  current = demoState();
  member = true;
  mock.rpc.mockReset();
  mock.getUser.mockReset();
  mock.getUser.mockResolvedValue({
    data: { user: { id: '8ef6fcb6-c653-4250-8364-ed69eb55e62e' } },
    error: null,
  });
  mock.rpc.mockImplementation(
    async (_name: string, { p_op, p_args }: { p_op: string; p_args: any }) => {
      if (p_op === 'rate_limit') return { data: true, error: null };
      if (p_op === 'read') return { data: { state: current }, error: null };
      if (p_op === 'admin') return { data: member, error: null };
      if (p_op === 'commit') {
        current = p_args.state;
        return { data: { version: current.version }, error: null };
      }
      if (p_op === 'mail_status')
        return {
          data: {
            counts: { queued: 3, sent: 4 },
            lastWorkerAt: '2030-06-01T10:00:00Z',
            lastSentAt: '2030-06-01T10:00:00Z',
            messages: [],
          },
          error: null,
        };
      return { data: { ok: true }, error: null };
    },
  );
});
const request = (body: Record<string, unknown>, admin = false) =>
  new Request('https://db.example.test/functions/v1/portal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://team.example.test',
      ...(admin ? { Authorization: 'Bearer checked-by-auth' } : {}),
    },
    body: JSON.stringify({ teamSlug: current.team.slug, ...body }),
  });
const calls = (operation: string) =>
  mock.rpc.mock.calls.filter(([, args]) => args.p_op === operation);

describe('Core portal with mail deferred', () => {
  it('starts without mail secrets and returns the published portal', async () => {
    const response = await handle(request({ action: 'read' }));
    expect(response.status).toBe(200);
    const { state } = await response.json();
    expect(state.team.id).toBe(current.team.id);
    expect(state.history).toBeUndefined();
  });

  it('allows authenticated planning changes without fetching subscriptions or queueing notices', async () => {
    const version = current.version;
    const response = await handle(
      request(
        {
          action: 'command',
          expectedVersion: version,
          command: { type: 'update_team', team: { ...current.team, contactName: 'Ny kontakt' } },
        },
        true,
      ),
    );
    expect(response.status).toBe(200);
    expect(current.version).toBe(version + 1);
    expect(current.team.contactName).toBe('Ny kontakt');
    expect(calls('commit')).toHaveLength(1);
    expect(calls('commit')[0][1].p_args.jobs).toEqual([]);
    expect(calls('subscriptions')).toHaveLength(0);
    expect(calls('queue_jobs')).toHaveLength(0);
  });

  it('does not report a queued email for signup, verification or password recovery', async () => {
    for (const action of ['subscribe', 'verify_subscription', 'request_recovery']) {
      const response = await handle(request({ action, email: 'admin@example.test' }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'mail_disabled' });
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('does not lease, prepare, acknowledge or retry mail while sending is disabled', async () => {
    for (const action of ['mail_claim', 'mail_prepare', 'mail_ack', 'mail_resolve']) {
      const response = await handle(request({ action, workerSecret: '', outcome: 'retry' }, true));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'mail_disabled' });
      expect(calls(action)).toHaveLength(0);
    }
  });

  it('keeps queue information private and reports disabled without hiding existing job counts', async () => {
    expect((await handle(request({ action: 'mail_status' }))).status).toBe(401);
    member = false;
    expect((await handle(request({ action: 'mail_status' }, true))).status).toBe(403);
    member = true;
    const response = await handle(request({ action: 'mail_status' }, true));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, counts: { queued: 3, sent: 4 } });
    expect(calls('mail_status')).toHaveLength(1);
  });

  it('reports unavailable opt-out configuration instead of accepting an unsigned link', async () => {
    const response = await handle(request({ action: 'unsubscribe', token: 'untrusted' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'mail_disabled' });
    expect(calls('unsubscribe')).toHaveLength(0);
  });

  it('allows existing opt-out links while paused if their signing secret is retained', async () => {
    const signingSecret = 'retained-token-secret-for-opt-outs-'.repeat(2);
    settings.MAIL_TOKEN_SECRET = signingSecret;
    vi.resetModules();
    const paused = await import('../functions/portal/index.ts');
    const subscriptionId = '0cb17cf9-1e66-4bbb-936e-7d6125594166';
    const token = await signToken(subscriptionId, signingSecret);
    const response = await paused.handle(request({ action: 'unsubscribe', token }));
    expect(response.status).toBe(200);
    expect(calls('unsubscribe')[0][1].p_args.id).toBe(subscriptionId);
    delete settings.MAIL_TOKEN_SECRET;
  });
});
