import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildRestoreSql, validateBackup, writeRestoreFile } from './restore-backup.mjs';

function fixture() {
  const details = {
    title: 'Höstcup – Östra plan',
    location: 'Testplan',
    description: 'Kiosk och parkering.',
    startDate: '2026-10-17',
    endDate: '2026-10-17',
    shifts: [
      {
        id: 'shift:1',
        roleId: 'role:parking',
        roleName: 'P-värd',
        instructions: 'Visa vägen.',
        startsAt: '2026-10-17T11:00:00+02:00',
        endsAt: '2026-10-17T13:00:00+02:00',
        slots: [
          {
            id: 'slot:1',
            familyId: 'family:1',
            adultId: 'adult:1',
            adultName: 'Testförälder',
            adultPhone: '0700000000',
            locked: false,
            revision: 2,
            status: 'confirmed',
            confirmedRevision: 2,
            confirmedAt: '2026-10-01T10:00:00Z',
          },
        ],
      },
    ],
  };
  return {
    format: 'passlaget-backup-v1',
    exportedAt: '2026-10-02T12:00:00.000Z',
    state: {
      version: 7,
      team: {
        id: 'team:test',
        slug: 'testlag',
        name: 'Testlag',
        clubName: 'Testförening',
        contactName: 'Kontakt',
        contactPhone: '0700000001',
        reminderDays: [7, 1],
      },
      families: [
        {
          id: 'family:1',
          label: 'Testfamilj',
          active: true,
          exempt: false,
          unavailable: [{ startsAt: '2026-10-18T00:00:00Z', endsAt: '2026-10-19T00:00:00Z' }],
        },
      ],
      children: [{ id: 'child:1', name: 'Testbarn', familyId: 'family:1', active: true }],
      adults: [
        {
          id: 'adult:1',
          name: 'Testförälder',
          phone: '0700000000',
          familyIds: ['family:1'],
          active: true,
        },
      ],
      roles: [{ id: 'role:parking', name: 'P-värd', instructions: 'Visa vägen.' }],
      events: [
        {
          id: 'event:1',
          draft: details,
          published: structuredClone(details),
          publication: 1,
          cancelled: false,
          updatedAt: '2026-10-01T10:00:00Z',
        },
      ],
      history: [
        {
          id: 'history:1',
          assignmentId: 'old:1',
          familyId: 'family:1',
          eventTitle: 'Tidigare cup',
          roleName: 'Kiosk',
          startsAt: '2026-09-01T10:00:00Z',
          endsAt: '2026-09-01T12:00:00Z',
          source: 'import',
          verified: false,
        },
      ],
      requests: [
        {
          id: 'request:1',
          eventId: 'event:1',
          slotId: 'slot:1',
          familyId: 'family:1',
          message: 'Byte önskas',
          requestedAt: '2026-10-01T11:00:00Z',
          status: 'open',
        },
      ],
      audit: [
        {
          id: 'audit:1',
          at: '2026-10-01T10:00:00Z',
          actor: 'admin',
          action: 'publish',
          summary: 'Schemat publicerades.',
        },
      ],
    },
  };
}

test('round trips the exact Unicode backup through an SQL-safe literal', () => {
  const backup = fixture();
  const injection = "Åsa's höstcup'); DROP TABLE portal_private.teams; -- $passlaget_restore$ \\";
  backup.state.events[0].draft.title = injection;
  backup.state.events[0].draft.description = 'Rad ett\nRad två 😀';
  const sql = buildRestoreSql(backup);
  const match = sql.match(/decode\('([A-Za-z0-9+/=]+)', 'base64'\)/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')), backup);
  assert.ok(!sql.includes(injection));
  assert.ok(!sql.includes('DROP TABLE'));
  assert.equal(validateBackup(backup), backup);
});

test('restore is one transaction for an existing matching team, with a new current version', () => {
  const sql = buildRestoreSql(fixture());
  assert.match(sql, /\nBEGIN;[\s\S]+\nCOMMIT;\n$/);
  assert.match(sql, /WHERE id = restored #>> '\{team,id\}' FOR UPDATE/);
  assert.match(sql, /RESTORE_TEAM_NOT_FOUND/);
  assert.match(sql, /RESTORE_TEAM_MISMATCH/);
  assert.match(sql, /RESTORE_WORKER_BUSY/);
  assert.match(sql, /next_version := target.version \+ 1/);
  assert.match(sql, /jsonb_set\(restored, '\{version\}', to_jsonb\(next_version\)\)/);
  assert.match(sql, /SET state = restored, version = next_version/);
  assert.match(sql, /status IN \('queued', 'leased', 'uncertain', 'failed'\)/);
  assert.match(sql, /SET status = 'unsubscribed', verify_hash = NULL, verify_expires_at = NULL/);
  assert.match(sql, /a->>'id' = s.adult_id AND \(a->'familyIds'\) \? s.family_id/);
  assert.match(sql, /'action', 'backup_restored'/);
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT\s+INTO|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE|CREATE\s+TABLE)\b/i,
  );
  assert.doesNotMatch(sql, /UPDATE\s+(?:auth\.|portal_private\.admin_memberships)/i);
});

test('allows an unfinished draft and a published snapshot with the same slot IDs', () => {
  const backup = fixture();
  backup.state.events[0].draft.shifts[0].slots.push({
    id: 'slot:2',
    locked: false,
    revision: 0,
    status: 'pending',
  });
  backup.state.events[0].draft.shifts[0].startsAt = '2026-10-20T11:00:00Z';
  backup.state.events[0].draft.shifts[0].endsAt = '2026-10-20T13:00:00Z';
  assert.doesNotThrow(() => validateBackup(backup));
});

test('rejects unsupported, malformed, inconsistent and oversized backups before writing', () => {
  const invalid = [
    [
      (b) => {
        b.format = 'other';
      },
      /Unsupported backup/,
    ],
    [
      (b) => {
        delete b.state.audit;
      },
      /audit/,
    ],
    [
      (b) => {
        b.exportedAt = 'yesterday';
      },
      /timestamp/,
    ],
    [
      (b) => {
        b.exportedAt = '2026-02-30T10:00:00Z';
      },
      /date/,
    ],
    [
      (b) => {
        b.state.team.slug = "wrong'slug";
      },
      /slug/,
    ],
    [
      (b) => {
        b.state.events[0].draft.startDate = '2026-02-30';
      },
      /date/,
    ],
    [
      (b) => {
        b.state.events[0].draft.shifts[0].endsAt = '2026-10-17T09:00:00Z';
      },
      /end must follow/,
    ],
    [
      (b) => {
        b.state.roles = [];
      },
      /role is missing/,
    ],
    [
      (b) => {
        b.state.children[0].familyId = 'missing';
      },
      /family is missing/,
    ],
    [
      (b) => {
        b.state.adults[0].familyIds = [];
      },
      /family links/,
    ],
    [
      (b) => {
        b.state.events[0].draft.shifts[0].slots[0].adultId = 'missing';
      },
      /adult does not belong/,
    ],
    [
      (b) => {
        b.state.events[0].draft.shifts[0].slots[0].status = 'unknown';
      },
      /unknown status/,
    ],
    [
      (b) => {
        b.state.events.push({ ...structuredClone(b.state.events[0]), id: 'event:2' });
      },
      /duplicate slot/,
    ],
    [
      (b) => {
        b.state.history.push({ ...b.state.history[0], id: 'history:2' });
      },
      /duplicate assignment/,
    ],
    [
      (b) => {
        b.state.families[0].active = 'true';
      },
      /boolean/,
    ],
    [
      (b) => {
        b.state.adults[0].phone = null;
      },
      /invalid text/,
    ],
    [
      (b) => {
        b.state.version = -1;
      },
      /integer/,
    ],
    [
      (b) => {
        b.state.audit[0].actor = 'system';
      },
      /unknown actor/,
    ],
    [
      (b) => {
        b.state.team.name = 'Test\0team';
      },
      /invalid text/,
    ],
    [
      (b) => {
        b.state.extra = 'x'.repeat(4_000_000);
      },
      /4 MB/,
    ],
  ];
  for (const [mutate, expected] of invalid) {
    const backup = fixture();
    mutate(backup);
    assert.throws(() => validateBackup(backup), expected);
  }
  assert.throws(() => validateBackup(null), /object/);
});

test('creates a private output once and refuses existing files, same input or symlinks', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'passlaget-restore-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'backup.json'),
    output = join(directory, 'restore.sql');
  const original = JSON.stringify(fixture());
  writeFileSync(input, original);
  assert.deepEqual(writeRestoreFile(input, output), { families: 1, events: 1, history: 1 });
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const sql = readFileSync(output, 'utf8');
  assert.throws(() => writeRestoreFile(input, output), { code: 'EEXIST' });
  assert.equal(readFileSync(output, 'utf8'), sql);
  assert.throws(() => writeRestoreFile(input, input), { code: 'EEXIST' });
  assert.equal(readFileSync(input, 'utf8'), original);
  const link = join(directory, 'link.sql');
  symlinkSync(input, link);
  assert.throws(() => writeRestoreFile(input, link), { code: 'EEXIST' });
  assert.equal(readFileSync(input, 'utf8'), original);
});

test('invalid JSON or invalid backup produces no SQL artifact', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'passlaget-restore-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'backup.json'),
    output = join(directory, 'restore.sql');
  writeFileSync(input, '{"private-content":"do-not-print"');
  assert.throws(() => writeRestoreFile(input, output), /Backup is not valid JSON/);
  assert.equal(existsSync(output), false);
  writeFileSync(input, JSON.stringify({ format: 'unsupported' }));
  assert.throws(() => writeRestoreFile(input, output), /Unsupported backup/);
  assert.equal(existsSync(output), false);
});

test('CLI generates locally, prints counts only, and returns failure for an existing output', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'passlaget-restore-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'backup.json'),
    output = join(directory, 'restore.sql');
  const backup = fixture();
  writeFileSync(input, JSON.stringify(backup));
  const script = fileURLToPath(new URL('./restore-backup.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Families: 1, events: 1, history: 1/);
  assert.match(result.stdout, /No database connection or restore was performed/);
  assert.ok(!result.stdout.includes(backup.state.adults[0].name));
  const repeat = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
  assert.equal(repeat.status, 1);
  assert.match(repeat.stderr, /Refusing to overwrite/);
});

// Optional offline execution against embedded PostgreSQL. No server/network and
// no production connection string is accepted by this test or the restore tool.
test(
  'generated SQL atomically restores only its team and preserves consent and sent mail',
  { skip: !process.env.PGLITE_MODULE },
  async (t) => {
    const { PGlite } = await import(process.env.PGLITE_MODULE);
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(
      'create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text);',
    );
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await db.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
    const backup = fixture(),
      current = structuredClone(backup.state);
    current.version = 19;
    current.team.name = 'Current name';
    await db.query('insert into portal_private.teams(id,slug,version,state) values($1,$2,$3,$4)', [
      current.team.id,
      current.team.slug,
      current.version,
      JSON.stringify(current),
    ]);
    const second = {
      ...structuredClone(current),
      team: { ...current.team, id: 'team:other', slug: 'other-team' },
    };
    await db.query('insert into portal_private.teams(id,slug,version,state) values($1,$2,$3,$4)', [
      second.team.id,
      second.team.slug,
      second.version,
      JSON.stringify(second),
    ]);
    for (const [family, adult, email] of [
      ['family:1', 'adult:1', 'kept@example.test'],
      ['family:removed', null, 'removed-family@example.test'],
      ['family:1', 'adult:removed', 'removed-adult@example.test'],
    ]) {
      await db.query(
        "insert into portal_private.subscriptions(team_id,family_id,adult_id,scope,email,status,verify_hash,verify_expires_at) values($1,$2,$3,'family',$4,'active',$5,now()+interval '1 day')",
        [current.team.id, family, adult, email, email],
      );
    }
    for (const status of ['queued', 'leased', 'uncertain', 'failed', 'sent', 'suppressed']) {
      await db.query(
        "insert into portal_private.outbox(team_id,kind,dedupe_key,recipient,subject,status,lease_token,lease_expires_at) values($1,'reminder',$2,'test@example.test','Test',$3,gen_random_uuid(),now()-interval '1 hour')",
        [current.team.id, status, status],
      );
    }
    // Live leases must abort the entire transaction; finish or reconcile first.
    await db.query(
      "update portal_private.outbox set lease_expires_at=now()+interval '1 minute' where dedupe_key='leased'",
    );
    await assert.rejects(() => db.exec(buildRestoreSql(backup)), /RESTORE_WORKER_BUSY/);
    await db.exec('ROLLBACK;');
    assert.equal(
      (await db.query('select version from portal_private.teams where id=$1', [current.team.id]))
        .rows[0].version,
      19,
    );
    await db.query(
      "update portal_private.outbox set lease_expires_at=now()-interval '1 minute' where dedupe_key='leased'",
    );
    const mismatch = structuredClone(backup);
    mismatch.state.team.slug = 'wrong-team';
    await assert.rejects(() => db.exec(buildRestoreSql(mismatch)), /RESTORE_TEAM_MISMATCH/);
    await db.exec('ROLLBACK;');
    const missing = structuredClone(backup);
    missing.state.team.id = 'team:missing';
    await assert.rejects(() => db.exec(buildRestoreSql(missing)), /RESTORE_TEAM_NOT_FOUND/);
    await db.exec('ROLLBACK;');
    await db.exec(buildRestoreSql(backup));
    const restored = (
      await db.query('select version,state from portal_private.teams where id=$1', [
        current.team.id,
      ])
    ).rows[0];
    assert.equal(restored.version, 20);
    assert.equal(restored.state.version, 20);
    assert.equal(restored.state.team.name, backup.state.team.name);
    assert.equal(restored.state.history[0].verified, false);
    assert.equal(restored.state.audit.at(-1).action, 'backup_restored');
    assert.deepEqual(
      (await db.query('select state from portal_private.teams where id=$1', [second.team.id]))
        .rows[0].state,
      second,
    );
    const statuses = (
      await db.query(
        'select dedupe_key,status,lease_token from portal_private.outbox order by dedupe_key',
      )
    ).rows;
    for (const row of statuses) {
      assert.equal(row.status, row.dedupe_key === 'sent' ? 'sent' : 'suppressed');
      if (!['sent', 'suppressed'].includes(row.dedupe_key)) assert.equal(row.lease_token, null);
    }
    const subscriptions = (
      await db.query(
        'select email,status,verify_hash from portal_private.subscriptions order by email',
      )
    ).rows;
    assert.equal(subscriptions[0].email, 'kept@example.test');
    assert.equal(subscriptions[0].status, 'active');
    for (const row of subscriptions.slice(1)) {
      assert.equal(row.status, 'unsubscribed');
      assert.equal(row.verify_hash, null);
    }
  },
);
