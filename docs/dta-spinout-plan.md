# DTA Spin-Out Plan

## Goal

Create a separate DTA Calculator app without breaking the current Roster Export app.

The new DTA app should:

- read the same roster formats (`.txt` and `.pdf`)
- identify the same individual trips/patterns
- calculate DTA using the same logic and data
- integrate with the same email intake pipeline
- avoid duplicated parser, duplicated storage logic, and duplicated business rules

The current Roster Export app should keep its full DTA functionality until the new app is proven.

## Core Principle

Do not make the new DTA app depend on the existing Roster Export UI.

Instead:

- parse rosters once
- store parsed roster data once
- let both apps read the same processed roster data

This avoids sync problems and duplicated business logic.

## Current State

### Shared already

- [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/public/rosterParser.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/public/rosterParser.mjs)
  is already used by both:
  - the browser app
  - the Worker backend

That is a strong starting point. The parser is already portable enough to be treated as shared core.

### Not yet separated cleanly

- [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/public/dta.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/public/dta.mjs)
  currently contains three concerns in one file:
  - DTA calculation engine
  - DTA reference/default data
  - browser storage persistence for country/rate/airport mappings

- [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/public/app.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/public/app.mjs)
  contains the DTA UI orchestration, import/export UI, and state restoration logic.

- [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/worker.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/worker.mjs)
  ingests rosters for calendar publishing, but it does not yet act as a general parsed-roster store that a second app can query.

## Target Architecture

### 1. Shared roster core

Shared modules that are UI-agnostic and reusable by:

- Roster Export app
- DTA app
- Worker backend
- Gmail email intake path

Recommended structure:

- `shared/roster-parser.mjs`
- `shared/dta-engine.mjs`
- `shared/dta-reference-data.mjs`
- `shared/dta-storage-schema.mjs` (optional, if we want cleaner typing/shape helpers)

Notes:

- `rosterParser.mjs` should move here first with no behavior change.
- The pure DTA calculation logic should move out of browser-specific code.
- Browser storage helpers should remain separate from the calculation engine.

### 2. Shared backend roster store

The Worker should become the single source of truth for processed rosters that arrive by:

- manual upload
- Gmail intake
- future app-to-backend uploads

Recommended stored objects per roster:

- `staffNumber`
- `bidPeriod`
- `source` (`manual`, `gmail`, etc.)
- `receivedAtUtc`
- `fileName`
- `parsedRoster`
- optional source metadata (`senderEmail`, `messageId`, `contentType`)

Recommended behavior:

- one stored parsed roster per `staffNumber + bidPeriod`
- re-upload or re-email updates that BP only
- older BPs remain available

### 3. Two separate frontends

#### Roster Export app

Keeps:

- roster upload
- events preview
- ICS export
- subscribed calendar publishing
- fallback DTA UI during transition

#### DTA app

New app that provides:

- roster upload
- pattern/trip selection
- DTA working and totals
- rate and airport/country management
- optional automatic load of latest parsed roster for a staff number

## Recommended Data Flow

### Manual workflow

1. User uploads roster in either app
2. Shared parser processes roster
3. App can:
   - use parsed result immediately in UI
   - optionally save parsed roster to Worker backend

### Automatic email workflow

1. Gmail receives roster email
2. Apps Script extracts valid roster attachment text
3. Worker ingests roster
4. Worker parses roster once
5. Worker stores parsed roster by `staffNumber + bidPeriod`
6. Worker updates subscribed calendar feed
7. DTA app can read the same stored parsed roster later without reparsing the email copy

This is the integration path to prefer.

## Why Not “App A Sends To App B”

Avoid making the Roster Export app actively push roster data into the DTA app.

That approach creates:

- duplicated state
- ordering/sync problems
- harder debugging
- tighter coupling between two UIs

The better pattern is:

- intake once
- parse once
- store once
- both apps read the same record

## First Extraction Targets

### Step 1: Formalize the shared core boundary

This is the current step.

Output of this step:

- agreed target architecture
- agreed phased extraction plan
- no user-visible behavior change

### Step 2: Extract pure DTA engine from browser persistence

Split [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/public/dta.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/public/dta.mjs) into:

- pure calculation + data helpers
- browser `localStorage` persistence helpers

Recommended end state:

- `shared/dta-engine.mjs`
  - `getDtaPatterns`
  - `calculateDtaForPattern`
  - airport/country/rate resolution helpers

- `shared/dta-reference-data.mjs`
  - default rates
  - default airport-country map
  - fallback rate constants

- `public/dta-storage.mjs`
  - load/save country rates
  - load/save airport mappings
  - load/save overrides

This step gives us the DTA app core without changing current UI behavior.

### Step 3: Move the parser to an explicit shared location

Move:

- [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/public/rosterParser.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/public/rosterParser.mjs)

to a shared module path, then update imports in:

- [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/public/app.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/public/app.mjs)
- [`/Users/russellgillson/Documents/MyApps/Roster Export iCal/worker.mjs`](/Users/russellgillson/Documents/MyApps/Roster%20Export%20iCal/worker.mjs)

This is mostly a path/ownership cleanup, but it matters because the parser is no longer conceptually “owned” by the Roster Export frontend.

### Step 4: Add Worker parsed-roster persistence

Add backend persistence for parsed roster records by:

- `staffNumber`
- `bidPeriod`

Recommended new Worker endpoints:

- `POST /api/rosters`
- `GET /api/rosters/latest?staffNumber=...`
- `GET /api/rosters/:staffNumber/:bidPeriod`

Exact routing can vary, but this is the right capability shape.

### Step 5: Create the separate DTA app shell

Create a new frontend entry point, for example:

- `public-dta/index.html`
- `public-dta/app.mjs`

or:

- `public/dta-index.html`
- `public/dta-app.mjs`

The DTA app should:

- use the shared parser/core immediately
- initially support manual upload first
- then optionally add “load latest stored roster”

### Step 6: Connect DTA app to email-ingested roster data

Once parsed-roster persistence exists:

- the DTA app can load the latest stored roster for a staff number
- a newly emailed roster becomes available to the DTA app automatically
- no app-to-app forwarding is required

## Recommended Implementation Order

1. Write and agree the target architecture
2. Extract DTA engine from storage/UI concerns
3. Move parser into shared ownership
4. Add parsed-roster persistence to Worker
5. Build separate DTA app UI
6. Connect DTA app to stored roster records
7. Only then decide whether to remove DTA from the export app

## Minimal-Duplication Rules

To keep duplication low, we should follow these rules:

- one parser
- one DTA engine
- one default rate dataset
- one airport-country map dataset
- one email intake path
- one parsed-roster backend store

Separate only:

- frontend presentation
- frontend local UI state
- app-specific controls/actions

## Suggested Next Build Step

The next practical refactor should be:

**Extract the pure DTA engine and reference data out of `public/dta.mjs`, leaving browser storage behind.**

That gives us the reusable core needed by both apps without changing the current user workflow.
