# Roster Export iCal

Upload your `webCisRoster_*.txt` or roster `.pdf` file, parse trips/flights plus SIM/training duties, and download one Apple Calendar-compatible `.ics` file.

## What it does
- Detects Bid Period (for example `BP374`).
- Reads trip identifiers from the roster table (for example `RC51`, `NO09`, `NS27`).
- Matches each trip to the detailed pattern section below the table.
- Creates one calendar event per flight.
- Creates one all-day event per pattern occurrence with sector details in notes.
- Adds `SIM` and training duties from the roster table.
- Adds all-day `A Day`, `X Day`, and `AL` (annual leave) markers (`Last X Day` shown at end of an X run).
- Includes a DTA checker per pattern code using country meal+incidental rates (hourly = meal + incidental).
- Uses a saved airport-to-country map and prompts only when a new airport code needs mapping.
- Supports saved per-port hourly rate overrides (auto-filled when known and editable).
- Applies fallback Cost Group 1 rate ($5.00 meals + $1.25 incidentals = $6.25/hr) when a mapped country is not listed.
- Supports importing updated country rates from `.xlsx`/`.csv` and downloading the current rates table.
- Exports all events in one `.ics` file.
- Supports direct PDF roster upload (parsed in-browser).

## Run
From the project folder:

```bash
cd public
python3 -m http.server 8000
```

Then open:

- [http://localhost:8000](http://localhost:8000)

## Use
1. Click **Roster file** and choose a new roster `.txt` or `.pdf` file.
2. Click **Parse roster**.
3. Optional: in **DTA Checker**, select a pattern code and click **Check DTA**.
4. If prompted for an unknown airport code, add/update its country mapping (saved for future use).
5. Optional: import an updated rates table (`.xlsx`/`.csv`) or download the current table.
6. Click **Download .ics** if you want a one-off file export, or use the subscribed calendar workflow below for ongoing updates.

## Notes
- Flight events use UTC times from the roster data.
- SIM/training events are exported as local-time events when start/end times are present.
- Description fields include bid period, duty/flight details, and source filename.
- Supported non-flying duty codes include `A`, `X`, `AL`, `GL`, `LSL`, `SL`, and `SR` (Standby).

## Cloudflare Worker subscription feed

This app can now publish a stable subscribed calendar feed instead of relying on repeated manual `.ics` imports.

### What you need
- A Cloudflare account
- Wrangler installed: `npm install -g wrangler`
- One KV namespace for published roster feeds

### Configure
1. Create KV namespaces:
   - `wrangler kv namespace create ROSTER_FEEDS`
   - `wrangler kv namespace create ROSTER_FEEDS --preview`
2. Copy the returned IDs into [wrangler.jsonc](/Users/russellgillson/Documents/MyApps/Roster Export iCal/wrangler.jsonc).
3. Set Worker secrets:
   - `wrangler secret put ADMIN_PASSWORD`
   - `wrangler secret put INGEST_API_TOKEN`
   - `wrangler secret put ALERT_EMAIL`
4. Deploy with:
   - `wrangler deploy`
5. For local Worker testing, run:
   - `wrangler dev`

### Publish and subscribe
1. Open the deployed app.
2. Parse your roster.
3. Click **Publish Calendar**.
4. Click **Copy Subscription Link**.
5. In Apple Calendar, add a new calendar subscription using that link.
6. On later roster changes from any device, enter the same staff number, parse the new roster, and click **Create / Link My Calendar** or **Update My Calendar**. The subscribed calendar URL stays the same.

### Why this fixes updates
Manual `.ics` imports merge events and do not reliably remove deleted duties. The subscribed feed becomes the source of truth, so removed duties such as a dropped pattern are removed from the feed on the next refresh.

### Privacy note
Treat published subscription links as private URLs. Anyone with the full `webcal://` or `https://` link can read that roster feed. Do not post or share those links outside the people and devices that should see your roster.


## Multi-user browser model

This deployed app can be used by multiple people without accounts.

- Each person enters their staff number and uses the same staff number on every device.
- Parsing still happens in the browser.
- On first publish, that staff number creates one subscribed calendar feed.
- On later publishes from iPhone, iPad, or Mac, entering the same staff number updates the same feed and returns the same subscription link.
- The parsed roster must contain that same staff number before the app will publish, which helps catch mismatches.
- If several people use the same browser/device, click **Clear This Device** before the next person enters their staff number.
- Staff number only is convenient, but it is not secret. Anyone who knows a person's staff number could still update that calendar feed.

## Admin + Gmail intake model

The deployed app now includes an admin section for managing approved staff and reviewing automatic email intake activity.

### Approved staff

Each approved staff record stores:
- staff number
- optional name
- recipient email address for automatic subscription-link replies
- active/inactive status

Only approved staff numbers are processed automatically from email intake.

### Admin authentication

The admin section is protected with a single admin password stored in the Worker secret:
- `ADMIN_PASSWORD`

Enter that password in the app to:
- add/update approved staff
- review recent ingest logs
- see which approved staff already have a subscription link

### Email ingest endpoint

Gmail automation should POST parsed roster payloads to:

- `/api/email-ingest`

with header:

- `x-ingest-token: <INGEST_API_TOKEN>`

Request body shape:

```json
{
  "senderEmail": "example@gmail.com",
  "subject": "Roster upload",
  "messageId": "<gmail-message-id>",
  "attachments": [
    {
      "fileName": "BP374.txt",
      "contentType": "text/plain",
      "rosterText": "full parsed roster text here"
    }
  ]
}
```

### Email ingest behaviour

For each attachment:
- parse the roster text
- read the staff number from the roster
- reject and log if the staff number is missing
- reject and log if the staff number is not on the approved list
- update only the matching BP for that staff member
- keep previously stored BPs for that staff member
- auto-create the subscribed calendar feed if this is the first approved roster for that staff number

The response includes:
- processed roster results
- issues for admin review
- notification email payloads

That allows a Gmail / Apps Script bridge to:
- email the new subscription link to approved staff on first creation
- forward a copy of each successfully processed roster email/attachment to the approved recipient email for that staff number
- email alerts to the admin address when intake fails or an unapproved staff number is received

### Current implementation note

The Worker and app now support:
- approved staff management
- ingest logging
- secure email-ingest endpoint

The Gmail-side automation script is included in:

- [google-apps-script/Code.js](/Users/russellgillson/Documents/MyApps/Roster Export iCal/google-apps-script/Code.js)
- [google-apps-script/appsscript.json](/Users/russellgillson/Documents/MyApps/Roster Export iCal/google-apps-script/appsscript.json)

### Google Apps Script setup

1. Open [script.google.com](https://script.google.com/) while signed in to `rosterexportcal@gmail.com`.
2. Create a new Apps Script project.
3. Replace the default script content with:
   - [google-apps-script/Code.js](/Users/russellgillson/Documents/MyApps/Roster Export iCal/google-apps-script/Code.js)
4. Replace the project manifest with:
   - [google-apps-script/appsscript.json](/Users/russellgillson/Documents/MyApps/Roster Export iCal/google-apps-script/appsscript.json)
5. In `Code.js`, set:
   - `CONFIG.workerBaseUrl`
   - `CONFIG.ingestApiToken`
6. Enable the Advanced Drive service in Apps Script:
   - Services → add `Drive API`
7. Run `processRosterInbox` once manually to grant permissions.
8. Run `installFiveMinuteTrigger` once to create the background polling trigger.

### What the Gmail script does

- checks the Gmail inbox for recent messages with attachments
- processes all valid `.txt` and `.pdf` roster attachments it finds
- extracts text from `.txt` attachments directly
- converts `.pdf` attachments into a temporary Google Doc to extract text
- POSTs all parsed roster attachments for a message to `/api/email-ingest`
- sends any notification emails returned by the Worker
- forwards the original processed roster attachment to the approved recipient email linked to that staff number
- labels threads for visibility:
  - `Roster Auto/Processed`
  - `Roster Auto/Failed`
  - `Roster Auto/Needs Review`

### Gmail script notes

- PDF extraction depends on Google Drive conversion/OCR via the Advanced Drive service.
- The script stores processed Gmail message IDs in Script Properties to avoid reprocessing the same message repeatedly.
- You can test one message directly with:
  - `testSingleMessageById(messageId)`
