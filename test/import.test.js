/**
 * Tests für den QR-Import-Pfad (reine Logik) in src/db.js:
 *   - dbParseQrPayload: gültig / malformed / truncated / falsche Version
 *   - dbImportVehicle:  frische ids, re-keyed Einträge, 'neu' vs
 *                       'zusammenfuehren', keine Kollisionen
 *   - Build → Parse → Import Round-Trip (Gegenstück zu dbBuildQrPayload)
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDb } = require('./helpers');

const validPayload = (over = {}) => JSON.stringify(Object.assign({
  app: 'ModLog', v: 1, t: 'vehicle',
  fz: { name: 'VW Golf GTI', jahr: 2018, farbe: 'Tornado Red', kuerzel: 'GTI' },
  mods: [
    { n: 'KW V3', k: 'Fahrwerk', d: '2024-05-01', ko: 2100, km: 42000, s: 'kw.de', o: '', no: 'top' },
    { n: 'APR Stage 2', k: 'Motor', d: '2024-06-01', ko: 1500, km: 42500, s: 'apr', o: '', no: '' },
  ],
  truncated: false,
}, over));

test('dbParseQrPayload: parses & normalizes a valid payload', () => {
  const db = loadDb();
  const r = db.dbParseQrPayload(validPayload());
  assert.equal(r.fahrzeug.name, 'VW Golf GTI');
  assert.equal(r.fahrzeug.jahr, 2018);
  assert.equal(r.fahrzeug.kuerzel, 'GTI');
  assert.equal(r.eintraege.length, 2);
  // normalisierte (ausgeschriebene) Feldnamen
  assert.deepEqual(Object.keys(r.eintraege[0]).sort(),
    ['datum', 'kat', 'km', 'kosten', 'name', 'notiz', 'oem', 'shop']);
  assert.equal(r.eintraege[0].kat, 'Fahrwerk');
  assert.equal(r.truncated, false);
});

test('dbParseQrPayload: typed errors for malformed / foreign / wrong version', () => {
  const db = loadDb();
  assert.throws(() => db.dbParseQrPayload('{nope'), e => e.code === 'invalid_json');
  assert.throws(() => db.dbParseQrPayload('{"app":"Other","t":"vehicle","v":1,"fz":{"name":"x"},"mods":[]}'),
    e => e.code === 'not_modlog');
  assert.throws(() => db.dbParseQrPayload(validPayload({ v: 2 })), e => e.code === 'unsupported_version');
  assert.throws(() => db.dbParseQrPayload('{"app":"ModLog","t":"vehicle","v":1,"mods":[]}'),
    e => e.code === 'invalid_structure');
  assert.throws(() => db.dbParseQrPayload(validPayload({ mods: 'nope' })),
    e => e.code === 'invalid_structure');
});

test('dbParseQrPayload: keeps truncated flag, drops nameless mods, defaults bad kat', () => {
  const db = loadDb();
  const r = db.dbParseQrPayload(validPayload({
    truncated: true,
    mods: [{ n: 'Real', k: 'Quatsch', d: '2024-01-01', ko: 10 }, { n: '', k: 'Motor' }],
  }));
  assert.equal(r.truncated, true);
  assert.equal(r.eintraege.length, 1, 'namenloser Eintrag verworfen');
  assert.equal(r.eintraege[0].kat, 'Sonstiges', 'unbekannte Kategorie → Sonstiges');
});

test('dbImportVehicle neu: fresh ids, entries re-keyed, no collisions', () => {
  const db = loadDb();
  const beforeFz = db.dbGetFahrzeuge().length;
  const beforeEntries = db.dbGetEintraege().length;
  const existingFzIds = new Set(db.dbGetFahrzeuge().map(f => f.id));

  const parsed = db.dbParseQrPayload(validPayload());
  const res = db.dbImportVehicle(parsed, 'neu');

  assert.equal(res.count, 2);
  assert.ok(!existingFzIds.has(res.fahrzeugId), 'neue, kollisionsfreie Fahrzeug-id');
  assert.equal(db.dbGetFahrzeuge().length, beforeFz + 1);

  const imported = db.dbGetEintraege({ fz: res.fahrzeugId });
  assert.equal(imported.length, 2);
  // alle Einträge auf die neue Fahrzeug-id umgehängt, frische, eindeutige ids
  const ids = db.dbGetEintraege().map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'keine doppelten Eintrags-ids');
  imported.forEach(e => assert.equal(e.fz, res.fahrzeugId));
  assert.equal(db.dbGetEintraege().length, beforeEntries + 2);
});

test('dbImportVehicle: default mode is neu', () => {
  const db = loadDb();
  const parsed = db.dbParseQrPayload(validPayload());
  const res = db.dbImportVehicle(parsed); // kein mode
  assert.equal(res.mode, 'neu');
});

test('dbImportVehicle zusammenfuehren: appends to existing name+kuerzel match', () => {
  const db = loadDb();
  // Erst neu importieren → existiert dann als Match
  const parsed = db.dbParseQrPayload(validPayload());
  const first = db.dbImportVehicle(parsed, 'neu');
  const fzCountAfterFirst = db.dbGetFahrzeuge().length;

  // dbFindImportMatch findet das eben angelegte Fahrzeug
  const match = db.dbFindImportMatch(parsed.fahrzeug);
  assert.ok(match && match.id === first.fahrzeugId);

  const second = db.dbImportVehicle(parsed, 'zusammenfuehren');
  assert.equal(second.fahrzeugId, first.fahrzeugId, 'an bestehendes Fahrzeug angehängt');
  assert.equal(db.dbGetFahrzeuge().length, fzCountAfterFirst, 'kein neues Fahrzeug');
  assert.equal(db.dbGetEintraege({ fz: first.fahrzeugId }).length, 4, '2 + 2 Einträge');
});

test('dbImportVehicle zusammenfuehren without match throws no_merge_target', () => {
  const db = loadDb();
  const parsed = db.dbParseQrPayload(validPayload({ fz: { name: 'Unique Car', jahr: 2020, kuerzel: 'UQ' } }));
  assert.throws(() => db.dbImportVehicle(parsed, 'zusammenfuehren'), e => e.code === 'no_merge_target');
});

test('build → parse → import round-trip (incl. umlauts) preserves data', () => {
  const db = loadDb();
  // Seed-Fahrzeug fz1 (BMW 135i E82) hat Einträge inkl. "Öhlins"
  const payloadStr = JSON.stringify(db.dbBuildQrPayload('fz1', { maxBytes: 100000 }));
  const parsed = db.dbParseQrPayload(payloadStr);
  const srcCount = db.dbGetEintraege({ fz: 'fz1' }).length;

  const res = db.dbImportVehicle(parsed, 'neu');
  assert.equal(res.count, srcCount);

  const imported = db.dbGetEintraege({ fz: res.fahrzeugId });
  assert.ok(imported.some(e => e.name.includes('Öhlins')), 'Umlaut erhalten');
  // Beträge/Felder erhalten
  const orig = db.dbGetEintraege({ fz: 'fz1' });
  assert.equal(
    imported.reduce((s, e) => s + e.kosten, 0),
    orig.reduce((s, e) => s + e.kosten, 0),
    'Gesamtkosten identisch',
  );
});
