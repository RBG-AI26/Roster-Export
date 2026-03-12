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
6. Click **Download .ics**, **Export to iPad**, or **Open .ics**.
7. Import the `.ics` file into Apple Calendar.

## iPad export flow
1. Open the app in Safari (on iPad or iPhone).
2. Parse your roster.
3. Tap **Export to iPad**.
4. In the share sheet, choose:
- **Calendar** to import directly, or
- **Save to Files** and then open the `.ics` file in Files.
5. If share is blocked by Safari, tap **Open .ics** and use the iPad share button from the opened file.

## Notes
- Flight events use UTC times from the roster data.
- SIM/training events are exported as local-time events when start/end times are present.
- Description fields include bid period, duty/flight details, and source filename.
- Sample outputs generated from your provided file are included as `BP374_flights.ics` and `BP374_events.ics`.
