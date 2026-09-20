/** Run with PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/sql-smoke.mjs */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text);`,
);
const migrationFiles = (await readdir(new URL('../migrations/', import.meta.url)))
  .filter((x) => x.endsWith('.sql'))
  .sort();
for (const file of migrationFiles)
  await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
const admin = '11cc7337-20ed-4812-a2c8-81a841f134ab';
await db.query('insert into auth.users(id,email) values($1,$2)', [admin, 'admin@example.test']);
const state = {
  version: 0,
  team: { id: 't1', slug: 'team-one', name: 'Testlag', reminderDays: [7, 1] },
  families: [{ id: 'f1', active: true }],
  adults: [],
  children: [],
  roles: [],
  events: [],
  history: [],
  requests: [],
  audit: [],
};
await db.query('insert into portal_private.teams(id,slug,version,state) values($1,$2,0,$3)', [
  state.team.id,
  state.team.slug,
  JSON.stringify(state),
]);
await db.query('insert into portal_private.teams(id,slug,version,state) values($1,$2,0,$3)', [
  't2',
  'team-two',
  JSON.stringify({ ...state, team: { ...state.team, id: 't2', slug: 'team-two' } }),
]);
await db.query('insert into portal_private.admin_memberships(team_id,user_id) values($1,$2)', [
  't1',
  admin,
]);
const rpc = async (op, args = {}) =>
  (
    await db.query('select public.portal_backend($1,$2::jsonb) as result', [
      op,
      JSON.stringify(args),
    ])
  ).rows[0].result;
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => rpc('read', { slug: 'team-one' }), /permission denied/);
  await assert.rejects(
    () => db.query('select state from portal_private.teams'),
    /permission denied/,
  );
  await db.exec('reset role');
}
await db.exec('set role service_role');
assert.equal((await rpc('read', { slug: 'team-one' })).state.team.id, 't1');
assert.equal(await rpc('admin', { team_id: 't1', user_id: admin }), true);
assert.equal(await rpc('admin', { team_id: 't2', user_id: admin }), false);
assert.equal(await rpc('rate_limit', { key: 'test', limit: 1, window_seconds: 60 }), true);
assert.equal(await rpc('rate_limit', { key: 'test', limit: 1, window_seconds: 60 }), false);
await rpc('subscribe', {
  team_id: 't1',
  family_id: 'f1',
  scope: 'family',
  email: 'parent@example.test',
  token: 'x'.repeat(64),
  verify_hash: 'h'.repeat(64),
});
const verified = await rpc('verify_subscription', { hash: 'h'.repeat(64) });
assert.equal(verified.ok, true);
const sub = verified.subscription;
state.version = verified.state.version;
assert.equal(state.version, 1);
assert.equal((await rpc('verify_subscription', { hash: 'h'.repeat(64) })).ok, false);
const job = {
  subscriptionId: sub.id,
  kind: 'reminder',
  dedupeKey: 'one-reminder',
  subject: 'Test',
  payload: { entries: [] },
  priority: 50,
  dueAt: '2026-01-01T00:00:00Z',
};
await rpc('commit', {
  team_id: 't1',
  expected_version: 1,
  state: { ...state, version: 2 },
  jobs: [job, job],
});
assert.equal((await rpc('read', { slug: 'team-one' })).version, 2);
await assert.rejects(
  () =>
    rpc('commit', {
      team_id: 't1',
      expected_version: 0,
      state: { ...state, version: 1 },
      jobs: [{ ...job, dedupeKey: 'must-not-be-inserted' }],
    }),
  /VERSION_CONFLICT/,
);
assert.equal(
  (
    await db.query('select count(*)::integer n from portal_private.outbox where dedupe_key=$1', [
      'one-reminder',
    ])
  ).rows[0].n,
  1,
);
assert.equal(
  (
    await db.query('select count(*)::integer n from portal_private.outbox where dedupe_key=$1', [
      'must-not-be-inserted',
    ])
  ).rows[0].n,
  0,
);
// A subscription from a different team cannot receive a commit's queued payload.
await rpc('commit', {
  team_id: 't2',
  expected_version: 0,
  state: { ...state, version: 1, team: { ...state.team, id: 't2', slug: 'team-two' } },
  jobs: [{ ...job, dedupeKey: 'cross-team' }],
});
assert.equal(
  (
    await db.query(
      "select count(*)::integer n from portal_private.outbox where dedupe_key='cross-team'",
    )
  ).rows[0].n,
  0,
);
// Claiming is atomic, one lease per job; heartbeat can run without consuming a job.
assert.deepEqual((await rpc('mail_claim', { limit: 0 })).messages, []);
const claims = (await rpc('mail_claim', { limit: 5 })).messages;
assert.equal(claims.length, 2);
assert.equal((await rpc('mail_claim', { limit: 5 })).messages.length, 0);
const item = claims[0];
assert.ok(await rpc('mail_prepare', { id: item.id, lease_token: item.leaseToken }));
assert.equal(await rpc('mail_prepare', { id: item.id, lease_token: item.leaseToken }), null);
await rpc('mail_ack', {
  id: item.id,
  lease_token: item.leaseToken,
  outcome: 'uncertain',
  error: 'SEND_OUTCOME_UNKNOWN',
});
await rpc('mail_ack', {
  id: item.id,
  lease_token: item.leaseToken,
  outcome: 'uncertain',
  error: 'SEND_OUTCOME_UNKNOWN',
});
assert.equal((await rpc('mail_claim', { limit: 5 })).messages.length, 0);
await assert.rejects(
  () => rpc('mail_resolve', { team_id: 't2', user_id: admin, id: item.id, outcome: 'retry' }),
  /FORBIDDEN/,
);
await rpc('mail_resolve', { team_id: 't1', user_id: admin, id: item.id, outcome: 'retry' });
const retry = (await rpc('mail_claim', { limit: 5 })).messages[0];
assert.equal(retry.id, item.id);
assert.notEqual(retry.leaseToken, item.leaseToken);
await rpc('mail_ack', { id: retry.id, lease_token: retry.leaseToken, outcome: 'sent' });
await rpc('mail_ack', { id: retry.id, lease_token: retry.leaseToken, outcome: 'sent' });
const second = claims[1];
await db.query(
  "update portal_private.outbox set lease_expires_at=now()-interval '1 minute' where id=$1",
  [second.id],
);
await rpc('mail_claim', { limit: 0 });
assert.equal(
  (await db.query('select status from portal_private.outbox where id=$1', [second.id])).rows[0]
    .status,
  'uncertain',
);
await rpc('mail_ack', { id: second.id, lease_token: second.leaseToken, outcome: 'sent' }); // receipt after expiry is safe.
await rpc('queue_jobs', { team_id: 't1', jobs: [{ ...job, dedupeKey: 'unsubscribe-suppresses' }] });
await rpc('unsubscribe', { id: sub.id });
assert.equal(
  (
    await db.query(
      "select status from portal_private.outbox where dedupe_key='unsubscribe-suppresses'",
    )
  ).rows[0].status,
  'suppressed',
);
await db.exec('reset role');
await db.query('insert into auth.users(id,email) values($1,$2)', [
  '22cc7337-20ed-4812-a2c8-81a841f134ab',
  'nonmember@example.test',
]);
await db.exec('set role service_role');
await rpc('queue_recovery', {
  email: 'nonmember@example.test',
  return_url: 'https://example.test/',
  dedupe_key: 'nonmember',
});
assert.equal(
  (
    await db.query(
      "select count(*)::integer n from portal_private.outbox where dedupe_key='nonmember'",
    )
  ).rows[0].n,
  0,
);
await rpc('queue_recovery', {
  email: 'not-an-admin@example.test',
  return_url: 'https://example.test/',
  dedupe_key: 'no-admin',
});
assert.equal(
  (
    await db.query(
      "select count(*)::integer n from portal_private.outbox where dedupe_key='no-admin'",
    )
  ).rows[0].n,
  0,
);
await rpc('queue_recovery', {
  email: 'admin@example.test',
  return_url: 'https://example.test/',
  dedupe_key: 'valid-admin',
});
assert.equal(
  (
    await db.query(
      "select count(*)::integer n from portal_private.outbox where dedupe_key='valid-admin'",
    )
  ).rows[0].n,
  1,
);
const status = await rpc('mail_status', { team_id: 't1' });
assert.ok(status.lastWorkerAt);
assert.ok(status.lastSentAt);
assert.ok(
  status.messages.every((x) => !('payload' in x) && !('lease_token' in x) && !('token' in x)),
);
assert.equal(
  (await db.query('select count(*)::integer n from portal_private.mail_resolutions')).rows[0].n,
  1,
);
// Consent plus scheduled reminders roll back together when a queue payload fails.
await rpc('subscribe', {
  team_id: 't1',
  family_id: 'f1',
  scope: 'family',
  email: 'second@example.test',
  token: 'z'.repeat(64),
  verify_hash: 'z'.repeat(64),
});
const preview = await rpc('subscription_preview', { hash: 'z'.repeat(64) });
await assert.rejects(
  () =>
    rpc('verify_subscription', {
      hash: 'z'.repeat(64),
      expected_version: preview.state.version - 1,
    }),
  /VERSION_CONFLICT/,
);
await assert.rejects(
  () =>
    rpc('verify_subscription', {
      hash: 'z'.repeat(64),
      expected_version: preview.state.version,
      jobs: [
        { ...job, subscriptionId: preview.subscription.id, kind: 'invalid', dedupeKey: 'invalid' },
      ],
    }),
  /check constraint/,
);
assert.ok(await rpc('subscription_preview', { hash: 'z'.repeat(64) }));
assert.equal((await rpc('read', { slug: 'team-one' })).version, preview.state.version);
await rpc('verify_subscription', {
  hash: 'z'.repeat(64),
  expected_version: preview.state.version,
  jobs: [{ ...job, subscriptionId: preview.subscription.id, dedupeKey: 'consent-reminder' }],
});
assert.equal(
  (
    await db.query(
      "select count(*)::integer n from portal_private.outbox where dedupe_key='consent-reminder'",
    )
  ).rows[0].n,
  1,
);
await db.close();
console.log(
  'Postgres smoke checks passed: migration, role grants, team isolation, atomic state/outbox, rate limits, consent, leases, receipts, recovery and explicit reconciliation.',
);
