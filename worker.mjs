const CALENDAR_KEY_PREFIX = "calendar:";
const STAFF_NUMBER_PREFIX = "staff-number:";
const TOKEN_BYTES = 18;
const COMBINED_CALENDAR_NAME = "Roster Export iCal";

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

function generateToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalisePublishRequest(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Publish body must be JSON.");
  }

  const icsContent = String(body.icsContent || "");
  const bidPeriod = String(body.bidPeriod || "").trim();
  const fileName = String(body.fileName || "BP_events.ics").trim() || "BP_events.ics";
  const staffNumber = String(body.staffNumber || "").replace(/\D+/g, "").trim();
  const parsedStaffNumber = String(body.parsedStaffNumber || "").replace(/\D+/g, "").trim();

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

async function hashStaffNumber(staffNumber) {
  const data = new TextEncoder().encode(staffNumber);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeSubscriptionUrls(requestUrl, calendarToken) {
  const httpsUrl = new URL(`/calendar/${calendarToken}.ics`, requestUrl).toString();
  const webcalUrl = httpsUrl.startsWith("https://") ? `webcal://${httpsUrl.slice("https://".length)}` : httpsUrl;
  return { subscriptionUrl: httpsUrl, webcalUrl };
}

function normaliseBidPeriod(value) {
  return String(value || "").trim();
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

function extractIcsEventBlocks(icsContent) {
  const content = String(icsContent || "");
  const matches = content.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  return matches ? matches.map((block) => block.trim()) : [];
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
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

async function handlePublish(request, env) {
  const body = await request.json().catch(() => null);
  const { icsContent, bidPeriod, fileName, staffNumber } = normalisePublishRequest(body);

  const staffNumberHash = await hashStaffNumber(staffNumber);
  const mappingKey = `${STAFF_NUMBER_PREFIX}${staffNumberHash}`;
  const mappingRecord = await env.ROSTER_FEEDS.get(mappingKey, "json");

  let calendarToken = String(mappingRecord?.calendarToken || "").trim().toLowerCase();
  if (!calendarToken) {
    calendarToken = generateToken();
  }

  const updatedAtUtc = new Date().toISOString();
  const existingFeedRecord = normaliseFeedRecord(
    await env.ROSTER_FEEDS.get(`${CALENDAR_KEY_PREFIX}${calendarToken}`, "json")
  );
  existingFeedRecord.calendarsByBidPeriod[bidPeriod] = {
    bidPeriod,
    fileName,
    updatedAtUtc,
    icsContent,
  };
  existingFeedRecord.updatedAtUtc = updatedAtUtc;

  await env.ROSTER_FEEDS.put(`${CALENDAR_KEY_PREFIX}${calendarToken}`, JSON.stringify(existingFeedRecord));
  await env.ROSTER_FEEDS.put(
    mappingKey,
    JSON.stringify({ calendarToken, updatedAtUtc, bidPeriod })
  );
  const urls = makeSubscriptionUrls(request.url, calendarToken);

  return jsonResponse({
    bidPeriod,
    updatedAtUtc,
    ...urls,
  });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscribed-calendar") {
      if (request.method === "POST") {
        try {
          return await handlePublish(request, env);
        } catch (error) {
          return jsonResponse({ error: String(error?.message || "Could not publish calendar.") }, { status: 400 });
        }
      }

      return jsonResponse({ error: "Method not allowed." }, { status: 405 });
    }

    const calendarMatch = url.pathname.match(/^\/calendar\/([a-f0-9]{24,})\.ics$/i);
    if (calendarMatch && request.method === "GET") {
      return handleCalendarRequest(request, env, calendarMatch[1].toLowerCase());
    }

    return env.ASSETS.fetch(request);
  },
};
