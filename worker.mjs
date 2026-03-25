import { parseRosterText, rosterToIcs } from "./public/rosterParser.mjs";

const CALENDAR_KEY_PREFIX = "calendar:";
const STAFF_NUMBER_PREFIX = "staff-number:";
const APPROVED_STAFF_PREFIX = "approved-staff:";
const INGEST_LOG_PREFIX = "ingest-log:";
const TOKEN_BYTES = 18;
const COMBINED_CALENDAR_NAME = "Roster Export iCal";
const MAX_LOGS = 100;

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: String(message || "Request failed.") }, { status });
}

function generateToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nowIso() {
  return new Date().toISOString();
}

function normaliseBidPeriod(value) {
  return String(value || "").trim();
}

function normaliseStaffNumber(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function extractIcsEventBlocks(icsContent) {
  const content = String(icsContent || "");
  const matches = content.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  return matches ? matches.map((block) => block.trim()) : [];
}

function makeSubscriptionUrls(requestUrl, calendarToken) {
  const httpsUrl = new URL(`/calendar/${calendarToken}.ics`, requestUrl).toString();
  const webcalUrl = httpsUrl.startsWith("https://") ? `webcal://${httpsUrl.slice("https://".length)}` : httpsUrl;
  return { subscriptionUrl: httpsUrl, webcalUrl };
}

async function hashStaffNumber(staffNumber) {
  const data = new TextEncoder().encode(staffNumber);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalisePublishRequest(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Publish body must be JSON.");
  }

  const icsContent = String(body.icsContent || "");
  const bidPeriod = normaliseBidPeriod(body.bidPeriod || "");
  const fileName = String(body.fileName || "BP_events.ics").trim() || "BP_events.ics";
  const staffNumber = normaliseStaffNumber(body.staffNumber || "");
  const parsedStaffNumber = normaliseStaffNumber(body.parsedStaffNumber || "");

  if (!icsContent.includes("BEGIN:VCALENDAR") || !icsContent.includes("END:VCALENDAR")) {
    throw new Error("ICS payload is missing VCALENDAR content.");
  }

  if (icsContent.length > 2000000) {
    throw new Error("ICS payload is too large for this worker.");
  }

  if (!bidPeriod) {
    throw new Error("Bid period is required.");
  }

  if (staffNumber.length < 4) {
    throw new Error("Staff number must include at least 4 digits.");
  }

  if (parsedStaffNumber && parsedStaffNumber !== staffNumber) {
    throw new Error("Parsed roster staff number does not match the entered staff number.");
  }

  return { icsContent, bidPeriod, fileName, staffNumber };
}

function normaliseApprovedStaffRecord(rawRecord, staffNumberOverride = "") {
  if (!rawRecord || typeof rawRecord !== "object") {
    return null;
  }

  const staffNumber = normaliseStaffNumber(staffNumberOverride || rawRecord.staffNumber || "");
  const email = normaliseEmail(rawRecord.email || "");
  if (staffNumber.length < 4 || !email) {
    return null;
  }

  return {
    staffNumber,
    name: String(rawRecord.name || "").trim(),
    email,
    active: rawRecord.active !== false,
    createdAtUtc: String(rawRecord.createdAtUtc || "").trim(),
    updatedAtUtc: String(rawRecord.updatedAtUtc || "").trim(),
  };
}

function normaliseIngestAttachment(rawAttachment) {
  if (!rawAttachment || typeof rawAttachment !== "object") {
    return null;
  }

  const fileName = String(rawAttachment.fileName || "").trim();
  const rosterText = String(rawAttachment.rosterText || "");
  if (!fileName || !rosterText.trim()) {
    return null;
  }

  return {
    fileName,
    contentType: String(rawAttachment.contentType || "").trim(),
    rosterText,
  };
}

function normaliseEmailIngestRequest(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Ingest body must be JSON.");
  }

  const attachments = Array.isArray(body.attachments) ? body.attachments.map(normaliseIngestAttachment).filter(Boolean) : [];
  if (attachments.length === 0) {
    throw new Error("At least one parsed roster attachment is required.");
  }

  return {
    senderEmail: normaliseEmail(body.senderEmail || ""),
    subject: String(body.subject || "").trim(),
    messageId: String(body.messageId || "").trim(),
    attachments,
  };
}

export function normaliseFeedRecord(record) {
  if (!record || typeof record !== "object") {
    return { calendarsByBidPeriod: {}, updatedAtUtc: "" };
  }

  const calendarsByBidPeriod = {};
  const rawCalendars = record.calendarsByBidPeriod;
  if (rawCalendars && typeof rawCalendars === "object") {
    for (const [rawBidPeriod, entry] of Object.entries(rawCalendars)) {
      const bidPeriod = normaliseBidPeriod(rawBidPeriod || entry?.bidPeriod);
      const icsContent = String(entry?.icsContent || "");
      if (!bidPeriod || !icsContent) {
        continue;
      }
      calendarsByBidPeriod[bidPeriod] = {
        bidPeriod,
        fileName: String(entry?.fileName || `BP${bidPeriod}_events.ics`).trim() || `BP${bidPeriod}_events.ics`,
        updatedAtUtc: String(entry?.updatedAtUtc || record.updatedAtUtc || "").trim(),
        icsContent,
      };
    }
  }

  if (Object.keys(calendarsByBidPeriod).length === 0) {
    const bidPeriod = normaliseBidPeriod(record.bidPeriod);
    const icsContent = String(record.icsContent || "");
    if (bidPeriod && icsContent) {
      calendarsByBidPeriod[bidPeriod] = {
        bidPeriod,
        fileName: String(record.fileName || `BP${bidPeriod}_events.ics`).trim() || `BP${bidPeriod}_events.ics`,
        updatedAtUtc: String(record.updatedAtUtc || "").trim(),
        icsContent,
      };
    }
  }

  return {
    calendarsByBidPeriod,
    updatedAtUtc: String(record.updatedAtUtc || "").trim(),
  };
}

export function buildCombinedCalendarIcs(feedRecord) {
  const normalised = normaliseFeedRecord(feedRecord);
  const calendarEntries = Object.values(normalised.calendarsByBidPeriod).sort((left, right) =>
    left.bidPeriod.localeCompare(right.bidPeriod, undefined, { numeric: true })
  );

  if (calendarEntries.length === 0) {
    return "";
  }

  const combinedLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Roster Export iCal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(COMBINED_CALENDAR_NAME)}`,
  ];

  for (const entry of calendarEntries) {
    combinedLines.push(...extractIcsEventBlocks(entry.icsContent));
  }

  combinedLines.push("END:VCALENDAR");
  return `${combinedLines.join("\r\n")}\r\n`;
}

async function getSubscriptionMapping(env, staffNumber) {
  const staffNumberHash = await hashStaffNumber(staffNumber);
  const mappingKey = `${STAFF_NUMBER_PREFIX}${staffNumberHash}`;
  const mappingRecord = await env.ROSTER_FEEDS.get(mappingKey, "json");
  return { mappingKey, mappingRecord, staffNumberHash };
}

async function getApprovedStaff(env, staffNumber) {
  return normaliseApprovedStaffRecord(
    await env.ROSTER_FEEDS.get(`${APPROVED_STAFF_PREFIX}${normaliseStaffNumber(staffNumber)}`, "json"),
    staffNumber
  );
}

async function listApprovedStaff(env, requestUrl) {
  const listResult = await env.ROSTER_FEEDS.list({ prefix: APPROVED_STAFF_PREFIX, limit: 1000 });
  const records = [];

  for (const keyInfo of listResult.keys || []) {
    const staffNumber = keyInfo.name.slice(APPROVED_STAFF_PREFIX.length);
    const record = await getApprovedStaff(env, staffNumber);
    if (!record) {
      continue;
    }

    const { mappingRecord } = await getSubscriptionMapping(env, record.staffNumber);
    const urls = mappingRecord?.calendarToken ? makeSubscriptionUrls(requestUrl, String(mappingRecord.calendarToken).trim().toLowerCase()) : null;
    records.push({
      ...record,
      hasSubscription: Boolean(urls),
      subscriptionUrl: urls?.subscriptionUrl || "",
      webcalUrl: urls?.webcalUrl || "",
      latestBidPeriod: String(mappingRecord?.bidPeriod || "").trim(),
      latestUpdatedAtUtc: String(mappingRecord?.updatedAtUtc || "").trim(),
    });
  }

  records.sort((left, right) => left.staffNumber.localeCompare(right.staffNumber, undefined, { numeric: true }));
  return records;
}

async function logIngestEvent(env, payload) {
  const createdAtUtc = String(payload?.createdAtUtc || nowIso());
  const id = String(payload?.id || `${createdAtUtc}-${generateToken().slice(0, 8)}`);
  const record = {
    id,
    createdAtUtc,
    type: String(payload?.type || "info"),
    message: String(payload?.message || "").trim(),
    senderEmail: normaliseEmail(payload?.senderEmail || ""),
    subject: String(payload?.subject || "").trim(),
    messageId: String(payload?.messageId || "").trim(),
    staffNumber: normaliseStaffNumber(payload?.staffNumber || ""),
    fileName: String(payload?.fileName || "").trim(),
    bidPeriod: normaliseBidPeriod(payload?.bidPeriod || ""),
    resolved: payload?.resolved === true,
  };

  await env.ROSTER_FEEDS.put(`${INGEST_LOG_PREFIX}${record.createdAtUtc}:${record.id}`, JSON.stringify(record));
  return record;
}

async function listIngestLogs(env) {
  const listResult = await env.ROSTER_FEEDS.list({ prefix: INGEST_LOG_PREFIX, limit: MAX_LOGS });
  const records = [];

  for (const keyInfo of listResult.keys || []) {
    const record = await env.ROSTER_FEEDS.get(keyInfo.name, "json");
    if (record && typeof record === "object") {
      records.push(record);
    }
  }

  records.sort((left, right) => String(right.createdAtUtc || "").localeCompare(String(left.createdAtUtc || "")));
  return records.slice(0, MAX_LOGS);
}

function requireAdminPassword(request, env) {
  const expected = String(env.ADMIN_PASSWORD || "");
  if (!expected) {
    throw new Response(JSON.stringify({ error: "Admin password is not configured." }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const supplied = String(request.headers.get("x-admin-password") || "");
  if (supplied !== expected) {
    throw new Response(JSON.stringify({ error: "Admin password is incorrect." }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}

function requireIngestToken(request, env) {
  const expected = String(env.INGEST_API_TOKEN || "");
  if (!expected) {
    throw new Error("Email ingest token is not configured.");
  }

  const supplied = String(request.headers.get("x-ingest-token") || "");
  if (supplied !== expected) {
    throw new Error("Email ingest token is invalid.");
  }
}

async function updateCalendarFeedForStaff({ env, requestUrl, staffNumber, bidPeriod, fileName, icsContent }) {
  const { mappingKey, mappingRecord } = await getSubscriptionMapping(env, staffNumber);

  let calendarToken = String(mappingRecord?.calendarToken || "").trim().toLowerCase();
  const isNewCalendar = !calendarToken;
  if (!calendarToken) {
    calendarToken = generateToken();
  }

  const updatedAtUtc = nowIso();
  const existingFeedRecord = normaliseFeedRecord(await env.ROSTER_FEEDS.get(`${CALENDAR_KEY_PREFIX}${calendarToken}`, "json"));
  existingFeedRecord.calendarsByBidPeriod[bidPeriod] = {
    bidPeriod,
    fileName,
    updatedAtUtc,
    icsContent,
  };
  existingFeedRecord.updatedAtUtc = updatedAtUtc;

  await env.ROSTER_FEEDS.put(`${CALENDAR_KEY_PREFIX}${calendarToken}`, JSON.stringify(existingFeedRecord));
  await env.ROSTER_FEEDS.put(mappingKey, JSON.stringify({ calendarToken, updatedAtUtc, bidPeriod }));

  return {
    bidPeriod,
    updatedAtUtc,
    isNewCalendar,
    ...makeSubscriptionUrls(requestUrl, calendarToken),
  };
}

async function handlePublish(request, env) {
  const body = await request.json().catch(() => null);
  const { icsContent, bidPeriod, fileName, staffNumber } = normalisePublishRequest(body);

  return jsonResponse(await updateCalendarFeedForStaff({ env, requestUrl: request.url, staffNumber, bidPeriod, fileName, icsContent }));
}

async function handleCalendarRequest(request, env, calendarToken) {
  const record = await env.ROSTER_FEEDS.get(`${CALENDAR_KEY_PREFIX}${calendarToken}`, "json");
  const icsContent = buildCombinedCalendarIcs(record);
  if (!icsContent) {
    return new Response("Calendar feed not found.", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return new Response(icsContent, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'inline; filename="Roster_events.ics"',
    },
  });
}

async function handleAdminListStaff(request, env) {
  requireAdminPassword(request, env);
  return jsonResponse({ staff: await listApprovedStaff(env, request.url) });
}

async function handleAdminUpsertStaff(request, env) {
  requireAdminPassword(request, env);
  const body = await request.json().catch(() => null);
  const staffNumber = normaliseStaffNumber(body?.staffNumber || "");
  const email = normaliseEmail(body?.email || "");

  if (staffNumber.length < 4) {
    throw new Error("Staff number must include at least 4 digits.");
  }
  if (!email) {
    throw new Error("Approved staff must include an email address.");
  }

  const existing = await getApprovedStaff(env, staffNumber);
  const record = normaliseApprovedStaffRecord({
    staffNumber,
    name: body?.name || "",
    email,
    active: body?.active !== false,
    createdAtUtc: existing?.createdAtUtc || nowIso(),
    updatedAtUtc: nowIso(),
  }, staffNumber);

  await env.ROSTER_FEEDS.put(`${APPROVED_STAFF_PREFIX}${staffNumber}`, JSON.stringify(record));
  return jsonResponse({ staff: record });
}

async function handleAdminListLogs(request, env) {
  requireAdminPassword(request, env);
  return jsonResponse({ logs: await listIngestLogs(env) });
}

function buildSubscriptionEmail(record, publishResult) {
  const displayName = record.name ? `Hi ${record.name},` : "Hello,";
  return {
    to: record.email,
    subject: `Your roster subscription link for staff ${record.staffNumber}`,
    body: [
      displayName,
      "",
      "Your roster subscription calendar is ready.",
      "",
      `Subscription link: ${publishResult.webcalUrl || publishResult.subscriptionUrl}`,
      `HTTPS link: ${publishResult.subscriptionUrl}`,
      "",
      "Add the webcal link to Apple Calendar as a subscribed calendar.",
      "",
      `Staff number: ${record.staffNumber}`,
      `Updated at: ${publishResult.updatedAtUtc}`,
    ].join("\n"),
  };
}

function buildAlertEmail(env, issue) {
  const to = normaliseEmail(env.ALERT_EMAIL || "");
  if (!to) {
    return null;
  }

  return {
    to,
    subject: `Roster intake alert: ${issue.type}`,
    body: [
      "A roster email could not be processed automatically.",
      "",
      `Type: ${issue.type}`,
      `Message: ${issue.message}`,
      `Sender: ${issue.senderEmail || "Unknown"}`,
      `Staff number: ${issue.staffNumber || "Unknown"}`,
      `File: ${issue.fileName || "Unknown"}`,
      `Bid period: ${issue.bidPeriod || "Unknown"}`,
      `Message ID: ${issue.messageId || "Unknown"}`,
      `Logged at: ${issue.createdAtUtc}`,
    ].join("\n"),
  };
}

async function processEmailAttachment({ env, request, ingestRequest, attachment }) {
  const parsedRoster = parseRosterText(attachment.rosterText);
  const staffNumber = normaliseStaffNumber(parsedRoster.staffNumber || "");
  const bidPeriod = normaliseBidPeriod(parsedRoster.bidPeriod || "");

  if (!staffNumber) {
    const issue = await logIngestEvent(env, {
      type: "missing-staff-number",
      message: "Parsed roster did not include a staff number.",
      senderEmail: ingestRequest.senderEmail,
      subject: ingestRequest.subject,
      messageId: ingestRequest.messageId,
      fileName: attachment.fileName,
      bidPeriod,
      createdAtUtc: nowIso(),
    });
    return { ok: false, issue, alertEmail: buildAlertEmail(env, issue) };
  }

  const approvedStaff = await getApprovedStaff(env, staffNumber);
  if (!approvedStaff || approvedStaff.active === false) {
    const issue = await logIngestEvent(env, {
      type: "unapproved-staff-number",
      message: "Parsed staff number is not on the approved list.",
      senderEmail: ingestRequest.senderEmail,
      subject: ingestRequest.subject,
      messageId: ingestRequest.messageId,
      staffNumber,
      fileName: attachment.fileName,
      bidPeriod,
      createdAtUtc: nowIso(),
    });
    return { ok: false, issue, alertEmail: buildAlertEmail(env, issue) };
  }

  const icsContent = rosterToIcs(parsedRoster, attachment.fileName);
  const publishResult = await updateCalendarFeedForStaff({
    env,
    requestUrl: request.url,
    staffNumber,
    bidPeriod,
    fileName: `BP${bidPeriod}_events.ics`,
    icsContent,
  });

  await logIngestEvent(env, {
    type: publishResult.isNewCalendar ? "calendar-created" : "calendar-updated",
    message: publishResult.isNewCalendar ? "Created subscribed calendar from email ingest." : "Updated subscribed calendar from email ingest.",
    senderEmail: ingestRequest.senderEmail,
    subject: ingestRequest.subject,
    messageId: ingestRequest.messageId,
    staffNumber,
    fileName: attachment.fileName,
    bidPeriod,
    createdAtUtc: publishResult.updatedAtUtc,
  });

  return {
    ok: true,
    staffNumber,
    bidPeriod,
    fileName: attachment.fileName,
    parsedEventCount: Array.isArray(parsedRoster.events) ? parsedRoster.events.length : 0,
    publishResult,
    approvedStaff,
    notificationEmail: publishResult.isNewCalendar ? buildSubscriptionEmail(approvedStaff, publishResult) : null,
  };
}

async function handleEmailIngest(request, env) {
  requireIngestToken(request, env);
  const ingestRequest = normaliseEmailIngestRequest(await request.json().catch(() => null));

  const results = [];
  const notifications = [];

  for (const attachment of ingestRequest.attachments) {
    try {
      const result = await processEmailAttachment({ env, request, ingestRequest, attachment });
      results.push(result);
      if (result.notificationEmail) {
        notifications.push(result.notificationEmail);
      }
      if (result.alertEmail) {
        notifications.push(result.alertEmail);
      }
    } catch (error) {
      const issue = await logIngestEvent(env, {
        type: "parse-error",
        message: String(error?.message || "Could not process roster attachment."),
        senderEmail: ingestRequest.senderEmail,
        subject: ingestRequest.subject,
        messageId: ingestRequest.messageId,
        fileName: attachment.fileName,
        createdAtUtc: nowIso(),
      });
      results.push({ ok: false, issue });
      const alertEmail = buildAlertEmail(env, issue);
      if (alertEmail) {
        notifications.push(alertEmail);
      }
    }
  }

  return jsonResponse({
    processed: results.filter((result) => result.ok).map((result) => ({
      staffNumber: result.staffNumber,
      bidPeriod: result.bidPeriod,
      fileName: result.fileName,
      eventCount: result.parsedEventCount,
      recipientEmail: result.approvedStaff?.email || "",
      recipientName: result.approvedStaff?.name || "",
      ...result.publishResult,
    })),
    issues: results.filter((result) => !result.ok).map((result) => result.issue),
    notifications,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/subscribed-calendar") {
        if (request.method === "POST") {
          return await handlePublish(request, env);
        }

        return errorResponse("Method not allowed.", 405);
      }

      if (url.pathname === "/api/email-ingest") {
        if (request.method === "POST") {
          return await handleEmailIngest(request, env);
        }

        return errorResponse("Method not allowed.", 405);
      }

      if (url.pathname === "/api/admin/staff") {
        if (request.method === "GET") {
          return await handleAdminListStaff(request, env);
        }
        if (request.method === "POST") {
          return await handleAdminUpsertStaff(request, env);
        }

        return errorResponse("Method not allowed.", 405);
      }

      if (url.pathname === "/api/admin/logs") {
        if (request.method === "GET") {
          return await handleAdminListLogs(request, env);
        }

        return errorResponse("Method not allowed.", 405);
      }

      const calendarMatch = url.pathname.match(/^\/calendar\/([a-f0-9]{24,})\.ics$/i);
      if (calendarMatch && request.method === "GET") {
        return handleCalendarRequest(request, env, calendarMatch[1].toLowerCase());
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      return errorResponse(error?.message || "Request failed.", 400);
    }
  },
};
