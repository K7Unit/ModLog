# ModLog

iPhone-optimierte Web-App zur Dokumentation von Fahrzeug-Umbauten.

## Stack

Vanilla HTML / CSS / JS — kein Framework, kein Build-Step.

## Start

```bash
# Python
python3 -m http.server 8080 --directory src/
# → http://localhost:8080

# oder npx live-server
npx live-server src/
```

## Struktur

```
src/
  index.html   Markup & Modals
  style.css    Dark Theme (CSS-Variablen)
  db.js        Daten-Layer (localStorage + IndexedDB für Fotos)
  app.js       UI-Logik
  sw.js        Service Worker (PWA / Offline)
  manifest.json
  icons/
test/          Node-Tests (fake-indexeddb)
CLAUDE.md      Anweisungen für Claude Code
```

Die App selbst bleibt **laufzeit-abhängigkeitsfrei** (nur Google Fonts +
Tabler Icons via CDN). `fake-indexeddb` ist eine reine **devDependency** für
die Tests und wird nie ausgeliefert.

## Tests

Die IndexedDB- (Fotos) und Backup/Restore-Pfade aus `src/db.js` werden unter
Node gegen [`fake-indexeddb`](https://www.npmjs.com/package/fake-indexeddb)
ausgeführt:

```bash
npm install      # einmalig, installiert die devDependency
npm test         # führt test/*.test.js mit dem node:test-Runner aus
npm run check    # node --check über alle JS-Dateien in src/
```

Die Tests laden `src/db.js` über das `vm`-Modul in einen isolierten Kontext
mit gestubbten Browser-Globals (`localStorage`, `indexedDB`) — die App-Datei
selbst muss dafür nicht angefasst werden.

## Mit Claude Code weiterentwickeln

```bash
claude
```

Claude Code liest automatisch `CLAUDE.md` und kennt die Architektur, das Datenmodell und den Backlog.
