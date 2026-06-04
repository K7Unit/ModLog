/**
 * Tests für den Teilen-Pfad (Web Share API + Clipboard-Fallback) aus app.js.
 * Web Share lässt sich unter Node nicht real auslösen — getestet wird daher
 * vor allem der Fallback (kein navigator.share → Zwischenablage) sowie der
 * Aufbau der Text-Zusammenfassung.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers');

test('buildShareText enthält alle relevanten Felder', () => {
  const app = loadApp();
  const e = app.dbGetEintraege()[0];
  const text = app.buildShareText(e);
  assert.match(text, /Fahrzeug:/);
  assert.match(text, /Kategorie:/);
  assert.match(text, /Kosten: CHF/);
  assert.match(text, /Datum:/);
  assert.ok(text.startsWith(e.name), 'beginnt mit der Bezeichnung');
});

test('shareEntry fällt ohne navigator.share auf die Zwischenablage zurück', async () => {
  const app = loadApp();
  let copied = null;
  // navigator OHNE share/canShare → Fallback-Pfad
  app.navigator = { clipboard: { writeText: async t => { copied = t; } } };

  const e = app.dbGetEintraege()[0];
  await app.shareEntry(e.id);

  assert.ok(copied, 'Text wurde in die Zwischenablage kopiert');
  assert.match(copied, /Kategorie:/);
  assert.ok(copied.startsWith(e.name));
});

test('shareEntry nutzt navigator.share wenn verfügbar (kein Clipboard-Fallback)', async () => {
  const app = loadApp();
  let shared = null;
  let clipboardUsed = false;
  app.navigator = {
    share: async data => { shared = data; },
    clipboard: { writeText: async () => { clipboardUsed = true; } },
  };

  const e = app.dbGetEintraege()[0];
  await app.shareEntry(e.id);

  assert.ok(shared, 'navigator.share wurde aufgerufen');
  assert.match(shared.text, /Kategorie:/);
  assert.equal(clipboardUsed, false, 'Clipboard-Fallback nicht genutzt');
});
