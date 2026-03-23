const CALENDAR_KEY_PREFIX = "calendar:";
const STAFF_NUMBER_PREFIX = "staff-number:";
const TOKEN_BYTES = 18;

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
  const feedRecord = {
    bidPeriod,
    fileName,
    updatedAtUtc,
    icsContent,
  };

  await env.ROSTER_FEEDS.put(`${CALENDAR_KEY_PREFIX}${calendarToken}`, JSON.stringify(feedRecord));
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
  if (!record || typeof record.icsContent !== "string") {
    return new Response("Calendar feed not found.", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return new Response(record.icsContent, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="${String(record.fileName || `BP${record.bidPeriod || ""}_events.ics`).replace(/"/g, "")}"`,
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
