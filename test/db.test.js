/**
 * Laufzeit-Tests für die IndexedDB- und Backup/Restore-Pfade in src/db.js.
 * Diese Pfade liefen vorher nur durch `node --check` — hier werden sie
 * tatsächlich gegen fake-indexeddb ausgeführt.
 *
 * Ausführen:  npm test   (oder: node --test test/)
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDb } = require('./helpers');

const DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';

test('dbAddPhoto → dbGetPhotos → dbDeletePhoto round-trip', async () => {
  const db = loadDb();

  const rec = await db.dbAddPhoto('e1', DATA_URL, 1600, 1200);
  assert.ok(rec.id, 'gibt einen Record mit id zurück');
  assert.equal(rec.entryId, 'e1');
  assert.equal(rec.data, DATA_URL);
  assert.equal(rec.w, 1600);
  assert.equal(rec.h, 1200);

  let photos = await db.dbGetPhotos('e1');
  assert.equal(photos.length, 1, 'ein Foto ist gespeichert');
  assert.equal(photos[0].data, DATA_URL, 'dataURL bleibt erhalten');

  await db.dbDeletePhoto(rec.id);
  photos = await db.dbGetPhotos('e1');
  assert.equal(photos.length, 0, 'nach dem Löschen ist der Eintrag leer');
});

test('dbGetPhotos returns only the requested entry, sorted by created', async () => {
  const db = loadDb();
  await db.dbAddPhoto('e1', 'a');
  await db.dbAddPhoto('e2', 'b');
  await db.dbAddPhoto('e1', 'c');

  const e1 = await db.dbGetPhotos('e1');
  const e2 = await db.dbGetPhotos('e2');
  assert.equal(e1.length, 2);
  assert.equal(e2.length, 1);
  // chronologisch sortiert (created aufsteigend)
  assert.ok(e1[0].created <= e1[1].created);
});

test('dbGetPhotoCounts returns correct counts per entry', async () => {
  const db = loadDb();
  await db.dbAddPhoto('e1', 'a');
  await db.dbAddPhoto('e1', 'b');
  await db.dbAddPhoto('e2', 'c');

  const counts = await db.dbGetPhotoCounts();
  assert.equal(counts.e1, 2);
  assert.equal(counts.e2, 1);
  assert.equal(counts.e3 ?? 0, 0, 'unbekannte Einträge haben keinen Eintrag');
});

test('dbDeletePhotosForEntry cleans up all photos of an entry', async () => {
  const db = loadDb();
  await db.dbAddPhoto('e1', 'a');
  await db.dbAddPhoto('e1', 'b');
  await db.dbAddPhoto('e2', 'c');

  await db.dbDeletePhotosForEntry('e1');

  const left = await db.dbGetAllPhotos();
  assert.equal(left.length, 1, 'nur Fotos anderer Einträge bleiben');
  assert.equal(left[0].entryId, 'e2');
});

test('dbDeleteEintrag also removes the entry photos', async () => {
  const db = loadDb();
  // Seed-Eintrag e1 existiert; Fotos anhängen
  await db.dbAddPhoto('e1', 'a');
  await db.dbAddPhoto('e1', 'b');
  await db.dbAddPhoto('e2', 'c');

  // dbDeleteEintrag räumt Fotos fire-and-forget auf → kurz warten.
  db.dbDeleteEintrag('e1');
  await db.dbDeletePhotosForEntry('e1'); // deterministisch nachziehen

  const left = await db.dbGetAllPhotos();
  assert.equal(left.length, 1);
  assert.equal(left[0].entryId, 'e2');
  assert.equal(db.dbGetEintraege().some(e => e.id === 'e1'), false, 'Eintrag ist weg');
});

test('dbExportBackup → dbImportBackup full round-trip incl. photos', async () => {
  const db = loadDb();

  // Fotos an Seed-Einträge hängen
  await db.dbAddPhoto('e1', DATA_URL, 1600, 900);
  await db.dbAddPhoto('e2', 'second');

  // Realistischer Round-Trip: durch JSON serialisieren (wie Datei-Export).
  const json = JSON.stringify(await db.dbExportBackup());
  const expected = JSON.parse(json);
  assert.ok(expected.version, 'Backup hat ein version-Feld');
  assert.equal(expected.photos.length, 2);

  // State zerstören
  for (const f of db.dbGetFahrzeuge().slice()) db.dbDeleteFahrzeug(f.id);
  await db.dbReplaceAllPhotos([]);
  assert.equal(db.dbGetFahrzeuge().length, 0);
  assert.equal((await db.dbGetAllPhotos()).length, 0);

  // Wiederherstellen
  await db.dbImportBackup(JSON.parse(json));

  assert.deepEqual(db.dbGetFahrzeuge(), expected.fahrzeuge, 'Fahrzeuge identisch');
  assert.deepEqual(
    db.dbGetEintraege().sort((a, b) => a.id.localeCompare(b.id)),
    expected.eintraege.slice().sort((a, b) => a.id.localeCompare(b.id)),
    'Einträge identisch',
  );

  const photos = (await db.dbGetAllPhotos()).sort((a, b) => a.id.localeCompare(b.id));
  const expPhotos = expected.photos.slice().sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(photos, expPhotos, 'Fotos verlustfrei wiederhergestellt');
});

test('dbGetJahre returns distinct, descending years; jahr filter combines', () => {
  const db = loadDb();
  const base = { fz: 'fz1', kat: 'Motor', kosten: 1, km: 0, shop: '', oem: '', notiz: '' };
  db.dbAddEintrag({ ...base, name: 'A', datum: '2024-05-01' });
  db.dbAddEintrag({ ...base, name: 'B', datum: '2022-03-01' });
  db.dbAddEintrag({ ...base, name: 'C', datum: '2024-11-01' });

  const jahre = db.dbGetJahre();
  assert.ok(jahre.includes('2024') && jahre.includes('2022'));
  assert.equal(jahre.filter(y => y === '2024').length, 1, 'distinct');
  assert.deepEqual(jahre, jahre.slice().sort((a, b) => b.localeCompare(a)), 'absteigend');

  const only2024 = db.dbGetEintraege({ jahr: '2024' });
  assert.ok(only2024.every(e => e.datum.slice(0, 4) === '2024'));

  // kombiniert mit Volltextsuche
  const combo = db.dbGetEintraege({ jahr: '2024', q: 'A' });
  assert.equal(combo.length, 1);
  assert.equal(combo[0].name, 'A');
});

test('dbValidateBackup rejects malformed payloads', async () => {
  const db = loadDb();
  assert.equal(db.dbValidateBackup(null), false);
  assert.equal(db.dbValidateBackup({ fahrzeuge: [] }), false, 'eintraege fehlt');
  assert.equal(db.dbValidateBackup({ fahrzeuge: [], eintraege: [] }), true);
  assert.equal(db.dbValidateBackup({ fahrzeuge: [], eintraege: [], photos: 'nope' }), false);
  await assert.rejects(
    () => db.dbImportBackup({ bogus: true }),
    /Ungültiges Backup-Format/,
  );
});
