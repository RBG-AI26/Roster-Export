import { parseRosterText, rosterToIcs } from "./rosterParser.mjs";

const rosterFileInput = document.getElementById("rosterFile");
const parseBtn = document.getElementById("parseBtn");
const downloadBtn = document.getElementById("downloadBtn");
const shareBtn = document.getElementById("shareBtn");
const statusEl = document.getElementById("status");
const eventsBody = document.getElementById("eventsBody");

let parsedRoster = null;
let currentFileName = null;

function isMacSafari() {
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  const isMac = /\bMacintosh\b/.test(ua);
  const isSafari = /Safari/.test(ua) && /Apple/.test(vendor) && !/Chrome|CriOS|Edg|OPR|Firefox/.test(ua);
  return isMac && isSafari;
}

function withAirdropHint(message) {
  if (!isMacSafari()) {
    return message;
  }

  return `${message} Tip: AirDrop to iPad from Finder (right-click the .ics file -> Share -> AirDrop).`;
}

function setStatus(message) {
  statusEl.textContent = message;
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

function renderPreview(events) {
  eventsBody.innerHTML = "";

  if (events.length === 0) {
    resetPreview();
    return;
  }

  for (const event of events) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${event.previewType}</td>
      <td>${event.previewCode}</td>
      <td>${event.previewInfo}</td>
      <td>${event.previewStart}</td>
      <td>${event.previewEnd}</td>
    `;

    eventsBody.appendChild(row);
  }
}

async function parseSelectedFile() {
  const file = rosterFileInput.files?.[0];
  if (!file) {
    setStatus("Choose a roster .txt file first.");
    return;
  }

  try {
    currentFileName = file.name;
    const text = await file.text();
    parsedRoster = parseRosterText(text);

    renderPreview(parsedRoster.events);

    if (parsedRoster.events.length === 0) {
      setStatus("No supported events found. Check the roster layout or file type.");
      downloadBtn.disabled = true;
      shareBtn.disabled = true;
      return;
    }

    setStatus(
      withAirdropHint(
        `Parsed BP${parsedRoster.bidPeriod}: ${parsedRoster.counts.flights} flights + ${parsedRoster.counts.patterns} patterns + ${parsedRoster.counts.training} SIM/training + ${parsedRoster.counts.dayMarkers} A/X days = ${parsedRoster.counts.total} total events.`
      )
    );
    downloadBtn.disabled = false;
    shareBtn.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus("Failed to parse roster file.");
    downloadBtn.disabled = true;
    shareBtn.disabled = true;
  }
}

function downloadIcs() {
  if (!parsedRoster) {
    setStatus("Parse a roster first.");
    return;
  }

  const content = rosterToIcs(parsedRoster, currentFileName || "roster.txt");
  const fileName = `BP${parsedRoster.bidPeriod}_events.ics`;
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(withAirdropHint(`Downloaded ${fileName}`));
}

async function shareForIpad() {
  if (!parsedRoster) {
    setStatus("Parse a roster first.");
    return;
  }

  const content = rosterToIcs(parsedRoster, currentFileName || "roster.txt");
  const fileName = `BP${parsedRoster.bidPeriod}_events.ics`;
  const file = new File([content], fileName, { type: "text/calendar;charset=utf-8" });

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: fileName,
        text: "Roster calendar export",
        files: [file],
      });
      setStatus(withAirdropHint("Shared .ics file. On iPad choose Calendar or Save to Files."));
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("Share cancelled.");
      return;
    }
    console.error(error);
  }

  downloadIcs();
  setStatus(withAirdropHint("Share not supported in this browser. Downloaded .ics instead."));
}

parseBtn.addEventListener("click", parseSelectedFile);
downloadBtn.addEventListener("click", downloadIcs);
shareBtn.addEventListener("click", shareForIpad);
rosterFileInput.addEventListener("change", () => {
  downloadBtn.disabled = true;
  shareBtn.disabled = true;
  parsedRoster = null;
  setStatus('File selected. Click "Parse roster".');
});

resetPreview();
