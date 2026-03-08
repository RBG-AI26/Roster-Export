# Roster Export iCal

Upload your `webCisRoster_*.txt` file, parse trips/flights plus SIM/training duties, and download one Apple Calendar-compatible `.ics` file.

## What it does
- Detects Bid Period (for example `BP374`).
- Reads trip identifiers from the roster table (for example `RC51`, `NO09`, `NS27`).
- Matches each trip to the detailed pattern section below the table.
- Creates one calendar event per flight.
- Creates one all-day event per pattern occurrence with sector details in notes.
- Adds `SIM` and training duties from the roster table.
- Adds all-day `A Day` and `X Day` markers (including `Last X Day` at end of an X run).
- Exports all events in one `.ics` file.

## Run
From the project folder:

```bash
python3 -m http.server 8000
```

Then open:

- [http://localhost:8000](http://localhost:8000)

## Use
1. Click **Roster file** and choose a new roster `.txt` file.
2. Click **Parse roster**.
3. Click **Download .ics** or **Export to iPad**.
4. Import the `.ics` file into Apple Calendar.

## iPad export flow
1. Open the app in Safari (on iPad or iPhone).
2. Parse your roster.
3. Tap **Export to iPad**.
4. In the share sheet, choose:
- **Calendar** to import directly, or
- **Save to Files** and then open the `.ics` file in Files.

## Notes
- Flight events use UTC times from the roster data.
- SIM/training events are exported as local-time events when start/end times are present.
- Description fields include bid period, duty/flight details, and source filename.
- Sample outputs generated from your provided file are included as `BP374_flights.ics` and `BP374_events.ics`.
