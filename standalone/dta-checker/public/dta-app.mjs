import { parseRosterText, rehydrateParsedRoster } from "./shared/roster-parser.mjs";
import {
  calculateDtaForPattern,
  canonicaliseCountryNameForInput,
  DEFAULT_FALLBACK_RATE,
  getCountryRateRows,
  getDtaPatterns,
  getHourlyRateForAirport,
  getKnownCountries,
  loadAirportCountryMap,
  loadAirportRateOverrides,
  loadDtaCountryRates,
  normaliseAirportCodeForInput,
  saveAirportCountryMap,
  saveAirportRateOverrides,
  saveDtaCountryRates,
} from "./dta.mjs";

const APP_VERSION = "2026-04-03k";
const SERVICE_WORKER_URL = "./sw.js?v=20260403k";
const ROSTER_LIBRARY_STORAGE_KEY = "dtaCheckerStandalone.library.v1";
const UI_STATE_STORAGE_KEY = "dtaCheckerStandalone.uiState.v1";

const rosterFileInput = document.getElementById("rosterFile");
const parseBtn = document.getElementById("parseBtn");
const clearLibraryBtn = document.getElementById("clearLibraryBtn");
const toggleSavedRostersBtn = document.getElementById("toggleSavedRostersBtn");
const savedRostersContent = document.getElementById("savedRostersContent");
const statusEl = document.getElementById("status");
const sourceDetailsEl = document.getElementById("sourceDetails");
const buildVersionEl = document.getElementById("buildVersion");
const savedRostersBody = document.getElementById("savedRostersBody");
const patternsBody = document.getElementById("patternsBody");
const patternSelect = document.getElementById("patternSelect");
const checkDtaBtn = document.getElementById("checkDtaBtn");
const dtaStatusEl = document.getElementById("dtaStatus");
const dtaSummaryBody = document.getElementById("dtaSummaryBody");
const mealDocketFileInput = document.getElementById("mealDocketFile");
const checkMealDocketBtn = document.getElementById("checkMealDocketBtn");
const mealDocketStatusEl = document.getElementById("mealDocketStatus");
const mealDocketSummaryBody = document.getElementById("mealDocketSummaryBody");
const mealDocketLinesBody = document.getElementById("mealDocketLinesBody");
const countryOptions = document.getElementById("countryOptions");
const ratesFileInput = document.getElementById("ratesFile");
const importRatesBtn = document.getElementById("importRatesBtn");
const downloadRatesBtn = document.getElementById("downloadRatesBtn");
const addAirportMapForm = document.getElementById("addAirportMapForm");
const newAirportCodeInput = document.getElementById("newAirportCode");
const newAirportCountryInput = document.getElementById("newAirportCountry");
const newAirportRateInput = document.getElementById("newAirportRate");

let parsedRoster = null;
let currentRosterMeta = null;
let dtaPatterns = [];
let dtaCountryRates = loadDtaCountryRates();
let airportCountryMap = loadAirportCountryMap(null, dtaCountryRates);
let airportRateOverrides = loadAirportRateOverrides();
let rosterLibrary = [];
let pdfJsModulePromise = null;
let xlsxModulePromise = null;
let verifiedPatternIds = new Set();
let savedMealDocketComparisons = [];

if (buildVersionEl) {
  buildVersionEl.textContent = `Build ${APP_VERSION}`;
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function setSourceDetails(message) {
  if (sourceDetailsEl) {
    sourceDetailsEl.textContent = message;
  }
}

function setDtaStatus(message) {
  if (dtaStatusEl) {
    dtaStatusEl.textContent = message;
  }
}

function setMealDocketStatus(message) {
  if (mealDocketStatusEl) {
    mealDocketStatusEl.textContent = message;
  }
}

function renderSourceDetailsFromMeta() {
  if (!currentRosterMeta) {
    setSourceDetails("No roster loaded yet.");
    return;
  }

  const detailParts = [
    currentRosterMeta.source === "saved-library" ? "Loaded from saved library" : "Loaded from local file",
    currentRosterMeta.bidPeriod ? `BP${currentRosterMeta.bidPeriod}` : "",
    currentRosterMeta.staffNumber ? `staff ${currentRosterMeta.staffNumber}` : "",
    currentRosterMeta.fileName ? `file ${currentRosterMeta.fileName}` : "",
    currentRosterMeta.loadedAtUtc ? `loaded ${currentRosterMeta.loadedAtUtc}` : "",
  ].filter(Boolean);

  setSourceDetails(`${detailParts.join(" | ")}.`);
}

function canRegisterServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  if (window.isSecureContext) {
    return true;
  }

  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function registerServiceWorker() {
  if (!canRegisterServiceWorker()) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "./" });
    } catch (error) {
      console.error("Service worker registration failed", error);
    }
  });
}

function getLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function serialiseForStorage(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serialiseForStorage(entry));
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serialiseForStorage(entry);
    }
    return output;
  }

  return value;
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
        selectedPatternId: String(patternSelect?.value || ""),
        selectedRosterId: String(currentRosterMeta?.libraryId || ""),
        airportCode: String(newAirportCodeInput?.value || ""),
        airportCountry: String(newAirportCountryInput?.value || ""),
        airportRate: String(newAirportRateInput?.value || ""),
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function loadUiState() {
  const storage = getLocalStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(UI_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function restoreUiState() {
  const state = loadUiState();
  if (newAirportCodeInput && state.airportCode) {
    newAirportCodeInput.value = String(state.airportCode);
  }
  if (newAirportCountryInput && state.airportCountry) {
    newAirportCountryInput.value = String(state.airportCountry);
  }
  if (newAirportRateInput && state.airportRate) {
    newAirportRateInput.value = String(state.airportRate);
  }

  return String(state.selectedPatternId || "");
}

function getSavedSelectedPatternId() {
  const state = loadUiState();
  return String(state.selectedPatternId || "");
}

function getSavedSelectedRosterId() {
  const state = loadUiState();
  return String(state.selectedRosterId || "");
}

function buildLibraryId(roster) {
  return `${String(roster?.staffNumber || "unknown").trim()}|${String(roster?.bidPeriod || "unknown").trim()}`;
}

function saveRosterLibrary() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(ROSTER_LIBRARY_STORAGE_KEY, JSON.stringify(rosterLibrary));
  } catch {
    // Ignore storage failures.
  }
}

function loadRosterLibrary() {
  const storage = getLocalStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(ROSTER_LIBRARY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatLocalDateTime(iso) {
  if (!iso) {
    return "-";
  }

  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return "-";
  }

  return value.toLocaleString("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortRosterLibrary(entries) {
  return [...entries].sort((left, right) => {
    const leftBp = Number(left?.bidPeriod || 0);
    const rightBp = Number(right?.bidPeriod || 0);
    if (leftBp !== rightBp) {
      return rightBp - leftBp;
    }
    return String(right?.loadedAtUtc || "").localeCompare(String(left?.loadedAtUtc || ""));
  });
}

function formatHours(hours) {
  return Number(hours || 0).toFixed(2);
}

function formatMoney(amount) {
  if (amount == null || Number.isNaN(amount)) {
    return "Need mapping";
  }
  return `$${amount.toFixed(2)}`;
}

function formatMoneyDelta(amount) {
  if (amount == null || Number.isNaN(amount)) {
    return "-";
  }
  const prefix = amount > 0 ? "+" : "";
  return `${prefix}$${amount.toFixed(2)}`;
}

function formatRate(rate, source = "table") {
  if (rate == null || Number.isNaN(rate)) {
    return "Need airport-country mapping";
  }
  if (source === "override") {
    return `$${Number(rate).toFixed(2)}/hr (override)`;
  }
  if (source === "fallback") {
    return `$${Number(rate).toFixed(2)}/hr (default)`;
  }
  return `$${Number(rate).toFixed(2)}/hr`;
}

function formatUtcDateTime(value) {
  if (!(value instanceof Date)) {
    return "-";
  }

  const dd = String(value.getUTCDate()).padStart(2, "0");
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(value.getUTCFullYear()).slice(-2);
  const hh = String(value.getUTCHours()).padStart(2, "0");
  const mi = String(value.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi} UTC`;
}

function hhmmToDisplay(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}$/.test(text)) {
    return "";
  }
  return `${text.slice(0, 2)}:${text.slice(2)}`;
}

function previousDayAbbrev(day) {
  const days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const index = days.indexOf(String(day || "").toUpperCase());
  if (index === -1) {
    return String(day || "").toUpperCase();
  }
  return days[(index + days.length - 1) % days.length];
}

function formatPlannedPartATimeBasis(segment) {
  const reportLocal = hhmmToDisplay(segment?.reportLocal);
  const depLocal = String(segment?.depLocal || "").trim();
  let startDay = String(segment?.depDay || "").trim().toUpperCase();
  if (reportLocal && /^\d{4}$/.test(depLocal) && /^\d{4}$/.test(String(segment?.reportLocal || ""))) {
    if (Number(segment.reportLocal) > Number(depLocal)) {
      startDay = previousDayAbbrev(startDay);
    }
  }
  const endDay = String(segment?.arrDay || "").trim().toUpperCase();
  const endTime = hhmmToDisplay(segment?.arrLocal);
  if (!startDay || !reportLocal || !endDay || !endTime) {
    return formatTimeBasisUtc(segment?.startUtc, segment?.endUtc);
  }
  return `${startDay} ${reportLocal} to ${endDay} ${endTime}`;
}

function formatPlannedPartBTimeBasis(segment) {
  const startDay = String(segment?.slipStartDay || "").trim().toUpperCase();
  const startTime = hhmmToDisplay(segment?.slipStartLocal);
  const endDay = String(segment?.slipEndDay || "").trim().toUpperCase();
  const endTime = hhmmToDisplay(segment?.slipEndLocal);
  if (!startDay || !startTime || !endDay || !endTime) {
    return formatTimeBasisUtc(segment?.startUtc, segment?.endUtc);
  }
  return `${startDay} ${startTime} to ${endDay} ${endTime}`;
}

function formatTimeBasisUtc(startUtc, endUtc) {
  if (!(startUtc instanceof Date) || !(endUtc instanceof Date)) {
    return "-";
  }
  return `${formatUtcDateTime(startUtc)} to ${formatUtcDateTime(endUtc)}`;
}

function resetPatternsTable(message = "No roster parsed yet.") {
  patternsBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = message;
  row.appendChild(cell);
  patternsBody.appendChild(row);
}

function resetDtaSummary(message = "No DTA calculation yet.") {
  dtaSummaryBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = message;
  row.appendChild(cell);
  dtaSummaryBody.appendChild(row);
}

function resetMealDocketSummary(message = "No meal-docket comparison yet.") {
  mealDocketSummaryBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 8;
  cell.textContent = message;
  row.appendChild(cell);
  mealDocketSummaryBody.appendChild(row);
}

function resetMealDocketLines(message = "No meal-docket line items yet.") {
  mealDocketLinesBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 9;
  cell.textContent = message;
  row.appendChild(cell);
  mealDocketLinesBody.appendChild(row);
}

function resetDtaPatternSelect(message = "Parse or load a roster first") {
  patternSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  patternSelect.appendChild(option);
  patternSelect.disabled = true;
  checkDtaBtn.disabled = true;
}

function renderRosterLibrary() {
  if (!savedRostersBody) {
    return;
  }

  savedRostersBody.innerHTML = "";

  if (!rosterLibrary.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No saved rosters yet.";
    row.appendChild(cell);
    savedRostersBody.appendChild(row);
    return;
  }

  const currentLibraryId = String(currentRosterMeta?.libraryId || "");

  for (const entry of sortRosterLibrary(rosterLibrary)) {
    const row = document.createElement("tr");
    if (entry.libraryId === currentLibraryId) {
      row.className = "selected-row";
    }

    const bpCell = document.createElement("td");
    bpCell.textContent = entry.bidPeriod ? `BP${entry.bidPeriod}` : "-";

    const staffCell = document.createElement("td");
    staffCell.textContent = entry.staffNumber || "-";

    const sourceCell = document.createElement("td");
    sourceCell.textContent = entry.fileName || entry.source || "-";

    const loadedCell = document.createElement("td");
    loadedCell.textContent = formatLocalDateTime(entry.loadedAtUtc);

    const patternsCell = document.createElement("td");
    patternsCell.textContent = String(entry.patternCount || 0);

    const actionCell = document.createElement("td");
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => loadSavedRoster(entry.libraryId));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeSavedRoster(entry.libraryId));

    actionCell.appendChild(loadButton);
    actionCell.appendChild(document.createTextNode(" "));
    actionCell.appendChild(removeButton);

    row.appendChild(bpCell);
    row.appendChild(staffCell);
    row.appendChild(sourceCell);
    row.appendChild(loadedCell);
    row.appendChild(patternsCell);
    row.appendChild(actionCell);
    savedRostersBody.appendChild(row);
  }
}

function renderCountryOptions() {
  countryOptions.innerHTML = "";
  for (const country of getKnownCountries(dtaCountryRates)) {
    const option = document.createElement("option");
    option.value = country;
    countryOptions.appendChild(option);
  }
}

function renderPatterns(patterns) {
  patternsBody.innerHTML = "";

  if (!patterns.length) {
    resetPatternsTable("No trips found in this roster.");
    return;
  }

  for (const pattern of patterns) {
    const row = document.createElement("tr");
    const patternCell = document.createElement("td");
    const startCell = document.createElement("td");
    const endCell = document.createElement("td");
    const flightsCell = document.createElement("td");
    const checkedCell = document.createElement("td");

    patternCell.textContent = pattern.patternCode;
    startCell.textContent = pattern.tripStartIso || "-";
    endCell.textContent = pattern.tripEndIso || "-";
    flightsCell.textContent = pattern.flights.map((flight) => flight.flightNumber).join(", ") || "-";
    checkedCell.innerHTML = verifiedPatternIds.has(pattern.id)
      ? '<span class="verified-tick" aria-label="Checked">✓</span>'
      : '<span class="verified-placeholder" aria-hidden="true"> </span>';

    row.appendChild(patternCell);
    row.appendChild(startCell);
    row.appendChild(endCell);
    row.appendChild(flightsCell);
    row.appendChild(checkedCell);
    patternsBody.appendChild(row);
  }
}

function populatePatternSelect(patterns, selectedPatternId = "") {
  patternSelect.innerHTML = "";

  if (!patterns.length) {
    resetDtaPatternSelect("No patterns found in roster");
    setDtaStatus("No patterns available to calculate DTA.");
    resetDtaSummary("No patterns found in this roster.");
    return;
  }

  const countByCode = new Map();
  for (const pattern of patterns) {
    countByCode.set(pattern.patternCode, (countByCode.get(pattern.patternCode) || 0) + 1);
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select pattern code";
  patternSelect.appendChild(placeholder);

  for (const pattern of patterns) {
    const option = document.createElement("option");
    option.value = pattern.id;
    const hasDuplicates = (countByCode.get(pattern.patternCode) || 0) > 1;
    option.textContent = hasDuplicates ? `${pattern.patternCode} (${pattern.tripStartIso})` : pattern.patternCode;
    patternSelect.appendChild(option);
  }

  patternSelect.disabled = false;
  checkDtaBtn.disabled = false;
  patternSelect.value = patterns.some((pattern) => pattern.id === selectedPatternId) ? selectedPatternId : "";
  setDtaStatus("Select a pattern code and click Check DTA.");
}

function renderDtaSummary(result) {
  dtaSummaryBody.innerHTML = "";

  if (!result || result.flightsCount === 0) {
    resetDtaSummary("No flight sectors available for this pattern.");
    return;
  }

  const addRow = (section, timeBasis, rate, hours, amount) => {
    const row = document.createElement("tr");
    const sectionCell = document.createElement("td");
    const timeBasisCell = document.createElement("td");
    const rateCell = document.createElement("td");
    const hoursCell = document.createElement("td");
    const amountCell = document.createElement("td");

    sectionCell.textContent = section;
    timeBasisCell.textContent = timeBasis;
    rateCell.textContent = rate;
    hoursCell.textContent = formatHours(hours);
    amountCell.textContent = formatMoney(amount);

    row.appendChild(sectionCell);
    row.appendChild(timeBasisCell);
    row.appendChild(rateCell);
    row.appendChild(hoursCell);
    row.appendChild(amountCell);
    dtaSummaryBody.appendChild(row);
  };

  for (const segment of result.partA.segments) {
    addRow(
      `Part A ${segment.flightNumber} ${segment.origin}/${segment.destination} @ ${segment.rateAirportCode}`,
      formatPlannedPartATimeBasis(segment),
      formatRate(segment.rate, segment.rateSource),
      segment.hours,
      segment.amount
    );
  }
  addRow("Part A subtotal", "-", "-", result.partA.totalHours, result.partA.totalAmount);

  for (const segment of result.partB.segments) {
    addRow(
      `Part B layover ${segment.slipPort} @ ${segment.rateAirportCode}`,
      formatPlannedPartBTimeBasis(segment),
      formatRate(segment.rate, segment.rateSource),
      segment.hours,
      segment.amount
    );
  }
  addRow("Part B subtotal", "-", "-", result.partB.totalHours, result.partB.totalAmount);
  addRow("Total DTA", "-", "-", result.partA.totalHours + result.partB.totalHours, result.grandTotal);
}

function getSelectedPattern() {
  const selectedId = patternSelect.value;
  if (!selectedId) {
    return null;
  }
  return dtaPatterns.find((pattern) => pattern.id === selectedId) || null;
}

function updateDtaSummaryForSelection() {
  const selectedPattern = getSelectedPattern();
  if (!selectedPattern) {
    setDtaStatus("Select a pattern code to check DTA.");
    saveUiState();
    return;
  }

  const result = calculateDtaForPattern(selectedPattern, dtaCountryRates, airportCountryMap, airportRateOverrides);
  renderDtaSummary(result);

  if (result.missingAirportCodes.length > 0) {
    const missingList = result.missingAirportCodes.join(", ");
    setDtaStatus(`Need airport-country mapping for: ${missingList}. Add mapping below, then check again.`);
    if (!newAirportCodeInput.value) {
      newAirportCodeInput.value = result.missingAirportCodes[0];
      suggestAirportDetailsForCode();
    }
    saveUiState();
    return;
  }

  const fallbackNote =
    result.fallbackCountriesUsed.length > 0
      ? ` Using default Cost Group 1 rate ($${DEFAULT_FALLBACK_RATE.hourlyRate.toFixed(2)}/hr) for: ${result.fallbackCountriesUsed.join(", ")}.`
      : "";

  setDtaStatus(
    `DTA for ${result.patternCode} (${result.tripStartIso} to ${result.tripEndIso}) is ${formatMoney(result.grandTotal)}.${fallbackNote}`
  );
  saveUiState();
}

function saveCurrentRosterVerificationState() {
  if (!currentRosterMeta?.libraryId) {
    renderPatterns(dtaPatterns);
    return;
  }

  currentRosterMeta = {
    ...currentRosterMeta,
    verifiedPatternIds: [...verifiedPatternIds],
    mealDocketComparisons: serialiseMealDocketComparisons(savedMealDocketComparisons),
  };

  rosterLibrary = rosterLibrary.map((entry) =>
    entry.libraryId === currentRosterMeta.libraryId
      ? {
          ...entry,
          meta: {
            ...(entry.meta || {}),
            ...currentRosterMeta,
            verifiedPatternIds: [...verifiedPatternIds],
            mealDocketComparisons: serialiseMealDocketComparisons(savedMealDocketComparisons),
          },
        }
      : entry
  );

  saveRosterLibrary();
  renderRosterLibrary();
  renderPatterns(dtaPatterns);
}

function markPatternsVerified(patternIds) {
  let changed = false;

  for (const patternId of patternIds || []) {
    if (!patternId || verifiedPatternIds.has(patternId)) {
      continue;
    }
    verifiedPatternIds.add(patternId);
    changed = true;
  }

  if (changed) {
    saveCurrentRosterVerificationState();
  } else {
    renderPatterns(dtaPatterns);
  }
}

function isMealDocketFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".txt") ||
    name.endsWith(".rtf") ||
    type === "application/pdf" ||
    type.startsWith("text/") ||
    type.includes("rtf")
  );
}

function normaliseMealDocketText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/(\d{3}\s*-\s*[A-Z0-9]+\s*-\s*\d+(?:\s*-\s*\d+)?)/gi, "\n$1\n")
    .replace(/(Totals:)/gi, "\n$1")
    .replace(/((?:MO|TU|WE|TH|FR|SA|SU)\s+\d{1,2}:\d{2}\s+(?:MO|TU|WE|TH|FR|SA|SU)\s+\d{1,2}:\d{2})/g, "\n$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n");
}

function isRtfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".rtf") || type.includes("rtf");
}

function stripRtf(text) {
  return String(text || "")
    .replace(/\\par[d]?/gi, "\n")
    .replace(/\\tab/gi, "\t")
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\r\n/g, "\n");
}

function isAirportToken(value) {
  return /^[A-Z]{3}$/.test(String(value || "").trim().toUpperCase());
}

function parseMoneyToken(value) {
  const cleaned = String(value || "").replace(/[$,]/g, "");
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function isHourToken(value) {
  return /^\d+\.\d{2}$/.test(String(value || "").trim());
}

function lastMoneyInLine(line) {
  const matches = String(line || "").match(/\d[\d,]*\.\d{2}/g);
  if (!matches?.length) {
    return null;
  }
  return parseMoneyToken(matches[matches.length - 1]);
}

function firstMoneyInLine(line) {
  const matches = String(line || "").match(/\d[\d,]*\.\d{2}/g);
  if (!matches?.length) {
    return null;
  }
  return parseMoneyToken(matches[0]);
}

function parseMealDocketSegmentLine(line) {
  const tokens = String(line || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length < 10) {
    return null;
  }

  if (!/^(MO|TU|WE|TH|FR|SA|SU)$/i.test(tokens[0]) || !/^\d{1,2}:\d{2}$/.test(tokens[1])) {
    return null;
  }
  if (!/^(MO|TU|WE|TH|FR|SA|SU)$/i.test(tokens[2]) || !/^\d{1,2}:\d{2}$/.test(tokens[3])) {
    return null;
  }

  let cursor = 4;
  let leadingPort = "";
  if (isAirportToken(tokens[cursor])) {
    leadingPort = tokens[cursor];
    cursor += 1;
  }

  const dutyHours = parseMoneyToken(tokens[cursor]);
  const slipHours = parseMoneyToken(tokens[cursor + 1]);
  if (dutyHours == null || slipHours == null) {
    return null;
  }
  cursor += 2;

  let port = leadingPort;
  if (isAirportToken(tokens[cursor])) {
    port = tokens[cursor];
    cursor += 1;
  }

  const mealRate = parseMoneyToken(tokens[cursor]);
  const incidentalRate = parseMoneyToken(tokens[cursor + 1]);
  if (!port || mealRate == null || incidentalRate == null) {
    return null;
  }

  const lineAllow = lastMoneyInLine(line);
  if (lineAllow == null) {
    return null;
  }

  const hours = slipHours > 0 ? slipHours : dutyHours;
  const section = slipHours > 0 ? "Part B" : "Part A";
  const calculatedAmount = roundMoney(hours * (mealRate + incidentalRate));

  return {
    rawLine: line,
    section,
    startDay: tokens[0].toUpperCase(),
    startTime: tokens[1],
    endDay: tokens[2].toUpperCase(),
    endTime: tokens[3],
    port,
    dutyHours,
    slipHours,
    hours,
    mealRate,
    incidentalRate,
    hourlyRate: roundMoney(mealRate + incidentalRate),
    calculatedAmount,
    qfAllow: lineAllow,
  };
}

function extractMealDocketSegmentsFromBlockText(blockText) {
  const dayPattern = "(MO|TU|WE|TH|FR|SA|SU)";
  const timePattern = "(\\d{1,2}:\\d{2})";
  const airportPattern = "(AU\\$|[A-Z]{3})";
  const hoursPattern = "(\\d+\\.\\d{2})";
  const moneyPattern = "([\\d,]+\\.\\d{2})";

  const continuous = String(blockText || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!continuous) {
    return [];
  }

  const regex = new RegExp(
    `${dayPattern}\\s+${timePattern}\\s+${dayPattern}\\s+${timePattern}\\s+(?:${airportPattern}\\s+)?${hoursPattern}\\s+${hoursPattern}\\s+${airportPattern}\\s+${hoursPattern}\\s+${hoursPattern}\\s+${moneyPattern}`,
    "g"
  );

  const segments = [];
  let match;
  while ((match = regex.exec(continuous)) !== null) {
    const leadingPort = match[5] || "";
    const dutyHours = parseMoneyToken(match[6]);
    const slipHours = parseMoneyToken(match[7]);
    const port = match[8] || leadingPort;
    const mealRate = parseMoneyToken(match[9]);
    const incidentalRate = parseMoneyToken(match[10]);
    const qfAllow = parseMoneyToken(match[11]);

    if (
      dutyHours == null ||
      slipHours == null ||
      !port ||
      mealRate == null ||
      incidentalRate == null ||
      qfAllow == null
    ) {
      continue;
    }

    const hours = slipHours > 0 ? slipHours : dutyHours;
    const section = slipHours > 0 ? "Part B" : "Part A";
    const calculatedAmount = roundMoney(hours * (mealRate + incidentalRate));

    segments.push({
      rawLine: match[0],
      section,
      startDay: match[1].toUpperCase(),
      startTime: match[2],
      endDay: match[3].toUpperCase(),
      endTime: match[4],
      port,
      dutyHours,
      slipHours,
      hours,
      mealRate,
      incidentalRate,
      hourlyRate: roundMoney(mealRate + incidentalRate),
      calculatedAmount,
      qfAllow,
    });
  }

  return segments;
}

function expandMealDocketSegment(segment) {
  const dutyHours = Number(segment?.dutyHours || 0);
  const slipHours = Number(segment?.slipHours || 0);
  const hourlyRate = Number(segment?.hourlyRate || 0);
  const qfAllow = Number(segment?.qfAllow || 0);

  if (dutyHours > 0 && slipHours > 0) {
    const partAAmount = roundMoney(dutyHours * hourlyRate);
    const partBAmount = roundMoney(slipHours * hourlyRate);
    const totalAmount = partAAmount + partBAmount;
    const partAQfAllow = totalAmount > 0 ? roundMoney((qfAllow * partAAmount) / totalAmount) : 0;
    const partBQfAllow = roundMoney(qfAllow - partAQfAllow);

    return [
      {
        ...segment,
        section: "Part A",
        hours: dutyHours,
        calculatedAmount: partAAmount,
        qfAllow: partAQfAllow,
      },
      {
        ...segment,
        section: "Part B",
        hours: slipHours,
        calculatedAmount: partBAmount,
        qfAllow: partBQfAllow,
      },
    ];
  }

  return [
    {
      ...segment,
      hours: slipHours > 0 ? slipHours : dutyHours,
      section: slipHours > 0 ? "Part B" : "Part A",
      calculatedAmount: roundMoney((slipHours > 0 ? slipHours : dutyHours) * hourlyRate),
    },
  ];
}

function parseMealDocketText(text) {
  const normalised = normaliseMealDocketText(text);
  const headerPattern = /\b(\d{3})\s*-\s*([A-Z0-9]+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?\b/gi;
  const headerMatches = [...normalised.matchAll(headerPattern)];

  if (!headerMatches.length) {
    throw new Error("No meal-docket pattern blocks found in the uploaded file.");
  }

  const blocks = [];

  for (let i = 0; i < headerMatches.length; i += 1) {
    const headerMatch = headerMatches[i];
    const startIndex = headerMatch.index ?? 0;
    const endIndex = headerMatches[i + 1]?.index ?? normalised.length;
    const blockText = normalised.slice(startIndex, endIndex).trim();
    const header = String(headerMatch[0] || "").trim();

    const blockLines = blockText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const rawSegmentsFromLines = blockLines.map((line) => parseMealDocketSegmentLine(line)).filter(Boolean);
    const rawSegments = rawSegmentsFromLines.length ? rawSegmentsFromLines : extractMealDocketSegmentsFromBlockText(blockText);
    const segments = rawSegments.flatMap((segment) => expandMealDocketSegment(segment));
    const totalsMatch = blockText.match(/Totals:\s*((?:[\d,]+\.\d{2}\s*){1,4})/i);
    const totalsPayload = totalsMatch?.[1] || "";
    const totalsValues = (totalsPayload.match(/\d[\d,]*\.\d{2}/g) || [])
      .map((value) => parseMoneyToken(value))
      .filter((value) => value != null);
    const qfAllowTotal =
      totalsValues[0] ??
      roundMoney(segments.reduce((sum, segment) => sum + segment.qfAllow, 0));
    const actualCalculatedTotal = roundMoney(segments.reduce((sum, segment) => sum + segment.calculatedAmount, 0));

    blocks.push({
      bidPeriod: headerMatch[1],
      patternCode: headerMatch[2],
      week: headerMatch[3],
      sequence: headerMatch[4] || "",
      header,
      segments,
      qfAllowTotal,
      actualCalculatedTotal,
    });
  }

  if (!blocks.length) {
    throw new Error("Could not parse any meal-docket pattern blocks.");
  }

  return blocks;
}

function serialiseMealDocketComparisons(comparisons) {
  return (comparisons || []).map((comparison) => ({
    fileName: String(comparison.fileName || ""),
      uploadedAtUtc: String(comparison.uploadedAtUtc || ""),
      blocks: (comparison.blocks || []).map((block) => ({
        bidPeriod: String(block.bidPeriod || ""),
      patternCode: String(block.patternCode || ""),
      week: String(block.week || ""),
      sequence: String(block.sequence || ""),
      header: String(block.header || ""),
      qfAllowTotal: Number(block.qfAllowTotal || 0),
      actualCalculatedTotal: Number(block.actualCalculatedTotal || 0),
      segments: (block.segments || []).map((segment) => ({
        rawLine: String(segment.rawLine || ""),
        section: String(segment.section || ""),
        startDay: String(segment.startDay || ""),
        startTime: String(segment.startTime || ""),
        endDay: String(segment.endDay || ""),
        endTime: String(segment.endTime || ""),
        port: String(segment.port || ""),
        dutyHours: Number(segment.dutyHours || 0),
        slipHours: Number(segment.slipHours || 0),
        hours: Number(segment.hours || 0),
        mealRate: Number(segment.mealRate || 0),
        incidentalRate: Number(segment.incidentalRate || 0),
        hourlyRate: Number(segment.hourlyRate || 0),
        calculatedAmount: Number(segment.calculatedAmount || 0),
        qfAllow: Number(segment.qfAllow || 0),
      })),
    })),
  }));
}

function loadSavedMealDocketComparison() {
  if (!savedMealDocketComparisons.length) {
    resetMealDocketSummary("No meal-docket comparison yet.");
    resetMealDocketLines("No meal-docket line items yet.");
    setMealDocketStatus("Upload a meal-docket file to compare actual flown DTA with the planned roster pattern.");
    return;
  }

  const latest = savedMealDocketComparisons[0];
  renderMealDocketComparison(latest.blocks, {
    fileName: latest.fileName,
    uploadedAtUtc: latest.uploadedAtUtc,
    persist: false,
  });
}

function cloneSavedMealDocketComparisons(comparisons) {
  return serialiseMealDocketComparisons(comparisons || []);
}

function findPlannedPatternForMealDocketBlock(block, selectedPattern, patternsByCode) {
  const docketPatternCode = String(block?.patternCode || "").trim().toUpperCase();
  if (!docketPatternCode) {
    return null;
  }

  if (selectedPattern?.patternCode && String(selectedPattern.patternCode).toUpperCase() === docketPatternCode) {
    return selectedPattern;
  }

  const exactMatches = patternsByCode.get(docketPatternCode) || [];
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1 && selectedPattern && exactMatches.some((pattern) => pattern.id === selectedPattern.id)) {
    return selectedPattern;
  }

  const prefixCandidates = [];
  for (const [plannedCode, patterns] of patternsByCode.entries()) {
    if (!docketPatternCode.startsWith(plannedCode)) {
      continue;
    }
    prefixCandidates.push({
      plannedCode,
      patterns,
      codeLength: plannedCode.length,
    });
  }

  if (!prefixCandidates.length) {
    return null;
  }

  prefixCandidates.sort((left, right) => right.codeLength - left.codeLength || left.plannedCode.localeCompare(right.plannedCode));
  const longestLength = prefixCandidates[0].codeLength;
  const longestCandidates = prefixCandidates.filter((candidate) => candidate.codeLength === longestLength);

  if (
    selectedPattern?.patternCode &&
    longestCandidates.some((candidate) => candidate.plannedCode === String(selectedPattern.patternCode).toUpperCase())
  ) {
    return selectedPattern;
  }

  if (longestCandidates.length !== 1) {
    return null;
  }

  const bestPatterns = longestCandidates[0].patterns || [];
  if (bestPatterns.length === 1) {
    return bestPatterns[0];
  }

  if (selectedPattern && bestPatterns.some((pattern) => pattern.id === selectedPattern.id)) {
    return selectedPattern;
  }

  return null;
}

function scoreMealDocketBlocks(blocks) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const segmentCount = safeBlocks.reduce((sum, block) => sum + (Array.isArray(block.segments) ? block.segments.length : 0), 0);
  const qfAllowTotal = safeBlocks.reduce((sum, block) => sum + Number(block.qfAllowTotal || 0), 0);
  const calculatedTotal = safeBlocks.reduce((sum, block) => sum + Number(block.actualCalculatedTotal || 0), 0);

  return {
    blockCount: safeBlocks.length,
    segmentCount,
    qfAllowTotal,
    calculatedTotal,
  };
}

function isBetterMealDocketScore(candidate, best) {
  if (!best) {
    return true;
  }
  if (candidate.segmentCount !== best.segmentCount) {
    return candidate.segmentCount > best.segmentCount;
  }
  if (candidate.qfAllowTotal !== best.qfAllowTotal) {
    return candidate.qfAllowTotal > best.qfAllowTotal;
  }
  if (candidate.calculatedTotal !== best.calculatedTotal) {
    return candidate.calculatedTotal > best.calculatedTotal;
  }
  return candidate.blockCount > best.blockCount;
}

function compareMealDocketBlocks(left, right) {
  const leftBp = Number.parseInt(String(left?.bidPeriod || "0"), 10) || 0;
  const rightBp = Number.parseInt(String(right?.bidPeriod || "0"), 10) || 0;
  if (leftBp !== rightBp) {
    return leftBp - rightBp;
  }

  const leftWeek = Number.parseInt(String(left?.week || "0"), 10) || 0;
  const rightWeek = Number.parseInt(String(right?.week || "0"), 10) || 0;
  if (leftWeek !== rightWeek) {
    return leftWeek - rightWeek;
  }

  const leftSequence = Number.parseInt(String(left?.sequence || "0"), 10) || 0;
  const rightSequence = Number.parseInt(String(right?.sequence || "0"), 10) || 0;
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  return String(left?.patternCode || "").localeCompare(String(right?.patternCode || ""));
}

function renderMealDocketComparison(blocks, options = {}) {
  const { fileName = "", uploadedAtUtc = "", persist = false } = options;
  mealDocketSummaryBody.innerHTML = "";
  mealDocketLinesBody.innerHTML = "";
  const sortedBlocks = [...blocks].sort(compareMealDocketBlocks);

  const matchedPatternIds = [];
  const selectedPattern = getSelectedPattern();
  const patternsByCode = new Map();
  for (const pattern of dtaPatterns) {
    const key = String(pattern.patternCode || "").trim().toUpperCase();
    if (!patternsByCode.has(key)) {
      patternsByCode.set(key, []);
    }
    patternsByCode.get(key).push(pattern);
  }

  let previousLinePatternCode = "";

  for (const block of sortedBlocks) {
    const plannedPattern = findPlannedPatternForMealDocketBlock(block, selectedPattern, patternsByCode);

    const plannedResult = plannedPattern
      ? calculateDtaForPattern(plannedPattern, dtaCountryRates, airportCountryMap, airportRateOverrides)
      : null;
    const calcVsPaid = Math.round((block.actualCalculatedTotal - block.qfAllowTotal + Number.EPSILON) * 100) / 100;
    const actualVsPlanned =
      plannedResult != null
        ? Math.round((block.actualCalculatedTotal - plannedResult.grandTotal + Number.EPSILON) * 100) / 100
        : null;

    const summaryRow = document.createElement("tr");
    [
      block.bidPeriod ? `BP${block.bidPeriod}` : "-",
      block.patternCode,
      plannedPattern?.patternCode || "-",
      plannedResult ? formatMoney(plannedResult.grandTotal) : "No planned match",
      formatMoney(block.actualCalculatedTotal),
      formatMoney(block.qfAllowTotal),
      formatMoneyDelta(calcVsPaid),
      actualVsPlanned == null ? "-" : formatMoneyDelta(actualVsPlanned),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      summaryRow.appendChild(cell);
    });
    mealDocketSummaryBody.appendChild(summaryRow);

    for (const segment of block.segments) {
      const currentLinePatternCode = `${block.bidPeriod || ""}:${block.patternCode || ""}`;
      if (previousLinePatternCode && previousLinePatternCode !== currentLinePatternCode) {
        const spacerRow = document.createElement("tr");
        spacerRow.className = "meal-docket-separator-row";
        const spacerCell = document.createElement("td");
        spacerCell.colSpan = 9;
        spacerCell.setAttribute("aria-hidden", "true");
        spacerRow.appendChild(spacerCell);
        mealDocketLinesBody.appendChild(spacerRow);
      }

      const lineRow = document.createElement("tr");
      if (previousLinePatternCode !== currentLinePatternCode) {
        lineRow.classList.add("meal-docket-group-start");
      }
      const values = [
        block.bidPeriod ? `BP${block.bidPeriod}` : "-",
        block.patternCode,
        segment.section,
        `${segment.startDay} ${segment.startTime} to ${segment.endDay} ${segment.endTime}`,
        segment.port,
        `$${segment.hourlyRate.toFixed(2)}/hr`,
        formatHours(segment.hours),
        formatMoney(segment.calculatedAmount),
        formatMoney(segment.qfAllow),
      ];

      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        lineRow.appendChild(cell);
      }
      mealDocketLinesBody.appendChild(lineRow);
      previousLinePatternCode = currentLinePatternCode;
    }

    const totalRow = document.createElement("tr");
    totalRow.className = "meal-docket-pattern-total";

    const labelCell = document.createElement("td");
    labelCell.colSpan = 7;
    labelCell.textContent = `Pattern total ${block.patternCode}`;
    totalRow.appendChild(labelCell);

    const calculatedTotalCell = document.createElement("td");
    calculatedTotalCell.textContent = formatMoney(block.actualCalculatedTotal);
    totalRow.appendChild(calculatedTotalCell);

    const qfAllowTotalCell = document.createElement("td");
    qfAllowTotalCell.textContent = formatMoney(block.qfAllowTotal);
    totalRow.appendChild(qfAllowTotalCell);

    mealDocketLinesBody.appendChild(totalRow);

    if (plannedPattern) {
      matchedPatternIds.push(plannedPattern.id);
    }
  }

  markPatternsVerified(matchedPatternIds);

  if (persist) {
    const nextComparison = {
      fileName,
      uploadedAtUtc: uploadedAtUtc || new Date().toISOString(),
      blocks: serialiseMealDocketComparisons([{ fileName, uploadedAtUtc, blocks }])[0].blocks,
    };
    const deduped = savedMealDocketComparisons.filter((comparison) => comparison.fileName !== nextComparison.fileName);
    savedMealDocketComparisons = [nextComparison, ...deduped].slice(0, 12);
    saveCurrentRosterVerificationState();
  }

  const matchedCount = matchedPatternIds.length;
  if (matchedCount > 0) {
    setMealDocketStatus(
      `Checked ${sortedBlocks.length} meal-docket pattern${sortedBlocks.length === 1 ? "" : "s"} from ${fileName || "uploaded file"}. Matched ${matchedCount} planned roster pattern${matchedCount === 1 ? "" : "s"} and marked them in Trips Found.`
    );
    return;
  }

  setMealDocketStatus(
    `Parsed ${sortedBlocks.length} meal-docket pattern${sortedBlocks.length === 1 ? "" : "s"} from ${fileName || "uploaded file"}, but no planned roster pattern could be matched automatically.`
  );
}

function persistCurrentRosterToLibrary() {
  if (!parsedRoster?.events?.length) {
    return;
  }

  const libraryId = buildLibraryId(parsedRoster);
  const existingEntry = rosterLibrary.find((item) => item.libraryId === libraryId);
  const existingVerifiedPatternIds = Array.isArray(existingEntry?.meta?.verifiedPatternIds)
    ? existingEntry.meta.verifiedPatternIds
    : [];
  const existingMealDocketComparisons = Array.isArray(existingEntry?.meta?.mealDocketComparisons)
    ? existingEntry.meta.mealDocketComparisons
    : [];
  const nextVerifiedPatternIds =
    Array.isArray(currentRosterMeta?.verifiedPatternIds) && currentRosterMeta.verifiedPatternIds.length
      ? [...new Set(currentRosterMeta.verifiedPatternIds)]
      : existingVerifiedPatternIds;
  const nextMealDocketComparisons =
    Array.isArray(savedMealDocketComparisons) && savedMealDocketComparisons.length
      ? cloneSavedMealDocketComparisons(savedMealDocketComparisons)
      : cloneSavedMealDocketComparisons(existingMealDocketComparisons);

  const entry = {
    libraryId,
    bidPeriod: parsedRoster.bidPeriod || "",
    staffNumber: parsedRoster.staffNumber || "",
    fileName: currentRosterMeta?.fileName || "",
    source: currentRosterMeta?.source || "manual-file",
    loadedAtUtc: currentRosterMeta?.loadedAtUtc || new Date().toISOString(),
    patternCount: getDtaPatterns(parsedRoster).length,
    roster: serialiseForStorage(parsedRoster),
    meta: {
      ...currentRosterMeta,
      libraryId,
      loadedAtUtc: currentRosterMeta?.loadedAtUtc || new Date().toISOString(),
      bidPeriod: parsedRoster.bidPeriod || "",
      staffNumber: parsedRoster.staffNumber || "",
      verifiedPatternIds: nextVerifiedPatternIds,
      mealDocketComparisons: nextMealDocketComparisons,
    },
  };

  const nextLibrary = rosterLibrary.filter((item) => item.libraryId !== libraryId);
  nextLibrary.push(entry);
  rosterLibrary = nextLibrary;
  currentRosterMeta = entry.meta;
  verifiedPatternIds = new Set(nextVerifiedPatternIds);
  savedMealDocketComparisons = cloneSavedMealDocketComparisons(nextMealDocketComparisons);
  saveRosterLibrary();
  renderRosterLibrary();
}

function loadSavedRoster(libraryId) {
  const entry = rosterLibrary.find((item) => item.libraryId === libraryId);
  if (!entry) {
    setStatus("Saved roster could not be found.");
    return;
  }

  const restoredRoster = rehydrateParsedRoster(entry.roster);
  if (!restoredRoster?.events?.length) {
    setStatus("Saved roster record is empty.");
    return;
  }

  parsedRoster = restoredRoster;
  currentRosterMeta = {
    ...entry.meta,
    source: "saved-library",
    libraryId: entry.libraryId,
    fileName: entry.fileName || entry.meta?.fileName || "",
    loadedAtUtc: entry.loadedAtUtc || entry.meta?.loadedAtUtc || "",
  };
  verifiedPatternIds = new Set(Array.isArray(entry.meta?.verifiedPatternIds) ? entry.meta.verifiedPatternIds : []);
  savedMealDocketComparisons = cloneSavedMealDocketComparisons(entry.meta?.mealDocketComparisons);
  applyRosterToUi({ restoreSelection: true, persistLibrary: false });
  renderSourceDetailsFromMeta();
  loadSavedMealDocketComparison();
  setStatus(`Loaded saved BP${parsedRoster.bidPeriod} for staff ${parsedRoster.staffNumber || "unknown"}.`);
  saveUiState();
}

function removeSavedRoster(libraryId) {
  rosterLibrary = rosterLibrary.filter((item) => item.libraryId !== libraryId);
  saveRosterLibrary();
  renderRosterLibrary();

  if (currentRosterMeta?.libraryId === libraryId) {
    parsedRoster = null;
    currentRosterMeta = null;
    dtaPatterns = [];
    verifiedPatternIds = new Set();
    savedMealDocketComparisons = [];
    resetPatternsTable("No roster parsed yet.");
    resetDtaPatternSelect("Parse or select a saved roster first");
    resetDtaSummary("No DTA calculation yet.");
    resetMealDocketSummary("No meal-docket comparison yet.");
    resetMealDocketLines("No meal-docket line items yet.");
    setDtaStatus("Parse or select a saved roster, then choose a pattern.");
    setMealDocketStatus("Upload a meal-docket file to compare actual flown DTA with the planned roster pattern.");
    setStatus("Saved roster removed. Choose another bid period or parse a new roster.");
    setSourceDetails("No roster loaded yet.");
    saveUiState();
  }
}

function clearSavedRosterLibrary() {
  rosterLibrary = [];
  saveRosterLibrary();
  renderRosterLibrary();
  parsedRoster = null;
  currentRosterMeta = null;
  dtaPatterns = [];
  verifiedPatternIds = new Set();
  savedMealDocketComparisons = [];
  resetPatternsTable("No roster parsed yet.");
  resetDtaPatternSelect("Parse or select a saved roster first");
  resetDtaSummary("No DTA calculation yet.");
  resetMealDocketSummary("No meal-docket comparison yet.");
  resetMealDocketLines("No meal-docket line items yet.");
  setDtaStatus("Parse or select a saved roster, then choose a pattern.");
  setMealDocketStatus("Upload a meal-docket file to compare actual flown DTA with the planned roster pattern.");
  setStatus("Cleared saved roster library for this browser.");
  setSourceDetails("No roster loaded yet.");
  saveUiState();
}

function toggleSavedRostersSection() {
  if (!toggleSavedRostersBtn || !savedRostersContent) {
    return;
  }

  const isExpanded = toggleSavedRostersBtn.getAttribute("aria-expanded") !== "false";
  const nextExpanded = !isExpanded;
  toggleSavedRostersBtn.setAttribute("aria-expanded", String(nextExpanded));
  toggleSavedRostersBtn.textContent = nextExpanded ? "Collapse" : "Expand";
  savedRostersContent.hidden = !nextExpanded;
}

function applyRosterToUi({ restoreSelection = false, persistLibrary = true } = {}) {
  dtaPatterns = getDtaPatterns(parsedRoster);
  verifiedPatternIds = new Set(Array.isArray(currentRosterMeta?.verifiedPatternIds) ? currentRosterMeta.verifiedPatternIds : []);
  const selectedPatternId = restoreSelection ? getSavedSelectedPatternId() : String(patternSelect.value || "");

  renderPatterns(dtaPatterns);
  populatePatternSelect(dtaPatterns, selectedPatternId);
  if (persistLibrary) {
    persistCurrentRosterToLibrary();
  } else {
    renderRosterLibrary();
  }

  if (!dtaPatterns.length) {
    return;
  }

  if (patternSelect.value) {
    updateDtaSummaryForSelection();
  } else {
    resetDtaSummary("Select a pattern and click Check DTA.");
  }
}

function isPdfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".pdf") || type === "application/pdf";
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs");
  }
  return pdfJsModulePromise;
}

async function loadXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  }
  return xlsxModulePromise;
}

function linesFromPdfTextItems(items) {
  const rowMap = new Map();

  for (const item of items || []) {
    const text = String(item?.str || "").trim();
    if (!text) {
      continue;
    }

    const x = Number(item?.transform?.[4] || 0);
    const y = Number(item?.transform?.[5] || 0);
    const rowKey = String(Math.round(y * 2) / 2);
    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, []);
    }
    rowMap.get(rowKey).push({ x, text });
  }

  const rows = [...rowMap.entries()]
    .map(([rowKey, cells]) => ({
      y: Number(rowKey),
      cells: cells.sort((left, right) => left.x - right.x),
    }))
    .sort((left, right) => right.y - left.y)
    .map((row) => row.cells.map((cell) => cell.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return rows.join("\n");
}

function rawTextFromPdfTextItems(items) {
  const parts = [];

  for (const item of items || []) {
    const text = String(item?.str || "");
    if (!text.trim()) {
      continue;
    }
    parts.push(text);
    parts.push(item?.hasEOL ? "\n" : " ");
  }

  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function extractTextFromPdf(file) {
  let pdfjs;
  try {
    pdfjs = await loadPdfJsModule();
  } catch {
    throw new Error("Could not load PDF reader library.");
  }

  const { getDocument, GlobalWorkerOptions } = pdfjs;
  GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(linesFromPdfTextItems(content.items));
  }

  return pages.join("\n\n");
}

async function extractMealDocketTextCandidatesFromPdf(file) {
  try {
    const response = await fetch("./api/extract-meal-docket-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
      },
      body: await file.arrayBuffer(),
    });

    if (response.ok) {
      const payload = await response.json();
      const nativeText = String(payload?.text || "").trim();
      if (nativeText) {
        return [nativeText];
      }
    }
  } catch {
    // Fall back to in-browser extraction when local endpoint is unavailable.
  }

  let pdfjs;
  try {
    pdfjs = await loadPdfJsModule();
  } catch {
    throw new Error("Could not load PDF reader library.");
  }

  const { getDocument, GlobalWorkerOptions } = pdfjs;
  GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const groupedPages = [];
  const rawPages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    groupedPages.push(linesFromPdfTextItems(content.items));
    rawPages.push(rawTextFromPdfTextItems(content.items));
  }

  const candidates = [
    groupedPages.join("\n\n"),
    rawPages.join("\n\n"),
    groupedPages.join("\n"),
    rawPages.join("\n"),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return [...new Set(candidates)];
}

async function readRosterFileText(file) {
  if (isPdfFile(file)) {
    return extractTextFromPdf(file);
  }
  return file.text();
}

async function readMealDocketFileCandidates(file) {
  if (isPdfFile(file)) {
    return extractMealDocketTextCandidatesFromPdf(file);
  }

  let text = await file.text();
  if (isRtfFile(file)) {
    text = stripRtf(text);
  }

  return [text];
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normaliseHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildCountryRatesFromRows(rows) {
  const nextRates = {};

  for (const row of rows) {
    const country = String(
      row.country || row.Country || row.countryname || row.CountryName || row["Country Name"] || ""
    ).trim();
    const costGroup = String(
      row.costgroup || row["Cost Group"] || row.costGroup || row.CostGroup || row.group || ""
    ).trim();
    const mealRaw = row.mealrate ?? row["Meal Rate"] ?? row.mealsrate ?? row["Meals Rate"];
    const incidentalRaw = row.incidentalrate ?? row["Incidental Rate"] ?? row.incidentalsrate ?? row["Incidentals Rate"];

    const mealRate = Number(mealRaw);
    const incidentalRate = Number(incidentalRaw);

    if (!country || !Number.isFinite(mealRate) || mealRate <= 0 || !Number.isFinite(incidentalRate) || incidentalRate <= 0) {
      continue;
    }

    nextRates[country] = {
      costGroup,
      mealRate,
      incidentalRate,
      hourlyRate: mealRate + incidentalRate,
    };
  }

  if (Object.keys(nextRates).length === 0) {
    throw new Error("No valid country rates found in file.");
  }

  return nextRates;
}

function parseCountryRatesFromCsv(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV needs a header row and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]);
  const headerMap = headers.map((header) => normaliseHeader(header));
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headerMap.length; j += 1) {
      row[headerMap[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return buildCountryRatesFromRows(rows);
}

async function parseCountryRatesFromXlsx(file) {
  const xlsxModule = await loadXlsxModule();
  const XLSX = xlsxModule.default || xlsxModule;
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array" });

  if (!workbook.SheetNames.length) {
    throw new Error("Workbook has no sheets.");
  }

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  const rows = rawRows.map((row) => {
    const normalised = {};
    for (const [key, value] of Object.entries(row)) {
      normalised[normaliseHeader(key)] = value;
    }
    return normalised;
  });

  return buildCountryRatesFromRows(rows);
}

function isCsvFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".csv") || type.includes("csv");
}

function isXlsxFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    type.includes("spreadsheetml") ||
    type.includes("excel") ||
    type.includes("officedocument")
  );
}

async function importCountryRatesFromFile() {
  const file = ratesFileInput.files?.[0];
  if (!file) {
    setDtaStatus("Choose a .xlsx or .csv rates file first.");
    return;
  }

  try {
    let importedRates;
    if (isCsvFile(file)) {
      importedRates = parseCountryRatesFromCsv(await file.text());
    } else if (isXlsxFile(file)) {
      importedRates = await parseCountryRatesFromXlsx(file);
    } else {
      throw new Error("Unsupported rates file type. Use .xlsx or .csv.");
    }

    dtaCountryRates = importedRates;
    saveDtaCountryRates(dtaCountryRates);

    const recanonicalisedMap = {};
    for (const [airportCode, country] of Object.entries(airportCountryMap || {})) {
      recanonicalisedMap[airportCode] = canonicaliseCountryNameForInput(country, dtaCountryRates);
    }
    airportCountryMap = recanonicalisedMap;
    saveAirportCountryMap(airportCountryMap, null, dtaCountryRates);

    renderCountryOptions();
    suggestAirportDetailsForCode();
    setDtaStatus(`Imported ${Object.keys(dtaCountryRates).length} country rates and saved for future reference.`);

    if (patternSelect.value) {
      updateDtaSummaryForSelection();
    }
  } catch (error) {
    console.error(error);
    setDtaStatus(`Could not import rates: ${error.message || "invalid file format"}.`);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadCountryRateTable() {
  const lines = ["Country,Cost Group,Meal Rate,Incidental Rate,Hourly Rate"];
  for (const row of getCountryRateRows(dtaCountryRates)) {
    lines.push(
      [
        csvEscape(row.country),
        csvEscape(row.costGroup || ""),
        Number(row.mealRate).toFixed(2),
        Number(row.incidentalRate).toFixed(2),
        Number(row.hourlyRate).toFixed(2),
      ].join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dta_country_rates.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);

  setDtaStatus("Downloaded current country rates table.");
}

function suggestAirportDetailsForCode() {
  const airportCode = normaliseAirportCodeForInput(newAirportCodeInput.value);
  newAirportCodeInput.value = airportCode;

  if (!/^[A-Z]{3}$/.test(airportCode)) {
    newAirportCountryInput.value = "";
    newAirportRateInput.value = "";
    saveUiState();
    return;
  }

  const details = getHourlyRateForAirport(airportCode, dtaCountryRates, airportCountryMap, airportRateOverrides);
  newAirportCountryInput.value = details.country || "";
  newAirportRateInput.value = details.rate == null ? "" : Number(details.rate).toFixed(2);
  saveUiState();
}

function addOrUpdateAirportMapping(event) {
  event.preventDefault();

  const airportCode = normaliseAirportCodeForInput(newAirportCodeInput.value);
  if (!/^[A-Z]{3}$/.test(airportCode)) {
    setDtaStatus("Enter a valid 3-letter airport code.");
    return;
  }

  const rawCountry = String(newAirportCountryInput.value || "").trim();
  if (!rawCountry) {
    setDtaStatus("Enter the country for this airport.");
    return;
  }

  const rawRate = String(newAirportRateInput.value || "").trim();
  if (!rawRate) {
    setDtaStatus("Enter a valid hourly rate.");
    return;
  }

  const hourlyRate = Number(rawRate);
  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    setDtaStatus("Enter a valid positive hourly rate.");
    return;
  }

  const country = canonicaliseCountryNameForInput(rawCountry, dtaCountryRates);
  airportCountryMap[airportCode] = country;
  saveAirportCountryMap(airportCountryMap, null, dtaCountryRates);

  airportRateOverrides[airportCode] = hourlyRate;
  saveAirportRateOverrides(airportRateOverrides);

  newAirportCodeInput.value = airportCode;
  newAirportCountryInput.value = country;
  newAirportRateInput.value = Number(hourlyRate).toFixed(2);
  setDtaStatus(`Saved ${airportCode}: ${country} at $${Number(hourlyRate).toFixed(2)}/hr for future reference.`);
  saveUiState();

  if (patternSelect.value) {
    updateDtaSummaryForSelection();
  }
}

async function parseSelectedFile() {
  const files = Array.from(rosterFileInput.files || []);
  if (!files.length) {
    setStatus("Choose one or more roster .txt or .pdf files first.");
    return;
  }

  const failures = [];
  let successCount = 0;
  let lastSuccessfulRoster = null;
  let lastSuccessfulMeta = null;

  for (const file of files) {
    try {
      setStatus(`Parsing ${file.name}...`);
      if (isPdfFile(file)) {
        setStatus(`Reading PDF roster ${file.name}...`);
      }

      const text = await readRosterFileText(file);
      const nextRoster = parseRosterText(text);
      const nextMeta = {
        source: "manual-file",
        fileName: file.name,
        loadedAtUtc: new Date().toISOString(),
      };

      if (!nextRoster?.events?.length) {
        failures.push(`${file.name}: no supported roster events found`);
        continue;
      }

      parsedRoster = nextRoster;
      currentRosterMeta = nextMeta;
      savedMealDocketComparisons = [];
      applyRosterToUi({ restoreSelection: false });
      lastSuccessfulRoster = nextRoster;
      lastSuccessfulMeta = currentRosterMeta;
      successCount += 1;
    } catch (error) {
      console.error(error);
      failures.push(`${file.name}: ${error?.message || "parse failed"}`);
    }
  }

  if (!successCount || !lastSuccessfulRoster) {
    parsedRoster = null;
    currentRosterMeta = null;
    setSourceDetails("No roster loaded yet.");
    resetPatternsTable("No roster parsed yet.");
    resetDtaPatternSelect("Parse or select a saved roster first");
    resetDtaSummary("No DTA calculation yet.");
    setDtaStatus("Unable to calculate DTA because parsing failed.");
    setStatus(
      failures.length ? `Could not parse selected rosters. ${failures[0]}` : "Could not parse selected rosters."
    );
    return;
  }

  parsedRoster = lastSuccessfulRoster;
  currentRosterMeta = lastSuccessfulMeta;
  renderSourceDetailsFromMeta();
  saveUiState();

  const successLabel = successCount === 1 ? "roster" : "rosters";
  const failureLabel = failures.length ? ` ${failures.length} failed.` : "";
  setStatus(
    `Saved ${successCount} ${successLabel} to the local library. Current roster is BP${parsedRoster.bidPeriod} for staff ${parsedRoster.staffNumber || "unknown"}.${failureLabel}`
  );

  if (failures.length) {
    setDtaStatus(`Parsed ${successCount} rosters. Check the saved roster library and re-upload any failed files if needed.`);
  }
}

async function checkUploadedMealDocket() {
  const files = Array.from(mealDocketFileInput.files || []);
  if (!files.length) {
    setMealDocketStatus("Choose one or more meal-docket files first.");
    return;
  }

  if (files.some((file) => !isMealDocketFile(file))) {
    setMealDocketStatus("Unsupported file type. Use meal-docket PDF, TXT, or RTF files.");
    return;
  }

  try {
    const allBlocks = [];
    const fileNames = [];

    for (const file of files) {
      setMealDocketStatus(`Reading ${file.name}...`);
      const candidateTexts = await readMealDocketFileCandidates(file);
      let lastError = null;
      let bestBlocks = null;
      let bestScore = null;

      for (const candidateText of candidateTexts) {
        try {
          const parsedBlocks = parseMealDocketText(candidateText);
          if (parsedBlocks?.length) {
            const score = scoreMealDocketBlocks(parsedBlocks);
            if (isBetterMealDocketScore(score, bestScore)) {
              bestBlocks = parsedBlocks;
              bestScore = score;
            }
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (!bestBlocks?.length) {
        throw lastError || new Error(`No meal-docket pattern blocks found in ${file.name}.`);
      }

      allBlocks.push(...bestBlocks);
      fileNames.push(file.name);
    }

    if (!allBlocks.length) {
      throw new Error("No meal-docket pattern blocks found in the uploaded files.");
    }

    const fileLabel =
      fileNames.length === 1 ? fileNames[0] : `${fileNames[0]} (+${fileNames.length - 1} more)`;

    renderMealDocketComparison(allBlocks, {
      fileName: fileLabel,
      uploadedAtUtc: new Date().toISOString(),
      persist: true,
    });
  } catch (error) {
    console.error(error);
    resetMealDocketSummary("Could not parse the uploaded meal-docket file.");
    resetMealDocketLines("Could not parse meal-docket line items.");
    setMealDocketStatus(`Could not parse meal docket: ${error?.message || "unrecognised layout"}.`);
  }
}

window.addEventListener("error", (event) => {
  console.error("Unhandled error", event.error || event.message);
  setStatus("App error occurred. Hard refresh and try again.");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection", event.reason);
  setStatus("App error occurred. Hard refresh and try again.");
});

parseBtn.addEventListener("click", parseSelectedFile);
clearLibraryBtn.addEventListener("click", clearSavedRosterLibrary);
toggleSavedRostersBtn.addEventListener("click", toggleSavedRostersSection);
checkDtaBtn.addEventListener("click", updateDtaSummaryForSelection);
checkMealDocketBtn.addEventListener("click", checkUploadedMealDocket);
patternSelect.addEventListener("change", saveUiState);
importRatesBtn.addEventListener("click", importCountryRatesFromFile);
downloadRatesBtn.addEventListener("click", downloadCountryRateTable);
newAirportCodeInput.addEventListener("input", suggestAirportDetailsForCode);
newAirportCountryInput.addEventListener("input", saveUiState);
newAirportRateInput.addEventListener("input", saveUiState);
addAirportMapForm.addEventListener("submit", addOrUpdateAirportMapping);

rosterFileInput.addEventListener("change", () => {
  parsedRoster = null;
  currentRosterMeta = null;
  dtaPatterns = [];
  verifiedPatternIds = new Set();
  savedMealDocketComparisons = [];
  resetPatternsTable("No roster parsed yet.");
  resetDtaPatternSelect("Parse or select a saved roster first");
  resetDtaSummary("No DTA calculation yet.");
  resetMealDocketSummary("No meal-docket comparison yet.");
  resetMealDocketLines("No meal-docket line items yet.");
  const selectedCount = Array.from(rosterFileInput.files || []).length;
  const label = selectedCount === 1 ? "roster" : "rosters";
  setDtaStatus(`Selected ${selectedCount} ${label}. Click "Parse selected rosters".`);
  setMealDocketStatus("Upload a meal-docket file to compare actual flown DTA with the planned roster pattern.");
  setStatus(`Selected ${selectedCount} ${label}. Click "Parse selected rosters".`);
  setSourceDetails("No roster loaded yet.");
});

mealDocketFileInput.addEventListener("change", () => {
  const files = Array.from(mealDocketFileInput.files || []);
  resetMealDocketSummary("No meal-docket comparison yet.");
  resetMealDocketLines("No meal-docket line items yet.");
  if (!files.length) {
    setMealDocketStatus("Upload a meal-docket file to compare actual flown DTA with the planned roster pattern.");
    return;
  }
  const label =
    files.length === 1 ? files[0].name : `${files.length} meal-docket files selected. Click "Check Uploaded Meal Dockets".`;
  setMealDocketStatus(label);
});

registerServiceWorker();
renderCountryOptions();
resetPatternsTable();
rosterLibrary = loadRosterLibrary();
renderRosterLibrary();
resetDtaPatternSelect("Parse or select a saved roster first");
resetDtaSummary("No DTA calculation yet.");
resetMealDocketSummary("No meal-docket comparison yet.");
resetMealDocketLines("No meal-docket line items yet.");
setDtaStatus("Parse or select a saved roster, then choose a pattern.");
setMealDocketStatus("Upload a meal-docket file to compare actual flown DTA with the planned roster pattern.");

restoreUiState();
const restoredRosterId = getSavedSelectedRosterId();
if (restoredRosterId && rosterLibrary.some((entry) => entry.libraryId === restoredRosterId)) {
  loadSavedRoster(restoredRosterId);
} else if (rosterLibrary.length) {
  loadSavedRoster(sortRosterLibrary(rosterLibrary)[0].libraryId);
} else {
  setStatus(`Ready (v${APP_VERSION}). Choose a roster file or select a saved bid period.`);
  setSourceDetails("No roster loaded yet.");
}
