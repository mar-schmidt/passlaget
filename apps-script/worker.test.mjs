import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');

function harness(overrides = {}) {
  const props = new Map([
    ['PORTAL_URL', 'https://example.supabase.co/functions/v1/portal-api'],
    ['WORKER_SECRET', 'test-only-worker-secret-over-32-characters'],
  ]);
  const requests = [];
  const sends = [];
  let quota = overrides.quota ?? 10;
  const job = { id: 'job-1', leaseToken: 'lease-token-123' };
  const context = vm.createContext({
    console: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => props.get(key) ?? null,
        setProperty: (key, value) => {
          props.set(key, value);
        },
        deleteProperty: (key) => props.delete(key),
        getProperties: () => Object.fromEntries(props),
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => overrides.lock !== false, releaseLock() {} }),
    },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: (value) => {
        sends.push(value);
        quota -= 1;
        overrides.send?.(value);
      },
    },
    UrlFetchApp: {
      fetch: (_url, options) => {
        const body = JSON.parse(options.payload);
        requests.push(body);
        const defaults =
          body.action === 'mail_claim'
            ? { messages: body.limit > 0 ? [job] : [] }
            : body.action === 'mail_prepare'
              ? {
                  skip: false,
                  message: { to: 'parent@example.org', subject: 'Bemanning', text: 'Ditt pass' },
                }
              : { ok: true };
        const response = overrides.api?.(body, defaults) ?? defaults;
        return {
          getResponseCode: () => response.httpStatus ?? 200,
          getContentText: () => JSON.stringify(response),
        };
      },
    },
  });
  vm.runInContext(source, context);
  return { context, props, requests, sends, job, run: () => context.processMailQueue() };
}

test('prepares immediately before send, then acknowledges and removes receipt', () => {
  const h = harness();
  h.run();
  assert.equal(h.sends.length, 1);
  assert.deepEqual(
    h.requests.map((r) => r.action),
    ['mail_claim', 'mail_prepare', 'mail_ack'],
  );
  assert.equal(h.requests.at(-1).outcome, 'sent');
  assert.equal(
    [...h.props.keys()].some((k) => k.startsWith('MAIL_RECEIPT_')),
    false,
  );
});

test('waits without sending or throwing while a newly installed sender is paused', () => {
  const h = harness({ api: () => ({ httpStatus: 503, code: 'mail_disabled' }) });
  assert.doesNotThrow(() => h.run());
  assert.equal(h.sends.length, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].action, 'mail_claim');
});

test('ack failure retries only acknowledgement before any new work', () => {
  let blockAck = true;
  let claimed = false;
  const h = harness({
    api(body, defaults) {
      if (body.action === 'mail_ack' && blockAck) return { httpStatus: 503 };
      if (body.action === 'mail_claim') {
        if (claimed) return { messages: [] };
        claimed = true;
      }
      return defaults;
    },
  });
  h.run();
  assert.equal(h.sends.length, 1);
  h.run();
  assert.equal(h.sends.length, 1);
  blockAck = false;
  h.run();
  assert.equal(h.sends.length, 1);
  assert.equal(h.props.has('MAIL_RECEIPT_job-1'), false);
});

test('a crashed sending receipt becomes uncertain and is never resent', () => {
  const h = harness({
    api(body, fallback) {
      return body.action === 'mail_claim' ? { messages: [] } : fallback;
    },
  });
  h.props.set('MAIL_RECEIPT_job-1', JSON.stringify({ ...h.job, state: 'sending', error: '' }));
  h.run();
  assert.equal(h.sends.length, 0);
  assert.equal(h.requests[0].outcome, 'uncertain');
});

test('a MailApp exception has uncertain outcome, without exposing original error', () => {
  const h = harness({
    send() {
      throw new Error('private provider details');
    },
  });
  h.run();
  assert.equal(h.requests.at(-1).outcome, 'uncertain');
  assert.equal(h.requests.at(-1).error, 'SEND_OUTCOME_UNKNOWN');
});

test('quota zero still reports heartbeat with limit zero and sends nothing', () => {
  const h = harness({ quota: 0 });
  h.run();
  assert.equal(h.sends.length, 0);
  assert.equal(h.requests[0].limit, 0);
});

test('superseded or opted-out message is suppressed before MailApp', () => {
  const h = harness({
    api(body, fallback) {
      return body.action === 'mail_prepare' ? { skip: true } : fallback;
    },
  });
  h.run();
  assert.equal(h.sends.length, 0);
  assert.equal(h.requests.filter((r) => r.action === 'mail_ack').length, 0);
});

test('preparation outage is deferred without sending', () => {
  const h = harness({
    api(body, fallback) {
      return body.action === 'mail_prepare' ? { httpStatus: 503 } : fallback;
    },
  });
  h.run();
  assert.equal(h.sends.length, 0);
  assert.equal(h.requests.at(-1).outcome, 'deferred');
});

test('recipient lists and header injection are rejected', () => {
  const h = harness({
    api(body, fallback) {
      return body.action === 'mail_prepare'
        ? {
            skip: false,
            message: { to: 'one@example.org,two@example.org', subject: 'Hi', text: 'Test' },
          }
        : fallback;
    },
  });
  h.run();
  assert.equal(h.sends.length, 0);
  assert.equal(h.requests.at(-1).outcome, 'failed');
});

test('an overlapping run makes no network or MailApp calls', () => {
  const h = harness({ lock: false });
  h.run();
  assert.equal(h.requests.length, 0);
  assert.equal(h.sends.length, 0);
});
