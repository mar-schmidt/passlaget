#!/usr/bin/env node
/** Offline only: validate a portal JSON backup and write SQL, never connect to a DB. */
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 4_000_000;
const ID = /^[\w][\w.:@/-]*$/;
const statuses = new Set(['pending', 'confirmed', 'completed', 'absent', 'cancelled']);
const fail = (message) => {
  throw new Error(message);
};
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label}: expected an object.`);
  return value;
};
const text = (value, label, max = 200, empty = false) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    value.includes('\0')
  )
    fail(`${label}: invalid text.`);
  return value;
};
const id = (value, label) => {
  text(value, label, 160);
  if (!ID.test(value)) fail(`${label}: invalid identifier.`);
  return value;
};
const bool = (value, label) => {
  if (typeof value !== 'boolean') fail(`${label}: expected a boolean.`);
};
const integer = (value, label, max = 2_147_483_646) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`${label}: invalid integer.`);
};
const list = (value, label, max = 10000) => {
  if (!Array.isArray(value) || value.length > max) fail(`${label}: invalid list.`);
  return value;
};
const unique = (rows, label) => {
  const result = new Set();
  rows.forEach((row) => {
    object(row, label);
    id(row.id, `${label}.id`);
    if (result.has(row.id)) fail(`${label}: duplicate identifier.`);
    result.add(row.id);
  });
  return result;
};
const instant = (value, label) => {
  text(value, label, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail(`${label}: invalid zoned timestamp.`);
  date(value.slice(0, 10), label);
};
const date = (value, label) => {
  text(value, label, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    fail(`${label}: invalid date.`);
};
const range = (row, label) => {
  instant(row.startsAt, `${label}.startsAt`);
  instant(row.endsAt, `${label}.endsAt`);
  if (Date.parse(row.endsAt) <= Date.parse(row.startsAt)) fail(`${label}: end must follow start.`);
};
const phone = (value, label, optional = false) => {
  if (optional && value === undefined) return;
  text(value, label, 40, true);
  if (value && (!/^[+\d\s().-]+$/.test(value) || value.replace(/\D/g, '').length < 5))
    fail(`${label}: invalid phone.`);
};

/** Deliberately checks the stored format, not planning readiness of unfinished drafts. */
export function validateBackup(backup) {
  object(backup, 'Backup');
  if (backup.format !== 'passlaget-backup-v1')
    fail('Unsupported backup format. Expected passlaget-backup-v1.');
  instant(backup.exportedAt, 'exportedAt');
  const state = object(backup.state, 'state');
  integer(state.version, 'state.version');
  const team = object(state.team, 'team');
  id(team.id, 'team.id');
  text(team.slug, 'team.slug', 80);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(team.slug)) fail('team.slug: invalid slug.');
  text(team.name, 'team.name');
  text(team.clubName, 'team.clubName');
  text(team.contactName, 'team.contactName', 200, true);
  phone(team.contactPhone, 'team.contactPhone');
  list(team.reminderDays, 'team.reminderDays', 20).forEach((day) =>
    integer(day, 'reminderDays entry', 365),
  );
  const families = list(state.families, 'families', 500);
  const children = list(state.children, 'children', 1000);
  const adults = list(state.adults, 'adults', 1500);
  const roles = list(state.roles, 'roles', 500);
  const events = list(state.events, 'events', 1000);
  const history = list(state.history, 'history');
  const requests = list(state.requests, 'requests');
  const audit = list(state.audit, 'audit', 100000);
  const familyIds = unique(families, 'families');
  unique(children, 'children');
  const adultIds = unique(adults, 'adults');
  const roleIds = unique(roles, 'roles');
  unique(events, 'events');
  unique(history, 'history');
  unique(requests, 'requests');
  unique(audit, 'audit');
  families.forEach((row) => {
    text(row.label, 'family.label');
    bool(row.active, 'family.active');
    bool(row.exempt, 'family.exempt');
    if (row.unavailable !== undefined)
      list(row.unavailable, 'family.unavailable', 1000).forEach((period) => {
        object(period, 'unavailable');
        range(period, 'unavailable');
      });
  });
  children.forEach((row) => {
    text(row.name, 'child.name');
    bool(row.active, 'child.active');
    if (!familyIds.has(row.familyId)) fail('child.familyId: family is missing.');
  });
  adults.forEach((row) => {
    text(row.name, 'adult.name');
    phone(row.phone, 'adult.phone');
    bool(row.active, 'adult.active');
    const linked = list(row.familyIds, 'adult.familyIds', 30);
    if (
      !linked.length ||
      new Set(linked).size !== linked.length ||
      linked.some((value) => !familyIds.has(value))
    )
      fail('adult.familyIds: invalid family links.');
  });
  roles.forEach((row) => {
    text(row.name, 'role.name');
    text(row.instructions, 'role.instructions', 8000, true);
  });
  const slotOwners = new Map();
  const validateDetails = (details, eventId) => {
    object(details, 'event details');
    text(details.title, 'event.title');
    text(details.location, 'event.location', 200, true);
    text(details.description, 'event.description', 8000, true);
    date(details.startDate, 'event.startDate');
    date(details.endDate, 'event.endDate');
    if (details.endDate < details.startDate) fail('event: end date precedes start date.');
    const shifts = list(details.shifts, 'shifts', 1000);
    unique(shifts, 'shifts');
    const idsInVersion = new Set();
    shifts.forEach((shift) => {
      if (!roleIds.has(shift.roleId)) fail('shift.roleId: role is missing.');
      text(shift.roleName, 'shift.roleName');
      text(shift.instructions, 'shift.instructions', 8000, true);
      range(shift, 'shift');
      if (shift.externalTeam !== undefined)
        text(shift.externalTeam, 'shift.externalTeam', 200, true);
      list(shift.slots, 'shift.slots', 100).forEach((slot) => {
        object(slot, 'slot');
        id(slot.id, 'slot.id');
        bool(slot.locked, 'slot.locked');
        integer(slot.revision, 'slot.revision');
        if (!statuses.has(slot.status)) fail('slot.status: unknown status.');
        if (
          idsInVersion.has(slot.id) ||
          (slotOwners.has(slot.id) && slotOwners.get(slot.id) !== eventId)
        )
          fail('slot.id: duplicate slot across shifts or events.');
        idsInVersion.add(slot.id);
        slotOwners.set(slot.id, eventId);
        if (slot.familyId !== undefined && !familyIds.has(slot.familyId))
          fail('slot.familyId: family is missing.');
        if (
          slot.adultId !== undefined &&
          (!adultIds.has(slot.adultId) ||
            !adults.find((a) => a.id === slot.adultId).familyIds.includes(slot.familyId))
        )
          fail('slot.adultId: adult does not belong to assigned family.');
        if (slot.adultName !== undefined) text(slot.adultName, 'slot.adultName', 200, true);
        phone(slot.adultPhone, 'slot.adultPhone', true);
        if (!slot.familyId && (slot.adultId || slot.adultName || slot.adultPhone))
          fail('slot: responsible adult requires a family.');
        if (shift.externalTeam && slot.familyId)
          fail('slot: external team cannot be assigned a local family.');
        if (slot.confirmedAt !== undefined) instant(slot.confirmedAt, 'slot.confirmedAt');
        if (slot.confirmedRevision !== undefined)
          integer(slot.confirmedRevision, 'slot.confirmedRevision');
      });
    });
  };
  events.forEach((row) => {
    bool(row.cancelled, 'event.cancelled');
    integer(row.publication, 'event.publication');
    instant(row.updatedAt, 'event.updatedAt');
    validateDetails(row.draft, row.id);
    if (row.published !== undefined) validateDetails(row.published, row.id);
  });
  const assignmentIds = new Set();
  history.forEach((row) => {
    if (!familyIds.has(row.familyId)) fail('history.familyId: family is missing.');
    id(row.assignmentId, 'history.assignmentId');
    if (assignmentIds.has(row.assignmentId)) fail('history: duplicate assignment.');
    assignmentIds.add(row.assignmentId);
    text(row.eventTitle, 'history.eventTitle');
    text(row.roleName, 'history.roleName');
    range(row, 'history');
    bool(row.verified, 'history.verified');
    if (!['portal', 'import'].includes(row.source)) fail('history.source: unknown source.');
  });
  requests.forEach((row) => {
    id(row.eventId, 'request.eventId');
    id(row.slotId, 'request.slotId');
    if (!familyIds.has(row.familyId)) fail('request.familyId: family is missing.');
    text(row.message, 'request.message', 2000);
    instant(row.requestedAt, 'request.requestedAt');
    if (!['open', 'resolved', 'declined'].includes(row.status))
      fail('request.status: unknown status.');
  });
  audit.forEach((row) => {
    instant(row.at, 'audit.at');
    text(row.action, 'audit.action', 100);
    text(row.summary, 'audit.summary', 2000, true);
    if (!['admin', 'public'].includes(row.actor)) fail('audit.actor: unknown actor.');
  });
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_BYTES)
    fail('State exceeds the 4 MB server limit.');
  return backup;
}

export function buildRestoreSql(backup) {
  validateBackup(backup);
  // Encode all user-controlled JSON, including quotes and Unicode, as an SQL-safe
  // base64 literal. Never interpolate names, slug, IDs or timestamps into SQL code.
  const encoded = Buffer.from(JSON.stringify(backup), 'utf8').toString('base64');
  return `-- PRIVATE: this SQL contains reversible, base64-encoded personal data.
-- Generated offline. No database was contacted and nothing has been restored yet.
-- Before execution: pause Google processMailQueue; finish/reconcile local receipts;
-- stop other administrators from editing; take a fresh private database backup.
-- Test first in an isolated local environment. Review every statement.
-- Restore targets an EXISTING team with the exact same id AND slug.
-- Auth, admin memberships, existing mail journal and matching consents are retained.
-- Unsent old mail is suppressed. No new mail is created. Review scheduling before
-- restarting the worker: suppressed reminder dedupe keys will not automatically requeue.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $passlaget_restore$
DECLARE
  backup jsonb := convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb;
  restored jsonb;
  target portal_private.teams%ROWTYPE;
  next_version integer;
BEGIN
  restored := backup->'state';
  SELECT * INTO target FROM portal_private.teams
    WHERE id = restored #>> '{team,id}' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTORE_TEAM_NOT_FOUND: create and verify the correct team before restoring';
  END IF;
  IF target.slug IS DISTINCT FROM restored #>> '{team,slug}' THEN
    RAISE EXCEPTION 'RESTORE_TEAM_MISMATCH: team slug must match exactly';
  END IF;
  IF target.version >= 2147483647 THEN
    RAISE EXCEPTION 'RESTORE_VERSION_OVERFLOW';
  END IF;
  -- Pausing a trigger does not abort an already running Google execution.
  IF EXISTS (SELECT 1 FROM portal_private.outbox WHERE team_id = target.id
    AND status = 'leased' AND lease_expires_at > now()) THEN
    RAISE EXCEPTION 'RESTORE_WORKER_BUSY: wait for/reconcile existing mail leases first';
  END IF;
  next_version := target.version + 1;
  restored := jsonb_set(restored, '{version}', to_jsonb(next_version));
  restored := jsonb_set(restored, '{audit}', (restored->'audit') || jsonb_build_array(
    jsonb_build_object('id', 'audit:restore:' || gen_random_uuid()::text,
      'at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'actor', 'admin', 'action', 'backup_restored',
      'summary', 'Portaldata återställdes från en privat säkerhetskopia. Gamla väntande utskick stoppades.')));
  IF octet_length(restored::text) > 4000000 THEN
    RAISE EXCEPTION 'RESTORE_STATE_TOO_LARGE';
  END IF;
  UPDATE portal_private.teams
    SET state = restored, version = next_version, updated_at = now()
    WHERE id = target.id;
  -- Preserve sent mail and resolution history. Never resend an old/uncertain job.
  UPDATE portal_private.outbox
    SET status = 'suppressed', last_error = 'backup_restored',
      lease_token = NULL, lease_expires_at = NULL, prepared_at = NULL,
      payload = CASE WHEN kind IN ('verify', 'recovery') THEN '{}'::jsonb ELSE payload END
    WHERE team_id = target.id AND status IN ('queued', 'leased', 'uncertain', 'failed');
  -- Keep existing consent only where the restored family/adult relationship exists.
  -- No consent, subscription, account or administrative permission comes from JSON.
  UPDATE portal_private.subscriptions s
    SET status = 'unsubscribed', verify_hash = NULL, verify_expires_at = NULL
    WHERE s.team_id = target.id AND (
      NOT EXISTS (SELECT 1 FROM jsonb_array_elements(restored->'families') f
        WHERE f->>'id' = s.family_id)
      OR (s.adult_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(restored->'adults') a
        WHERE a->>'id' = s.adult_id AND (a->'familyIds') ? s.family_id)));
END;
$passlaget_restore$;
COMMIT;
`;
}

export function writeRestoreFile(inputPath, outputPath) {
  if (statSync(inputPath).size > MAX_BYTES + 10000) fail('Backup file exceeds the 4 MB limit.');
  let backup;
  try {
    backup = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch {
    fail('Backup is not valid JSON.');
  }
  const sql = buildRestoreSql(backup);
  // Exclusive creation also refuses symlinks and existing files; never overwrite.
  const handle = openSync(outputPath, 'wx', 0o600);
  try {
    writeFileSync(handle, sql, 'utf8');
  } finally {
    closeSync(handle);
  }
  return {
    families: backup.state.families.length,
    events: backup.state.events.length,
    history: backup.state.history.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (!inputPath || !outputPath || extra.length) {
    console.error('Usage: node scripts/restore-backup.mjs PRIVATE_BACKUP.json PRIVATE_OUTPUT.sql');
    process.exitCode = 1;
  } else {
    try {
      const counts = writeRestoreFile(inputPath, outputPath);
      console.log(
        `Validated backup; SQL file created privately. Families: ${counts.families}, events: ${counts.events}, history: ${counts.history}. No database connection or restore was performed.`,
      );
    } catch (error) {
      console.error(
        error?.code === 'EEXIST'
          ? 'Refusing to overwrite an existing output file.'
          : `Cannot prepare restore: ${error.message}`,
      );
      process.exitCode = 1;
    }
  }
}
