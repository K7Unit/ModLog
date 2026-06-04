/**
 * Test-Harness: lädt das browser-orientierte src/db.js unter Node.
 *
 * db.js erwartet Browser-Globals (localStorage, indexedDB, alert). Wir laden
 * den Quelltext über das vm-Modul in einen isolierten Kontext und stellen
 * dort Stubs bereit:
 *   - localStorage  → einfaches In-Memory-Objekt
 *   - indexedDB     → frische fake-indexeddb-Instanz pro loadDb()-Aufruf
 *                     (vollständige Test-Isolation, kein geteilter State)
 *
 * Top-Level `function`-Deklarationen aus db.js landen als Eigenschaften auf
 * dem Kontext-Objekt und sind so direkt aufrufbar. Das interne `let db`
 * bleibt lexikalisch in db.js gekapselt — genau wie im Browser.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Setzt globale IDB-Klassen (IDBFactory, IDBKeyRange, …) auf globalThis.
require('fake-indexeddb/auto');

const DB_SRC = path.join(__dirname, '..', 'src', 'db.js');

/**
 * Lädt eine frische, isolierte db.js-Instanz.
 * @returns {object} Kontext mit allen db*-Funktionen.
 */
function loadDb() {
  const code = fs.readFileSync(DB_SRC, 'utf8');

  const storage = {};
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  };

  const ctx = {
    localStorage,
    indexedDB: new IDBFactory(), // frische, leere IDB pro Aufruf
    IDBKeyRange,
    console,
    alert: () => {},
  };

  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'src/db.js' });
  return ctx;
}

module.exports = { loadDb };
