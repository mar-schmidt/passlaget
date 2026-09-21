import { sportadminAction } from '../_shared/sportadmin.ts';
import { createClient } from '@supabase/supabase-js';
import { applyCommand, publicState, DomainError } from '../../../src/domain/logic.ts';
import { buildContactMailJobs, validContactMailEntries } from '../_shared/contact-mail.ts';
import type { PortalCommand, PortalState } from '../../../src/domain/model.ts';
import {
  buildMailJobs,
  hash,
  renderMail,
  validMailEntries,
  type Subscription,
} from '../_shared/mail.ts';
import {
  configuredUrl,
  HttpError,
  normalizeEmail,
  portalLink,
  readToken,
  secretMatches,
  signToken,
  stringValue,
  uuidValue,
} from '../_shared/security.ts';

const env = (name: string) => Deno.env.get(name) ?? '';
const appUrl = configuredUrl(env('APP_URL') || env('PORTAL_URL') || 'http://localhost:5173/');
const allowedOrigins = (env('PORTAL_ORIGINS') || new URL(appUrl).origin)
  .split(',')
  .map((x) => x.trim());
const secretKey =
  env('PORTAL_SUPABASE_SECRET_KEY') ||
  JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default ||
  env('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(env('SUPABASE_URL'), secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tokenSecret = env('MAIL_TOKEN_SECRET'),
  workerSecret = env('MAIL_WORKER_SECRET');
// Mail is opt-in. Core planning must work before any sender or mail secret exists.
const mailEnabled = env('MAIL_ENABLED') === 'true';
if (mailEnabled && (tokenSecret.length < 32 || workerSecret.length < 32))
  throw new Error(
    'Configure independent MAIL_TOKEN_SECRET and MAIL_WORKER_SECRET (at least 32 characters)',
  );
if (mailEnabled && tokenSecret === workerSecret) throw new Error('Mail secrets must be different');

function requireMail() {
  if (!mailEnabled)
    throw new HttpError(
      503,
      'Mejlfunktionen är inte aktiverad ännu. Inga mejl har lagts i kö.',
      'mail_disabled',
    );
}

async function rpc(op: string, args: Record<string, unknown> = {}): Promise<any> {
  const { data, error } = await db.rpc('portal_backend', { p_op: op, p_args: args });
  if (error) {
    if (error.code === '40001')
      throw new HttpError(
        409,
        'Schemat har ändrats. Hämta senaste uppgifterna och försök igen.',
        'conflict',
      );
    if (error.code === 'P0002') throw new HttpError(404, 'Uppgiften finns inte.', 'not_found');
    if (error.code === '22023' || error.code === '23505')
      throw new HttpError(400, 'Åtgärden är inte längre giltig.');
    // Do not put DB details, payloads, addresses or recovery tokens into responses/logs.
    throw new HttpError(
      503,
      'Tjänsten kunde inte spara just nu. Försök igen.',
      'backend_unavailable',
    );
  }
  return data;
}
async function sportRpc(op: string, args: Record<string, unknown> = {}): Promise<any> {
  const { data, error } = await db.rpc('portal_sportadmin', { p_op: op, p_args: args });
  if (error)
    throw new HttpError(
      error.code === '40001' ? 409 : 503,
      'SportAdmin-uppdateringen kunde inte sparas. Försök igen.',
    );
  return data;
}
async function loadTeam(slug: unknown): Promise<PortalState> {
  const value = stringValue(slug, 'teamSlug', 80);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new HttpError(400, 'Ogiltigt lag.');
  const row = await rpc('read', { slug: value });
  if (!row) throw new HttpError(404, 'Laget finns inte.', 'not_found');
  return row.state;
}
async function requireAdmin(request: Request, state: PortalState): Promise<string> {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer '))
    throw new HttpError(401, 'Logga in som administratör.', 'unauthorized');
  const jwt = auth.slice(7);
  // getUser verifies the session with Auth. Never authorize from user_metadata or an unverified JWT.
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Inloggningen har löpt ut.', 'unauthorized');
  if (!(await rpc('admin', { team_id: state.team.id, user_id: data.user.id })))
    throw new HttpError(403, 'Du saknar behörighet till laget.', 'forbidden');
  return data.user.id;
}
async function rateLimit(
  request: Request,
  action: string,
  identity = '',
  limit = 40,
  seconds = 60,
) {
  // A forwarded address is only a hint, not trusted identity. Fixed global and
  // resource/email buckets below remain effective if a caller spoofs this header.
  const ip = (
    request.headers.get('x-forwarded-for') ??
    request.headers.get('cf-connecting-ip') ??
    'unknown'
  )
    .split(',')[0]
    .trim();
  const key = await hash(`${action}:${identity || ip}`);
  if (!(await rpc('rate_limit', { key, limit, window_seconds: seconds })))
    throw new HttpError(429, 'För många försök. Vänta en stund och försök igen.', 'rate_limited');
}
function workerOnly(body: Record<string, any>) {
  if (!secretMatches(body.workerSecret, workerSecret))
    throw new HttpError(401, 'Ogiltig utskicksbehörighet.', 'unauthorized');
}
async function prepareMail(body: Record<string, any>) {
  const id = uuidValue(body.id),
    leaseToken = uuidValue(body.leaseToken);
  const context = await rpc('mail_prepare', { id, lease_token: leaseToken });
  if (!context) return { skip: true };
  const { mail, subscription, state } = context;
  const suppress = async (reason: string) => {
    await rpc('mail_suppress', { id, lease_token: leaseToken, reason });
    return { skip: true };
  };
  if (mail.kind === 'verify') {
    if (
      !subscription ||
      subscription.status !== 'pending' ||
      subscription.verify_hash !== mail.payload.verifyHash ||
      Date.parse(subscription.verify_expires_at) <= Date.now()
    )
      return suppress('verification_expired');
    const link = portalLink(appUrl, 'subscription', mail.payload.token);
    return {
      skip: false,
      message: {
        to: mail.recipient,
        subject: mail.subject,
        text: `Du har valt mejlpåminnelser för ${state.team.name}.\n\nBekräfta mejladressen: ${link}\n\nLänken gäller i 48 timmar. Om du inte begärt detta behöver du inte göra något. Ingen prenumeration aktiveras utan bekräftelse.`,
      },
    };
  }
  if (mail.kind === 'recovery') {
    if (!(await rpc('admin', { team_id: mail.team_id, user_id: mail.payload.userId })))
      return suppress('admin_removed');
    const { data: user, error: userError } = await db.auth.admin.getUserById(mail.payload.userId);
    if (userError || !user.user || user.user.email?.toLowerCase() !== mail.recipient.toLowerCase())
      return suppress('admin_changed');
    // Ignore caller-provided redirects; this is a configured, exact frontend URL.
    const { data, error } = await db.auth.admin.generateLink({
      type: 'recovery',
      email: mail.recipient,
      options: { redirectTo: appUrl },
    });
    if (error || !data.properties?.action_link) {
      await rpc('mail_ack', {
        id,
        lease_token: leaseToken,
        outcome: 'failed',
        error: 'recovery_generation_failed',
      });
      return { skip: true };
    }
    return {
      skip: false,
      message: {
        to: mail.recipient,
        subject: mail.subject,
        text: `Återställ ditt administratörslösenord:\n${data.properties.action_link}\n\nOm du inte begärt detta kan du ignorera mejlet.`,
      },
    };
  }
  if (mail.payload.contact) {
    if (!state) return suppress('state_missing');
    const valid = await validContactMailEntries(mail.kind, mail.payload, state, mail.recipient);
    if (!valid.length) return suppress('stale_contact_or_assignment');
    return {
      skip: false,
      message: {
        to: mail.recipient,
        ...renderMail(
          mail.subject,
          valid,
          mail.payload.confirmationOnly ? 'confirmation' : mail.kind,
          appUrl,
          '',
        ),
      },
    };
  }
  if (!subscription || !state) return suppress('subscription_missing');
  const valid = validMailEntries(mail.kind, mail.payload, state, subscription);
  if (!valid.length) return suppress('stale_or_unsubscribed');
  const unsubscribe = portalLink(
    appUrl,
    'unsubscribe',
    await signToken(subscription.id, tokenSecret),
  );
  return {
    skip: false,
    message: {
      to: subscription.email,
      ...renderMail(mail.subject, valid, mail.kind, appUrl, unsubscribe),
    },
  };
}

export async function handle(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors: Record<string, string> = {
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && allowedOrigins.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
  cors['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
  cors['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: cors });
  if (origin && !allowedOrigins.includes(origin))
    return response({ error: 'Otillåtet ursprung.', code: 'forbidden' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST')
    return response({ error: 'Använd POST.', code: 'method_not_allowed' }, 405);
  try {
    if (Number(request.headers.get('content-length') || 0) > 4000000)
      throw new HttpError(413, 'Begäran är för stor.');
    const raw = await request.text();
    if (raw.length > 4000000) throw new HttpError(413, 'Begäran är för stor.');
    let body: Record<string, any>;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Ogiltig begäran.');
    }
    if (!body || Array.isArray(body) || typeof body !== 'object')
      throw new HttpError(400, 'Ogiltig begäran.');
    const action = stringValue(body.action, 'action', 40);
    if (action.startsWith('mail_') && !['mail_status', 'mail_resolve'].includes(action)) {
      requireMail();
      workerOnly(body);
      if (action === 'mail_claim')
        return response(
          await rpc('mail_claim', {
            limit: Number.isInteger(body.limit) ? Math.max(0, Math.min(5, body.limit)) : 5,
          }),
        );
      if (action === 'mail_prepare') return response(await prepareMail(body));
      if (action === 'mail_ack') {
        if (!['sent', 'failed', 'uncertain', 'deferred'].includes(body.outcome))
          throw new HttpError(400, 'Ogiltig utskicksstatus.');
        return response(
          await rpc('mail_ack', {
            id: uuidValue(body.id),
            lease_token: uuidValue(body.leaseToken),
            outcome: body.outcome,
            error:
              typeof body.error === 'string'
                ? body.error.replace(/[^a-z0-9_-]/gi, '').slice(0, 80)
                : undefined,
          }),
        );
      }
      throw new HttpError(400, 'Okänd åtgärd.');
    }
    if (action === 'sportadmin_cron') {
      const key = env('SPORTADMIN_WORKER_SECRET');
      if (key.length < 32 || !secretMatches(body.workerSecret, key))
        throw new HttpError(401, 'Ogiltig synkbehörighet.');
      const teams = await sportRpc('list');
      // Sequential, bounded work. Failed connections remain visible to their own administrator.
      let updated = 0;
      for (const team of teams.slice(0, 20)) {
        try {
          await sportadminAction(
            { operation: 'sync' },
            await loadTeam(team.slug),
            sportRpc,
            loadTeam,
          );
          updated++;
        } catch {
          /* retry at next run */
        }
      }
      return response({ updated });
    }
    const globalLimits: Record<string, [number, number]> = {
      sportadmin: [60, 60],
      read: [600, 60],
      command: [180, 60],
      request_recovery: [20, 3600],
      subscribe: [100, 86400],
      verify_subscription: [120, 3600],
      unsubscribe: [120, 3600],
      mail_status: [120, 60],
      mail_resolve: [30, 60],
    };
    if (!Object.hasOwn(globalLimits, action)) throw new HttpError(400, 'Okänd åtgärd.');
    if (['subscribe', 'verify_subscription', 'request_recovery'].includes(action)) requireMail();
    const globalLimit = globalLimits[action];
    // This bucket is fixed, independent of caller-controlled IPs, emails or family IDs.
    if (
      !(await rpc('rate_limit', {
        key: `global:${action}`,
        limit: globalLimit[0],
        window_seconds: globalLimit[1],
      }))
    )
      throw new HttpError(
        429,
        'Många försöker just nu. Vänta en stund och försök igen.',
        'rate_limited',
      );
    await rateLimit(request, action, '', action === 'read' ? 120 : 40);
    if (action === 'request_recovery') {
      const email = normalizeEmail(body.email);
      await rateLimit(request, 'recovery_email', email, 3, 3600);
      // A neutral result prevents account discovery. Only known admin memberships are queued.
      await rpc('queue_recovery', {
        email,
        return_url: appUrl,
        dedupe_key: `recovery:${await hash(email)}:${Math.floor(Date.now() / 600000)}`,
      });
      return response({
        ok: true,
        message: 'Om adressen tillhör en administratör skickas en återställningslänk.',
      });
    }
    if (action === 'verify_subscription') {
      const token = stringValue(body.token, 'token', 128);
      if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, 'Länken är ogiltig.');
      const tokenHash = await hash(token);
      const preview = await rpc('subscription_preview', { hash: tokenHash });
      if (!preview) throw new HttpError(400, 'Länken har löpt ut eller redan använts.');
      // Activation and its future reminders are committed together. A failed request can retry the unused token.
      const jobs = await buildMailJobs(preview.state, preview.state, [
        { ...preview.subscription, status: 'active' },
      ]);
      const result = await rpc('verify_subscription', {
        hash: tokenHash,
        expected_version: preview.state.version,
        jobs,
      });
      if (!result.ok) throw new HttpError(400, 'Länken har löpt ut eller redan använts.');
      return response({ ok: true });
    }
    if (action === 'unsubscribe') {
      // Keep old opt-out links working while sending is paused, when their key is retained.
      if (tokenSecret.length < 32)
        throw new HttpError(
          503,
          'Mejlfunktionen är inte konfigurerad. Kontakta portalens ansvariga för hjälp.',
          'mail_disabled',
        );
      const id = await readToken(body.token, tokenSecret);
      await rpc('unsubscribe', { id });
      return response({ ok: true });
    }
    const state = await loadTeam(body.teamSlug);
    if (action === 'sportadmin') {
      await requireAdmin(request, state);
      await rateLimit(
        request,
        'sportadmin_team',
        state.team.id,
        body.operation === 'connect' ? 5 : 30,
        body.operation === 'connect' ? 3600 : 60,
      );
      return response(await sportadminAction(body, state, sportRpc, loadTeam));
    }
    if (action === 'read') {
      if (body.admin === true) {
        await requireAdmin(request, state);
        return response({ state });
      }
      return response({ state: publicState(state) });
    }
    if (action === 'command') {
      const command = body.command as PortalCommand;
      if (
        !command ||
        typeof command !== 'object' ||
        Array.isArray(command) ||
        typeof command.type !== 'string'
      )
        throw new HttpError(400, 'Ogiltig ändring.');
      const isPublic =
        command.type === 'confirm' ||
        command.type === 'book' ||
        command.type === 'update_answers' ||
        command.type === 'request_change';
      if (!isPublic) await requireAdmin(request, state);
      else
        await rateLimit(
          request,
          'public_slot',
          `${state.team.id}:${stringValue(command.eventId, 'eventId')}:${stringValue(command.slotId, 'slotId')}`,
          10,
          60,
        );
      if (command.type === 'remind_confirmation') requireMail();
      if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== state.version)
        throw new HttpError(409, 'Schemat har ändrats. Hämta senaste uppgifterna.', 'conflict');
      if (command.type === 'save_event' && Object.hasOwn(command, 'sportadminActivityId')) {
        await rateLimit(request, 'sportadmin_team', state.team.id, 30, 60);
        const result = await sportadminAction(
          {
            operation: 'save_event',
            event: command.event,
            activityId: command.sportadminActivityId,
            expectedVersion: body.expectedVersion,
          },
          state,
          sportRpc,
          loadTeam,
        );
        return response({ state: result!.state });
      }
      const next = applyCommand(state, command, isPublic ? 'public' : 'admin');
      if (next.team.id !== state.team.id || next.team.slug !== state.team.slug)
        throw new HttpError(400, 'Lagets id och adress kan inte ändras.');
      if (next.version !== state.version) {
        const jobs = mailEnabled
          ? [
              ...(await buildMailJobs(
                state,
                next,
                ((await rpc('subscriptions', { team_id: state.team.id })) as Subscription[]).filter(
                  (s) =>
                    !next.adults.some(
                      (a) => a.active && a.email === s.email && a.familyIds.includes(s.family_id),
                    ),
                ),
              )),
              ...(await buildContactMailJobs(state, next, command)),
            ]
          : [];
        if (command.type === 'remind_confirmation' && !jobs.some((j) => j.payload.confirmationOnly))
          throw new HttpError(400, 'Det finns ingen mejladress att påminna för detta pass.');
        await rpc('commit', {
          team_id: state.team.id,
          expected_version: state.version,
          state: next,
          jobs,
        });
      }
      return response({ state: isPublic ? publicState(next) : next });
    }
    if (action === 'subscribe') {
      const email = normalizeEmail(body.email);
      await rateLimit(request, 'subscribe_email', email, 3, 3600);
      const familyId = stringValue(body.familyId, 'familyId');
      if (!state.families.some((f) => f.id === familyId && f.active))
        throw new HttpError(400, 'Familjen är inte aktiv.');
      if (!['family', 'adult'].includes(body.scope))
        throw new HttpError(400, 'Välj familj eller egna uppdrag.');
      const adultId = body.adultId ? stringValue(body.adultId, 'adultId') : null;
      if (
        (body.scope === 'adult' && !adultId) ||
        (adultId &&
          !state.adults.some((a) => a.id === adultId && a.active && a.familyIds.includes(familyId)))
      )
        throw new HttpError(400, 'Välj en vuxen i familjen.');
      const token = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
      await rpc('subscribe', {
        team_id: state.team.id,
        family_id: familyId,
        adult_id: adultId,
        scope: body.scope,
        email,
        token,
        verify_hash: await hash(token),
      });
      return response({
        ok: true,
        message:
          'Om prenumerationen behöver bekräftas skickas ett mejl. Öppna länken för att aktivera den.',
      });
    }
    if (action === 'mail_resolve') {
      const userId = await requireAdmin(request, state);
      requireMail();
      if (!['sent', 'retry', 'suppress'].includes(body.outcome))
        throw new HttpError(400, 'Välj hantering för utskicket.');
      return response(
        await rpc('mail_resolve', {
          team_id: state.team.id,
          user_id: userId,
          id: uuidValue(body.id),
          outcome: body.outcome,
        }),
      );
    }
    if (action === 'mail_status') {
      await requireAdmin(request, state);
      const status = await rpc('mail_status', { team_id: state.team.id });
      return response({
        ...status,
        enabled: mailEnabled,
        counts: {
          queued: 0,
          leased: 0,
          sent: 0,
          failed: 0,
          uncertain: 0,
          suppressed: 0,
          ...status.counts,
        },
      });
    }
    throw new HttpError(400, 'Okänd åtgärd.');
  } catch (error) {
    if (error instanceof HttpError)
      return response({ error: error.message, code: error.code }, error.status);
    if (error instanceof DomainError)
      return response(
        { error: error.message, code: error.code === 409 ? 'conflict' : 'invalid_command' },
        error.code,
      );
    // A malformed command must not leak JS paths or private values in a stack trace.
    if (error instanceof TypeError || error instanceof RangeError)
      return response(
        { error: 'Kontrollera uppgifterna och försök igen.', code: 'invalid_request' },
        400,
      );
    return response(
      { error: 'Tjänsten kunde inte genomföra åtgärden. Försök igen.', code: 'server_error' },
      500,
    );
  }
}
Deno.serve(handle);
