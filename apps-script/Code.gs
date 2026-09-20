/** Passlaget mail worker. No Google services are called until explicitly run. */
var WORKER_RECEIPT_PREFIX = 'MAIL_RECEIPT_';
var WORKER_BATCH_SIZE = 5;
var WORKER_MAX_RUNTIME_MS = 4 * 60 * 1000;

/** Run manually once after setting PORTAL_URL and WORKER_SECRET in properties. */
function installMailTrigger() {
  workerConfig_();
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processMailQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('processMailQueue').timeBased().everyMinutes(5).create();
  console.log('Mail trigger installed; interval: 5 minutes.');
}

function removeMailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processMailQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  console.log('Mail trigger removed.');
}

/** Process one small, server-prioritised batch. Overlapping executions do no work. */
function processMailQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  var startedAt = Date.now();
  try {
    var config = workerConfig_();
    if (!flushMailReceipts_(config)) {
      console.log('Waiting for previous acknowledgements; no new mail claimed.');
      return;
    }
    var remaining = Math.max(0, MailApp.getRemainingDailyQuota());
    var batch = workerApi_(config, {
      action: 'mail_claim',
      limit: Math.min(WORKER_BATCH_SIZE, remaining)
    });
    if (!batch || !Array.isArray(batch.messages)) throw new Error('INVALID_CLAIM');
    var sentCount = 0;
    var deferredCount = 0;
    batch.messages.forEach(function (job) {
      if (!validJob_(job)) throw new Error('INVALID_CLAIM_JOB');
      if (remaining <= 0 || Date.now() - startedAt > WORKER_MAX_RUNTIME_MS) {
        saveMailReceipt_(job, 'deferred', 'QUOTA_OR_TIME_LIMIT');
        acknowledgeMailReceipt_(config, receiptFor_(job.id));
        deferredCount += 1;
        return;
      }
      // If this fails before sending, keep the job safely retryable.
      var prepared;
      try {
        prepared = workerApi_(config, {
          action: 'mail_prepare', id: job.id, leaseToken: job.leaseToken
        });
      } catch (_) {
        saveMailReceipt_(job, 'deferred', 'PREPARE_UNAVAILABLE');
        acknowledgeMailReceipt_(config, receiptFor_(job.id));
        return;
      }
      // The server has already terminalised a suppressed, obsolete or opted-out job.
      if (prepared && prepared.skip === true) return;
      var message = prepared && prepared.message;
      if (!validMessage_(message)) {
        saveMailReceipt_(job, 'failed', 'INVALID_MESSAGE');
        acknowledgeMailReceipt_(config, receiptFor_(job.id));
        return;
      }
      remaining = Math.max(0, MailApp.getRemainingDailyQuota());
      if (!remaining) {
        saveMailReceipt_(job, 'deferred', 'QUOTA_LIMIT');
        acknowledgeMailReceipt_(config, receiptFor_(job.id));
        deferredCount += 1;
        return;
      }
      // Persist BEFORE sending. A crash from here cannot safely trigger a resend.
      // Do not include email addresses, body, subject, recovery links or secrets.
      saveMailReceipt_(job, 'sending');
      try {
        var options = {
          to: message.to,
          subject: message.subject,
          body: message.text,
          name: 'Landvetter IS – bemanning'
        };
        if (message.html) options.htmlBody = message.html;
        MailApp.sendEmail(options);
      } catch (_) {
        saveMailReceipt_(job, 'uncertain', 'SEND_OUTCOME_UNKNOWN');
        acknowledgeMailReceipt_(config, receiptFor_(job.id));
        remaining = Math.max(0, MailApp.getRemainingDailyQuota());
        return;
      }
      // If this write fails, the old 'sending' receipt conservatively becomes uncertain.
      saveMailReceipt_(job, 'sent');
      acknowledgeMailReceipt_(config, receiptFor_(job.id));
      remaining -= 1;
      sentCount += 1;
    });
    console.log('Mail worker complete. Sent: ' + sentCount + '; deferred: ' + deferredCount + '.');
  } catch (_) {
    // Apps Script failure notification is intentionally generic, with no API payload.
    throw new Error('MAIL_WORKER_FAILED: inspect portal mail status and configuration.');
  } finally {
    lock.releaseLock();
  }
}

function workerConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var url = (properties.getProperty('PORTAL_URL') || '').trim();
  var secret = (properties.getProperty('WORKER_SECRET') || '').trim();
  // Full deployed Edge Function endpoint; never a github.io frontend URL.
  if (!/^https:\/\/[^\s?#]+\/functions\/v1\/[^\s?#]+$/.test(url) || secret.length < 32) {
    throw new Error('WORKER_CONFIGURATION_REQUIRED');
  }
  return { url: url, secret: secret };
}

function workerApi_(config, body) {
  var payload = Object.assign({}, body, { workerSecret: config.secret });
  var response = UrlFetchApp.fetch(config.url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: false,
    validateHttpsCertificates: true
  });
  // A freshly installed sender can wait quietly while the portal is still paused.
  // Never treat a failed prepare/ack as success: their receipts must be retained.
  if (body.action === 'mail_claim' && response.getResponseCode() === 503) {
    var paused;
    try { paused = JSON.parse(response.getContentText()); } catch (_) { paused = null; }
    if (paused && paused.code === 'mail_disabled') return { messages: [], paused: true };
  }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('WORKER_API_REJECTED');
  }
  try {
    return JSON.parse(response.getContentText());
  } catch (_) {
    throw new Error('WORKER_API_INVALID_JSON');
  }
}

function validJob_(job) {
  return job && typeof job.id === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(job.id) &&
    typeof job.leaseToken === 'string' && job.leaseToken.length >= 8 && job.leaseToken.length <= 256;
}

function validMessage_(message) {
  // One recipient per job: never allow comma-separated recipient lists or header injection.
  return message && typeof message.to === 'string' &&
    /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/.test(message.to) &&
    typeof message.subject === 'string' && message.subject.length > 0 &&
    message.subject.length <= 250 && !/[\r\n]/.test(message.subject) &&
    typeof message.text === 'string' && message.text.length <= 60000 &&
    (!message.html || (typeof message.html === 'string' && message.html.length <= 100000));
}

function saveMailReceipt_(job, state, error) {
  PropertiesService.getScriptProperties().setProperty(WORKER_RECEIPT_PREFIX + job.id, JSON.stringify({
    id: job.id, leaseToken: job.leaseToken, state: state,
    error: error || '', at: new Date().toISOString()
  }));
}

function receiptFor_(id) {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty(WORKER_RECEIPT_PREFIX + id));
}

function acknowledgeMailReceipt_(config, receipt) {
  try {
    var outcome = receipt.state === 'sending' ? 'uncertain' : receipt.state;
    var result = workerApi_(config, {
      action: 'mail_ack', id: receipt.id, leaseToken: receipt.leaseToken,
      outcome: outcome, error: receipt.state === 'sending' ? 'INTERRUPTED_DURING_SEND' : receipt.error
    });
    if (!result || result.ok !== true) return false;
    PropertiesService.getScriptProperties().deleteProperty(WORKER_RECEIPT_PREFIX + receipt.id);
    return true;
  } catch (_) {
    // No resend: persist receipt and retry only acknowledgement on the next invocation.
    return false;
  }
}

function flushMailReceipts_(config) {
  var all = PropertiesService.getScriptProperties().getProperties();
  var complete = true;
  Object.keys(all).filter(function (key) {
    return key.indexOf(WORKER_RECEIPT_PREFIX) === 0;
  }).forEach(function (key) {
    var receipt;
    try { receipt = JSON.parse(all[key]); } catch (_) { complete = false; return; }
    if (!validJob_(receipt) || ['sending', 'sent', 'failed', 'uncertain', 'deferred'].indexOf(receipt.state) < 0) {
      complete = false;
      return;
    }
    if (!acknowledgeMailReceipt_(config, receipt)) complete = false;
  });
  return complete;
}
