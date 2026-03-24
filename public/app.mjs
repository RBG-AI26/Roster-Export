import { parseRosterText, rosterToIcs } from "./rosterParser.mjs?v=20260324f";

const APP_VERSION = "2026-03-24f";
const SERVICE_WORKER_URL = "./sw.js?v=20260324f";
const LAST_ROSTER_STORAGE_KEY = "rosterExport.lastRoster.v1";
const UI_STATE_STORAGE_KEY = "rosterExport.uiState.v2";
const EXPORT_SNAPSHOT_STORAGE_KEY = "rosterExport.lastExportSnapshot.v1";
const SUBSCRIBED_CALENDAR_STORAGE_KEY = "rosterExport.subscribedCalendar.v3";
const ADMIN_PASSWORD_SESSION_KEY = "rosterExport.adminPassword.v1";
const SECTION_STATE_STORAGE_KEY = "rosterExport.sectionState.v1";

const rosterFileInput = document.getElementById("rosterFile");
const parseBtn = document.getElementById("parseBtn");
const downloadBtn = document.getElementById("downloadBtn");
const staffNumberInput = document.getElementById("staffNumber");
const publishBtn = document.getElementById("publishBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const resetCalendarBtn = document.getElementById("resetCalendarBtn");
const statusEl = document.getElementById("status");
const buildVersionEl = document.getElementById("buildVersion");
const subscriptionStatusEl = document.getElementById("subscriptionStatus");
const subscriptionLinkWrap = document.getElementById("subscriptionLinkWrap");
const subscriptionLinkEl = document.getElementById("subscriptionLink");
const eventsBody = document.getElementById("eventsBody");
const toggleAdminSectionBtn = document.getElementById("toggleAdminSectionBtn");
const adminSectionContent = document.getElementById("adminSectionContent");
const adminPasswordInput = document.getElementById("adminPassword");
const adminUnlockBtn = document.getElementById("adminUnlockBtn");
const adminRefreshBtn = document.getElementById("adminRefreshBtn");
const adminStatusEl = document.getElementById("adminStatus");
const adminPanel = document.getElementById("adminPanel");
const adminStaffForm = document.getElementById("adminStaffForm");
const adminStaffNumberInput = document.getElementById("adminStaffNumber");
const adminStaffNameInput = document.getElementById("adminStaffName");
const adminStaffEmailInput = document.getElementById("adminStaffEmail");
const adminStaffActiveInput = document.getElementById("adminStaffActive");
const adminStaffBody = document.getElementById("adminStaffBody");
const adminLogsBody = document.getElementById("adminLogsBody");
const toggleEventsPreviewBtn = document.getElementById("toggleEventsPreviewBtn");
const eventsPreviewContent = document.getElementById("eventsPreviewContent");

const patternSelect = document.getElementById("patternSelect");
const checkDtaBtn = document.getElementById("checkDtaBtn");
const dtaStatusEl = document.getElementById("dtaStatus");
const dtaSummaryBody = document.getElementById("dtaSummaryBody");
const countryOptions = document.getElementById("countryOptions");
const ratesFileInput = document.getElementById("ratesFile");
const importRatesBtn = document.getElementById("importRatesBtn");
const downloadRatesBtn = document.getElementById("downloadRatesBtn");
const addAirportMapForm = document.getElementById("addAirportMapForm");
const newAirportCodeInput = document.getElementById("newAirportCode");
const newAirportCountryInput = document.getElementById("newAirportCountry");
const newAirportRateInput = document.getElementById("newAirportRate");
const toggleDtaSectionBtn = document.getElementById("toggleDtaSectionBtn");
const dtaSectionContent = document.getElementById("dtaSectionContent");

const dtaFeatureEnabled =
  !!patternSelect &&
  !!checkDtaBtn &&
  !!dtaStatusEl &&
  !!dtaSummaryBody &&
  !!countryOptions &&
  !!ratesFileInput &&
  !!importRatesBtn &&
  !!downloadRatesBtn &&
  !!addAirportMapForm &&
  !!newAirportCodeInput &&
  !!newAirportCountryInput &&
  !!newAirportRateInput;

let parsedRoster = null;
let currentFileName = null;
let lastRosterText = "";
let dtaPatterns = [];
let dtaCountryRates = {};
let airportCountryMap = {};
let airportRateOverrides = {};
let pendingRestoredPatternId = "";
let uiStateWasRestored = false;
let subscribedCalendarState = null;
let adminPassword = "";

let dtaModuleReady = false;
let calculateDtaForPattern = () => null;
let getDtaPatterns = () => [];
let loadDtaCountryRates = () => ({});
let saveDtaCountryRates = () => {};
let loadAirportCountryMap = () => ({});
let saveAirportCountryMap = () => {};
let loadAirportRateOverrides = () => ({});
let saveAirportRateOverrides = () => {};
let getHourlyRateForAirport = () => ({ rate: null, source: "missing-airport-map", country: "", costGroup: "" });
let getCountryRateRows = () => [];
let getKnownCountries = () => [];
let normaliseAirportCodeForInput = (value) => String(value || "").trim().toUpperCase();
let canonicaliseCountryNameForInput = (value) => String(value || "").trim();
let defaultFallbackRate = { costGroup: "1", mealRate: 5, incidentalRate: 1.25, hourlyRate: 6.25 };

let pdfJsModulePromise = null;
let xlsxModulePromise = null;

if (buildVersionEl) {
  buildVersionEl.textContent = `Build ${APP_VERSION}`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setSubscriptionStatus(message) {
  if (subscriptionStatusEl) {
    subscriptionStatusEl.textContent = message;
  }
}

function setSubscriptionLink(url) {
  if (!subscriptionLinkWrap || !subscriptionLinkEl) {
    return;
  }

  if (!url) {
    subscriptionLinkWrap.hidden = true;
    subscriptionLinkEl.removeAttribute("href");
    subscriptionLinkEl.textContent = "";
    return;
  }

  subscriptionLinkWrap.hidden = false;
  subscriptionLinkEl.href = url;
  subscriptionLinkEl.textContent = url;
}

function getSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function loadAdminPassword() {
  const storage = getSessionStorage();
  if (!storage) {
    return "";
  }

  try {
    return String(storage.getItem(ADMIN_PASSWORD_SESSION_KEY) || "");
  } catch {
    return "";
  }
}

function saveAdminPassword(value) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(ADMIN_PASSWORD_SESSION_KEY, String(value || ""));
  } catch {
    // Ignore storage failures.
  }
}

function clearAdminPassword() {
  adminPassword = "";
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.removeItem(ADMIN_PASSWORD_SESSION_KEY);
    } catch {
      // Ignore storage failures.
    }
  }
  if (adminPasswordInput) {
    adminPasswordInput.value = "";
  }
}

function setAdminStatus(message) {
  if (adminStatusEl) {
    adminStatusEl.textContent = message;
  }
}

function renderAdminStaff(staff = []) {
  if (!adminStaffBody) {
    return;
  }

  adminStaffBody.innerHTML = "";
  if (!staff.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No approved staff yet.";
    row.appendChild(cell);
    adminStaffBody.appendChild(row);
    return;
  }

  for (const entry of staff) {
    const row = document.createElement("tr");
    const values = [
      entry.staffNumber,
      entry.name || "",
      entry.email || "",
      entry.active ? "Yes" : "No",
      entry.latestBidPeriod ? `BP${entry.latestBidPeriod}` : "",
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value || "");
      row.appendChild(cell);
    }

    const linkCell = document.createElement("td");
    if (entry.subscriptionUrl) {
      const link = document.createElement("a");
      link.href = entry.subscriptionUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open";
      linkCell.appendChild(link);
    } else {
      linkCell.textContent = "";
    }
    row.appendChild(linkCell);
    adminStaffBody.appendChild(row);
  }
}

function renderAdminLogs(logs = []) {
  if (!adminLogsBody) {
    return;
  }

  adminLogsBody.innerHTML = "";
  if (!logs.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No intake activity logged yet.";
    row.appendChild(cell);
    adminLogsBody.appendChild(row);
    return;
  }

  for (const entry of logs) {
    const row = document.createElement("tr");
    const values = [
      entry.createdAtUtc || "",
      entry.type || "",
      entry.staffNumber || "",
      entry.fileName || "",
      entry.message || "",
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value || "");
      row.appendChild(cell);
    }
    adminLogsBody.appendChild(row);
  }
}

function updateAdminUi() {
  if (adminPanel) {
    adminPanel.hidden = !adminPassword;
  }
  if (adminRefreshBtn) {
    adminRefreshBtn.disabled = !adminPassword;
  }
}

async function adminApiFetch(path, options = {}) {
  if (!adminPassword) {
    throw new Error("Enter the admin password first.");
  }

  const headers = {
    ...(options.headers || {}),
    "x-admin-password": adminPassword,
  };
  if (options.body) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      clearAdminPassword();
      updateAdminUi();
    }
    throw new Error(String(data?.error || "Admin request failed."));
  }
  return data;
}

async function refreshAdminData() {
  if (!adminPassword) {
    updateAdminUi();
    setAdminStatus("Enter the admin password to manage approved staff.");
    return;
  }

  updateAdminUi();
  setAdminStatus("Loading admin data...");

  try {
    const [staffData, logData] = await Promise.all([
      adminApiFetch("./api/admin/staff"),
      adminApiFetch("./api/admin/logs"),
    ]);
    renderAdminStaff(staffData.staff || []);
    renderAdminLogs(logData.logs || []);
    setAdminStatus("Admin data loaded.");
  } catch (error) {
    console.error(error);
    setAdminStatus(error?.message || "Could not load admin data.");
  }
}

async function unlockAdmin() {
  const nextPassword = String(adminPasswordInput?.value || "").trim();
  if (!nextPassword) {
    setAdminStatus("Enter the admin password.");
    return;
  }

  adminPassword = nextPassword;
  saveAdminPassword(adminPassword);
  await refreshAdminData();
}

async function saveApprovedStaffEntry(event) {
  event.preventDefault();

  const payload = {
    staffNumber: normaliseStaffNumber(adminStaffNumberInput?.value || ""),
    name: String(adminStaffNameInput?.value || "").trim(),
    email: String(adminStaffEmailInput?.value || "").trim(),
    active: Boolean(adminStaffActiveInput?.checked),
  };

  if (payload.staffNumber.length < 4) {
    setAdminStatus("Staff number must include at least 4 digits.");
    return;
  }
  if (!payload.email) {
    setAdminStatus("Enter the approved recipient email address.");
    return;
  }

  setAdminStatus(`Saving approved staff ${payload.staffNumber}...`);

  try {
    await adminApiFetch("./api/admin/staff", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (adminStaffForm) {
      adminStaffForm.reset();
    }
    if (adminStaffActiveInput) {
      adminStaffActiveInput.checked = true;
    }
    await refreshAdminData();
    setAdminStatus(`Saved approved staff ${payload.staffNumber}.`);
  } catch (error) {
    console.error(error);
    setAdminStatus(error?.message || "Could not save approved staff.");
  }
}

function canUseSubscribedCalendarPublishing() {
  const host = window.location.hostname;
  return window.isSecureContext || host === "localhost" || host === "127.0.0.1";
}

function normaliseSubscribedCalendarState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return null;
  }

  const state = {
    staffNumber: normaliseStaffNumber(rawState.staffNumber || rawState.calendarCode || ""),
    subscriptionUrl: String(rawState.subscriptionUrl || "").trim(),
    webcalUrl: String(rawState.webcalUrl || "").trim(),
    bidPeriod: String(rawState.bidPeriod || "").trim(),
    updatedAtUtc: String(rawState.updatedAtUtc || "").trim(),
  };

  if (!state.staffNumber || !state.subscriptionUrl) {
    return null;
  }

  return state;
}

function normaliseStaffNumber(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function readStaffNumber() {
  return normaliseStaffNumber(staffNumberInput?.value || "");
}

function loadSubscribedCalendarState() {
  return normaliseSubscribedCalendarState(loadJsonState(SUBSCRIBED_CALENDAR_STORAGE_KEY));
}

function saveSubscribedCalendarState(state) {
  const normalised = normaliseSubscribedCalendarState(state);
  if (!normalised) {
    return;
  }

  saveJsonState(SUBSCRIBED_CALENDAR_STORAGE_KEY, normalised);
}

function clearSubscribedCalendarState() {
  const storage = getAppStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(SUBSCRIBED_CALENDAR_STORAGE_KEY);
  } catch {
    // Ignore storage failures and continue.
  }
}

function updateSubscribedCalendarUi() {
  const canPublish = canUseSubscribedCalendarPublishing();
  const staffNumber = readStaffNumber();
  const hasCalendar = Boolean(subscribedCalendarState?.subscriptionUrl);
  const isMatchingStaffNumber = hasCalendar && subscribedCalendarState?.staffNumber === staffNumber;
  const rosterMatchesStaffNumber = !parsedRoster || !staffNumber || parsedRoster.staffNumber === staffNumber;

  if (publishBtn) {
    publishBtn.disabled = !parsedRoster || !canPublish || staffNumber.length < 4 || !rosterMatchesStaffNumber;
    publishBtn.textContent = isMatchingStaffNumber ? "Update My Calendar" : "Create / Link My Calendar";
  }
  if (copyLinkBtn) {
    copyLinkBtn.disabled = !isMatchingStaffNumber || !subscribedCalendarState?.subscriptionUrl;
  }
  if (resetCalendarBtn) {
    resetCalendarBtn.disabled = !hasCalendar && !staffNumber;
  }

  const preferredLink = isMatchingStaffNumber
    ? subscribedCalendarState?.webcalUrl || subscribedCalendarState?.subscriptionUrl || ""
    : "";
  setSubscriptionLink(preferredLink);

  if (!subscriptionStatusEl) {
    return;
  }

  if (!canPublish) {
    setSubscriptionStatus("Subscribed calendar publishing is available when the app is served from the Cloudflare Worker over HTTPS.");
    return;
  }

  if (staffNumber.length > 0 && staffNumber.length < 4) {
    setSubscriptionStatus("Enter your staff number using at least 4 digits.");
    return;
  }

  if (parsedRoster && staffNumber && !rosterMatchesStaffNumber) {
    setSubscriptionStatus(`This roster is for staff number ${parsedRoster.staffNumber}. Enter that same staff number to publish or copy the correct subscription link.`);
    return;
  }

  if (isMatchingStaffNumber) {
    setSubscriptionStatus("Your subscribed calendar is linked on this device.");
    return;
  }

  if (staffNumber) {
    setSubscriptionStatus(parsedRoster ? "Ready to create or link your subscribed calendar for this staff number." : "Enter your staff number, then parse a roster to create or link your calendar.");
    return;
  }

  setSubscriptionStatus("Parse a roster, enter your staff number, then create or link your subscribed calendar.");
}

function resetSubscribedCalendar() {
  clearSubscribedCalendarState();
  subscribedCalendarState = null;
  if (staffNumberInput) {
    staffNumberInput.value = "";
  }
  saveUiState();
  updateSubscribedCalendarUi();
  setSubscriptionStatus("This device no longer remembers a staff number or subscribed link. Enter the same staff number again when you want to link that calendar.");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "readonly");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function setDtaStatus(message) {
  if (!dtaFeatureEnabled) {
    return;
  }
  dtaStatusEl.textContent = message;
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

function getAppStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function loadJsonState(key) {
  const storage = getAppStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveJsonState(key, value) {
  const storage = getAppStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/storage errors and continue with in-memory state.
  }
}

function loadSectionState() {
  return loadJsonState(SECTION_STATE_STORAGE_KEY) || {};
}

function saveSectionState(state) {
  saveJsonState(SECTION_STATE_STORAGE_KEY, state || {});
}

function setSectionCollapsed(buttonEl, contentEl, collapsed) {
  if (!buttonEl || !contentEl) {
    return;
  }

  const isCollapsed = Boolean(collapsed);
  contentEl.hidden = isCollapsed;
  buttonEl.setAttribute("aria-expanded", String(!isCollapsed));
  buttonEl.textContent = isCollapsed ? "Expand" : "Collapse";
}

function applySavedSectionState() {
  const state = loadSectionState();
  setSectionCollapsed(toggleAdminSectionBtn, adminSectionContent, state.admin === true);
  setSectionCollapsed(toggleEventsPreviewBtn, eventsPreviewContent, state.events === true);
  setSectionCollapsed(toggleDtaSectionBtn, dtaSectionContent, state.dta === true);
}

function toggleSection(sectionKey, buttonEl, contentEl) {
  if (!buttonEl || !contentEl) {
    return;
  }

  const state = loadSectionState();
  const nextCollapsed = !contentEl.hidden;
  state[sectionKey] = nextCollapsed;
  saveSectionState(state);
  setSectionCollapsed(buttonEl, contentEl, nextCollapsed);
}

function saveUiState() {
  const payload = {
    selectedPatternId: dtaFeatureEnabled ? String(patternSelect.value || "") : "",
    airportCode: dtaFeatureEnabled ? String(newAirportCodeInput.value || "") : "",
    airportCountry: dtaFeatureEnabled ? String(newAirportCountryInput.value || "") : "",
    airportRate: dtaFeatureEnabled ? String(newAirportRateInput.value || "") : "",
    staffNumber: readStaffNumber(),
  };
  saveJsonState(UI_STATE_STORAGE_KEY, payload);
}

function restoreUiState() {
  if (!dtaFeatureEnabled) {
    return null;
  }

  const state = loadJsonState(UI_STATE_STORAGE_KEY);
  if (!state) {
    return null;
  }

  uiStateWasRestored = true;

  if (typeof state.airportCode === "string") {
    newAirportCodeInput.value = state.airportCode;
  }
  if (typeof state.airportCountry === "string") {
    newAirportCountryInput.value = state.airportCountry;
  }
  if (typeof state.airportRate === "string") {
    newAirportRateInput.value = state.airportRate;
  }
  if (typeof state.selectedPatternId === "string") {
    pendingRestoredPatternId = state.selectedPatternId;
  }
  if (staffNumberInput) {
    const restoredStaffNumber = normaliseStaffNumber(state.staffNumber || state.calendarCode || "");
    if (restoredStaffNumber) {
      staffNumberInput.value = restoredStaffNumber;
    }
  }

  return state;
}

function saveLastRosterState() {
  if (!parsedRoster || parsedRoster.events.length === 0 || !lastRosterText) {
    return;
  }

  saveJsonState(LAST_ROSTER_STORAGE_KEY, {
    fileName: currentFileName || "roster.txt",
    rosterText: lastRosterText,
  });
}

function serialiseEventForSnapshot(event) {
  if (!event?.uid) {
    return null;
  }

  return {
    uid: String(event.uid),
    eventType: String(event.eventType || ""),
    timeKind: String(event.timeKind || ""),
    summary: String(event.summary || ""),
    dtStartUtc: event.dtStartUtc instanceof Date ? event.dtStartUtc.toISOString() : "",
    dtEndUtc: event.dtEndUtc instanceof Date ? event.dtEndUtc.toISOString() : "",
    dtStartDate: String(event.dtStartDate || ""),
    dtEndDate: String(event.dtEndDate || ""),
    dtStartLocal: String(event.dtStartLocal || ""),
    dtEndLocal: String(event.dtEndLocal || ""),
  };
}

function buildExportSnapshotFromRoster(roster) {
  if (!roster || !Array.isArray(roster.events)) {
    return null;
  }

  return {
    bidPeriod: String(roster.bidPeriod || ""),
    savedAtUtc: new Date().toISOString(),
    events: roster.events.map(serialiseEventForSnapshot).filter(Boolean),
  };
}

function normaliseExportSnapshotStore(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return {};
  }

  if (Array.isArray(rawState.events) && typeof rawState.bidPeriod === "string") {
    return {
      [rawState.bidPeriod]: rawState,
    };
  }

  const snapshots = rawState.snapshots;
  if (!snapshots || typeof snapshots !== "object") {
    return {};
  }

  const byBidPeriod = {};
  for (const [bidPeriod, snapshot] of Object.entries(snapshots)) {
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.events)) {
      continue;
    }
    byBidPeriod[String(bidPeriod)] = snapshot;
  }

  return byBidPeriod;
}

function loadExportSnapshots() {
  return normaliseExportSnapshotStore(loadJsonState(EXPORT_SNAPSHOT_STORAGE_KEY));
}

function saveExportSnapshots(snapshots) {
  saveJsonState(EXPORT_SNAPSHOT_STORAGE_KEY, {
    snapshots,
  });
}

function loadExportSnapshotForBidPeriod(bidPeriod) {
  const snapshots = loadExportSnapshots();
  return snapshots[String(bidPeriod || "")] || null;
}

function saveExportSnapshotForBidPeriod(snapshot) {
  if (!snapshot?.bidPeriod) {
    return;
  }

  const snapshots = loadExportSnapshots();
  snapshots[String(snapshot.bidPeriod)] = snapshot;
  saveExportSnapshots(snapshots);
}

function getCancelledEventsForRoster(roster) {
  const previousSnapshot = loadExportSnapshotForBidPeriod(roster?.bidPeriod);
  if (!previousSnapshot) {
    return [];
  }

  const currentUids = new Set(
    roster.events.map((event) => String(event?.uid || "")).filter((uid) => uid.length > 0)
  );

  return previousSnapshot.events.filter((event) => {
    const uid = String(event?.uid || "");
    return uid.length > 0 && !currentUids.has(uid);
  });
}

function restoreLastRosterState() {
  const state = loadJsonState(LAST_ROSTER_STORAGE_KEY);
  if (!state?.rosterText || typeof state.rosterText !== "string") {
    return false;
  }

  try {
    parsedRoster = parseRosterText(state.rosterText);
    currentFileName = String(state.fileName || "roster.txt");
    lastRosterText = state.rosterText;
  } catch {
    return false;
  }

  renderPreview(parsedRoster.events);
  if (parsedRoster.events.length === 0) {
    parsedRoster = null;
    currentFileName = null;
    lastRosterText = "";
    resetPreview();
    downloadBtn.disabled = true;
    return false;
  }

  downloadBtn.disabled = false;
  setStatus(
    `Restored BP${parsedRoster.bidPeriod} for staff ${parsedRoster.staffNumber || "unknown"}: ${parsedRoster.counts.flights} flights + ${parsedRoster.counts.patterns} patterns + ${parsedRoster.counts.training} SIM/training + ${parsedRoster.counts.dayMarkers} A/X days + ${(parsedRoster.counts.leaveDays || 0)} leave days + ${(parsedRoster.counts.standby || 0)} standby duties = ${parsedRoster.counts.total} total events.`
  );

  return true;
}

async function initDtaModule() {
  if (!dtaFeatureEnabled) {
    return;
  }

  try {
    const dtaModule = await import("./dta.mjs");
    calculateDtaForPattern = dtaModule.calculateDtaForPattern;
    getDtaPatterns = dtaModule.getDtaPatterns;
    loadDtaCountryRates = dtaModule.loadDtaCountryRates;
    saveDtaCountryRates = dtaModule.saveDtaCountryRates;
    loadAirportCountryMap = dtaModule.loadAirportCountryMap;
    saveAirportCountryMap = dtaModule.saveAirportCountryMap;
    loadAirportRateOverrides = dtaModule.loadAirportRateOverrides;
    saveAirportRateOverrides = dtaModule.saveAirportRateOverrides;
    getHourlyRateForAirport = dtaModule.getHourlyRateForAirport;
    getCountryRateRows = dtaModule.getCountryRateRows;
    getKnownCountries = dtaModule.getKnownCountries;
    normaliseAirportCodeForInput = dtaModule.normaliseAirportCodeForInput;
    canonicaliseCountryNameForInput = dtaModule.canonicaliseCountryNameForInput;
    defaultFallbackRate = dtaModule.DEFAULT_FALLBACK_RATE || defaultFallbackRate;

    dtaCountryRates = loadDtaCountryRates();
    airportCountryMap = loadAirportCountryMap(null, dtaCountryRates);
    airportRateOverrides = loadAirportRateOverrides();

    dtaModuleReady = true;
    renderCountryOptions();
    const hasRestoredManualAirportValues =
      uiStateWasRestored &&
      (String(newAirportCountryInput.value || "").trim() !== "" || String(newAirportRateInput.value || "").trim() !== "");
    if (!hasRestoredManualAirportValues) {
      suggestAirportDetailsForCode();
    }
    if (parsedRoster) {
      refreshDtaForCurrentRoster(true);
    } else {
      setDtaStatus("Parse a roster, then select a pattern.");
    }
  } catch (error) {
    console.error("Failed to load DTA module", error);
    dtaModuleReady = false;
    dtaCountryRates = {};
    airportCountryMap = {};
    dtaPatterns = [];
    resetDtaPatternSelect("DTA module unavailable");
    resetDtaSummary("DTA module unavailable.");
    setDtaStatus("DTA module unavailable. Calendar parse/export still works.");
  }
}

function buildExportPayload(options = {}) {
  if (!parsedRoster) {
    return null;
  }

  const includeCancelledEvents = options.includeCancelledEvents !== false;
  const snapshot = buildExportSnapshotFromRoster(parsedRoster);
  const cancelledEvents = includeCancelledEvents ? getCancelledEventsForRoster(parsedRoster) : [];
  const content = rosterToIcs(parsedRoster, currentFileName || "roster.txt", { cancelledEvents });
  const fileName = `BP${parsedRoster.bidPeriod}_events.ics`;
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  return { content, fileName, blob, cancelledCount: cancelledEvents.length, snapshot };
}

async function publishSubscribedCalendar() {
  if (!canUseSubscribedCalendarPublishing()) {
    setSubscriptionStatus("Subscribed calendar publishing is available when the app is served from the Cloudflare Worker over HTTPS.");
    return;
  }

  const payload = buildExportPayload({ includeCancelledEvents: false });
  if (!payload || !parsedRoster) {
    setSubscriptionStatus("Parse a roster first.");
    return;
  }

  if (publishBtn) {
    publishBtn.disabled = true;
  }
  setSubscriptionStatus("Publishing subscribed calendar...");

  try {
    const staffNumber = readStaffNumber();
    if (staffNumber.length < 4) {
      throw new Error("Enter your staff number using at least 4 digits.");
    }
    if (!parsedRoster.staffNumber) {
      throw new Error("This roster does not include a staff number, so it cannot be linked to a subscribed calendar.");
    }
    if (parsedRoster.staffNumber !== staffNumber) {
      throw new Error(`This roster belongs to staff number ${parsedRoster.staffNumber}. Enter that same staff number to publish this calendar.`);
    }

    const requestBody = {
      bidPeriod: String(parsedRoster.bidPeriod || ""),
      fileName: payload.fileName,
      icsContent: payload.content,
      staffNumber,
      parsedStaffNumber: parsedRoster.staffNumber,
    };

    const response = await fetch("./api/subscribed-calendar", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      if (response.status === 404) {
        throw new Error("Publish API not found. Deploy this app through the Cloudflare Worker first.");
      }
      throw new Error(String(data?.error || "Could not publish subscribed calendar."));
    }

    const nextState = normaliseSubscribedCalendarState({ ...data, staffNumber: readStaffNumber() });
    if (!nextState) {
      throw new Error("Publish response did not include the calendar subscription link.");
    }

    const wasExistingCalendar =
      Boolean(subscribedCalendarState?.subscriptionUrl) && subscribedCalendarState?.staffNumber === nextState.staffNumber;
    subscribedCalendarState = nextState;
    saveSubscribedCalendarState(nextState);
    persistSuccessfulExport(payload.snapshot);
    updateSubscribedCalendarUi();
    setSubscriptionStatus(
      wasExistingCalendar
        ? "Subscribed calendar updated. Apple Calendar will pick up the same link on its next refresh."
        : "Subscribed calendar created. Copy the link and subscribe to it once in Apple Calendar."
    );
    setStatus(wasExistingCalendar ? "Subscribed calendar updated successfully." : "Subscribed calendar created successfully.");
  } catch (error) {
    console.error(error);
    if (String(error?.message || "").toLowerCase().includes("staff number")) {
      clearSubscribedCalendarState();
      subscribedCalendarState = null;
      updateSubscribedCalendarUi();
    }
    setSubscriptionStatus(error?.message || "Could not publish subscribed calendar.");
  } finally {
    updateSubscribedCalendarUi();
  }
}

async function copySubscriptionLink() {
  const staffNumber = readStaffNumber();
  const isMatchingStaffNumber = subscribedCalendarState?.staffNumber === staffNumber;
  const link = isMatchingStaffNumber ? subscribedCalendarState?.webcalUrl || subscribedCalendarState?.subscriptionUrl || "" : "";
  if (!link) {
    setSubscriptionStatus("Publish a subscribed calendar for this staff number first.");
    return;
  }

  try {
    await copyTextToClipboard(link);
    setSubscriptionStatus("Subscription link copied. Add it in Calendar as a subscribed calendar.");
  } catch (error) {
    console.error(error);
    setSubscriptionStatus("Could not copy the subscription link automatically.");
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
      cells: cells.sort((a, b) => a.x - b.x),
    }))
    .sort((a, b) => b.y - a.y)
    .map((row) => row.cells.map((cell) => cell.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return rows.join("\n");
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

async function readRosterFileText(file) {
  if (isPdfFile(file)) {
    return extractTextFromPdf(file);
  }

  return file.text();
}

function resetPreview() {
  eventsBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = "No data yet.";
  row.appendChild(cell);
  eventsBody.appendChild(row);
}

function resetDtaSummary(message = "No DTA calculation yet.") {
  if (!dtaFeatureEnabled) {
    return;
  }
  dtaSummaryBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = message;
  row.appendChild(cell);
  dtaSummaryBody.appendChild(row);
}

function resetDtaPatternSelect(message = "Parse a roster first") {
  if (!dtaFeatureEnabled) {
    return;
  }
  patternSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  patternSelect.appendChild(option);
  patternSelect.disabled = true;
  checkDtaBtn.disabled = true;
}

function formatMoney(amount) {
  if (amount == null || Number.isNaN(amount)) {
    return "Need mapping";
  }
  return `$${amount.toFixed(2)}`;
}

function formatHours(hours) {
  return Number(hours || 0).toFixed(2);
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

function formatTimeBasis(startUtc, endUtc) {
  if (!(startUtc instanceof Date) || !(endUtc instanceof Date)) {
    return "-";
  }

  return `${formatUtcDateTime(startUtc)} to ${formatUtcDateTime(endUtc)}`;
}

function renderCountryOptions() {
  if (!dtaFeatureEnabled) {
    return;
  }

  countryOptions.innerHTML = "";
  for (const country of getKnownCountries(dtaCountryRates)) {
    const option = document.createElement("option");
    option.value = country;
    countryOptions.appendChild(option);
  }
}

function populatePatternSelect(patterns) {
  if (!dtaFeatureEnabled) {
    return;
  }
  if (!dtaModuleReady) {
    resetDtaPatternSelect("DTA module unavailable");
    setDtaStatus("DTA module unavailable.");
    resetDtaSummary("DTA module unavailable.");
    return;
  }

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
  setDtaStatus("Select a pattern code and click Check DTA.");
}

function refreshDtaForCurrentRoster(restoreSelection = false) {
  if (!dtaFeatureEnabled || !dtaModuleReady || !parsedRoster) {
    return;
  }

  dtaPatterns = getDtaPatterns(parsedRoster);
  populatePatternSelect(dtaPatterns);

  if (!dtaPatterns.length) {
    saveUiState();
    return;
  }

  if (restoreSelection && pendingRestoredPatternId) {
    const restoredPattern = dtaPatterns.find((pattern) => pattern.id === pendingRestoredPatternId);
    if (restoredPattern) {
      patternSelect.value = restoredPattern.id;
      pendingRestoredPatternId = "";
      checkSelectedPatternDta();
      return;
    }
    pendingRestoredPatternId = "";
  }

  resetDtaSummary("Select a pattern and click Check DTA.");
  saveUiState();
}

function renderDtaSummary(result) {
  if (!dtaFeatureEnabled) {
    return;
  }

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
      formatTimeBasis(segment.startUtc, segment.endUtc),
      formatRate(segment.rate, segment.rateSource),
      segment.hours,
      segment.amount
    );
  }
  addRow("Part A subtotal", "-", "-", result.partA.totalHours, result.partA.totalAmount);

  for (const segment of result.partB.segments) {
    addRow(
      `Part B layover ${segment.slipPort} @ ${segment.rateAirportCode}`,
      formatTimeBasis(segment.startUtc, segment.endUtc),
      formatRate(segment.rate, segment.rateSource),
      segment.hours,
      segment.amount
    );
  }
  addRow("Part B subtotal", "-", "-", result.partB.totalHours, result.partB.totalAmount);

  addRow("Total DTA", "-", "-", result.partA.totalHours + result.partB.totalHours, result.grandTotal);
}

function getSelectedPattern() {
  if (!dtaFeatureEnabled) {
    return null;
  }
  const selectedId = patternSelect.value;
  if (!selectedId) {
    return null;
  }

  return dtaPatterns.find((pattern) => pattern.id === selectedId) || null;
}

function checkSelectedPatternDta() {
  if (!dtaFeatureEnabled) {
    return;
  }
  if (!dtaModuleReady) {
    setDtaStatus("DTA module unavailable.");
    return;
  }

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
    setDtaStatus(
      `Need airport-country mapping for: ${missingList}. Add mapping below (saved for future), then check again.`
    );
    if (!newAirportCodeInput.value) {
      newAirportCodeInput.value = result.missingAirportCodes[0];
      suggestAirportDetailsForCode();
    }
    saveUiState();
    return;
  }

  const fallbackNote =
    result.fallbackCountriesUsed.length > 0
      ? ` Using default Cost Group 1 rate ($${defaultFallbackRate.hourlyRate.toFixed(2)}/hr) for: ${result.fallbackCountriesUsed.join(
          ", "
        )}.`
      : "";

  setDtaStatus(
    `DTA for ${result.patternCode} (${result.tripStartIso} to ${result.tripEndIso}) is ${formatMoney(
      result.grandTotal
    )}.${fallbackNote}`
  );
  saveUiState();
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
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
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }

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

    setDtaStatus(
      `Imported ${Object.keys(dtaCountryRates).length} country rates and saved for future reference.`
    );

    if (patternSelect.value) {
      checkSelectedPatternDta();
    }
  } catch (error) {
    console.error(error);
    setDtaStatus(`Could not import rates: ${error.message || "invalid file format"}.`);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCountryRateTable() {
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }

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
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }

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
  if (details.rate == null) {
    newAirportRateInput.value = "";
    saveUiState();
    return;
  }

  newAirportRateInput.value = Number(details.rate).toFixed(2);
  saveUiState();
}

function addOrUpdateAirportMapping(event) {
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }
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
    checkSelectedPatternDta();
  }
}

function renderPreview(events) {
  eventsBody.innerHTML = "";

  if (events.length === 0) {
    resetPreview();
    return;
  }

  for (const event of events) {
    const row = document.createElement("tr");
    for (const value of [
      event.previewType,
      event.previewCode,
      event.previewInfo,
      event.previewStart,
      event.previewEnd,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = String(value ?? "");
      row.appendChild(cell);
    }
    eventsBody.appendChild(row);
  }
}

function persistSuccessfulExport(snapshot) {
  saveExportSnapshotForBidPeriod(snapshot);
}

async function parseSelectedFile() {
  const file = rosterFileInput.files?.[0];
  if (!file) {
    setStatus("Choose a roster .txt or .pdf file first.");
    return;
  }

  try {
    currentFileName = file.name;
    setStatus(`Parsing ${file.name}...`);
    if (isPdfFile(file)) {
      setStatus("Reading PDF roster...");
    }

    const text = await readRosterFileText(file);
    parsedRoster = parseRosterText(text);
    lastRosterText = text;
    pendingRestoredPatternId = "";

    renderPreview(parsedRoster.events);

    if (dtaFeatureEnabled && dtaModuleReady) {
      refreshDtaForCurrentRoster();
    }

    if (parsedRoster.events.length === 0) {
      if (isPdfFile(file)) {
        setStatus("PDF read complete but no supported roster events were found.");
      } else {
        setStatus("No supported events found. Check the roster layout or file type.");
      }
      downloadBtn.disabled = true;
      if (dtaFeatureEnabled) {
        resetDtaPatternSelect("No patterns found in roster");
        setDtaStatus(dtaModuleReady ? "No patterns available to calculate DTA." : "DTA module unavailable.");
      }
      saveUiState();
      updateSubscribedCalendarUi();
      return;
    }

    setStatus(
      `Parsed BP${parsedRoster.bidPeriod} for staff ${parsedRoster.staffNumber || "unknown"}: ${parsedRoster.counts.flights} flights + ${parsedRoster.counts.patterns} patterns + ${parsedRoster.counts.training} SIM/training + ${parsedRoster.counts.dayMarkers} A/X days + ${(parsedRoster.counts.leaveDays || 0)} leave days + ${(parsedRoster.counts.standby || 0)} standby duties = ${parsedRoster.counts.total} total events.`
    );

    downloadBtn.disabled = false;
    saveLastRosterState();
    saveUiState();
    updateSubscribedCalendarUi();
  } catch (error) {
    console.error(error);
    if (isPdfFile(file)) {
      setStatus("Failed to read PDF roster. If this persists, export as text and parse that file.");
    } else {
      setStatus("Failed to parse roster file.");
    }

    downloadBtn.disabled = true;

    if (dtaFeatureEnabled) {
      resetDtaPatternSelect("Parse failed");
      resetDtaSummary("No DTA calculation yet.");
      setDtaStatus("Unable to calculate DTA because parsing failed.");
    }
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

function downloadIcs() {
  const payload = buildExportPayload();
  if (!payload) {
    setStatus("Parse a roster first.");
    return;
  }

  const url = URL.createObjectURL(payload.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
  persistSuccessfulExport(payload.snapshot);
  const cancellationSuffix =
    payload.cancelledCount > 0 ? ` including ${payload.cancelledCount} removed event cancellation(s)` : "";
  setStatus(`Downloaded ${payload.fileName}${cancellationSuffix}`);
}

parseBtn.addEventListener("click", parseSelectedFile);
downloadBtn.addEventListener("click", downloadIcs);
if (publishBtn) {
  publishBtn.addEventListener("click", publishSubscribedCalendar);
}
if (copyLinkBtn) {
  copyLinkBtn.addEventListener("click", copySubscriptionLink);
}
if (resetCalendarBtn) {
  resetCalendarBtn.addEventListener("click", resetSubscribedCalendar);
}
if (adminUnlockBtn) {
  adminUnlockBtn.addEventListener("click", unlockAdmin);
}
if (adminRefreshBtn) {
  adminRefreshBtn.addEventListener("click", refreshAdminData);
}
if (toggleAdminSectionBtn) {
  toggleAdminSectionBtn.addEventListener("click", () => toggleSection("admin", toggleAdminSectionBtn, adminSectionContent));
}
if (adminStaffForm) {
  adminStaffForm.addEventListener("submit", saveApprovedStaffEntry);
}
if (toggleEventsPreviewBtn) {
  toggleEventsPreviewBtn.addEventListener("click", () => toggleSection("events", toggleEventsPreviewBtn, eventsPreviewContent));
}
if (toggleDtaSectionBtn) {
  toggleDtaSectionBtn.addEventListener("click", () => toggleSection("dta", toggleDtaSectionBtn, dtaSectionContent));
}
if (staffNumberInput) {
  staffNumberInput.addEventListener("input", () => {
    saveUiState();
    updateSubscribedCalendarUi();
  });

  staffNumberInput.addEventListener("blur", () => {
    const normalised = readStaffNumber();
    if (normalised) {
      staffNumberInput.value = normalised;
    }
    saveUiState();
    updateSubscribedCalendarUi();
  });
}

if (dtaFeatureEnabled) {
  checkDtaBtn.addEventListener("click", checkSelectedPatternDta);
  patternSelect.addEventListener("change", saveUiState);
  importRatesBtn.addEventListener("click", importCountryRatesFromFile);
  downloadRatesBtn.addEventListener("click", downloadCountryRateTable);
  newAirportCodeInput.addEventListener("input", suggestAirportDetailsForCode);
  newAirportCountryInput.addEventListener("input", saveUiState);
  newAirportRateInput.addEventListener("input", saveUiState);
  addAirportMapForm.addEventListener("submit", addOrUpdateAirportMapping);
}

rosterFileInput.addEventListener("change", () => {
  downloadBtn.disabled = true;
  parsedRoster = null;

  if (dtaFeatureEnabled) {
    dtaPatterns = [];
    resetDtaPatternSelect("Parse a roster first");
    resetDtaSummary("No DTA calculation yet.");
    setDtaStatus('File selected. Click "Parse roster", then choose a pattern.');
  }

  setStatus('File selected. Click "Parse roster".');
  updateSubscribedCalendarUi();
});

registerServiceWorker();
resetPreview();
applySavedSectionState();
subscribedCalendarState = loadSubscribedCalendarState();
adminPassword = loadAdminPassword();
if (adminPasswordInput && adminPassword) {
  adminPasswordInput.value = adminPassword;
}
if (dtaFeatureEnabled) {
  restoreUiState();
}

const restoredRoster = restoreLastRosterState();
if (!restoredRoster) {
  setStatus(`Ready (v${APP_VERSION}). Choose a roster file, then click "Parse roster".`);
}

updateSubscribedCalendarUi();
updateAdminUi();
if (adminPassword) {
  refreshAdminData();
}

if (dtaFeatureEnabled) {
  resetDtaPatternSelect("Parse a roster first");
  resetDtaSummary("No DTA calculation yet.");
  setDtaStatus("Parse a roster, then select a pattern.");
  initDtaModule();
}
