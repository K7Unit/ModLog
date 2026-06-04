# ModLog — CLAUDE.md

Projektanweisungen für Claude Code. Lies diese Datei zuerst, bevor du irgendwas änderst.

## Was ist das?

ModLog ist eine iPhone-optimierte Web-App zur Dokumentation von Fahrzeug-Umbauten (Tuning, Werkstatt).
Stack: Vanilla HTML/CSS/JS, kein Framework, kein Build-Step. Alles in `src/`.

## Dateistruktur

```
src/
  index.html   — Markup, Modals, Tab-Struktur
  style.css    — Alle Styles (CSS-Variablen, dark theme)
  db.js        — Daten-Layer (localStorage). Muss VOR app.js geladen werden.
  app.js       — UI-Logik (Rendering, Events, Modals)
```

## Architektur-Regeln

- `db.js` ist der einzige Ort wo `localStorage` angefasst wird. Nie direkt in `app.js`.
- `app.js` ruft nur `db*`-Funktionen auf (z.B. `dbAddEintrag`, `dbGetFahrzeuge`).
- Neue Features → neue `db*`-Funktion in `db.js` + UI in `app.js`.
- Keine externen Libraries ohne guten Grund. Bestehende CDN-Links: Google Fonts, Tabler Icons.

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

Storage-Key: `modlog_data_v1` (nie umbenennen ohne Migration!)

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
- [ ] **Dark/Light-Mode-Toggle** — Aktuell nur Dark
- [ ] **QR-Code** — Fahrzeug-Setup als QR teilen
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
