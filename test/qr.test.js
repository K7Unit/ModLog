/**
 * Tests für den vendored QR-Encoder (src/qr.js) und den Payload-Builder.
 *
 * - Korrektheit des Encoders wird gegen die Referenzbibliothek `qrcode`
 *   (nur devDependency, NICHT im ausgelieferten App-Code) geprüft: für
 *   erzwungene version/ecl/mask müssen die Modul-Matrizen exakt übereinstimmen.
 * - Ein End-to-End-Decode mit `jsqr` (devDependency) beweist echte Scanbarkeit
 *   inkl. automatischer Versions- und Maskenwahl.
 * - Der Payload-Builder (dbBuildQrPayload) wird als reine Logik geprüft:
 *   Struktur, Foto-Ausschluss, Truncation.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const QR = require('../src/qr.js');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { loadDb } = require('./helpers');

// Encoder == Referenz für erzwungene Parameter (repräsentative Versionen,
// inkl. CCI-Grenzen 9/10 und 26/27 sowie Versionsinfo-Grenze 7).
test('qr.js matches the qrcode reference for forced version/ecl/mask', () => {
  const text = 'mod-1!'; // 6 Bytes, Byte-Modus, passt in V1-H
  const versions = [1, 2, 7, 9, 10, 26, 27, 40];
  const ecls = ['L', 'M', 'Q', 'H'];
  const masks = [0, 3, 7];
  let compared = 0;

  for (const v of versions) {
    for (const ecl of ecls) {
      for (const mask of masks) {
        const mine = QR.generate(text, { ecl, version: v, mask });
        const ref = QRCode.create(text, { version: v, errorCorrectionLevel: ecl, maskPattern: mask });
        assert.equal(mine.size, ref.modules.size, `size v${v} ${ecl} m${mask}`);
        let diff = 0;
        for (let r = 0; r < mine.size; r++) {
          for (let c = 0; c < mine.size; c++) {
            if ((mine.modules[r][c] ? 1 : 0) !== (ref.modules.get(r, c) ? 1 : 0)) diff++;
          }
        }
        assert.equal(diff, 0, `module diffs v${v} ${ecl} m${mask}`);
        compared++;
      }
    }
  }
  assert.equal(compared, versions.length * ecls.length * masks.length);
});

// End-to-End: erzeugen → rastern → mit jsQR dekodieren → Eingabe zurück.
function decodeRoundTrip(text, opts) {
  const q = QR.generate(text, opts);
  const quiet = 4, scale = 4, n = q.size, dim = (n + quiet * 2) * scale;
  const img = new Uint8ClampedArray(dim * dim * 4).fill(255); // weiss
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.modules[r][c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = (((r + quiet) * scale + dy) * dim + ((c + quiet) * scale + dx)) * 4;
          img[o] = img[o + 1] = img[o + 2] = 0;
        }
      }
    }
  }
  const res = jsQR(img, dim, dim);
  return res ? res.data : null;
}

test('generated QR decodes back to the input (auto version + auto mask)', () => {
  const db = loadDb();
  const payload = JSON.stringify(db.dbBuildQrPayload('fz1', { maxBytes: 1000 }));
  const cases = ['mod-1!', payload, 'x'.repeat(280)];
  for (const c of cases) {
    assert.equal(decodeRoundTrip(c, { ecl: 'L' }), c, `decode len=${c.length}`);
  }
});

test('dbBuildQrPayload: structure, compact keys, never includes photos', () => {
  const db = loadDb();
  const p = db.dbBuildQrPayload('fz1', { maxBytes: 100000 });
  assert.equal(p.app, 'ModLog');
  assert.equal(p.t, 'vehicle');
  assert.equal(p.truncated, false);
  assert.deepEqual(Object.keys(p.fz).sort(), ['farbe', 'jahr', 'kuerzel', 'name']);
  assert.ok(Array.isArray(p.mods) && p.mods.length === 5);
  // Kompakte Schlüssel, keine internen Felder (id/fz)
  assert.deepEqual(Object.keys(p.mods[0]).sort(), ['d', 'k', 'km', 'ko', 'n', 'no', 'o', 's']);
  // Fotos/Blobs dürfen nirgends auftauchen
  const json = JSON.stringify(p);
  assert.ok(!/data:image|dataUrl|"data"/.test(json), 'kein Foto-Datenfeld im Payload');
});

test('dbBuildQrPayload: truncates gracefully when over maxBytes', () => {
  const db = loadDb();
  const small = db.dbBuildQrPayload('fz1', { maxBytes: 220 });
  assert.equal(small.truncated, true);
  assert.ok(small.mods.length < 5, 'Einträge wurden reduziert');
  assert.equal(small.fz.kuerzel, '135i', 'Meta bleibt erhalten');

  // Selbst wenn nichts passt: nur Meta, keine Mods, truncated
  const tiny = db.dbBuildQrPayload('fz1', { maxBytes: 10 });
  assert.equal(tiny.truncated, true);
  assert.equal(tiny.mods.length, 0);

  assert.equal(db.dbBuildQrPayload('does-not-exist'), null);
});
