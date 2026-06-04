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
  db.js        Daten-Layer (localStorage)
  app.js       UI-Logik
CLAUDE.md      Anweisungen für Claude Code
```

## Mit Claude Code weiterentwickeln

```bash
claude
```

Claude Code liest automatisch `CLAUDE.md` und kennt die Architektur, das Datenmodell und den Backlog.
