# ModLog — CLAUDE.md

Projektanweisungen für Claude Code. Lies diese Datei zuerst, bevor du irgendwas änderst.

## Was ist das?

ModLog ist eine iPhone-optimierte Web-App zur Dokumentation von Fahrzeug-Umbauten (Tuning, Werkstatt).
Stack: Vanilla HTML/CSS/JS, kein Framework, kein Build-Step. Alles in `src/`.

## Dateistruktur

```
src/
  index.html   — Markup, Modals, Tab-Struktur
  style.css    — Alle Styles (CSS-Variablen, dark + [data-theme="light"])
  db.js        — Daten-Layer (localStorage + IndexedDB). Wird im <head> geladen
                 (setzt Theme vor dem ersten Paint, kein FOUC).
  qr.js        — Vendored QR-Encoder (selbstständig, MIT, keine Laufzeit-Dep).
  qr-decode.js — Vendored QR-Decoder (Scan/Import; selbstständig, MIT, keine Dep).
  app.js       — UI-Logik (Rendering, Events, Modals)
test/          — Node-Tests (node:test + fake-indexeddb; QR via qrcode/jsqr, devDeps)
```

## Architektur-Regeln

- `db.js` ist der einzige Ort wo `localStorage`/IndexedDB angefasst wird. Nie direkt in `app.js`.
- `app.js` ruft nur `db*`-Funktionen auf (z.B. `dbAddEintrag`, `dbGetFahrzeuge`).
- Neue Features → neue `db*`-Funktion in `db.js` + UI in `app.js`.
- Keine externen **Laufzeit**-Libraries. CDN-Links: nur Google Fonts + Tabler Icons.
  QR-Encoder (`src/qr.js`) und -Decoder (`src/qr-decode.js`) sind lokal vendored (kein CDN/npm zur Laufzeit).
  Test-Deps (fake-indexeddb, qrcode, jsqr) bleiben devDependencies und werden nie ausgeliefert.

## Design-System

- Font: IBM Plex Mono (Code, Labels, Zahlen) + IBM Plex Sans (Body)
- Theme: Industrial Dark — alle Farben als CSS-Variablen in `style.css` `:root`
- Accent: `--accent: #e8a020` (Amber/Orange)
- Neue Badges für Kategorien → Klasse `badge-{kategorie}` in `style.css` analog zu bestehenden
- Keine hellen Hintergründe, keine Gradienten, keine Schatten

## Datenmodell

```js
// Fahrzeug
{ id: string, name: string, jahr: number, farbe: string, kuerzel: string }

// ModEintrag
{ id: string, fz: string, name: string, kat: KatEnum, datum: 'YYYY-MM-DD',
  kosten: number, km: number, shop: string, oem: string, notiz: string }

// KatEnum: 'Motor' | 'Fahrwerk' | 'Antrieb' | 'Exterieur' | 'Elektronik' | 'Sonstiges'
```

Storage-Keys (nie umbenennen ohne Migration!):
- `modlog_data_v1` — App-Daten (Fahrzeuge + Einträge) in localStorage
- `modlog_theme_v1` — gewähltes Theme ('light'/'dark') in localStorage
- IndexedDB `modlog_photos` — Foto-Blobs (Store-Key `id`, Index `entryId`)

## Entwickeln

Kein Build-Step nötig. Einfach `index.html` im Browser öffnen oder via Live Server.

```bash
# Mit npx live-server (falls installiert)
npx live-server src/

# Oder Python
python3 -m http.server 8080 --directory src/
```

## Geplante Features / Backlog

Priorisiert nach Nützlichkeit:

### High Priority
- [ ] **Foto-Anhänge** — FileReader → base64 → IndexedDB (localStorage zu klein für Bilder)
- [ ] **Suche** — Volltextsuche über name/shop/oem/notiz
- [ ] **CSV-Export** — Alle Einträge als CSV runterladen

### Medium Priority
- [ ] **PWA / Service Worker** — Offline-Nutzung auf dem iPhone
- [ ] **Web Share API** — Einzelne Einträge teilen (WhatsApp etc.)
- [ ] **Suchfeld** — Live-Filter in der Log-Ansicht
- [ ] **Jahresfilter** — Nach Jahr filtern in der Log-Ansicht

### Low Priority / Nice to have
- [x] **Dark/Light-Mode-Toggle** — `[data-theme="light"]` auf `<html>`, Umschalter in der Topbar, persistiert in `modlog_theme_v1` (eigener Key, getrennt von App-Daten). Default dark; `prefers-color-scheme: light` nur als Erst-Fallback.
- [x] **QR-Code** — Fahrzeug-Setup (Meta + Mods, OHNE Fotos) als QR teilen UND importieren (voller Round-Trip). Encoder in `src/qr.js`, Decoder in `src/qr-decode.js` (beide selbstständig, MIT, keine Laufzeit-Abhängigkeit). Import: Kamera-Scan (getUserMedia, in-flow Overlay) mit Paste-Fallback → Vorschau → `dbImportVehicle` (frische ids; 'neu' oder 'zusammenfuehren'). Zu grosse Listen werden beim Teilen gekürzt (truncated).
- [ ] **IndexedDB Migration** — Für grössere Datensätze
- [ ] **Backup/Restore** — JSON-Export + Import

## Dos & Don'ts

**DO:**
- Kleine, gezielte Änderungen. Immer nur das ändern was nötig ist.
- Bei neuen Kategorien: Badge-Klasse in CSS + Option im Select-Element.
- Mobile first — alle neuen UI-Elemente auf 390px testen.
- Schweizer Zahlenformat: `toLocaleString('de-CH')` für CHF-Beträge.

**DON'T:**
- Kein React, kein Vue, kein Tailwind — bleibt Vanilla.
- Nicht den Storage-Key `modlog_data_v1` umbenennen.
- Keine `position: fixed` in Modals (bricht iframe-Höhe).
- Seed-Daten (`dbSeedIfEmpty`) nicht für Prod-Daten verwenden — nur Demo.
