import { getDtaPatterns } from "./dta-engine.mjs?v=20260329a";
import { parseRosterText } from "./roster-parser.mjs?v=20260402a";

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const LEAVE_DUTY_CODES = new Set(["AL", "SL", "LSL", "GL", "UL", "HL"]);
const SUMMARY_LEAVE_DUTY_CODES = new Set(["AL", "SL", "LSL", "GL"]);
const NON_PATTERN_DUTY_CODES = new Set(["A", "X", "RX", "AL", "SL", "LSL", "GL", "UL", "HL", "SR"]);
const NON_PATTERN_DUTY_PREFIXES = ["SIM", "EPA", "EPC", "EPE", "TPA", "TPAX", "TNR", "PMI", "EBT", "TSPD"];
const TRAINING_BUCKET_PREFIXES = ["SIM", "EPA", "EPC", "EPE", "TPA", "TPAX", "TNR"];
const HEADER_ADJUSTMENT_CODES = new Map([
  ["O", "Offsettable"],
  ["F", "Fixed"],
  ["M", "Multi"],
  ["D", "Date Limited"],
  ["L", "Low Line"],
  ["C", "Calendar Day"],
]);
const BP_ANCHOR_NUMBER = 358;
const BP_LENGTH_DAYS = 56;
const BP_ANCHOR_START_DATE = new Date(Date.UTC(2023, 9, 9));

function parseDurationToMinutes(value) {
  if (!/^\d{1,3}:\d{2}$/.test(String(value || "").trim())) {
    return null;
  }

  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const rounded = Math.round(numeric);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatDateIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDivisorMinutes(text) {
  const match = String(text || "").match(/Divisor\s*:\s*(\d{1,3}:\d{2})/i);
  return parseDurationToMinutes(match?.[1] || "");
}

function parseProjectedMinutes(text) {
  const match = String(text || "").match(/Projected\s*:\s*(\d{1,3}:\d{2})/i);
  return parseDurationToMinutes(match?.[1] || "");
}

function parseTrainingMinutes(text) {
  const match = String(text || "").match(/Training\s*:\s*(\d{1,3}:\d{2})/i);
  return parseDurationToMinutes(match?.[1] || "");
}

function parseBidPeriodNumber(text) {
  const match = String(text || "").match(/BID PERIOD\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseHeaderDate(text) {
  const match = String(text || "").match(/\b(\d{2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
  if (!match) {
    return new Date();
  }

  const month = MONTHS[match[2]];
  if (month == null) {
    return new Date();
  }

  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}

function deriveBidPeriodStartDate(bidPeriodNumber) {
  if (!Number.isFinite(bidPeriodNumber)) {
    return null;
  }

  return addDays(BP_ANCHOR_START_DATE, (bidPeriodNumber - BP_ANCHOR_NUMBER) * BP_LENGTH_DAYS);
}

function buildDateContext(text) {
  const headerDate = parseHeaderDate(text);
  const bidPeriodNumber = parseBidPeriodNumber(text);
  const bidPeriodStartDate = deriveBidPeriodStartDate(bidPeriodNumber);
  const bidPeriodEndDate = bidPeriodStartDate ? addDays(bidPeriodStartDate, BP_LENGTH_DAYS - 1) : null;

  return {
    headerDate,
    bidPeriodNumber,
    bidPeriodStartDate,
    bidPeriodEndDate,
  };
}

function normaliseDate(day, month, dateContext) {
  const context = dateContext || {};
  const anchorDate = context.bidPeriodStartDate || context.headerDate || new Date();
  const anchorYear = anchorDate.getUTCFullYear();
  const maxFutureDays = 120;
  const maxPastDays = 220;
  const candidates = [anchorYear - 1, anchorYear, anchorYear + 1].map((year) => {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    const diffDays = Math.floor((candidate - anchorDate) / 86400000);
    return {
      candidate,
      diffDays,
      inBidPeriodWindow:
        context.bidPeriodStartDate instanceof Date &&
        context.bidPeriodEndDate instanceof Date &&
        candidate >= context.bidPeriodStartDate &&
        candidate <= context.bidPeriodEndDate,
      inPreferredWindow: diffDays >= -maxPastDays && diffDays <= maxFutureDays,
    };
  });

  candidates.sort((left, right) => {
    if (left.inBidPeriodWindow !== right.inBidPeriodWindow) {
      return left.inBidPeriodWindow ? -1 : 1;
    }
    if (left.inPreferredWindow !== right.inPreferredWindow) {
      return left.inPreferredWindow ? -1 : 1;
    }
    const absoluteDiff = Math.abs(left.diffDays) - Math.abs(right.diffDays);
    if (absoluteDiff !== 0) {
      return absoluteDiff;
    }
    if ((left.diffDays <= 0) !== (right.diffDays <= 0)) {
      return left.diffDays <= 0 ? -1 : 1;
    }
    return left.diffDays - right.diffDays;
  });

  return candidates[0].candidate;
}

function addDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function isNextDay(leftDate, rightDate) {
  if (!(leftDate instanceof Date) || !(rightDate instanceof Date)) {
    return false;
  }

  return addDays(leftDate, 1).getTime() === rightDate.getTime();
}

function hhmmToMinutes(value) {
  if (!/^\d{4}$/.test(String(value || "").trim())) {
    return null;
  }

  const text = String(value);
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(2, 4));
}

function getNightOverlapMinutes(startMinutes, durationMinutes) {
  if (startMinutes == null || durationMinutes == null || durationMinutes <= 0) {
    return 0;
  }

  const intervalStart = startMinutes;
  const intervalEnd = startMinutes + durationMinutes;
  let overlap = 0;

  const startDay = Math.floor(intervalStart / 1440) - 1;
  const endDay = Math.floor(intervalEnd / 1440) + 1;
  for (let day = startDay; day <= endDay; day += 1) {
    const dayBase = day * 1440;
    const windows = [
      [dayBase, dayBase + 480],
      [dayBase + 1200, dayBase + 1440],
    ];

    for (const [windowStart, windowEnd] of windows) {
      const segmentStart = Math.max(intervalStart, windowStart);
      const segmentEnd = Math.min(intervalEnd, windowEnd);
      if (segmentEnd > segmentStart) {
        overlap += segmentEnd - segmentStart;
      }
    }
  }

  return overlap;
}

function extractPatternCreditRows(text) {
  const rows = [];
  const patternRegex =
    /\|\*\s*Pattern:\s*([A-Z0-9]+)\s*\|[\s\S]*?Days Away:\s*(\d+)\s+Minimum Pattern Credit:\s*([0-9:]+)\s+Minimum Daily Credit:\s*([0-9:]+)\s+Applicable Credit:\s*([0-9:]+)/gi;

  let match;
  while ((match = patternRegex.exec(String(text || "")))) {
    rows.push({
      patternCode: String(match[1] || "").trim().toUpperCase(),
      daysAway: Number(match[2]),
      minimumPatternCreditMinutes: parseDurationToMinutes(match[3]),
      minimumDailyCreditMinutes: parseDurationToMinutes(match[4]),
      applicableCreditMinutes: parseDurationToMinutes(match[5]),
    });
  }

  return rows;
}

function buildPatternCreditLookup(patternRows) {
  const lookup = new Map();
  for (const row of patternRows) {
    if (!row.patternCode || lookup.has(row.patternCode)) {
      continue;
    }
    lookup.set(row.patternCode, row);
  }
  return lookup;
}

function getDateDifferenceInDays(leftDate, rightDate) {
  if (!(leftDate instanceof Date) || !(rightDate instanceof Date)) {
    return null;
  }

  return Math.floor((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function isTrainingBucketCode(code) {
  const normalised = String(code || "").trim().toUpperCase();
  return TRAINING_BUCKET_PREFIXES.some((prefix) => normalised.startsWith(prefix));
}

function isTrainingDutyItem(item) {
  return isTrainingBucketCode(item?.code || "");
}

function splitScheduleLineIntoSegments(line) {
  const source = String(line || "");
  if (!source.trim()) {
    return [];
  }

  if (/[|│]/.test(source)) {
    return source.split(/[|│]/);
  }

  const starts = [...source.matchAll(/\d{2}\/\d{2}\s+[MTWFS]\s+/g)].map((match) => match.index);
  if (starts.length <= 1) {
    return [source];
  }

  const segments = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : source.length;
    segments.push(source.slice(start, end));
  }
  return segments;
}

function parseScheduleSegment(segment, dateContext) {
  const match = String(segment || "").match(/^\s*(\d{2})\/(\d{2})\s+([MTWFS])\s+(.+)$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const tokens = match[4].trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  const dutyCode = tokens.shift();
  let credit = null;
  if (tokens.length > 0 && /^\d{1,3}:\d{2}$/.test(tokens[tokens.length - 1])) {
    credit = tokens.pop();
  }

  const timeIndexes = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (/^\d{4}$/.test(tokens[i])) {
      timeIndexes.push(i);
    }
  }

  const rept = timeIndexes.length > 0 ? tokens[timeIndexes[0]] : null;
  const end = timeIndexes.length > 1 ? tokens[timeIndexes[1]] : null;
  const timeIndexSet = new Set(timeIndexes);
  const detail = tokens.filter((_, index) => !timeIndexSet.has(index)).join(" ").trim() || null;
  const date = normaliseDate(day, month, dateContext);

  return {
    date,
    iso: formatDateIso(date),
    dutyCode,
    detail,
    rept,
    end,
    credit,
  };
}

function parseScheduleRows(text) {
  const lines = String(text || "").split(/\r?\n/);
  const dateContext = buildDateContext(text);
  const startIndex = lines.findIndex(
    (line) => /Date\s+Duty/.test(line) && /Detail/.test(line) && /Credit/.test(line)
  );
  if (startIndex < 0) {
    return [];
  }

  const rows = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes("Carry Out")) {
      break;
    }

    const segments = splitScheduleLineIntoSegments(line);
    for (const segment of segments) {
      const parsed = parseScheduleSegment(segment, dateContext);
      if (parsed) {
        rows.push(parsed);
      }
    }
  }

  rows.sort((left, right) => left.date - right.date || left.dutyCode.localeCompare(right.dutyCode));
  return rows;
}

function countDaysByPredicate(scheduleRows, predicate) {
  const days = new Set();
  for (const row of Array.isArray(scheduleRows) ? scheduleRows : []) {
    if (!row?.iso) {
      continue;
    }
    if (predicate(row)) {
      days.add(row.iso);
    }
  }
  return days.size;
}

function makeScheduleRowKey(row) {
  return [
    row?.iso || "",
    row?.dutyCode || "",
    row?.detail || "",
    row?.rept || "",
    row?.end || "",
    row?.credit || "",
  ].join("|");
}

function isLikelyPatternDutyCode(row, scheduleRows, index, knownPatternCodes) {
  const dutyCode = String(row?.dutyCode || "").trim().toUpperCase();
  if (!dutyCode) {
    return false;
  }

  if (knownPatternCodes.has(dutyCode)) {
    return true;
  }

  if (NON_PATTERN_DUTY_CODES.has(dutyCode)) {
    return false;
  }

  if (NON_PATTERN_DUTY_PREFIXES.some((prefix) => dutyCode.startsWith(prefix))) {
    return false;
  }

  if (!/\d/.test(dutyCode) || dutyCode.length < 4) {
    return false;
  }

  const previous = scheduleRows[index - 1] || null;
  const next = scheduleRows[index + 1] || null;
  const hasAdjacentSameCode =
    (previous && previous.dutyCode === dutyCode && isNextDay(previous.date, row.date)) ||
    (next && next.dutyCode === dutyCode && isNextDay(row.date, next.date));
  if (hasAdjacentSameCode) {
    return true;
  }

  return !row.detail && (!row.rept || !row.end);
}

function mergePatternOccurrences(occurrences, patternCreditLookup) {
  if (occurrences.length <= 1) {
    return occurrences;
  }

  const merged = [];
  for (const occurrence of occurrences) {
    const previous = merged[merged.length - 1] || null;
    const summary = patternCreditLookup.get(occurrence.patternCode) || null;
    const totalSpanDays =
      previous && previous.patternCode === occurrence.patternCode
        ? getDateDifferenceInDays(previous.startDate, occurrence.endDate) + 1
        : null;
    const canMerge =
      previous &&
      previous.patternCode === occurrence.patternCode &&
      occurrence.startDate.getTime() <= addDays(previous.endDate, 2).getTime() &&
      Number.isFinite(summary?.daysAway) &&
      summary.daysAway > 0 &&
      Number.isFinite(totalSpanDays) &&
      totalSpanDays <= summary.daysAway;

    if (!canMerge) {
      merged.push({
        ...occurrence,
        rows: [...occurrence.rows],
      });
      continue;
    }

    if (occurrence.endDate > previous.endDate) {
      previous.endDate = occurrence.endDate;
    }
    previous.rows.push(...occurrence.rows);
  }

  return merged;
}

function extractPatternOccurrencesFromSchedule(scheduleRows, knownPatternCodes, patternCreditLookup) {
  const occurrences = [];
  let current = null;

  for (let index = 0; index < scheduleRows.length; index += 1) {
    const row = scheduleRows[index];
    const isPatternDay = isLikelyPatternDutyCode(row, scheduleRows, index, knownPatternCodes);
    const isUplineSickDay = row.dutyCode === "UL";

    if (!isPatternDay) {
      if (current && isUplineSickDay && isNextDay(current.endDate, row.date)) {
        current.endDate = row.date;
        current.rows.push(row);
        continue;
      }

      if (current) {
        occurrences.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = {
        patternCode: row.dutyCode,
        startDate: row.date,
        endDate: row.date,
        rows: [row],
      };
      continue;
    }

    const isSamePatternContinuation =
      current.patternCode === row.dutyCode && isNextDay(current.endDate, row.date);

    if (isSamePatternContinuation) {
      current.endDate = row.date;
      current.rows.push(row);
      continue;
    }

    occurrences.push(current);
    current = {
      patternCode: row.dutyCode,
      startDate: row.date,
      endDate: row.date,
      rows: [row],
    };
  }

  if (current) {
    occurrences.push(current);
  }

  return mergePatternOccurrences(occurrences, patternCreditLookup).map((occurrence) => {
    const creditedRow = occurrence.rows.find(
      (row) => row.dutyCode === occurrence.patternCode && parseDurationToMinutes(row.credit) != null
    );
    return {
      ...occurrence,
      tripStartIso: formatDateIso(occurrence.startDate),
      tripEndIso: formatDateIso(occurrence.endDate),
      occurrenceCreditMinutes: parseDurationToMinutes(creditedRow?.credit || "") ?? null,
    };
  });
}

function roundToMinute(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function getGreatestFinite(values) {
  let greatest = null;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    if (greatest == null || value > greatest) {
      greatest = value;
    }
  }
  return greatest;
}

function calculatePercentDifference(baseMinutes, comparisonMinutes) {
  if (!Number.isFinite(baseMinutes) || baseMinutes <= 0 || !Number.isFinite(comparisonMinutes)) {
    return null;
  }

  return ((comparisonMinutes - baseMinutes) / baseMinutes) * 100;
}

function deriveLeaveBlockCreditMinutes(blockRows, divisorMinutes) {
  const explicitMinutes = blockRows.reduce((total, row) => total + (parseDurationToMinutes(row.credit) || 0), 0);
  if (explicitMinutes > 0) {
    return explicitMinutes;
  }

  if (!Number.isFinite(divisorMinutes) || divisorMinutes <= 0) {
    return 0;
  }

  return roundToMinute((divisorMinutes / 56) * blockRows.length) || 0;
}

function buildOtherCreditedDutyItems(scheduleRows, divisorMinutes, excludedRowKeys = new Set()) {
  const rows = Array.isArray(scheduleRows) ? scheduleRows : [];
  const items = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    const rowKey = makeScheduleRowKey(row);
    const rowExcluded = excludedRowKeys.has(rowKey);

    if (rowExcluded && row.dutyCode !== "UL") {
      index += 1;
      continue;
    }

    if (row.dutyCode === "HL") {
      index += 1;
      continue;
    }

    if (LEAVE_DUTY_CODES.has(row.dutyCode)) {
      const blockRows = [row];
      let cursor = index + 1;

      while (cursor < rows.length) {
        const candidate = rows[cursor];
        const candidateKey = makeScheduleRowKey(candidate);

        if (row.dutyCode === "UL" && excludedRowKeys.has(candidateKey)) {
          cursor += 1;
          continue;
        }

        if (excludedRowKeys.has(candidateKey)) {
          break;
        }

        if (candidate.dutyCode !== row.dutyCode) {
          break;
        }

        const dayGap = getDateDifferenceInDays(blockRows[blockRows.length - 1].date, candidate.date);
        const canExtend =
          row.dutyCode === "UL"
            ? Number.isFinite(dayGap) && dayGap >= 1 && dayGap <= 2
            : Number.isFinite(dayGap) && dayGap === 1;

        if (!canExtend) {
          break;
        }

        blockRows.push(candidate);
        cursor += 1;
      }

      const creditMinutes = deriveLeaveBlockCreditMinutes(blockRows, divisorMinutes);
      if (creditMinutes > 0) {
        items.push({
          itemType: "duty",
          code: row.dutyCode,
          label: row.dutyCode,
          dateStartIso: blockRows[0].iso,
          dateEndIso: blockRows[blockRows.length - 1].iso,
          dayCount: blockRows.length,
          creditMinutes,
          source: "leave-block",
        });
      }

      index = cursor;
      continue;
    }

    if (rowExcluded) {
      index += 1;
      continue;
    }

    const explicitCreditMinutes = parseDurationToMinutes(row.credit) || 0;
    let derivedCreditMinutes = explicitCreditMinutes;

    if (derivedCreditMinutes <= 0 && row.dutyCode === "SR") {
      derivedCreditMinutes = 330;
    } else if (derivedCreditMinutes <= 0 && /^SIM/i.test(row.dutyCode)) {
      derivedCreditMinutes = 330;
    }

    if (derivedCreditMinutes > 0) {
      items.push({
        itemType: "duty",
        code: row.dutyCode,
        label: [row.dutyCode, row.detail].filter(Boolean).join(" "),
        dateStartIso: row.iso,
        dateEndIso: row.iso,
        dayCount: 1,
        creditMinutes: derivedCreditMinutes,
        source: explicitCreditMinutes > 0 ? "schedule-credit" : "derived-duty-credit",
      });
    }

    index += 1;
  }

  return items;
}

function parseHeaderAdjustmentItems(text) {
  const lines = String(text || "").split(/\r?\n/);
  const items = [];

  for (const line of lines.slice(0, 20)) {
    const matches = [...line.matchAll(/([A-Za-z ]+)\(([A-Z])\):\s*(\d{1,3}:\d{2})/g)];
    for (const match of matches) {
      const code = String(match[2] || "").trim();
      const creditMinutes = parseDurationToMinutes(match[3]);
      if (!HEADER_ADJUSTMENT_CODES.has(code) || !creditMinutes) {
        continue;
      }

      items.push({
        itemType: "adjustment",
        code,
        label: HEADER_ADJUSTMENT_CODES.get(code) || String(match[1] || "").trim(),
        dayCount: 0,
        creditMinutes,
        source: "header-adjustment",
      });
    }
  }

  return items;
}

function estimateSectorDelta(flightEvent) {
  const depLocalMinutes = hhmmToMinutes(flightEvent?.depLocal);
  const scheduledFlightMinutes = Number(flightEvent?.scheduledFlightMinutes);
  const hasScheduledFlightMinutes = Number.isFinite(scheduledFlightMinutes) && scheduledFlightMinutes > 0;
  const rawNightOverlapMinutes = hasScheduledFlightMinutes
    ? getNightOverlapMinutes(depLocalMinutes, scheduledFlightMinutes)
    : 0;
  const nightOverlapMinutes = flightEvent?.isPax ? 0 : rawNightOverlapMinutes;

  let estimatedDutyMinutes = null;
  if (flightEvent?.reportStartUtc instanceof Date && flightEvent?.dtEndUtc instanceof Date) {
    estimatedDutyMinutes = (flightEvent.dtEndUtc.getTime() - flightEvent.reportStartUtc.getTime()) / 60000;
  } else if (flightEvent?.dtStartUtc instanceof Date && flightEvent?.dtEndUtc instanceof Date) {
    estimatedDutyMinutes = (flightEvent.dtEndUtc.getTime() - flightEvent.dtStartUtc.getTime()) / 60000;
  }

  return {
    estimatedDutyMinutes,
    nightOverlapMinutes,
  };
}

function normaliseFlightNumberForCrewRule(value) {
  const match = String(value || "")
    .trim()
    .toUpperCase()
    .match(/([A-Z]+)?0*(\d{1,4})$/);
  return match ? Number(match[2]) : null;
}

function isQf3OrQf4AklSydSector(sector) {
  const flightNumber = normaliseFlightNumberForCrewRule(sector?.flightNumber);
  const origin = String(sector?.origin || "").trim().toUpperCase();
  const destination = String(sector?.destination || "").trim().toUpperCase();
  const isAklSydRoute =
    (origin === "SYD" && destination === "AKL") || (origin === "AKL" && destination === "SYD");

  return isAklSydRoute && (flightNumber === 3 || flightNumber === 4);
}

function applyCrewComplementRuleToPatternSectors(sectors) {
  const enriched = sectors.map((sector) => ({
    ...sector,
    crewRuleException: isQf3OrQf4AklSydSector(sector),
  }));

  const patternHasFourPilotSector = enriched.some(
    (sector) =>
      !sector.isPax &&
      !sector.crewRuleException &&
      Number.isFinite(sector.estimatedDutyMinutes) &&
      sector.estimatedDutyMinutes > 12 * 60
  );

  return enriched.map((sector) => {
    const estimatedFourPilot =
      !sector.isPax &&
      !sector.crewRuleException &&
      (patternHasFourPilotSector ||
        (Number.isFinite(sector.estimatedDutyMinutes) && sector.estimatedDutyMinutes > 12 * 60));
    const fourPilotNightDeltaMinutes = estimatedFourPilot ? (Number(sector.nightOverlapMinutes) || 0) / 3 : 0;

    return {
      ...sector,
      estimatedFourPilot,
      fourPilotNightDeltaMinutes,
    };
  });
}

export function buildRosterAnalysis(text, fileName = "") {
  const parsedRoster = parseRosterText(String(text || ""));
  const divisorMinutes = parseDivisorMinutes(text);
  const projectedMinutes = parseProjectedMinutes(text);
  const headerTrainingMinutes = parseTrainingMinutes(text);
  const scheduleRows = parseScheduleRows(text);
  const patternCreditRows = extractPatternCreditRows(text);
  const patternCreditLookup = buildPatternCreditLookup(patternCreditRows);
  const patternCodes = new Set(patternCreditRows.map((row) => row.patternCode));
  const patternOccurrences = extractPatternOccurrencesFromSchedule(scheduleRows, patternCodes, patternCreditLookup);
  const dtaPatternLookup = new Map(
    getDtaPatterns(parsedRoster).map((pattern) => [`${pattern.patternCode}|${pattern.tripStartIso}`, pattern])
  );
  const patterns = patternOccurrences.map((occurrence) => {
    const dtaPattern = dtaPatternLookup.get(`${occurrence.patternCode}|${occurrence.tripStartIso}`) || null;
    const creditSummary = patternCreditLookup.get(occurrence.patternCode) || null;
    const sectors = applyCrewComplementRuleToPatternSectors(
      (dtaPattern?.flights || []).map((flight) => {
        const delta = estimateSectorDelta(flight);
        return {
          ...flight,
          ...delta,
        };
      })
    );

    const potentialNightCreditDeltaMinutes = sectors.reduce(
      (total, sector) => total + (Number(sector.fourPilotNightDeltaMinutes) || 0),
      0
    );
    const totalScheduledFlightMinutes = sectors.reduce(
      (total, sector) => total + (Number(sector.scheduledFlightMinutes) || 0),
      0
    );
    const totalNightOverlapMinutes = sectors.reduce(
      (total, sector) => total + (Number(sector.nightOverlapMinutes) || 0),
      0
    );
    const baseApplicableCreditMinutes = occurrence.occurrenceCreditMinutes ?? creditSummary?.applicableCreditMinutes ?? null;
    const nightCreditDeltaMinutes = potentialNightCreditDeltaMinutes;
    const withNightCreditMinutes =
      Number.isFinite(baseApplicableCreditMinutes) ? baseApplicableCreditMinutes + nightCreditDeltaMinutes : null;
    const nightCreditDifferencePercent = calculatePercentDifference(
      baseApplicableCreditMinutes,
      withNightCreditMinutes
    );

    return {
      id: `${occurrence.patternCode}|${occurrence.tripStartIso}`,
      patternCode: occurrence.patternCode,
      tripStartIso: occurrence.tripStartIso,
      tripEndIso: occurrence.tripEndIso,
      label: `${occurrence.patternCode} (${occurrence.tripStartIso})`,
      startSort: occurrence.startDate.getTime(),
      flightCount: sectors.length,
      sectors,
      occurrenceCreditMinutes: occurrence.occurrenceCreditMinutes,
      daysAway: creditSummary?.daysAway ?? null,
      minimumPatternCreditMinutes: creditSummary?.minimumPatternCreditMinutes ?? null,
      minimumDailyCreditMinutes: creditSummary?.minimumDailyCreditMinutes ?? null,
      baseApplicableCreditMinutes,
      potentialNightCreditDeltaMinutes,
      fourPilotNightDeltaMinutes: nightCreditDeltaMinutes,
      withNightCreditMinutes,
      nightCreditDifferencePercent,
      totalScheduledFlightMinutes,
      totalNightOverlapMinutes,
      modelledAllNightCreditMinutes: withNightCreditMinutes,
    };
  });

  patterns.sort((left, right) => left.startSort - right.startSort || left.id.localeCompare(right.id));

  const totalBaseApplicableCreditMinutes = patterns.reduce(
    (total, pattern) => total + (Number(pattern.baseApplicableCreditMinutes) || 0),
    0
  );
  const totalFourPilotNightDeltaMinutes = patterns.reduce(
    (total, pattern) => total + (Number(pattern.fourPilotNightDeltaMinutes) || 0),
    0
  );
  const totalWithNightPatternCreditMinutes = patterns.reduce(
    (total, pattern) => total + (Number(pattern.withNightCreditMinutes) || 0),
    0
  );
  const totalScheduledFlightMinutes = patterns.reduce(
    (total, pattern) => total + (Number(pattern.totalScheduledFlightMinutes) || 0),
    0
  );
  const excludedPatternRowKeys = new Set(
    patternOccurrences.flatMap((occurrence) =>
      occurrence.rows
        .filter((row) => row.dutyCode === occurrence.patternCode)
        .map((row) => makeScheduleRowKey(row))
    )
  );
  const creditedDutyItems = buildOtherCreditedDutyItems(scheduleRows, divisorMinutes, excludedPatternRowKeys);
  const shouldUseTrainingBucket = Number.isFinite(headerTrainingMinutes) && headerTrainingMinutes > 0;
  const trainingItems = shouldUseTrainingBucket ? creditedDutyItems.filter((item) => isTrainingDutyItem(item)) : [];
  const otherCreditedItems = shouldUseTrainingBucket
    ? creditedDutyItems.filter((item) => !isTrainingDutyItem(item))
    : creditedDutyItems;
  const adjustmentItems = parseHeaderAdjustmentItems(text);
  const totalWorkedDayCount = countDaysByPredicate(
    scheduleRows,
    (row) => !["A", "X", "RX"].includes(String(row?.dutyCode || "").trim().toUpperCase()) && !LEAVE_DUTY_CODES.has(String(row?.dutyCode || "").trim().toUpperCase())
  );
  const totalLeaveDayCount = countDaysByPredicate(
    scheduleRows,
    (row) => SUMMARY_LEAVE_DUTY_CODES.has(String(row?.dutyCode || "").trim().toUpperCase())
  );
  const totalPaxSectorCount = (parsedRoster.events || []).filter(
    (event) => event?.eventType === "flight" && event?.isPax
  ).length;
  const totalRouteCheckSectorCount = (parsedRoster.events || []).filter(
    (event) => event?.eventType === "flight" && event?.isRouteCheck
  ).length;
  const totalTrainingCreditedDutyMinutes = trainingItems.reduce(
    (total, item) => total + (Number(item.creditMinutes) || 0),
    0
  );
  const totalTrainingCreditMinutes =
    shouldUseTrainingBucket
      ? headerTrainingMinutes
      : totalTrainingCreditedDutyMinutes;
  const totalOtherCreditedDutyMinutes = otherCreditedItems.reduce(
    (total, item) => total + (Number(item.creditMinutes) || 0),
    0
  );
  const totalAdjustmentCreditMinutes = adjustmentItems.reduce(
    (total, item) => total + (Number(item.creditMinutes) || 0),
    0
  );
  const displayedReconciliationMinutes =
    totalBaseApplicableCreditMinutes + totalOtherCreditedDutyMinutes + totalAdjustmentCreditMinutes;
  const reconciliationGapMinutes =
    Number.isFinite(projectedMinutes) ? projectedMinutes - displayedReconciliationMinutes : null;
  const totalReconciledTrainingCreditMinutes =
    Number.isFinite(reconciliationGapMinutes) &&
    reconciliationGapMinutes !== 0 &&
    reconciliationGapMinutes === totalTrainingCreditMinutes
      ? totalTrainingCreditMinutes
      : 0;
  const totalApplicableCreditMinutes =
    totalBaseApplicableCreditMinutes +
    totalOtherCreditedDutyMinutes +
    totalReconciledTrainingCreditMinutes +
    totalAdjustmentCreditMinutes;
  const totalWithNightCreditMinutes =
    totalWithNightPatternCreditMinutes +
    totalOtherCreditedDutyMinutes +
    totalReconciledTrainingCreditMinutes +
    totalAdjustmentCreditMinutes;
  const totalNightCreditDifferencePercent = calculatePercentDifference(
    totalApplicableCreditMinutes,
    totalWithNightCreditMinutes
  );

  return {
    fileName: String(fileName || "").trim(),
    parsedRoster,
    divisorMinutes,
    projectedMinutes,
    patterns,
    trainingItems,
    otherCreditedItems,
    adjustmentItems,
    headerTrainingMinutes,
    totalTrainingCreditedDutyMinutes,
    totalTrainingCreditMinutes,
    totalReconciledTrainingCreditMinutes,
    totalBaseApplicableCreditMinutes,
    totalOtherCreditedDutyMinutes,
    totalAdjustmentCreditMinutes,
    totalWorkedDayCount,
    totalLeaveDayCount,
    totalPaxSectorCount,
    totalRouteCheckSectorCount,
    totalApplicableCreditMinutes,
    totalWithNightPatternCreditMinutes,
    totalWithNightCreditMinutes,
    totalNightCreditDifferencePercent,
    totalFourPilotNightDeltaMinutes,
    totalScheduledFlightMinutes,
    totalModelledAllNightCreditMinutes: totalWithNightCreditMinutes,
  };
}
