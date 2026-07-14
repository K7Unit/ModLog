# AGENTS.md — ModLog

Anleitung für KI-Coding-Agenten (OpenAI Codex, ChatGPT u. a.). **Lies diese
Datei zuerst, bevor du irgendetwas änderst.** Sie ist die verbindliche Quelle
für Architektur, Konventionen und Validierung. (Für Claude Code existiert die
inhaltlich gleichwertige `CLAUDE.md` — bei Änderungen bitte beide pflegen.)

## Was ist das?

ModLog ist eine iPhone-optimierte Web-App zur Dokumentation von Fahrzeug-
Umbauten (Tuning, Werkstatt). **Vanilla HTML/CSS/JS, kein Framework, kein
Build-Step.** Der gesamte ausgelieferte Code liegt in `src/`.

## Setup & Befehle

```bash
# Abhängigkeiten (nur Dev/Test — die App selbst hat KEINE Laufzeit-Deps)
npm ci

# Tests (node:test + fake-indexeddb; QR-Oracles jsqr/qrcode)
npm test

# Syntax-Check aller JS-Dateien in src/
npm run check

# Lokal ausliefern (kein Build nötig)
npm run serve        # → http://localhost:8080  (python3 http.server auf src/)
# Alternativ: npx live-server src/  oder index.html direkt im Browser öffnen
```

**Definition of Done:** Vor Abschluss jeder Änderung müssen `npm run check`
und `npm test` grün sein. CI (`.github/workflows/ci.yml`) läuft bei push +
pull_request und muss grün bleiben.

## Dateistruktur

```
src/
  index.html   — Markup, Modals/Overlays, Tab-Struktur
  style.css    — Alle Styles (CSS-Variablen, dark + [data-theme="light"])
  db.js        — Daten-Layer (localStorage + IndexedDB). Wird im <head> geladen
                 (setzt Theme vor dem ersten Paint, kein FOUC).
  qr.js        — Vendored QR-Encoder (selbstständig, MIT, keine Laufzeit-Dep)
  qr-decode.js — Vendored QR-Decoder (Scan/Import; selbstständig, MIT)
  app.js       — UI-Logik (Rendering, Events, Modals) — ruft nur db*-Funktionen
  manifest.json, sw.js, icons/  — PWA (Service Worker Cache-Version: modlog-v5)
test/          — Node-Tests (node:test + fake-indexeddb; jsqr/qrcode als devDeps)
.github/workflows/ci.yml — CI: npm ci → node --check → JSON-Validierung → npm test
```

## Architektur-Regeln (strikt)

- **`db.js` ist der EINZIGE Ort, der Storage anfasst** (`localStorage` +
  IndexedDB). Niemals direkt in `app.js`.
- **`app.js` ruft ausschliesslich `db*`-Funktionen** auf (z. B. `dbAddEintrag`,
  `dbGetFahrzeuge`, `dbBuildQrPayload`, `dbImportVehicle`).
- Neues Feature → neue `db*`-Funktion in `db.js` + UI in `app.js`.
- **Keine externen Laufzeit-Libraries.** Erlaubte CDN-Links: nur Google Fonts +
  Tabler Icons. QR-Encoder/-Decoder sind lokal vendored (kein CDN/npm zur
  Laufzeit). Dev-Deps (`fake-indexeddb`, `qrcode`, `jsqr`) bleiben
  devDependencies und dürfen **nie** aus `src/` referenziert werden.

## Storage-Keys (NIE umbenennen ohne Migration!)

- `modlog_data_v1` — App-Daten (Fahrzeuge + Einträge) in localStorage
- `modlog_theme_v1` — gewähltes Theme (`'light'`/`'dark'`) in localStorage
- IndexedDB `modlog_photos` — Foto-Blobs (Store-Key `id`, Index `entryId`)

## Datenmodell

```js
// Fahrzeug
{ id: string, name: string, jahr: number, farbe: string, kuerzel: string }

// ModEintrag
{ id: string, fz: string, name: string, kat: KatEnum, datum: 'YYYY-MM-DD',
  kosten: number, km: number, shop: string, oem: string, notiz: string }

// KatEnum: 'Motor' | 'Fahrwerk' | 'Antrieb' | 'Exterieur' | 'Elektronik' | 'Sonstiges'

// Foto (IndexedDB modlog_photos): { id, entryId, data: <dataURL>, w, h, created }
// QR-Payload (src/qr.js → dbBuildQrPayload): kompakte Keys, OHNE Fotos, ggf. gekürzt
```

## Design-System

- Font: IBM Plex Mono (Code, Labels, Zahlen) + IBM Plex Sans (Body)
- Theme: Industrial — alle Farben als CSS-Variablen in `:root`; Light-Theme
  unter `[data-theme="light"]`. Amber-Accent `--accent: #e8a020` bleibt in
  beiden Themes konstant.
- Neue Kategorie-Badges → Klasse `badge-{kategorie}` in `style.css` analog zu
  bestehenden (dark + `[data-theme="light"]`-Override).
- **Keine hellen Weiss-Flächen, keine Gradienten, keine Schatten** — in beiden Themes.

## Konventionen (DO / DON'T)

**DO**
- Kleine, gezielte Änderungen — nur was nötig ist.
- Mobile first: alles auf 390 px Breite testen, Tap-Targets min. 44 px.
- Schweizer Format: `toLocaleString('de-CH')` für CHF-Beträge.
- User-sichtbare Strings auf **Deutsch**, Schweizer Schreibweise (**ss statt ß**).
- Kommentare/Commits im bestehenden Stil (Deutsch).
- Importierte/fremde Daten HTML-escapen (siehe `escapeHtml` in `app.js`).

**DON'T**
- Kein React/Vue/Tailwind — bleibt Vanilla, kein Build-Step.
- Storage-Keys nicht umbenennen; bestehende Datensätze nie überschreiben
  (Import legt immer frische, kollisionsfreie IDs an).
- **Keine `position: fixed` in Modals/Overlays** — nur in-flow Overlays
  (bricht sonst die iframe-Höhe). Kamera-Preview & QR-/Foto-Viewer halten sich daran.
- Seed-Daten (`dbSeedIfEmpty`) nicht für Prod-Daten verwenden — nur Demo.
- Neues Shell-Asset in `src/` → in `sw.js`-Cache-Liste aufnehmen UND
  `CACHE`-Version hochzählen (`modlog-vN`).

## Tests & CI

- Harness `test/helpers.js` lädt `src/db.js` (bzw. db.js + app.js) via
  `node:vm` in einen isolierten Kontext mit gestubbten Browser-Globals
  (`localStorage`, `indexedDB`, DOM). Die App-Dateien selbst bleiben unangetastet.
- Reine Logik wird getestet (db*-Funktionen, QR-Payload, Parser/Import,
  Encoder↔Decoder-Round-Trip, Reed-Solomon-Fehlerkorrektur). QR wird
  zusätzlich gegen `qrcode`/`jsqr` als Dev-Oracle geprüft.
- **Manuelle On-Device-Checks (nicht automatisiert):** Live-Kamera-Scan eines
  echten QR-Codes, Theme-Umschalt-Timing (kein Flash).

## Status — v1.0.0 (Baseline)

Erster Entwicklungszyklus ist gemerged (PR #1, squash) und in `main`; 30 Tests, CI grün.

**Gebaut:** 3-Tab-CRUD (Einträge + Fahrzeuge) · Filter (Fahrzeug/Kategorie/
Jahr) + Volltextsuche · Statistik + CSV-Export (BOM, UTF-8) · Foto-Anhänge
(IndexedDB, Canvas-Resize 1600px/JPEG 0.82) · Backup/Restore (JSON inkl.
Fotos) · Web Share + Clipboard-Fallback · Dark/Light-Toggle (kein FOUC) ·
QR teilen + importieren (vendored Encoder/Decoder, voller Round-Trip,
Kamera-Scan + Paste-Fallback) · PWA (`sw.js` `modlog-v5`).

## Backlog (offen)

- **QR-Decoder: Perspektive/Keystone** — robustes Mehr-Alignment-Sampling für
  schräge Scans (aktuell auf frontale/saubere Codes getrimmt).
- **QR-Scan: automatisierte Kamera-Tests** — der Live-`getUserMedia`-Pfad ist
  bisher nur manueller On-Device-Check.
- **Web Share: Datei-Edge-Cases** — Verhalten bei sehr grossen Foto-Dateien /
  Teil-Support von `canShare({ files })` verfeinern.
- **IndexedDB-Migration** — Versionierung/Migration für grössere Datensätze.
