const CALENDAR_KEY_PREFIX = "calendar:";
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
  const calendarToken = String(body.calendarToken || "").trim().toLowerCase();
  const writeToken = String(body.writeToken || "").trim().toLowerCase();

  if (!icsContent.includes("BEGIN:VCALENDAR") || !icsContent.includes("END:VCALENDAR")) {
    throw new Error("ICS payload is missing VCALENDAR content.");
  }

  if (icsContent.length > 2000000) {
    throw new Error("ICS payload is too large for this worker.");
  }

  if (!bidPeriod) {
    throw new Error("Bid period is required.");
  }

  return { icsContent, bidPeriod, fileName, calendarToken, writeToken };
}

function makeSubscriptionUrls(requestUrl, calendarToken) {
  const httpsUrl = new URL(`/calendar/${calendarToken}.ics`, requestUrl).toString();
  const webcalUrl = httpsUrl.startsWith("https://") ? `webcal://${httpsUrl.slice("https://".length)}` : httpsUrl;
  return { subscriptionUrl: httpsUrl, webcalUrl };
}

async function handlePublish(request, env) {
  const body = await request.json().catch(() => null);
  const { icsContent, bidPeriod, fileName, calendarToken, writeToken } = normalisePublishRequest(body);

  let nextCalendarToken = calendarToken;
  let nextWriteToken = writeToken;
  let existing = null;

  if (nextCalendarToken) {
    existing = await env.ROSTER_FEEDS.get(`${CALENDAR_KEY_PREFIX}${nextCalendarToken}`, "json");
  }

  if (existing) {
    if (!nextWriteToken || nextWriteToken !== String(existing.writeToken || "")) {
      return jsonResponse({ error: "Saved write token does not match this published calendar." }, { status: 403 });
    }
  } else {
    nextCalendarToken = generateToken();
    nextWriteToken = generateToken();
  }

  const updatedAtUtc = new Date().toISOString();
  const feedRecord = {
    bidPeriod,
    fileName,
    updatedAtUtc,
    writeToken: nextWriteToken,
    icsContent,
  };

  await env.ROSTER_FEEDS.put(`${CALENDAR_KEY_PREFIX}${nextCalendarToken}`, JSON.stringify(feedRecord));
  const urls = makeSubscriptionUrls(request.url, nextCalendarToken);

  return jsonResponse({
    calendarToken: nextCalendarToken,
    writeToken: nextWriteToken,
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
