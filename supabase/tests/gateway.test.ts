import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoState } from '../../src/domain/demo.ts';
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  getUserById: vi.fn(),
  generateLink: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mock.rpc,
    auth: {
      getUser: mock.getUser,
      admin: { getUserById: mock.getUserById, generateLink: mock.generateLink },
    },
  }),
}));
let handle: (request: Request) => Promise<Response>;
let current = demoState();
let member = false;
const appUrl = 'https://team.example.test/passlaget/';
const settings: Record<string, string> = {
  APP_URL: appUrl,
  PORTAL_ORIGINS: 'https://team.example.test',
  SUPABASE_URL: 'https://db.example.test',
  PORTAL_SUPABASE_SECRET_KEY: 'server-only-test-key',
  MAIL_ENABLED: 'true',
  MAIL_TOKEN_SECRET: 'token-secret-for-test-'.repeat(3),
  MAIL_WORKER_SECRET: 'worker-secret-for-test-'.repeat(3),
};
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (name: string) => settings[name] }, serve: vi.fn() });
  ({ handle } = await import('../functions/portal/index.ts'));
});
beforeEach(() => {
  current = demoState();
  member = false;
  mock.rpc.mockReset();
  mock.getUser.mockReset();
  mock.getUser.mockResolvedValue({
    data: { user: { id: '8ef6fcb6-c653-4250-8364-ed69eb55e62e' } },
    error: null,
  });
  mock.rpc.mockImplementation(
    async (_name: string, { p_op, p_args }: { p_op: string; p_args: any }) => {
      if (p_op === 'rate_limit') return { data: true, error: null };
      if (p_op === 'read')
        return {
          data: { state: current, id: current.team.id, version: current.version },
          error: null,
        };
      if (p_op === 'admin') return { data: member, error: null };
      if (p_op === 'subscriptions') return { data: [], error: null };
      if (p_op === 'commit') {
        current = p_args.state;
        return { data: { version: current.version }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  );
});
const request = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request('https://db.example.test/functions/v1/portal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://team.example.test',
      ...headers,
    },
    body: JSON.stringify(body),
  });
const calls = (operation: string) =>
  mock.rpc.mock.calls.filter(([, args]) => args.p_op === operation);

describe('Edge gateway authorization boundary', () => {
  it('rejects unknown and inherited object names before accessing the database', async () => {
    for (const action of ['unknown', 'toString', '__proto__'])
      expect((await handle(request({ action }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('returns published snapshots without draft, history, emails, notes or live unassigned contact data', async () => {
    current.events.find((e) => !e.published)!.draft.description = 'PRIVATE_DRAFT_MARKER';
    current.history[0].eventTitle = 'PRIVATE_HISTORY_MARKER';
    current.requests[0].message = 'PRIVATE_MESSAGE_MARKER';
    current.adults[0].phone = 'PRIVATE_REGISTRY_MARKER';
    (current.adults[0] as unknown as Record<string, unknown>).email = 'PRIVATE_EMAIL_MARKER';
    const response = await handle(request({ action: 'read', teamSlug: current.team.slug }));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('PRIVATE_');
  });
  it('requires verified Auth identity and actual team membership for admin reads', async () => {
    const denied = await handle(
      request(
        { action: 'read', teamSlug: current.team.slug, admin: true },
        { Authorization: 'Bearer fake-but-check-with-auth' },
      ),
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('families');
    mock.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad' } });
    expect(
      (
        await handle(
          request(
            { action: 'read', teamSlug: current.team.slug, admin: true },
            { Authorization: 'Bearer invalid' },
          ),
        )
      ).status,
    ).toBe(401);
    member = true;
    expect(
      (
        await handle(
          request(
            { action: 'read', teamSlug: current.team.slug, admin: true },
            { Authorization: 'Bearer checked' },
          ),
        )
      ).status,
    ).toBe(200);
  });
  it('does not grant admin command authority from a client body flag', async () => {
    const response = await handle(
      request({
        action: 'command',
        teamSlug: current.team.slug,
        admin: true,
        expectedVersion: current.version,
        command: { type: 'update_team', team: current.team },
      }),
    );
    expect(response.status).toBe(401);
    expect(calls('commit')).toHaveLength(0);
  });
  it('returns conflict without private state when a public confirmation used an old version', async () => {
    const response = await handle(
      request({
        action: 'command',
        teamSlug: current.team.slug,
        expectedVersion: 0,
        command: { type: 'confirm', eventId: 'sammandrag-oktober', slotId: 'oct-slot-1' },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('state');
    expect(calls('commit')).toHaveLength(0);
  });
  it('uses fixed action buckets even when forwarded IP headers are changed by a caller', async () => {
    mock.rpc.mockImplementation(
      async (_name: string, { p_op, p_args }: { p_op: string; p_args: any }) => ({
        data: p_op === 'rate_limit' && p_args.key === 'global:subscribe' ? false : true,
        error: null,
      }),
    );
    for (const ip of ['1.2.3.4', '5.6.7.8'])
      expect(
        (await handle(request({ action: 'subscribe' }, { 'X-Forwarded-For': ip }))).status,
      ).toBe(429);
    expect(calls('rate_limit').map(([, args]) => args.p_args.key)).toEqual([
      'global:subscribe',
      'global:subscribe',
    ]);
  });
  it('rejects MailApp recipient lists before queueing a subscription', async () => {
    const response = await handle(
      request({
        action: 'subscribe',
        teamSlug: current.team.slug,
        familyId: current.families[0].id,
        scope: 'family',
        email: 'a@example.test,other',
      }),
    );
    expect(response.status).toBe(400);
    expect(calls('subscribe')).toHaveLength(0);
  });
  it('supports neutral admin recovery without a team and ignores supplied redirects', async () => {
    const response = await handle(
      request({
        action: 'request_recovery',
        email: 'admin@example.test',
        returnUrl: 'https://evil.example/',
      }),
    );
    expect(response.status).toBe(200);
    expect(calls('read')).toHaveLength(0);
    expect(calls('queue_recovery')[0][1].p_args.return_url).toBe(appUrl);
    expect(await response.text()).not.toContain('admin@example.test');
  });
  it('does not expose worker jobs for an incorrect or absent worker secret', async () => {
    expect(
      (await handle(request({ action: 'mail_claim', workerSecret: 'wrong', limit: 5 }))).status,
    ).toBe(401);
    expect(calls('mail_claim')).toHaveLength(0);
  });
  it('rejects a foreign browser origin before reading the database', async () => {
    expect(
      (
        await handle(
          request(
            { action: 'read', teamSlug: current.team.slug },
            { Origin: 'https://evil.example' },
          ),
        )
      ).status,
    ).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
