import assert from "node:assert/strict";

import { parseRosterText, rosterToIcs } from "./public/shared/roster-parser.mjs";
import { DEFAULT_AIRPORT_COUNTRY_MAP, DEFAULT_COUNTRY_RATES } from "./public/shared/dta-reference-data.mjs";
import { getDtaPatterns, getHourlyRateForAirport } from "./public/shared/dta-engine.mjs";
import workerApp, { buildCombinedCalendarIcs, normaliseFeedRecord } from "./worker.mjs";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

class MockKvNamespace {
  constructor() {
    this.map = new Map();
  }

  async get(key, type = "text") {
    if (!this.map.has(key)) {
      return null;
    }

    const value = this.map.get(key);
    if (type === "json") {
      return JSON.parse(value);
    }

    return value;
  }

  async put(key, value) {
    this.map.set(key, String(value));
  }

  async list(options = {}) {
    const prefix = String(options.prefix || "");
    const limit = Number(options.limit || 1000);
    const keys = [...this.map.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map((name) => ({ name }));

    return { keys, list_complete: true };
  }
}

test("pattern events sort before their flights", () => {
  const text = `BID PERIOD 999
25 Mar 2026
Date Duty Detail Credit
25/03 W RC51 0000 0000
26/03 T RC51 0000 0000
Pattern: RC51
QFA0003 SYD/AKL WE 0945 2245 WE 1250 0150 03:05
QFA0004 AKL/SYD TH 0645 1745 TH 1015 2115 03:30
----------------------------------------------------------------`;

  const parsed = parseRosterText(text);
  const rc51Events = parsed.events.filter((event) => event.patternCode === "RC51");

  assert.equal(rc51Events[0]?.eventType, "pattern");
  assert.equal(rc51Events[1]?.eventType, "flight");
  assert.equal(rc51Events[2]?.eventType, "flight");
});

test("pax sectors include PAX in the flight title", () => {
  const text = `BID PERIOD 999
01 Mar 2026
Date Duty Detail Credit
01/03 S ABCD 0000 0000
Pattern: ABCD
QF33 PAXSYD/PER MO 1530 0730 MO 1720 0920 04:50
----------------------------------------------------------------`;

  const parsed = parseRosterText(text);
  const flight = parsed.events.find((event) => event.eventType === "flight");

  assert.equal(flight?.summary, "QF33 PAX SYD/PER 1530 1720");
});

test("staff number is parsed from the roster header", () => {
  const text = `ARMS crew
Name: TEST   USER                                 Staff No: 504004
BID PERIOD 999
10 Mar 2026
Date Duty Detail Credit
10/03 T GL Golden Leave 00:00
`;

  const parsed = parseRosterText(text);

  assert.equal(parsed.staffNumber, "504004");
});

test("golden leave is created as an all-day leave event", () => {
  const text = `BID PERIOD 999
10 Mar 2026
Date Duty Detail Credit
10/03 T GL Golden Leave 00:00
`;

  const parsed = parseRosterText(text);
  const leave = parsed.events.find((event) => event.eventType === "leave_day");

  assert.equal(leave?.summary, "GL");
  assert.equal(leave?.timeKind, "all_day");
  assert.equal(leave?.dtStartDate, "20260310");
  assert.equal(leave?.dtEndDate, "20260311");
});

test("high priority leave is created as an all-day leave event", () => {
  const text = `BID PERIOD 999
10 Mar 2026
Date Duty Detail Credit
10/03 T HL High Priority Leave 00:00
`;

  const parsed = parseRosterText(text);
  const leave = parsed.events.find((event) => event.dutyCode === "HL");

  assert.equal(leave?.eventType, "leave_day");
  assert.equal(leave?.summary, "HL");
  assert.equal(leave?.previewInfo, "High Priority Leave");
});

test("EPA duties are recognised as emergency procedures with location", () => {
  const text = `BID PERIOD 999
23 Dec 2026
Date Duty Detail Credit
23/12 T EPASY 0800 1200 04:00
`;

  const parsed = parseRosterText(text);
  const training = parsed.events.find((event) => event.eventType === "training");
  const ics = rosterToIcs(parsed, "bp372.txt");

  assert.equal(training?.summary, "EPs-SY");
  assert.equal(training?.previewCode, "EPASY");
  assert.equal(training?.previewInfo, "EPs-SY");
  assert.match(ics, /LOCATION:Sydney/);
});

test("RX duties are treated as X-style all-day days off", () => {
  const text = `BID PERIOD 999
23 Dec 2026
Date Duty Detail Credit
23/12 T RX 00:00
24/12 F A 00:00
`;

  const parsed = parseRosterText(text);
  const rxDay = parsed.events.find((event) => event.dutyCode === "RX");

  assert.equal(rxDay?.eventType, "day_marker");
  assert.equal(rxDay?.summary, "Last RX Day");
  assert.equal(rxDay?.timeKind, "all_day");
});

test("SIM duties include the simulator exercise in the label", () => {
  const text = `BID PERIOD 999
23 Dec 2026
Date Duty Detail Credit
23/12 T SIMAB12 0800 1200 04:00
`;

  const parsed = parseRosterText(text);
  const sim = parsed.events.find((event) => event.eventType === "training");
  const ics = rosterToIcs(parsed, "bp372.txt");

  assert.equal(sim?.category, "SIM");
  assert.equal(sim?.summary, "SIM: Ex AB12");
  assert.equal(sim?.previewInfo, "Ex AB12");
  assert.match(ics, /SUMMARY:SIM: Ex AB12/);
});


test("SL, LSL, and SR are exported as supported duty events", () => {
  const text = `BID PERIOD 999
01 Apr 2026
Date Duty Detail Credit
01/04 W SL 1701
02/04 T LSL 00:00
03/04 F SR SBY 0600 1400
`;

  const parsed = parseRosterText(text);
  const sickLeave = parsed.events.find((event) => event.dutyCode === "SL");
  const longServiceLeave = parsed.events.find((event) => event.dutyCode === "LSL");
  const standby = parsed.events.find((event) => event.dutyCode === "SR");

  assert.equal(sickLeave?.eventType, "leave_day");
  assert.equal(sickLeave?.summary, "Sick Leave");
  assert.equal(sickLeave?.dtStartDate, "20260401");

  assert.equal(longServiceLeave?.eventType, "leave_day");
  assert.equal(longServiceLeave?.summary, "LSL");
  assert.equal(longServiceLeave?.previewInfo, "Long Service Leave");

  assert.equal(standby?.eventType, "standby");
  assert.equal(standby?.timeKind, "floating");
  assert.equal(standby?.summary, "Standby");
  assert.equal(standby?.dtStartLocal, "20260403T060000");
  assert.equal(standby?.dtEndLocal, "20260403T140000");
});

test("cancelled events are emitted in ICS output", () => {
  const parsedRoster = {
    bidPeriod: "999",
    events: [
      {
        uid: "uid-current",
        eventType: "leave_day",
        timeKind: "all_day",
        bidPeriod: "999",
        dutyCode: "AL",
        dateIso: "2026-03-01",
        summary: "AL",
        dtStartDate: "20260301",
        dtEndDate: "20260302",
      },
    ],
  };

  const cancelledEvents = [
    {
      uid: "uid-old",
      eventType: "flight",
      timeKind: "utc",
      summary: "QF33 SYD/PER 1530 1720",
      dtStartUtc: "2026-03-01T07:30:00.000Z",
      dtEndUtc: "2026-03-01T09:20:00.000Z",
    },
  ];

  const ics = rosterToIcs(parsedRoster, "test.txt", { cancelledEvents });

  assert.match(ics, /UID:uid-old@roster-export-ical/);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /SUMMARY:QF33 SYD\/PER 1530 1720 \(Cancelled\)/);
});

test("legacy single-bp feed records are normalised", () => {
  const legacyRecord = {
    bidPeriod: "373",
    fileName: "BP373_events.ics",
    updatedAtUtc: "2026-03-24T00:00:00.000Z",
    icsContent: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:bp373-1@roster-export-ical\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  };

  const normalised = normaliseFeedRecord(legacyRecord);

  assert.deepEqual(Object.keys(normalised.calendarsByBidPeriod), ["373"]);
  assert.equal(normalised.calendarsByBidPeriod["373"].fileName, "BP373_events.ics");
});

test("combined subscribed calendar preserves events across bid periods", () => {
  const combined = buildCombinedCalendarIcs({
    updatedAtUtc: "2026-03-24T00:00:00.000Z",
    calendarsByBidPeriod: {
      "373": {
        bidPeriod: "373",
        fileName: "BP373_events.ics",
        updatedAtUtc: "2026-03-23T00:00:00.000Z",
        icsContent: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:bp373-1@roster-export-ical\r\nSUMMARY:BP373 Event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      },
      "374": {
        bidPeriod: "374",
        fileName: "BP374_events.ics",
        updatedAtUtc: "2026-03-24T00:00:00.000Z",
        icsContent: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:bp374-1@roster-export-ical\r\nSUMMARY:BP374 Event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      },
    },
  });

  assert.match(combined, /UID:bp373-1@roster-export-ical/);
  assert.match(combined, /UID:bp374-1@roster-export-ical/);
  assert.match(combined, /X-WR-CALNAME:Roster Export iCal/);
});

test("shared DTA engine resolves patterns and airport hourly rates", () => {
  const text = `BID PERIOD 999
25 Mar 2026
Date Duty Detail Credit
25/03 W RC51 0000 0000
26/03 T RC51 0000 0000
Pattern: RC51
QFA0003 SYD/AKL WE 0945 2245 WE 1250 0150 03:05
QFA0004 AKL/SYD TH 0645 1745 TH 1015 2115 03:30
----------------------------------------------------------------`;

  const parsed = parseRosterText(text);
  const patterns = getDtaPatterns(parsed);
  const aklRate = getHourlyRateForAirport("AKL", DEFAULT_COUNTRY_RATES, DEFAULT_AIRPORT_COUNTRY_MAP);

  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].patternCode, "RC51");
  assert.equal(aklRate.country, "New Zealand");
  assert.equal(aklRate.rate, 14.16);
});

await testAsync("worker stores and returns latest parsed roster records", async () => {
  const env = {
    ADMIN_PASSWORD: "admin-secret",
    INGEST_API_TOKEN: "ingest-secret",
    ROSTER_FEEDS: new MockKvNamespace(),
    ASSETS: {
      fetch() {
        return new Response("not found", { status: 404 });
      },
    },
  };

  await env.ROSTER_FEEDS.put(
    "approved-staff:504004",
    JSON.stringify({
      staffNumber: "504004",
      email: "approved@example.com",
      active: true,
      createdAtUtc: "2026-03-25T00:00:00.000Z",
      updatedAtUtc: "2026-03-25T00:00:00.000Z",
    })
  );

  const rosterText = `ARMS crew
Name: TEST USER                                 Staff No: 504004
BID PERIOD 999
25 Mar 2026
Date Duty Detail Credit
25/03 W RC51 0000 0000
26/03 T RC51 0000 0000
Pattern: RC51
QFA0003 SYD/AKL WE 0945 2245 WE 1250 0150 03:05
QFA0004 AKL/SYD TH 0645 1745 TH 1015 2115 03:30
----------------------------------------------------------------`;

  const ingestRequest = new Request("https://example.com/api/email-ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ingest-token": "ingest-secret",
    },
    body: JSON.stringify({
      senderEmail: "crew@example.com",
      subject: "Roster update",
      messageId: "msg-1",
      attachments: [
        {
          fileName: "BP999.txt",
          contentType: "text/plain",
          rosterText,
        },
      ],
    }),
  });

  const ingestResponse = await workerApp.fetch(ingestRequest, env);
  assert.equal(ingestResponse.status, 200);
  const ingestData = await ingestResponse.json();
  assert.equal(ingestData.processed.length, 1);
  assert.equal(ingestData.processed[0].staffNumber, "504004");
  assert.ok(ingestData.processed[0].parsedRosterStoredAtUtc);

  const latestRequest = new Request("https://example.com/api/admin/rosters/latest?staffNumber=504004", {
    headers: {
      "x-admin-password": "admin-secret",
    },
  });

  const latestResponse = await workerApp.fetch(latestRequest, env);
  assert.equal(latestResponse.status, 200);
  const latestData = await latestResponse.json();
  assert.equal(latestData.roster.staffNumber, "504004");
  assert.equal(latestData.roster.bidPeriod, "999");
  assert.equal(latestData.roster.source, "gmail");
  assert.equal(latestData.roster.parsedRoster.staffNumber, "504004");
  assert.equal(latestData.roster.parsedRoster.bidPeriod, "999");
});

await testAsync("manual publish also stores parsed roster records", async () => {
  const env = {
    ROSTER_FEEDS: new MockKvNamespace(),
    ASSETS: {
      fetch() {
        return new Response("not found", { status: 404 });
      },
    },
  };

  const parsedRoster = parseRosterText(`ARMS crew
Name: TEST USER                                 Staff No: 777777
BID PERIOD 888
25 Mar 2026
Date Duty Detail Credit
25/03 W RC51 0000 0000
26/03 T RC51 0000 0000
Pattern: RC51
QFA0003 SYD/AKL WE 0945 2245 WE 1250 0150 03:05
QFA0004 AKL/SYD TH 0645 1745 TH 1015 2115 03:30
----------------------------------------------------------------`);

  const publishRequest = new Request("https://example.com/api/subscribed-calendar", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      bidPeriod: parsedRoster.bidPeriod,
      fileName: `BP${parsedRoster.bidPeriod}_events.ics`,
      rosterFileName: "manual-upload.txt",
      icsContent: rosterToIcs(parsedRoster, "manual-upload.txt"),
      staffNumber: parsedRoster.staffNumber,
      parsedStaffNumber: parsedRoster.staffNumber,
      parsedRoster,
    }),
  });

  const publishResponse = await workerApp.fetch(publishRequest, env);
  assert.equal(publishResponse.status, 200);
  const publishData = await publishResponse.json();
  assert.ok(publishData.subscriptionUrl);
  assert.ok(publishData.parsedRosterStoredAtUtc);

  const latestRecord = await env.ROSTER_FEEDS.get("parsed-roster-latest:777777", "json");
  assert.equal(latestRecord.staffNumber, "777777");
  assert.equal(latestRecord.bidPeriod, "888");

  const storedRoster = await env.ROSTER_FEEDS.get("parsed-roster:777777:888", "json");
  assert.equal(storedRoster.source, "manual");
  assert.equal(storedRoster.fileName, "manual-upload.txt");
  assert.equal(storedRoster.parsedRoster.staffNumber, "777777");
  assert.equal(storedRoster.parsedRoster.bidPeriod, "888");
});
