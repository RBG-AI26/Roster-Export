import { buildRosterAnalysis, formatMinutes } from "./shared/roster-analysis.mjs?v=20260402a";

const APP_VERSION = "2026-04-02b";
const CAPTAIN_PATTERN_ANALYSIS_URLS = {
  SYD: "./data/bp374-captain-night-credit.json?v=20260402a",
  MEL: "./data/bp374-captain-night-credit-mel.json?v=20260402a",
  BNE: "./data/bp374-captain-night-credit-bne.json?v=20260402a",
  PER: "./data/bp374-captain-night-credit-per.json?v=20260402a",
};
const ROSTER_LIBRARY_STORAGE_KEY = "rosterAnalysis.library.v1";
const UI_STATE_STORAGE_KEY = "rosterAnalysis.uiState.v1";

const rosterFilesInput = document.getElementById("rosterFiles");
const loadBtn = document.getElementById("loadBtn");
const clearBtn = document.getElementById("clearBtn");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const statusEl = document.getElementById("status");
const buildVersionEl = document.getElementById("buildVersion");
const rosterLibraryBody = document.getElementById("rosterLibraryBody");
const patternsBody = document.getElementById("patternsBody");
const sectorsBody = document.getElementById("sectorsBody");
const inspectedRosterLabel = document.getElementById("inspectedRosterLabel");
const inspectedPatternLabel = document.getElementById("inspectedPatternLabel");
const otherItemsLabel = document.getElementById("otherItemsLabel");
const otherItemsBody = document.getElementById("otherItemsBody");
const selectedRostersValue = document.getElementById("selectedRostersValue");
const selectedPatternsValue = document.getElementById("selectedPatternsValue");
const baseCreditValue = document.getElementById("baseCreditValue");
const otherCreditValue = document.getElementById("otherCreditValue");
const trainingCreditValue = document.getElementById("trainingCreditValue");
const nightDeltaValue = document.getElementById("nightDeltaValue");
const applicableCreditValue = document.getElementById("applicableCreditValue");
const withNightCreditValue = document.getElementById("withNightCreditValue");
const creditDifferenceValue = document.getElementById("creditDifferenceValue");
const captainBaseAllBtn = document.getElementById("captainBaseAllBtn");
const captainBaseSydBtn = document.getElementById("captainBaseSydBtn");
const captainBaseMelBtn = document.getElementById("captainBaseMelBtn");
const captainBaseBneBtn = document.getElementById("captainBaseBneBtn");
const captainBasePerBtn = document.getElementById("captainBasePerBtn");
const captainPatternSourceLabel = document.getElementById("captainPatternSourceLabel");
const captainPatternStatus = document.getElementById("captainPatternStatus");
const exportCaptainExcelBtn = document.getElementById("exportCaptainExcelBtn");
const exportCaptainPdfBtn = document.getElementById("exportCaptainPdfBtn");
const captainPatternCountValue = document.getElementById("captainPatternCountValue");
const captainFourPilotCountValue = document.getElementById("captainFourPilotCountValue");
const captainPositiveCountValue = document.getElementById("captainPositiveCountValue");
const captainApplicableValue = document.getElementById("captainApplicableValue");
const captainRawDeltaValue = document.getElementById("captainRawDeltaValue");
const captainGovernedDeltaValue = document.getElementById("captainGovernedDeltaValue");
const captainWithNightValue = document.getElementById("captainWithNightValue");
const captainPercentValue = document.getElementById("captainPercentValue");
const captainAllBasesPercentValue = document.getElementById("captainAllBasesPercentValue");
const captainPatternsBody = document.getElementById("captainPatternsBody");
const captainSortBase = document.getElementById("captainSortBase");
const captainSortPattern = document.getElementById("captainSortPattern");
const captainSortWeeks = document.getElementById("captainSortWeeks");
const captainSortOccurrences = document.getElementById("captainSortOccurrences");
const captainSortRoute = document.getElementById("captainSortRoute");
const captainSortCrew = document.getElementById("captainSortCrew");
const captainSortDays = document.getElementById("captainSortDays");
const captainSortApplicable = document.getElementById("captainSortApplicable");
const captainSortFlight = document.getElementById("captainSortFlight");
const captainSortNight = document.getElementById("captainSortNight");
const captainSortRawDelta = document.getElementById("captainSortRawDelta");
const captainSortGovernedDelta = document.getElementById("captainSortGovernedDelta");
const captainSortWithNight = document.getElementById("captainSortWithNight");
const captainSortPercent = document.getElementById("captainSortPercent");
const captainBaseButtons = {
  ALL: captainBaseAllBtn,
  SYD: captainBaseSydBtn,
  MEL: captainBaseMelBtn,
  BNE: captainBaseBneBtn,
  PER: captainBasePerBtn,
};

const state = {
  rosters: [],
  selectedRosterIds: new Set(),
  inspectedRosterId: "",
  inspectedPatternId: "",
  captainPatternBase: "SYD",
  captainPatternAnalysis: null,
  captainPatternAnalysisError: "",
  captainPatternAnalyses: Object.fromEntries(Object.keys(CAPTAIN_PATTERN_ANALYSIS_URLS).map((base) => [base, null])),
  captainPatternAnalysisErrors: Object.fromEntries(Object.keys(CAPTAIN_PATTERN_ANALYSIS_URLS).map((base) => [base, ""])),
  captainPatternSortKey: "governedNightDeltaMinutes",
  captainPatternSortDirection: "desc",
};

if (buildVersionEl) {
  buildVersionEl.textContent = `Build ${APP_VERSION}`;
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }

  return `${numeric.toFixed(1)}%`;
}

function getCaptainCrewLabel(pattern) {
  return pattern?.hasFourPilot ? "4 pilot" : "2/3 pilot";
}

function setCaptainPatternStatus(message) {
  if (captainPatternStatus) {
    captainPatternStatus.textContent = message;
    captainPatternStatus.hidden = !message;
  }
}

function getAllBasesWeightedCaptainPercent() {
  const analyses = Object.values(state.captainPatternAnalyses).filter(Boolean);
  const totals = analyses.reduce(
    (accumulator, analysis) => {
      accumulator.applicableMinutes += Number(analysis?.summary?.applicableMinutes) || 0;
      accumulator.governedNightDeltaMinutes += Number(analysis?.summary?.governedNightDeltaMinutes) || 0;
      return accumulator;
    },
    { applicableMinutes: 0, governedNightDeltaMinutes: 0 }
  );

  if (totals.applicableMinutes <= 0) {
    return 0;
  }

  return (totals.governedNightDeltaMinutes / totals.applicableMinutes) * 100;
}

function syncCaptainPatternAnalysisSelection() {
  if (state.captainPatternBase === "ALL") {
    state.captainPatternAnalysis = buildCombinedCaptainPatternAnalysis();
    state.captainPatternAnalysisError = state.captainPatternAnalysis ? "" : "All-bases captain pattern comparison is still loading.";
    return;
  }

  state.captainPatternAnalysis = state.captainPatternAnalyses[state.captainPatternBase] || null;
  state.captainPatternAnalysisError = state.captainPatternAnalysisErrors[state.captainPatternBase] || "";
}

function setCaptainPatternBase(base, shouldRender = true) {
  if (!captainBaseButtons[base]) {
    return;
  }

  state.captainPatternBase = base;
  syncCaptainPatternAnalysisSelection();
  saveUiState();
  if (shouldRender) {
    renderCaptainPatternAnalysis();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getProjectedHoursMinutes(analysis) {
  const projectedMinutes = Number(analysis?.projectedMinutes);
  if (Number.isFinite(projectedMinutes) && projectedMinutes > 0) {
    return projectedMinutes;
  }

  return Number(analysis?.totalApplicableCreditMinutes) || 0;
}

function getRosterNightDeltaMinutes(roster) {
  return Number(roster?.analysis?.totalFourPilotNightDeltaMinutes) || 0;
}

function getRosterTrainingMinutes(roster) {
  return Number(roster?.analysis?.totalTrainingCreditMinutes) || 0;
}

function getRosterWorkedDays(roster) {
  return Number(roster?.analysis?.totalWorkedDayCount) || 0;
}

function getRosterLeaveDays(roster) {
  return Number(roster?.analysis?.totalLeaveDayCount) || 0;
}

function getRosterPaxSectorCount(roster) {
  return Number(roster?.analysis?.totalPaxSectorCount) || 0;
}

function getRosterRouteCheckSectorCount(roster) {
  return Number(roster?.analysis?.totalRouteCheckSectorCount) || 0;
}

function getRosterProjectedWithNightMinutes(roster) {
  return getProjectedHoursMinutes(roster?.analysis) + getRosterNightDeltaMinutes(roster);
}

function getRosterNightDifferencePercent(roster) {
  const projectedMinutes = getProjectedHoursMinutes(roster?.analysis);
  if (projectedMinutes <= 0) {
    return 0;
  }

  return (getRosterNightDeltaMinutes(roster) / projectedMinutes) * 100;
}

function getLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function getBidPeriodSortValue(roster) {
  const bidPeriod = String(roster?.analysis?.parsedRoster?.bidPeriod || "").trim();
  const numeric = Number(bidPeriod);
  return Number.isFinite(numeric) ? numeric : -1;
}

function compareRosterEntries(left, right) {
  const bidDiff = getBidPeriodSortValue(right) - getBidPeriodSortValue(left);
  if (bidDiff !== 0) {
    return bidDiff;
  }

  const storedAtLeft = Date.parse(left?.storedAtUtc || "") || 0;
  const storedAtRight = Date.parse(right?.storedAtUtc || "") || 0;
  if (storedAtRight !== storedAtLeft) {
    return storedAtRight - storedAtLeft;
  }

  return String(left?.fileName || "").localeCompare(String(right?.fileName || ""), undefined, { numeric: true });
}

function sortRosterLibrary(rosters) {
  return [...rosters].sort(compareRosterEntries);
}

function getRostersGroupedByBidPeriod() {
  const groups = [];
  const byBidPeriod = new Map();

  for (const roster of state.rosters) {
    const bidPeriod = String(roster.analysis.parsedRoster.bidPeriod || "Unknown").trim() || "Unknown";
    if (!byBidPeriod.has(bidPeriod)) {
      byBidPeriod.set(bidPeriod, []);
    }
    byBidPeriod.get(bidPeriod).push(roster);
  }

  for (const [bidPeriod, rosters] of byBidPeriod.entries()) {
    groups.push({
      bidPeriod,
      rosters: sortRosterLibrary(rosters),
    });
  }

  groups.sort((left, right) => {
    const numericLeft = Number(left.bidPeriod);
    const numericRight = Number(right.bidPeriod);
    const leftSortable = Number.isFinite(numericLeft);
    const rightSortable = Number.isFinite(numericRight);
    if (leftSortable && rightSortable) {
      return numericRight - numericLeft;
    }
    if (leftSortable) {
      return -1;
    }
    if (rightSortable) {
      return 1;
    }
    return left.bidPeriod.localeCompare(right.bidPeriod, undefined, { numeric: true });
  });

  return groups;
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function serialiseLibrary() {
  return state.rosters.map((roster) => ({
    id: roster.id,
    fileName: roster.fileName,
    text: roster.text,
    storedAtUtc: roster.storedAtUtc || "",
  }));
}

function saveLibrary() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(ROSTER_LIBRARY_STORAGE_KEY, JSON.stringify(serialiseLibrary()));
  } catch (error) {
    console.error("Could not save roster library", error);
    setStatus("Roster library could not be fully saved on this device.");
  }
}

function saveUiState() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      UI_STATE_STORAGE_KEY,
      JSON.stringify({
        selectedRosterIds: [...state.selectedRosterIds],
        inspectedRosterId: state.inspectedRosterId,
        inspectedPatternId: state.inspectedPatternId,
        captainPatternBase: state.captainPatternBase,
      })
    );
  } catch {
    // Ignore UI-state storage failures.
  }
}

function rebuildRosterEntry(rawEntry) {
  const text = String(rawEntry?.text || "");
  const fileName = String(rawEntry?.fileName || "Saved roster").trim() || "Saved roster";
  if (!text.trim()) {
    return null;
  }

  const analysis = buildRosterAnalysis(text, fileName);
  return {
    id: String(rawEntry?.id || `${analysis.parsedRoster.staffNumber || "unknown"}-${analysis.parsedRoster.bidPeriod || "bp"}-${hashText(text)}`),
    fileName,
    text,
    storedAtUtc: String(rawEntry?.storedAtUtc || "").trim(),
    analysis,
  };
}

function loadPersistedState() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const rawLibrary = storage.getItem(ROSTER_LIBRARY_STORAGE_KEY);
    const parsedLibrary = rawLibrary ? JSON.parse(rawLibrary) : [];
    const rebuilt = Array.isArray(parsedLibrary) ? parsedLibrary.map(rebuildRosterEntry).filter(Boolean) : [];
    state.rosters = sortRosterLibrary(rebuilt);
  } catch (error) {
    console.error("Could not restore saved roster library", error);
    state.rosters = [];
  }

  try {
    const rawUiState = storage.getItem(UI_STATE_STORAGE_KEY);
    const parsedUiState = rawUiState ? JSON.parse(rawUiState) : {};
    const validIds = new Set(state.rosters.map((roster) => roster.id));
    const selectedIds = Array.isArray(parsedUiState.selectedRosterIds)
      ? parsedUiState.selectedRosterIds.filter((id) => validIds.has(id))
      : [];

    state.selectedRosterIds = new Set(selectedIds.length ? selectedIds : state.rosters.map((roster) => roster.id));
    state.inspectedRosterId = validIds.has(parsedUiState.inspectedRosterId)
      ? parsedUiState.inspectedRosterId
      : [...state.selectedRosterIds][0] || state.rosters[0]?.id || "";

    const inspectedRoster = getRosterById(state.inspectedRosterId);
    const validPatternIds = new Set((inspectedRoster?.analysis.patterns || []).map((pattern) => pattern.id));
    state.inspectedPatternId = validPatternIds.has(parsedUiState.inspectedPatternId)
      ? parsedUiState.inspectedPatternId
      : inspectedRoster?.analysis.patterns[0]?.id || "";
    state.captainPatternBase = captainBaseButtons[parsedUiState.captainPatternBase] ? parsedUiState.captainPatternBase : "SYD";

  } catch (error) {
    console.error("Could not restore analysis UI state", error);
    state.selectedRosterIds = new Set(state.rosters.map((roster) => roster.id));
    state.inspectedRosterId = state.rosters[0]?.id || "";
    state.inspectedPatternId = state.rosters[0]?.analysis.patterns[0]?.id || "";
    state.captainPatternBase = "SYD";
  }
}

function getRosterById(rosterId) {
  return state.rosters.find((roster) => roster.id === rosterId) || null;
}

function getInspectedRoster() {
  return getRosterById(state.inspectedRosterId);
}

function getInspectedPattern() {
  const roster = getInspectedRoster();
  if (!roster) {
    return null;
  }

  return roster.analysis.patterns.find((pattern) => pattern.id === state.inspectedPatternId) || null;
}

function getSelectedRosters() {
  return state.rosters.filter((roster) => state.selectedRosterIds.has(roster.id));
}

function syncInspectionState() {
  const inspectedRosterStillExists = state.rosters.some((roster) => roster.id === state.inspectedRosterId);
  if (!inspectedRosterStillExists) {
    const firstSelected = getSelectedRosters()[0] || state.rosters[0] || null;
    state.inspectedRosterId = firstSelected?.id || "";
  }

  const inspectedRoster = getInspectedRoster();
  const validPatternIds = new Set((inspectedRoster?.analysis.patterns || []).map((pattern) => pattern.id));
  if (!validPatternIds.has(state.inspectedPatternId)) {
    state.inspectedPatternId = inspectedRoster?.analysis.patterns[0]?.id || "";
  }
}

function getSelectedTotals() {
  const selected = getSelectedRosters();
  const baseMinutes = selected.reduce(
    (total, roster) => total + (Number(roster.analysis.totalBaseApplicableCreditMinutes) || 0),
    0
  );
  const otherMinutes = selected.reduce(
    (total, roster) =>
      total +
      (Number(roster.analysis.totalOtherCreditedDutyMinutes) || 0),
    0
  );
  const trainingMinutes = selected.reduce(
    (total, roster) => total + (Number(roster.analysis.totalTrainingCreditMinutes) || 0),
    0
  );
  const patternCount = selected.reduce((total, roster) => total + roster.analysis.patterns.length, 0);
  const projectedMinutes = selected.reduce(
    (total, roster) => total + getProjectedHoursMinutes(roster.analysis),
    0
  );
  const deltaMinutes = selected.reduce(
    (total, roster) => total + (Number(roster.analysis.totalFourPilotNightDeltaMinutes) || 0),
    0
  );
  const withNightMinutes = projectedMinutes + deltaMinutes;
  const percentDifference = projectedMinutes > 0 ? (deltaMinutes / projectedMinutes) * 100 : 0;

  return {
    selectedRosterCount: selected.length,
    patternCount,
    baseMinutes,
    otherMinutes,
    trainingMinutes,
    deltaMinutes,
    projectedMinutes,
    withNightMinutes,
    percentDifference,
  };
}

function getCaptainSortButtonMeta() {
  return [
    [captainSortBase, "base", "Base"],
    [captainSortPattern, "patternCode", "Pattern"],
    [captainSortWeeks, "weeksDisplay", "Weeks"],
    [captainSortOccurrences, "instanceCount", "Occurrences"],
    [captainSortRoute, "routeCode", "Route"],
    [captainSortCrew, "crew", "Crew"],
    [captainSortDays, "daysAway", "Days Away"],
    [captainSortApplicable, "applicableMinutes", "Applicable Credit"],
    [captainSortFlight, "flightMinutes", "Flight Total"],
    [captainSortNight, "nightMinutes", "Night Total"],
    [captainSortRawDelta, "rawNightDeltaMinutes", "Raw Night Credit Δ"],
    [captainSortGovernedDelta, "governedNightDeltaMinutes", "Effective Δ in Credit"],
    [captainSortWithNight, "governedWithNightMinutes", "With Proposed NC"],
    [captainSortPercent, "governedPercentDifference", "% Difference"],
  ];
}

function getCaptainPatternSortValue(pattern, sortKey) {
  if (!pattern) {
    return "";
  }

  switch (sortKey) {
    case "base":
      return String(pattern.base || "");
    case "crew":
      return pattern.hasFourPilot ? 1 : 0;
    case "patternCode":
    case "weeksDisplay":
    case "routeCode":
      return String(pattern[sortKey] || "");
    default:
      return Number(pattern[sortKey]) || 0;
  }
}

function compareCaptainPatterns(left, right) {
  const sortKey = state.captainPatternSortKey;
  const direction = state.captainPatternSortDirection === "asc" ? 1 : -1;
  const leftValue = getCaptainPatternSortValue(left, sortKey);
  const rightValue = getCaptainPatternSortValue(right, sortKey);

  if (typeof leftValue === "string" || typeof rightValue === "string") {
    const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
    if (comparison !== 0) {
      return comparison * direction;
    }
  } else if (leftValue !== rightValue) {
    return (leftValue - rightValue) * direction;
  }

  return String(left?.patternCode || "").localeCompare(String(right?.patternCode || ""), undefined, { numeric: true });
}

function getSortedCaptainPatterns() {
  return [...(state.captainPatternAnalysis?.patterns || [])].sort(compareCaptainPatterns);
}

function buildCombinedCaptainPatternAnalysis() {
  const analyses = Object.values(state.captainPatternAnalyses).filter(Boolean);
  if (!analyses.length) {
    return null;
  }

  const summary = analyses.reduce(
    (totals, analysis) => {
      const current = analysis.summary || {};
      totals.patternCodeCount += Number(current.patternCodeCount) || 0;
      totals.patternCount += Number(current.patternCount) || 0;
      totals.estimatedFourPilotPatternCount += Number(current.estimatedFourPilotPatternCount) || 0;
      totals.positiveGovernedPatternCount += Number(current.positiveGovernedPatternCount) || 0;
      totals.zeroedByMinimumCreditCount += Number(current.zeroedByMinimumCreditCount) || 0;
      totals.reducedByMinimumCreditCount += Number(current.reducedByMinimumCreditCount) || 0;
      totals.applicableMinutes += Number(current.applicableMinutes) || 0;
      totals.rawNightDeltaMinutes += Number(current.rawNightDeltaMinutes) || 0;
      totals.governedNightDeltaMinutes += Number(current.governedNightDeltaMinutes) || 0;
      totals.governedWithNightMinutes += Number(current.governedWithNightMinutes) || 0;
      return totals;
    },
    {
      patternCodeCount: 0,
      patternCount: 0,
      estimatedFourPilotPatternCount: 0,
      positiveGovernedPatternCount: 0,
      zeroedByMinimumCreditCount: 0,
      reducedByMinimumCreditCount: 0,
      applicableMinutes: 0,
      rawNightDeltaMinutes: 0,
      governedNightDeltaMinutes: 0,
      governedWithNightMinutes: 0,
      governedPercentDifference: 0,
    }
  );

  summary.governedPercentDifference =
    summary.applicableMinutes > 0 ? (summary.governedNightDeltaMinutes / summary.applicableMinutes) * 100 : 0;

  return {
    generatedAtUtc: new Date().toISOString(),
    bidPeriod: analyses[0].bidPeriod || "374",
    base: "ALL",
    aircraftType: analyses[0].aircraftType || "B787",
    summary,
    patterns: analyses.flatMap((analysis) => analysis.patterns || []),
  };
}

function exportCaptainPatternPdf() {
  const analysis = state.captainPatternAnalysis;
  if (!analysis) {
    setCaptainPatternStatus(`${state.captainPatternBase} captain pattern comparison is still loading, so there is nothing to export yet.`);
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    setCaptainPatternStatus("The PDF export window was blocked. Allow pop-ups for this page and try again.");
    return;
  }

  const summary = analysis.summary || {};
  const patterns = getSortedCaptainPatterns();
  const summaryCards = [
    ["Flown Patterns", String(summary.patternCount || 0)],
    ["4 pilot Flown", String(summary.estimatedFourPilotPatternCount || 0)],
    ["Positive Governed Uplift", String(summary.positiveGovernedPatternCount || 0)],
    ["Applicable Credit", formatMinutes(summary.applicableMinutes)],
    ["Raw Night Credit Δ", formatMinutes(summary.rawNightDeltaMinutes)],
    ["Effective Δ in Credit", formatMinutes(summary.governedNightDeltaMinutes)],
    ["With Proposed NC", formatMinutes(summary.governedWithNightMinutes)],
    ["% Difference", formatPercent(summary.governedPercentDifference) || "0.0%"],
  ]
    .map(
      ([label, value]) => `
        <div class="stat">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </div>`
    )
    .join("");

  const rows = patterns
    .map(
      (pattern) => `
        <tr class="${pattern.hasFourPilot ? "four-pilot" : ""}">
          <td>${escapeHtml(pattern.base || analysis.base)}</td>
          <td>${escapeHtml(pattern.patternCode)}</td>
          <td>${escapeHtml(pattern.weeksDisplay)}</td>
          <td>${escapeHtml(String(pattern.instanceCount || 1))}</td>
          <td>${escapeHtml(pattern.routeCode || "—")}</td>
          <td>${escapeHtml(getCaptainCrewLabel(pattern))}</td>
          <td>${escapeHtml(String(pattern.daysAway ?? ""))}</td>
          <td>${escapeHtml(formatMinutes(pattern.applicableMinutes))}</td>
          <td>${escapeHtml(formatMinutes(pattern.flightMinutes))}</td>
          <td>${escapeHtml(formatMinutes(pattern.nightMinutes))}</td>
          <td>${escapeHtml(formatMinutes(pattern.rawNightDeltaMinutes))}</td>
          <td>${escapeHtml(formatMinutes(pattern.governedNightDeltaMinutes))}</td>
          <td>${escapeHtml(formatMinutes(pattern.governedWithNightMinutes))}</td>
          <td>${escapeHtml(formatPercent(pattern.governedPercentDifference) || "0.0%")}</td>
        </tr>`
    )
    .join("");

  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>BP${escapeHtml(analysis.bidPeriod)} Captain Pattern Night Credit</title>
      <style>
        :root {
          --border: #cad7cf;
          --text: #1f2420;
          --muted: #4e5b51;
          --highlight: #fff7e8;
        }
        * { box-sizing: border-box; }
        body {
          margin: 24px;
          color: var(--text);
          font-family: "Avenir Next", "Segoe UI", sans-serif;
        }
        h1 {
          margin: 0 0 8px;
          font-family: "Gill Sans", "Avenir Next", sans-serif;
          letter-spacing: 0.02em;
        }
        p {
          margin: 0 0 12px;
          color: var(--muted);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin: 18px 0;
        }
        .stat {
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          background: #f7fbf8;
        }
        .label {
          color: var(--muted);
          font-size: 13px;
          margin-bottom: 6px;
        }
        .value {
          font-size: 28px;
          font-weight: 700;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        th, td {
          border-bottom: 1px solid var(--border);
          padding: 7px 6px;
          text-align: center;
          white-space: nowrap;
        }
        th:nth-child(1), th:nth-child(2), th:nth-child(3), th:nth-child(4),
        td:nth-child(1), td:nth-child(2), td:nth-child(3), td:nth-child(4) {
          text-align: left;
        }
        th {
          color: var(--muted);
          font-size: 11px;
        }
        .four-pilot td {
          background: var(--highlight);
        }
        @media print {
          body { margin: 12mm; }
          tr { break-inside: avoid; }
        }
      </style>
      <script>
        window.addEventListener("load", () => {
          setTimeout(() => {
            window.focus();
            window.print();
          }, 250);
        });
        window.addEventListener("afterprint", () => {
          setTimeout(() => window.close(), 150);
        });
      </script>
    </head>
    <body>
      <h1>BP${escapeHtml(analysis.bidPeriod)} Captain Pattern Night Credit</h1>
      <p>
        ${escapeHtml(analysis.base)} ${escapeHtml(analysis.aircraftType)} captain pattern review.
      </p>
      <div class="grid">${summaryCards}</div>
      <table>
        <thead>
          <tr>
            <th>Base</th>
            <th>Pattern</th>
            <th>Weeks</th>
            <th>Occurrences</th>
            <th>Route</th>
            <th>Crew</th>
            <th>Days Away</th>
            <th>Applicable Credit</th>
            <th>Flight Total</th>
            <th>Night Total</th>
            <th>Raw Night Credit Δ</th>
            <th>Effective Δ in Credit</th>
            <th>With Proposed NC</th>
            <th>% Difference</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
  </html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  setCaptainPatternStatus(`Print view opened for the BP${analysis.bidPeriod} ${analysis.base} captain pattern analysis. Use Save as PDF in the browser print dialog.`);
  setTimeout(() => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      // Allow the inline print script in the new window to handle it.
    }
  }, 450);
}

function downloadTextFile(fileName, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function exportCaptainPatternExcel() {
  const analysis = state.captainPatternAnalysis;
  if (!analysis) {
    setCaptainPatternStatus(`${state.captainPatternBase} captain pattern comparison is still loading, so there is nothing to export yet.`);
    return;
  }

  const summary = analysis.summary || {};
  const patterns = getSortedCaptainPatterns();
  const rows = [
    ["BP374 Captain Pattern Night Credit"],
    [`Base`, analysis.base, `Aircraft`, analysis.aircraftType],
    [],
    ["Summary"],
    ["Flown Patterns", summary.patternCount || 0],
    ["Pattern Codes", summary.patternCodeCount || patterns.length],
    ["4 pilot Flown", summary.estimatedFourPilotPatternCount || 0],
    ["Positive Governed Uplift", summary.positiveGovernedPatternCount || 0],
    ["Applicable Credit", formatMinutes(summary.applicableMinutes)],
    ["Raw Night Credit Δ", formatMinutes(summary.rawNightDeltaMinutes)],
    ["Effective Δ in Credit", formatMinutes(summary.governedNightDeltaMinutes)],
    ["With Proposed NC", formatMinutes(summary.governedWithNightMinutes)],
    ["% Difference", formatPercent(summary.governedPercentDifference) || "0.0%"],
    [],
    [
      "Base",
      "Pattern",
      "Weeks",
      "Occurrences",
      "Route",
      "Crew",
      "Days Away",
      "Applicable Credit",
      "Flight Total",
      "Night Total",
      "Raw Night Credit Δ",
      "Effective Δ in Credit",
      "With Proposed NC",
      "% Difference",
    ],
    ...patterns.map((pattern) => [
      pattern.base,
      pattern.patternCode,
      pattern.weeksDisplay,
      pattern.instanceCount || 1,
      pattern.routeCode || "—",
      getCaptainCrewLabel(pattern),
      pattern.daysAway == null ? "" : String(pattern.daysAway),
      formatMinutes(pattern.applicableMinutes),
      formatMinutes(pattern.flightMinutes),
      formatMinutes(pattern.nightMinutes),
      formatMinutes(pattern.rawNightDeltaMinutes),
      formatMinutes(pattern.governedNightDeltaMinutes),
      formatMinutes(pattern.governedWithNightMinutes),
      formatPercent(pattern.governedPercentDifference) || "0.0%",
    ]),
  ];

  const csv = `\ufeff${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
  const fileName = `BP${analysis.bidPeriod}-${analysis.base}-captain-pattern-night-credit.csv`;
  downloadTextFile(fileName, csv, "text/csv;charset=utf-8");
  setCaptainPatternStatus(`Excel export downloaded for BP${analysis.bidPeriod} ${analysis.base}. Open the CSV in Excel to review the pattern table, including occurrences.`);
}

function renderCaptainPatternAnalysis() {
  if (!captainPatternsBody) {
    return;
  }

  for (const [base, button] of Object.entries(captainBaseButtons)) {
    button?.classList.toggle("is-active", state.captainPatternBase === base);
  }
  captainPatternsBody.innerHTML = "";

  const analysis = state.captainPatternAnalysis;
  if (!analysis) {
    if (exportCaptainExcelBtn) {
      exportCaptainExcelBtn.disabled = true;
    }
    if (exportCaptainPdfBtn) {
      exportCaptainPdfBtn.disabled = true;
    }
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 14;
    cell.textContent = state.captainPatternAnalysisError || `Loading BP374 ${state.captainPatternBase} captain pattern comparison.`;
    row.appendChild(cell);
    captainPatternsBody.appendChild(row);
    if (captainPatternSourceLabel) {
      captainPatternSourceLabel.textContent = `BP374 | ${state.captainPatternBase} B787`;
    }
    setCaptainPatternStatus("");
    return;
  }

  const { summary, patterns = [] } = analysis;
  if (exportCaptainExcelBtn) {
    exportCaptainExcelBtn.disabled = false;
  }
  if (exportCaptainPdfBtn) {
    exportCaptainPdfBtn.disabled = false;
  }
  if (captainPatternSourceLabel) {
    captainPatternSourceLabel.textContent = `BP${analysis.bidPeriod} | ${analysis.base} ${analysis.aircraftType} | ${patterns.length} pattern codes | ${summary.patternCount} flown patterns | ${summary.estimatedFourPilotPatternCount} estimated 4 pilot`;
  }
  setCaptainPatternStatus("");

  captainPatternCountValue.textContent = String(summary.patternCount || 0);
  captainFourPilotCountValue.textContent = String(summary.estimatedFourPilotPatternCount || 0);
  captainPositiveCountValue.textContent = String(summary.positiveGovernedPatternCount || 0);
  captainApplicableValue.textContent = formatMinutes(summary.applicableMinutes);
  captainRawDeltaValue.textContent = formatMinutes(summary.rawNightDeltaMinutes);
  captainGovernedDeltaValue.textContent = formatMinutes(summary.governedNightDeltaMinutes);
  captainWithNightValue.textContent = formatMinutes(summary.governedWithNightMinutes);
  captainPercentValue.textContent = formatPercent(summary.governedPercentDifference) || "0.0%";
  if (captainAllBasesPercentValue) {
    captainAllBasesPercentValue.textContent = formatPercent(getAllBasesWeightedCaptainPercent()) || "0.0%";
  }

  for (const [button, sortKey, label] of getCaptainSortButtonMeta()) {
    if (!button) {
      continue;
    }
    const isActive = state.captainPatternSortKey === sortKey;
    const arrow = !isActive ? "" : state.captainPatternSortDirection === "asc" ? " ↑" : " ↓";
    button.textContent = `${label}${arrow}`;
  }

  const sortedPatterns = getSortedCaptainPatterns();
  for (const pattern of sortedPatterns) {
    const row = document.createElement("tr");
    if (pattern.hasFourPilot) {
      row.classList.add("comparison-row");
    }

    const values = [
      pattern.base || analysis.base,
      pattern.patternCode,
      pattern.weeksDisplay,
      pattern.instanceCount == null ? "1" : String(pattern.instanceCount),
      pattern.routeCode || "—",
      getCaptainCrewLabel(pattern),
      pattern.daysAway == null ? "" : String(pattern.daysAway),
      formatMinutes(pattern.applicableMinutes),
      formatMinutes(pattern.flightMinutes),
      formatMinutes(pattern.nightMinutes),
      formatMinutes(pattern.rawNightDeltaMinutes),
      formatMinutes(pattern.governedNightDeltaMinutes),
      formatMinutes(pattern.governedWithNightMinutes),
      formatPercent(pattern.governedPercentDifference) || "0.0%",
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    captainPatternsBody.appendChild(row);
  }
}

async function loadCaptainPatternAnalysis() {
  for (const base of Object.keys(CAPTAIN_PATTERN_ANALYSIS_URLS)) {
    try {
      state.captainPatternAnalysisErrors[base] = "";
      const response = await fetch(CAPTAIN_PATTERN_ANALYSIS_URLS[base], { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`${base} captain pattern data could not be loaded (${response.status}).`);
      }
      state.captainPatternAnalyses[base] = await response.json();
    } catch (error) {
      console.error(`Could not load ${base} captain pattern analysis`, error);
      state.captainPatternAnalyses[base] = null;
      state.captainPatternAnalysisErrors[base] = error?.message || `${base} captain pattern comparison could not be loaded.`;
    }
  }

  syncCaptainPatternAnalysisSelection();
  renderCaptainPatternAnalysis();
}

function renderSummary() {
  const totals = getSelectedTotals();
  selectedRostersValue.textContent = String(totals.selectedRosterCount);
  selectedPatternsValue.textContent = String(totals.patternCount);
  baseCreditValue.textContent = formatMinutes(totals.baseMinutes);
  otherCreditValue.textContent = formatMinutes(totals.otherMinutes);
  trainingCreditValue.textContent = formatMinutes(totals.trainingMinutes);
  nightDeltaValue.textContent = formatMinutes(totals.deltaMinutes);
  applicableCreditValue.textContent = formatMinutes(totals.projectedMinutes);
  withNightCreditValue.textContent = formatMinutes(totals.withNightMinutes);
  creditDifferenceValue.textContent = formatPercent(totals.percentDifference) || "0.0%";
}

function makeActionButton(label, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) {
    button.className = className;
  }
  button.addEventListener("click", onClick);
  return button;
}

function removeRoster(rosterId) {
  const roster = getRosterById(rosterId);
  if (!roster) {
    return;
  }

  state.rosters = state.rosters.filter((entry) => entry.id !== rosterId);
  state.selectedRosterIds.delete(rosterId);
  syncInspectionState();
  saveLibrary();
  renderAll();
  setStatus(
    `Removed BP${roster.analysis.parsedRoster.bidPeriod || "Unknown"} roster from the stored library. ${state.rosters.length} roster${state.rosters.length === 1 ? "" : "s"} remain.`
  );
}

function renderRosterLibrary() {
  rosterLibraryBody.innerHTML = "";

  if (!state.rosters.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 15;
    cell.textContent = "No rosters loaded yet.";
    row.appendChild(cell);
    rosterLibraryBody.appendChild(row);
    renderSummary();
    return;
  }

  for (const group of getRostersGroupedByBidPeriod()) {
    const groupRow = document.createElement("tr");
    groupRow.classList.add("group-row");
    const groupCell = document.createElement("td");
    groupCell.colSpan = 15;
    groupCell.textContent = `BP${group.bidPeriod}`;
    groupRow.appendChild(groupCell);
    rosterLibraryBody.appendChild(groupRow);

    for (const roster of group.rosters) {
      const row = document.createElement("tr");
      if (roster.id === state.inspectedRosterId) {
        row.classList.add("selected-row");
      }

      const selectCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedRosterIds.has(roster.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.selectedRosterIds.add(roster.id);
        } else {
          state.selectedRosterIds.delete(roster.id);
        }

        if (!state.selectedRosterIds.has(state.inspectedRosterId)) {
          const firstSelected = getSelectedRosters()[0] || null;
          state.inspectedRosterId = firstSelected?.id || "";
          state.inspectedPatternId = firstSelected?.analysis.patterns[0]?.id || "";
        }

        renderAll();
      });
      selectCell.appendChild(checkbox);
      row.appendChild(selectCell);

      const inspectCell = document.createElement("td");
      inspectCell.appendChild(
        makeActionButton("Inspect", () => {
          state.inspectedRosterId = roster.id;
          state.inspectedPatternId = roster.analysis.patterns[0]?.id || "";
          renderAll();
        }, "compact-action-btn")
      );
      row.appendChild(inspectCell);

      const removeCell = document.createElement("td");
      removeCell.appendChild(
        makeActionButton("Remove", () => {
          removeRoster(roster.id);
        }, "compact-action-btn")
      );
      row.appendChild(removeCell);

      const values = [
        roster.analysis.parsedRoster.bidPeriod || "",
        String(getRosterWorkedDays(roster)),
        String(getRosterLeaveDays(roster)),
        String(getRosterPaxSectorCount(roster)),
        String(getRosterRouteCheckSectorCount(roster)),
        formatMinutes(roster.analysis.totalBaseApplicableCreditMinutes),
        formatMinutes(Number(roster.analysis.totalOtherCreditedDutyMinutes) || 0),
        formatMinutes(getRosterTrainingMinutes(roster)),
        formatMinutes(getProjectedHoursMinutes(roster.analysis)),
        formatMinutes(getRosterNightDeltaMinutes(roster)),
        formatMinutes(getRosterProjectedWithNightMinutes(roster)),
        formatPercent(getRosterNightDifferencePercent(roster)) || "0.0%",
      ];

      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }

      rosterLibraryBody.appendChild(row);
    }
  }

  const selectedRosters = getSelectedRosters();
  if (selectedRosters.length) {
    const totals = getSelectedTotals();
    const averageRow = document.createElement("tr");
    averageRow.classList.add("average-row");

    const labelCell = document.createElement("td");
    labelCell.colSpan = 4;
    labelCell.textContent = `Selected Average (${selectedRosters.length})`;
    averageRow.appendChild(labelCell);

    const averageWorkedDays = selectedRosters.reduce((total, roster) => total + getRosterWorkedDays(roster), 0) / selectedRosters.length;
    const averageLeaveDays = selectedRosters.reduce((total, roster) => total + getRosterLeaveDays(roster), 0) / selectedRosters.length;
    const averagePaxSectors =
      selectedRosters.reduce((total, roster) => total + getRosterPaxSectorCount(roster), 0) / selectedRosters.length;
    const averageRouteChecks =
      selectedRosters.reduce((total, roster) => total + getRosterRouteCheckSectorCount(roster), 0) / selectedRosters.length;
    const averageProjectedMinutes = totals.projectedMinutes / selectedRosters.length;
    const averageDeltaMinutes = totals.deltaMinutes / selectedRosters.length;
    const averageWithNightMinutes = totals.withNightMinutes / selectedRosters.length;
    const averagePercent = totals.percentDifference;

    for (const value of [
      averageWorkedDays.toFixed(1),
      averageLeaveDays.toFixed(1),
      averagePaxSectors.toFixed(1),
      averageRouteChecks.toFixed(1),
      "",
      "",
      "",
      formatMinutes(averageProjectedMinutes),
      formatMinutes(averageDeltaMinutes),
      formatMinutes(averageWithNightMinutes),
      formatPercent(averagePercent) || "0.0%",
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      averageRow.appendChild(cell);
    }

    rosterLibraryBody.appendChild(averageRow);
  }

  renderSummary();
}

function renderPatterns() {
  patternsBody.innerHTML = "";

  const roster = getInspectedRoster();
  if (!roster) {
    inspectedRosterLabel.textContent = "Inspect a loaded roster to see its patterns.";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = "No roster selected for inspection.";
    row.appendChild(cell);
    patternsBody.appendChild(row);
    return;
  }

  inspectedRosterLabel.textContent = `${roster.analysis.fileName || roster.fileName} | BP${roster.analysis.parsedRoster.bidPeriod} | Divisor ${formatMinutes(roster.analysis.divisorMinutes)}`;

  if (!roster.analysis.patterns.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = "No pattern rows were identified in this roster.";
    row.appendChild(cell);
    patternsBody.appendChild(row);
    return;
  }

  for (const pattern of roster.analysis.patterns) {
    const row = document.createElement("tr");
    row.classList.toggle("selected-row", pattern.id === state.inspectedPatternId);
    row.addEventListener("click", () => {
      state.inspectedPatternId = pattern.id;
      renderSectors();
      renderPatterns();
    });

    const values = [
      pattern.patternCode,
      `${pattern.tripStartIso} to ${pattern.tripEndIso}`,
      pattern.daysAway == null ? "" : String(pattern.daysAway),
      formatMinutes(pattern.baseApplicableCreditMinutes),
      formatMinutes(pattern.minimumPatternCreditMinutes),
      formatMinutes(pattern.fourPilotNightDeltaMinutes),
      formatMinutes(pattern.baseApplicableCreditMinutes),
      formatMinutes(pattern.withNightCreditMinutes),
      formatPercent(pattern.nightCreditDifferencePercent) || "0.0%",
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    patternsBody.appendChild(row);
  }
}

function renderSectors() {
  sectorsBody.innerHTML = "";

  const pattern = getInspectedPattern();
  if (!pattern) {
    inspectedPatternLabel.textContent = "Select a pattern row to inspect its sectors.";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No pattern selected yet.";
    row.appendChild(cell);
    sectorsBody.appendChild(row);
    return;
  }

  inspectedPatternLabel.textContent = `${pattern.patternCode} | ${pattern.tripStartIso} to ${pattern.tripEndIso} | Base ${formatMinutes(
    pattern.baseApplicableCreditMinutes
  )} | With Night ${formatMinutes(pattern.withNightCreditMinutes)} | Night Credit Delta ${formatMinutes(
    pattern.fourPilotNightDeltaMinutes
  )}`;

  for (const sector of pattern.sectors) {
    const row = document.createElement("tr");
    if (sector.estimatedFourPilot) {
      row.classList.add("comparison-row");
    }

    const values = [
      sector.flightNumber || "",
      `${sector.isPax ? "PAX " : ""}${sector.origin || ""}/${sector.destination || ""}`,
      sector.depLocal || "",
      formatMinutes(sector.scheduledFlightMinutes),
      formatMinutes(sector.estimatedDutyMinutes),
      formatMinutes(sector.nightOverlapMinutes),
      sector.isPax ? "PAX excluded" : sector.estimatedFourPilot ? "4 pilot" : "2/3 pilot",
      formatMinutes(sector.fourPilotNightDeltaMinutes),
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    sectorsBody.appendChild(row);
  }
}

function renderOtherItems() {
  otherItemsBody.innerHTML = "";

  const roster = getInspectedRoster();
  if (!roster) {
    otherItemsLabel.textContent = "Inspect a loaded roster to see credited leave, standby, training, and adjustments.";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No roster selected for inspection.";
    row.appendChild(cell);
    otherItemsBody.appendChild(row);
    return;
  }

  const items = [
    ...roster.analysis.trainingItems.map((item) => ({ ...item, itemType: "training" })),
    ...roster.analysis.otherCreditedItems,
    ...roster.analysis.adjustmentItems,
  ];
  otherItemsLabel.textContent = `${roster.analysis.fileName || roster.fileName} | Other ${formatMinutes(
    roster.analysis.totalOtherCreditedDutyMinutes
  )} | Training ${formatMinutes(roster.analysis.totalTrainingCreditMinutes)} | Adjustments ${formatMinutes(
    roster.analysis.totalAdjustmentCreditMinutes
  )}`;

  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No other credited items were identified for this roster.";
    row.appendChild(cell);
    otherItemsBody.appendChild(row);
    return;
  }

  for (const item of items) {
    const row = document.createElement("tr");
    const dates =
      item.dateStartIso && item.dateEndIso
        ? item.dateStartIso === item.dateEndIso
          ? item.dateStartIso
          : `${item.dateStartIso} to ${item.dateEndIso}`
        : "";
    const values = [
      item.itemType === "adjustment" ? "Adjustment" : item.itemType === "training" ? "Training" : "Duty",
      item.label || item.code || "",
      dates,
      item.dayCount ? String(item.dayCount) : "",
      formatMinutes(item.creditMinutes),
      item.source || "",
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    otherItemsBody.appendChild(row);
  }
}

function renderAll() {
  renderCaptainPatternAnalysis();
  renderRosterLibrary();
  renderPatterns();
  renderSectors();
  renderOtherItems();
  saveUiState();
}

async function loadRosterFiles() {
  const files = [...(rosterFilesInput?.files || [])];
  if (!files.length) {
    setStatus("Choose one or more roster text files first.");
    return;
  }

  const loaded = [];
  for (const file of files) {
    if (!/\.txt$/i.test(file.name)) {
      continue;
    }

    const text = await file.text();
    const analysis = buildRosterAnalysis(text, file.name);
    const rosterId = `${analysis.parsedRoster.staffNumber || "unknown"}-${analysis.parsedRoster.bidPeriod || "bp"}-${hashText(text)}`;
    loaded.push({
      id: rosterId,
      fileName: file.name,
      text,
      storedAtUtc: new Date().toISOString(),
      analysis,
    });
  }

  if (!loaded.length) {
    setStatus("No supported .txt roster files were loaded.");
    return;
  }

  const mergedById = new Map(state.rosters.map((roster) => [roster.id, roster]));
  for (const roster of loaded) {
    mergedById.set(roster.id, roster);
    state.selectedRosterIds.add(roster.id);
  }
  state.rosters = sortRosterLibrary([...mergedById.values()]);

  const firstSelected = getSelectedRosters()[0] || null;
  state.inspectedRosterId = firstSelected?.id || "";
  state.inspectedPatternId = firstSelected?.analysis.patterns[0]?.id || "";

  saveLibrary();
  renderAll();
  setStatus(
    `Loaded ${loaded.length} roster file${loaded.length === 1 ? "" : "s"}. Roster library now contains ${state.rosters.length}.`
  );
}

function clearLoadedRosters() {
  state.rosters = [];
  state.selectedRosterIds.clear();
  state.inspectedRosterId = "";
  state.inspectedPatternId = "";
  if (rosterFilesInput) {
    rosterFilesInput.value = "";
  }
  saveLibrary();
  renderAll();
  setStatus("Stored roster library cleared from this device.");
}

loadBtn?.addEventListener("click", () => {
  loadRosterFiles().catch((error) => {
    console.error(error);
    setStatus(error?.message || "Could not load the selected roster files.");
  });
});

clearBtn?.addEventListener("click", clearLoadedRosters);

selectAllBtn?.addEventListener("click", () => {
  state.selectedRosterIds = new Set(state.rosters.map((roster) => roster.id));
  const firstSelected = getSelectedRosters()[0] || null;
  state.inspectedRosterId = firstSelected?.id || "";
  state.inspectedPatternId = firstSelected?.analysis.patterns[0]?.id || "";
  renderAll();
});

clearSelectionBtn?.addEventListener("click", () => {
  state.selectedRosterIds.clear();
  state.inspectedRosterId = "";
  state.inspectedPatternId = "";
  renderAll();
});

exportCaptainExcelBtn?.addEventListener("click", exportCaptainPatternExcel);
exportCaptainPdfBtn?.addEventListener("click", exportCaptainPatternPdf);
for (const base of Object.keys(captainBaseButtons)) {
  captainBaseButtons[base]?.addEventListener("click", () => setCaptainPatternBase(base));
}

for (const [button, sortKey] of getCaptainSortButtonMeta()) {
  button?.addEventListener("click", () => {
    if (state.captainPatternSortKey === sortKey) {
      state.captainPatternSortDirection = state.captainPatternSortDirection === "asc" ? "desc" : "asc";
    } else {
      state.captainPatternSortKey = sortKey;
      state.captainPatternSortDirection = sortKey === "patternCode" || sortKey === "weeksDisplay" || sortKey === "routeCode" ? "asc" : "desc";
    }
    renderCaptainPatternAnalysis();
  });
}

loadPersistedState();
syncCaptainPatternAnalysisSelection();
renderAll();
loadCaptainPatternAnalysis().catch((error) => {
  console.error(error);
});
if (state.rosters.length) {
  setStatus(`Restored ${state.rosters.length} saved roster file${state.rosters.length === 1 ? "" : "s"} from this device.`);
}
