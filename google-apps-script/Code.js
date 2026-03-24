const CONFIG = {
  workerBaseUrl: "https://roster-export-ical.rosterical.workers.dev",
  ingestPath: "/api/email-ingest",
  ingestApiToken: "roster-ingest-2026-very-long-random-string",
  searchQuery: 'in:inbox newer_than:30d has:attachment',
  processedLabel: "Roster Auto/Processed",
  failedLabel: "Roster Auto/Failed",
  reviewLabel: "Roster Auto/Needs Review",
  markThreadsReadAfterProcessing: true,
  archiveThreadsAfterProcessing: false,
  maxThreadsPerRun: 20,
  maxMessagesPerRun: 50,
};

function processRosterInbox() {
  validateConfig_();

  const processedLabel = getOrCreateLabel_(CONFIG.processedLabel);
  const failedLabel = getOrCreateLabel_(CONFIG.failedLabel);
  const reviewLabel = getOrCreateLabel_(CONFIG.reviewLabel);
  const threads = GmailApp.search(CONFIG.searchQuery, 0, CONFIG.maxThreadsPerRun);
  const stats = {
    scannedThreads: threads.length,
    processedMessages: 0,
    processedAttachments: 0,
    issueCount: 0,
  };

  for (const thread of threads) {
    const messages = thread.getMessages();
    let threadProcessed = false;
    let threadFailed = false;

    for (const message of messages) {
      if (stats.processedMessages >= CONFIG.maxMessagesPerRun) {
        break;
      }

      const messageId = message.getId();
      if (isMessageProcessed_(messageId)) {
        continue;
      }

      const validAttachments = extractValidRosterAttachments_(message);
      if (!validAttachments.length) {
        markMessageProcessed_(messageId, { skipped: true, processedAtUtc: new Date().toISOString() });
        continue;
      }

      const payload = {
        senderEmail: normaliseEmail_(message.getFrom()),
        subject: String(message.getSubject() || "").trim(),
        messageId,
        attachments: validAttachments,
      };

      const result = postToWorker_(payload);
      sendNotificationEmails_(result.notifications || []);
      markMessageProcessed_(messageId, {
        processedAtUtc: new Date().toISOString(),
        processedAttachmentCount: (result.processed || []).length,
        issueCount: (result.issues || []).length,
      });

      stats.processedMessages += 1;
      stats.processedAttachments += validAttachments.length;
      stats.issueCount += Array.isArray(result.issues) ? result.issues.length : 0;
      threadProcessed = true;
      threadFailed = threadFailed || (Array.isArray(result.issues) && result.issues.length > 0);
    }

    if (threadProcessed) {
      if (threadFailed) {
        reviewLabel.addToThread(thread);
        failedLabel.addToThread(thread);
      } else {
        processedLabel.addToThread(thread);
        reviewLabel.removeFromThread(thread);
        failedLabel.removeFromThread(thread);
      }

      if (CONFIG.markThreadsReadAfterProcessing) {
        GmailApp.markThreadRead(thread);
      }
      if (CONFIG.archiveThreadsAfterProcessing) {
        thread.moveToArchive();
      }
    }
  }

  Logger.log(JSON.stringify(stats, null, 2));
  return stats;
}

function installFiveMinuteTrigger() {
  const existing = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === "processRosterInbox"
  );
  if (existing.length > 0) {
    Logger.log("Trigger already exists.");
    return;
  }

  ScriptApp.newTrigger("processRosterInbox").timeBased().everyMinutes(5).create();
  Logger.log("Created 5-minute trigger for processRosterInbox.");
}

function clearFiveMinuteTriggers() {
  const triggers = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === "processRosterInbox"
  );
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  Logger.log(`Deleted ${triggers.length} processRosterInbox trigger(s).`);
}

function testSingleMessageById(messageId) {
  const message = GmailApp.getMessageById(String(messageId || "").trim());
  if (!message) {
    throw new Error("Message not found.");
  }

  const validAttachments = extractValidRosterAttachments_(message);
  if (!validAttachments.length) {
    throw new Error("No valid .txt or .pdf roster attachments found on that message.");
  }

  const payload = {
    senderEmail: normaliseEmail_(message.getFrom()),
    subject: String(message.getSubject() || "").trim(),
    messageId: message.getId(),
    attachments: validAttachments,
  };
  const result = postToWorker_(payload);
  sendNotificationEmails_(result.notifications || []);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function validateConfig_() {
  if (!/^https:\/\//.test(CONFIG.workerBaseUrl || "")) {
    throw new Error("CONFIG.workerBaseUrl must be an https URL.");
  }
  if (!CONFIG.ingestApiToken || CONFIG.ingestApiToken === "SET_ME") {
    throw new Error("Set CONFIG.ingestApiToken before running the Gmail automation.");
  }
}

function getOrCreateLabel_(name) {
  const existing = GmailApp.getUserLabelByName(name);
  return existing || GmailApp.createLabel(name);
}

function normaliseEmail_(value) {
  const raw = String(value || "").trim().toLowerCase();
  const match = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : raw;
}

function getMessageStateStore_() {
  return PropertiesService.getScriptProperties();
}

function getMessageStateKey_(messageId) {
  return `message:${String(messageId || "").trim()}`;
}

function isMessageProcessed_(messageId) {
  return Boolean(getMessageStateStore_().getProperty(getMessageStateKey_(messageId)));
}

function markMessageProcessed_(messageId, state) {
  getMessageStateStore_().setProperty(getMessageStateKey_(messageId), JSON.stringify(state || {}));
}

function extractValidRosterAttachments_(message) {
  const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true }) || [];
  const valid = [];

  for (const attachment of attachments) {
    const fileName = String(attachment.getName() || "").trim();
    const lowerName = fileName.toLowerCase();
    const contentType = String(attachment.getContentType() || "").toLowerCase();
    let rosterText = "";

    if (lowerName.endsWith(".txt") || contentType.includes("text/plain")) {
      rosterText = attachment.getDataAsString("utf-8");
    } else if (lowerName.endsWith(".pdf") || contentType === "application/pdf") {
      rosterText = extractTextFromPdf_(attachment.copyBlob(), fileName);
    } else {
      continue;
    }

    if (!String(rosterText || "").trim()) {
      continue;
    }

    valid.push({
      fileName,
      contentType,
      rosterText,
    });
  }

  return valid;
}

function extractTextFromPdf_(blob, fileName) {
  const imported = Drive.Files.create(
    {
      name: `Roster OCR ${new Date().toISOString()} ${fileName}`,
      mimeType: "application/vnd.google-apps.document",
    },
    blob
  );

  if (!imported || !imported.id) {
    throw new Error(`Could not OCR PDF attachment ${fileName}.`);
  }

  try {
    const doc = DocumentApp.openById(imported.id);
    return doc.getBody().getText();
  } finally {
    DriveApp.getFileById(imported.id).setTrashed(true);
  }
}

function postToWorker_(payload) {
  const url = `${String(CONFIG.workerBaseUrl || "").replace(/\/$/, "")}${CONFIG.ingestPath}`;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {
      "x-ingest-token": CONFIG.ingestApiToken,
    },
    payload: JSON.stringify(payload),
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  const data = text ? JSON.parse(text) : {};
  if (status < 200 || status >= 300) {
    throw new Error(data && data.error ? data.error : `Worker ingest failed with status ${status}.`);
  }

  return data;
}

function sendNotificationEmails_(notifications) {
  for (const notification of notifications || []) {
    if (!notification || !notification.to || !notification.subject) {
      continue;
    }

    MailApp.sendEmail({
      to: notification.to,
      subject: notification.subject,
      body: String(notification.body || ""),
    });
  }
}
