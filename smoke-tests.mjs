import assert from "node:assert/strict";

import { parseRosterText, rosterToIcs } from "./public/rosterParser.mjs";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
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
