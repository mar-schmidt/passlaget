import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoState } from '../../src/domain/demo.ts';
import { entries } from '../functions/_shared/mail.ts';
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
  it('allows public contact selection but returns only name and email for the resolved team', async () => {
    const previous = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) => {
      if (name === 'portal_admin_contacts')
        return {
          data: [
            {
              name: 'Test Admin',
              email: 'admin@example.test',
              id: 'PRIVATE_ID',
              phone: 'PRIVATE_PHONE',
            },
          ],
          error: null,
        };
      return previous(name, args);
    });
    const response = await handle(
      request({ action: 'admin_contacts', teamSlug: current.team.slug, teamId: 'other-team' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      contacts: [{ name: 'Test Admin', email: 'admin@example.test' }],
    });
    expect(mock.rpc).toHaveBeenCalledWith('portal_admin_contacts', { p_team_id: current.team.id });
    expect(mock.getUser).not.toHaveBeenCalled();
    expect(calls('commit')).toHaveLength(0);
  });
  it('does not leak database details or fall back to an old contact when the lookup fails', async () => {
    const previous = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) => {
      if (name === 'portal_admin_contacts')
        return { data: null, error: { message: 'PRIVATE_DB_ERROR' } };
      return previous(name, args);
    });
    const response = await handle(
      request({ action: 'admin_contacts', teamSlug: current.team.slug }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE_');
  });
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

describe('email-aware participation gateway', () => {
  function upcoming() {
    const event = current.events.find((e) => e.published)!;
    const shift = event.published!.shifts[0];
    const slot = shift.slots[0];
    slot.status = 'pending';
    shift.startsAt = '2030-06-15T09:00:00Z';
    shift.endsAt = '2030-06-15T11:00:00Z';
    const adult = current.adults.find((a) => a.familyIds.includes(slot.familyId!))!;
    adult.email = 'parent@example.test';
    return { event, slot, adult };
  }
  it('requires admin membership before allowing an individual reminder', async () => {
    const { event, slot } = upcoming();
    const body = {
      action: 'command',
      teamSlug: current.team.slug,
      expectedVersion: current.version,
      command: {
        type: 'remind_confirmation',
        eventId: event.id,
        slotId: slot.id,
        familyId: slot.familyId,
        revision: slot.revision,
      },
    };
    expect((await handle(request(body))).status).toBe(401);
    expect((await handle(request(body, { Authorization: 'Bearer test' }))).status).toBe(403);
    member = true;
    expect((await handle(request(body, { Authorization: 'Bearer test' }))).status).toBe(200);
    const commit = calls('commit').at(-1)![1].p_args;
    expect(
      commit.jobs.some(
        (job: any) => job.payload.confirmationOnly && job.recipient === 'parent@example.test',
      ),
    ).toBe(true);
  });
  it('stores the entered email without reminders for the confirmed duty or exposing the address', async () => {
    const { event, slot, adult } = upcoming();
    const response = await handle(
      request({
        action: 'command',
        teamSlug: current.team.slug,
        expectedVersion: current.version,
        command: {
          type: 'confirm',
          eventId: event.id,
          slotId: slot.id,
          familyId: slot.familyId,
          revision: slot.revision,
          adultId: adult.id,
          adultName: adult.name,
          adultPhone: adult.phone,
          adultEmail: 'PRIVATE@example.test',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('private@example.test');
    const commit = calls('commit')[0][1].p_args;
    expect(commit.state.adults.find((a: any) => a.id === adult.id).email).toBe(
      'private@example.test',
    );
    expect(
      commit.jobs.some(
        (j: any) =>
          j.kind === 'reminder' &&
          j.payload.entries.some(
            (entry: any) => entry.eventId === event.id && entry.slotId === slot.id,
          ),
      ),
    ).toBe(false);
    expect(
      commit.jobs
        .filter((j: any) => j.kind === 'reminder')
        .every((j: any) => j.payload.entries.every((entry: any) => entry.status === 'pending')),
    ).toBe(true);
    expect(commit.jobs.some((j: any) => j.kind === 'assignment')).toBe(false);
  });
  it.each([true, false])(
    'prepares a contact reminder and suppresses it after confirmation (manual: %s)',
    async (confirmationOnly) => {
      const { event, slot, adult } = upcoming();
      const payload = {
        contact: { familyId: slot.familyId, adultIds: [adult.id] },
        ...(confirmationOnly ? { confirmationOnly: true } : { reminderDays: 7 }),
        entries: entries(current).filter((e) => e.eventId === event.id && e.slotId === slot.id),
      };
      const normal = mock.rpc.getMockImplementation()!;
      mock.rpc.mockImplementation(async (name, args) =>
        args.p_op === 'mail_prepare'
          ? {
              data: {
                mail: {
                  id: 'b092b4b3-8493-48c2-bfde-01a7db3c91f1',
                  kind: 'reminder',
                  recipient: 'parent@example.test',
                  subject: 'Bekräfta passet',
                  payload,
                },
                subscription: null,
                state: current,
              },
              error: null,
            }
          : normal(name, args),
      );
      const body = {
        action: 'mail_prepare',
        workerSecret: settings.MAIL_WORKER_SECRET,
        id: 'b092b4b3-8493-48c2-bfde-01a7db3c91f1',
        leaseToken: '57d5b7e9-a1c9-498e-aafd-3c58e3e8cf8c',
      };
      const response = await handle(request(body));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message.to).toBe('parent@example.test');
      if (confirmationOnly) expect(data.message.text).toContain('Vi saknar din bekräftelse');
      slot.status = 'confirmed';
      expect(await (await handle(request(body))).json()).toEqual({ skip: true });
      expect(calls('mail_suppress')).toHaveLength(1);
    },
  );
});

it('accepts public self booking atomically and rejects a stale competing booking without leaking contact data', async () => {
  current.events = [current.events[0]];
  const event = current.events[0];
  event.published!.bookingMode = 'self';
  event.published!.startDate = '2099-10-04';
  event.published!.endDate = '2099-10-04';
  const shift = event.published!.shifts[0];
  shift.startsAt = '2099-10-04T08:00:00+02:00';
  shift.endsAt = '2099-10-04T10:00:00+02:00';
  shift.slots = [{ id: 'book-me', locked: false, revision: 1, status: 'pending' }];
  event.published!.shifts = [shift];
  event.draft = structuredClone(event.published!);
  const adult = current.adults.find((a) => a.id === 'adult-1-1')!;
  const body = {
    action: 'command',
    teamSlug: current.team.slug,
    expectedVersion: current.version,
    command: {
      type: 'book',
      eventId: event.id,
      slotId: 'book-me',
      revision: 1,
      familyId: 'family-1',
      adultId: adult.id,
      adultName: adult.name,
      adultPhone: adult.phone,
      adultEmail: 'booking-private@example.test',
    },
  };
  const response = await handle(request(body));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(JSON.stringify(result)).not.toContain('booking-private@example.test');
  expect(result.state.events[0].published.shifts[0].slots[0].status).toBe('confirmed');
  expect(mock.getUser).not.toHaveBeenCalled();
  expect(calls('commit')).toHaveLength(1);
  expect(calls('commit')[0][1].p_args.jobs).toEqual([]);
  expect((await handle(request(body))).status).toBe(409);
  expect(calls('commit')).toHaveLength(1);
});

describe('event-scoped saving', () => {
  function edit() {
    member = true;
    const baseEvent = structuredClone(current.events[0]);
    const event = structuredClone(baseEvent);
    event.draft.description = 'My updated description';
    return {
      action: 'command',
      teamSlug: current.team.slug,
      expectedVersion: current.version,
      command: { type: 'save_event', event, baseEvent },
    };
  }
  const send = (body: Record<string, unknown>) =>
    handle(request(body, { Authorization: 'Bearer checked' }));
  it('saves against latest team data and retains changes in another event', async () => {
    const body = edit();
    current.version++;
    current.events[1].draft.title = 'Concurrent event edit';
    const response = await send(body);
    expect(response.status).toBe(200);
    expect(current.events[0].draft.description).toBe('My updated description');
    expect(current.events[1].draft.title).toBe('Concurrent event edit');
    expect(calls('commit')[0][1].p_args.expected_version).toBe(body.expectedVersion + 1);
    expect(calls('commit')[0][1].p_args.jobs).toEqual([]);
  });
  it('retries a database race against fresh data without losing an intervening change', async () => {
    const body = edit();
    const previous = mock.rpc.getMockImplementation()!;
    let first = true;
    mock.rpc.mockImplementation(async (name, args) => {
      if (args.p_op === 'commit' && first) {
        first = false;
        current = structuredClone(current);
        current.version++;
        current.events[1].draft.title = 'Concurrent event edit';
        return { data: null, error: { code: '40001' } };
      }
      return previous(name, args);
    });
    expect((await send(body)).status).toBe(200);
    expect(current.events[0].draft.description).toBe('My updated description');
    expect(current.events[1].draft.title).toBe('Concurrent event edit');
    expect(calls('commit')).toHaveLength(2);
  });
  it('stops a retry if someone edits the same field during the commit', async () => {
    const body = edit();
    const previous = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) => {
      if (args.p_op === 'commit') {
        current = structuredClone(current);
        current.version++;
        current.events[0].draft.description = 'Their description';
        return { data: null, error: { code: '40001' } };
      }
      return previous(name, args);
    });
    const response = await send(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'event_conflict',
      error: expect.stringMatching(/Beskrivningen.*inte sparade/),
    });
    expect(current.events[0].draft.description).toBe('Their description');
    expect(calls('commit')).toHaveLength(1);
  });
  it('bounds retries and explains that the form can be saved again', async () => {
    const body = edit();
    const previous = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) =>
      args.p_op === 'commit' ? { data: null, error: { code: '40001' } } : previous(name, args),
    );
    const response = await send(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'event_busy',
      error: expect.stringContaining('Spara utkast igen'),
    });
    expect(calls('commit')).toHaveLength(3);
  });
  it('still requires admin membership for a save with a base snapshot', async () => {
    const body = edit();
    member = false;
    expect((await send(body)).status).toBe(403);
    expect(calls('commit')).toHaveLength(0);
  });
});
