# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page interactive Leaflet map for a self-planned Iceland road trip (Ring Road + F-roads, campsites, hikes, réttir sheep round-ups, POIs). There is no framework, no package manager, and no build step — the entire app is one HTML file.

- `index.html` — everything: CSS, DOM, and JS (~2300+ lines) for the map, controls, legend, and day-by-day schedule panel.
- `voyage.html` — a separate, self-contained page: the post-trip journal (actual day-by-day GPS tracks, real campsites, detected stops, mileage), built from a one-time data pipeline (Immich photos → clustering → OSRM road-matching) whose output is baked into static arrays in the file — no live API calls at runtime. See `VOYAGE.md` for the full data pipeline, thresholds, and the custom-domain/cookie reasoning behind it.
- `sw.js` — a small service worker for offline tile/route caching, registered only over HTTPS, shared as-is by both `index.html` and `voyage.html`.
- `hikes.json` — ~1000 hikes (route geometry + metadata), fetched at runtime, not inlined in `index.html`.
- `gpx/` — ~1000 downloadable `.gpx` files, one per hike, named by their Komoot numeric id (see "Hikes" below).
- `CNAME` — GitHub Pages custom domain (`islande.itcg-consulting.com`); required for `voyage.html`'s Immich thumbnails to work (see `VOYAGE.md`).

## Commands

There is no build, lint, or test tooling in this repo — it's plain static HTML/JS.

- **Local dev server** (required — see below): `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/index.html`.
  - Opening `index.html` directly via `file://` will **not** load hikes: the code explicitly skips the `hikes.json` fetch under `file:` protocol (see `init()`), and GPX download links resolve relative to the page.
  - The service worker (offline mode) only registers when `location.protocol === 'https:'`, so offline-cache behavior can only be exercised on the deployed GitHub Pages URL, not on `localhost`.
- **Verifying changes**: there's no automated test suite. Serve the file locally and check it in a real/headless browser (e.g. drive it with a headless Chromium over CDP) — click through the relevant `grp-btn`/`sub-btn` controls and confirm markers/layers update as expected, and check the console for errors.
- **Deploy**: `git push origin main` — GitHub Pages serves this repo's `main` branch root directly, so a push *is* the deploy. No CI config exists.

## Architecture

Everything lives in one `<script>` block in `index.html`, organized into clearly marked sections (search for `// ── SECTION ──` comments to jump around):

`SERVICE WORKER` → `MAP INIT` → `LAYERS` → `UI FUNCTIONS` → `ICONS` → `ROUTING` → `ROUTES ADVISORY` → `SEGMENTS` → `ÉTAPES` → `ROUTES INTERDITES` → `DONNÉES CAMPINGS CAMPEASY` → `DONNÉES RÉTTIR` → `DONNÉES POI` (one block per category) → `TABLEAUX POI` → `PROGRAMME JOUR PAR JOUR` → `INIT` (`async function init()` at the bottom, which actually builds and adds every marker to the map).

### Layer / control pattern

Each map category is a Leaflet `L.layerGroup()`. Two different visibility patterns are used depending on whether a category is a simple on/off toggle or a multi-select filter:

1. **Simple toggle** (most POI categories, itinerary, forbidden/orange/green roads): `layerState[name]` boolean + generic `toggleLayer(name)`, wired to a `.sub-btn` with `id="btn-<name>"` calling `onclick="toggleLayer('<name>')"`. `toggleLayer` adds/removes the whole layer group from the map and flips the button's `active` class via `syncSubBtn('btn-<name>', bool)`.
2. **Multi-select filter** (Campings, Réttir): markers are pre-built once in `init()` into a flat array (`campMarkers`, `rettirMarkers`) and are **not** attached to any layer group up front. A dedicated toggle function (`toggleFilter(cat)` for campings, `toggleRettirDay(day)` for réttir) maintains a `Set`/flags of active selections, then walks the marker array adding/removing each marker from its layer group depending on whether it matches the current selection, and adds/removes the layer group from the map based on whether *any* selection is active.
   - **Important asymmetry**: campings' `toggleFilter` treats "no category filter selected" as "show all campings" (empty selection = match everything). Réttir's `toggleRettirDay` does the opposite — no day selected means nothing is shown; a marker is only visible if its day is explicitly in `activeRettirDays`. This was a deliberate, explicit product decision (réttir must default to fully hidden), not an oversight — don't "fix" it to match the camping convention.

### Data flow for markers

Raw data for most POI-style categories is defined as arrays-of-tuples (e.g. `CAMPEASY_CAMPINGS`, `RETTIR`, `POIS_GLACIER`, `POIS_NATURE`, `DATA_FUEL`, `DATA_SHOPS`, ...), destructured either directly in `init()` (campings, réttir) or first mapped into a common `{ll, cat, name, desc, tips}` shape in the `TABLEAUX POI` section (`pois_glacier`, `pois_nature`, `fuelPois`, etc.), then turned into `L.marker`s inside `init()`. A new POI-like category should follow this same raw-array → (optional mapped-object) → marker-creation-loop-in-`init()` shape, plus its own icon function and popup-builder function (see below), plus a control entry (see "Controls UI").

- **Icons**: one factory function per marker family (`dayIcon`, `hikeIcon`, `campIcon`, `rettirIcon`, `poiIcon`, `practicalIcon`, `advisoryIcon`, `forbiddenIcon`), each returning an `L.divIcon` with inline-styled HTML — there are no external icon image files, everything is emoji + CSS.
- **Popups**: one builder function per family (`hikePop`, `campeasyPop`, `rettirPop`, `poiPop`, `forbPop`, `pop`) returning an HTML string passed to `.bindPopup()`.

### Controls UI (`#controls`)

The right-side floating menu is a list of `.ctrl-group` blocks. Each group is a top-level emoji button (`grp-btn`, `id="grpbtn-<name>"`) that toggles its own `.grp-menu` (`id="grpmenu-<name>"`) via `toggleGroup(name)` / `closeAllGroups()`. Inside a menu, `.sub-btn` entries call `toggleLayer` / `toggleFilter` / `toggleRettirDay`, and their `active` (checked) state is driven by `syncSubBtn(id, bool)` — the `id` passed there must exactly match the button's DOM id, so any new toggle function must follow the existing `btn-<name>` / `btn-filter-<cat>` / `btn-rettir-<ddmm>` id conventions.

This project's established preference is to give a **distinct data category its own top-level `ctrl-group` icon** rather than nesting it as a sub-section inside an unrelated existing group (e.g. Réttir has its own 🐑 group, separate from Campings ⛺), even when the two are visually/thematically adjacent.

### Hikes (`hikes.json` + `gpx/`)

Hikes are loaded at runtime (`fetch('./hikes.json?v='+Date.now())`, cache-busted, skipped entirely under `file:`), then rendered per `tier` (`high`/`mid`/`low`) into `layerHikesHigh/Mid/Low`. Each hike's Komoot URL trailing numeric id doubles as its GPX filename (`gpx/<id>.gpx`, linked from `hikePop()`) — a hike record and its GPX file must share that id.

### Routing & offline caching

- `getRoute()` calls the public OSRM demo server (`router.project-osrm.org`) for real driving geometry, with an 8s timeout and a straight-polyline fallback (`fixedCoords`) if it fails.
- `sw.js` caches OSM tiles and OSRM route responses cache-first, and `hikes.json` network-first-with-cache-fallback (bypassed when cache-busted with `?v=`). It's only registered over HTTPS (see `registerSW()`), and is manually driven by the UI (`toggleOffline()`, `precacheMap()`, `clearCache()`, `getCacheInfo()`) rather than auto-precaching.

### Schedule panel

`schedule` and `scheduleAlt` are hardcoded day-by-day arrays (main itinerary vs. Westfjords-skipping alternative) rendered into `#schedule-table` by `renderSchedule()`, switched via `switchTab('main'|'alt')`.

## Conventions

- All UI text, data labels, and popups are in French — match this for any new content.
- Coordinates throughout are `[lat, lon]` (Leaflet order), except OSRM request building in `getRoute()` which needs `lon,lat` and handles the swap inline.
