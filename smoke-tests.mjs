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

test("interleaved SIM rows do not split one pattern occurrence", () => {
  const text = `ARMS crew
07 May 2026
BID PERIOD 375
Date Duty Detail Rept End Credit
21/05 T ZDA60 AW99 0615 4:50
21/05 T SIM07CA AW99 1015 1545 5:30
22/05 F SIM07CB AW99 1415 1945 5:30
22/05 F ZDA60 2345
Pattern: ZDA60      INT  Base: MEL   Route Code:         Weeks: 1         Category:  CPT-B787                         Days Away:  2
Service T Pax    Sectors             Time     Day    LT    UTC     Day    LT    UTC     of Duty   Total     Night   Period    Credit
QFA0604   PAX   MEL/BNE              0615     TH    0700   2100    TH    0920   2320      1:40   (  2:20)
SIM07CA   &     BNE/BNE                       TH    1100   0100    TH    1500   0500     22:30      4:00              9:30
SIM07CB   &     BNE/BNE              1415     FR    1500   0500    FR    1900   0900      1:45      4:00
QFA1259   PAX   BNE/MEL                       FR    2045   1045    FR    2315   1315             (  2:30)             9:30
----------------------------------------------------------------`;

  const parsed = parseRosterText(text);
  const zda60Patterns = parsed.events.filter((event) => event.eventType === "pattern" && event.patternCode === "ZDA60");
  const zda60Flights = parsed.events.filter((event) => event.eventType === "flight" && event.patternCode === "ZDA60");

  assert.equal(zda60Patterns.length, 1);
  assert.equal(zda60Patterns[0]?.tripStartIso, "2026-05-21");
  assert.equal(zda60Patterns[0]?.tripEndIso, "2026-05-22");
  assert.deepEqual(
    zda60Flights.map((event) => event.flightNumber),
    ["QFA0604", "QFA1259"]
  );
  assert.equal(zda60Flights[0]?.previewStart, "2026-05-20T21:00:00Z");
  assert.equal(zda60Flights[1]?.previewStart, "2026-05-22T10:45:00Z");
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

test("placeholder bid periods do not override the roster header year", () => {
  const text = `BID PERIOD 999
10 Mar 2026
Date Duty Detail Credit
10/03 T X 00:00
`;

  const parsed = parseRosterText(text);
  const day = parsed.events.find((event) => event.dutyCode === "X");

  assert.equal(day?.dtStartDate, "20260310");
  assert.equal(day?.dtEndDate, "20260311");
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

test("TSPD is exported as a timed Melbourne event", () => {
  const text = `ARMS crew
28 Jun 2026
BID PERIOD 376
Date Duty Detail Rept End Credit|Date Duty Detail Rept End Credit|Date Duty Detail Rept End Credit
13/07 M A|01/08 S X|20/08 T TSPD 0900 1700
`;

  const parsed = parseRosterText(text);
  const tspd = parsed.events.find((event) => event.dutyCode === "TSPD");
  const ics = rosterToIcs(parsed, "bp376.txt");

  assert.equal(tspd?.eventType, "training");
  assert.equal(tspd?.summary, "TSPD");
  assert.equal(tspd?.timeZone, "Australia/Melbourne");
  assert.equal(tspd?.dtStartLocal, "20260820T090000");
  assert.equal(tspd?.dtEndLocal, "20260820T170000");
  assert.match(ics, /DTSTART;TZID=Australia\/Melbourne:20260820T090000/);
  assert.match(ics, /DTEND;TZID=Australia\/Melbourne:20260820T170000/);
  assert.match(ics, /SUMMARY:TSPD/);
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

test("HL and RX are recognised in multi-column roster layouts and exported as all-day events", () => {
  const text = `ARMS crew
27 Mar 2026
BID PERIOD 370
Date Duty Detail Rept End Credit|Date Duty Detail Rept End Credit|Date Duty Detail Rept End Credit
27/08 W HL|30/08 S X Cleared|18/09 T X
28/08 T HL|31/08 S X Cleared|19/09 F X
29/08 F RX|01/09 M A|20/09 S RCG20X064 AW22 1310 11:00
09/09 T RX|10/09 W A|27/09 S X
`;

  const parsed = parseRosterText(text);
  const hlEvents = parsed.events.filter((event) => event.dutyCode === "HL");
  const rxEvents = parsed.events.filter((event) => event.dutyCode === "RX");
  const ics = rosterToIcs(parsed, "bp370.txt");

  assert.equal(hlEvents.length, 2);
  assert.equal(hlEvents[0]?.eventType, "leave_day");
  assert.equal(hlEvents[0]?.summary, "HL");
  assert.equal(hlEvents[1]?.summary, "HL");

  assert.equal(rxEvents.length, 2);
  assert.equal(rxEvents[0]?.eventType, "day_marker");
  assert.equal(rxEvents[0]?.summary, "RX Day");
  assert.equal(rxEvents[1]?.summary, "Last RX Day");

  assert.match(ics, /SUMMARY:HL/);
  assert.match(ics, /SUMMARY:RX Day/);
  assert.match(ics, /SUMMARY:Last RX Day/);
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

test("SR standby duties are exported to ICS with timed local start and end", () => {
  const text = `BID PERIOD 999
01 Apr 2026
Date Duty Detail Credit
03/04 F SR AS01 0700 1900 5:30
`;

  const parsed = parseRosterText(text);
  const ics = rosterToIcs(parsed, "bp999.txt");

  assert.match(ics, /SUMMARY:Standby/);
  assert.match(ics, /DTSTART:20260403T070000/);
  assert.match(ics, /DTEND:20260403T190000/);
  assert.match(ics, /Duty: SR/);
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
