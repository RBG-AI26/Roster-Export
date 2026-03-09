import { parseRosterText, rosterToIcs } from "./rosterParser.mjs";

const rosterFileInput = document.getElementById("rosterFile");
const parseBtn = document.getElementById("parseBtn");
const downloadBtn = document.getElementById("downloadBtn");
const shareBtn = document.getElementById("shareBtn");
const openBtn = document.getElementById("openBtn");
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

function buildExportPayload() {
  if (!parsedRoster) {
    return null;
  }

  const content = rosterToIcs(parsedRoster, currentFileName || "roster.txt");
  const fileName = `BP${parsedRoster.bidPeriod}_events.ics`;
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  return { content, fileName, blob };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to convert calendar file."));
    reader.readAsDataURL(blob);
  });
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
      openBtn.disabled = true;
      return;
    }

    setStatus(
      withAirdropHint(
        `Parsed BP${parsedRoster.bidPeriod}: ${parsedRoster.counts.flights} flights + ${parsedRoster.counts.patterns} patterns + ${parsedRoster.counts.training} SIM/training + ${parsedRoster.counts.dayMarkers} A/X days = ${parsedRoster.counts.total} total events.`
      )
    );
    downloadBtn.disabled = false;
    shareBtn.disabled = false;
    openBtn.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus("Failed to parse roster file.");
    downloadBtn.disabled = true;
    shareBtn.disabled = true;
    openBtn.disabled = true;
  }
}

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
  setStatus(withAirdropHint(`Downloaded ${payload.fileName}`));
}

async function openIcsInBrowser() {
  const payload = buildExportPayload();
  if (!payload) {
    setStatus("Parse a roster first.");
    return;
  }

  try {
    const dataUrl = await blobToDataUrl(payload.blob);
    const opened = window.open(dataUrl, "_blank");
    if (!opened) {
      window.location.href = dataUrl;
    }
    setStatus("Opened .ics file. On iPad tap Share, then Calendar or Save to Files.");
  } catch (error) {
    console.error(error);
    downloadIcs();
  }
}

async function shareForIpad() {
  const payload = buildExportPayload();
  if (!payload) {
    setStatus("Parse a roster first.");
    return;
  }

  const shareableTypes = ["text/calendar;charset=utf-8", "text/plain;charset=utf-8"];

  try {
    if (navigator.share) {
      for (const type of shareableTypes) {
        const file = new File([payload.content], payload.fileName, { type });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
          continue;
        }

        await navigator.share({
          title: payload.fileName,
          text: "Roster calendar export",
          files: [file],
        });
        setStatus(withAirdropHint("Shared .ics file. On iPad choose Calendar or Save to Files."));
        return;
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("Share cancelled.");
      return;
    }
    console.error(error);
  }

  await openIcsInBrowser();
}

parseBtn.addEventListener("click", parseSelectedFile);
downloadBtn.addEventListener("click", downloadIcs);
shareBtn.addEventListener("click", shareForIpad);
openBtn.addEventListener("click", openIcsInBrowser);
rosterFileInput.addEventListener("change", () => {
  downloadBtn.disabled = true;
  shareBtn.disabled = true;
  openBtn.disabled = true;
  parsedRoster = null;
  setStatus('File selected. Click "Parse roster".');
});

resetPreview();
