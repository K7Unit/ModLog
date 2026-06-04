/**
 * Tests für den vendored QR-Decoder (src/qr-decode.js).
 *
 * - Encoder ↔ Decoder Round-Trip (src/qr.js → decodeMatrix) über mehrere
 *   Versionen/ECC inkl. Umlaute.
 * - Reed-Solomon-Fehlerkorrektur: injizierte Modul-Fehler werden behoben.
 * - decodeImage auf sauber gerasterten Bildern, quergeprüft mit jsqr (Oracle).
 * - End-to-End: Build-Payload → QR → Bild → decode → parse → import.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const QR = require('../src/qr.js');
const QRD = require('../src/qr-decode.js');
const jsQR = require('jsqr');
const { loadDb } = require('./helpers');

const PAYLOADS = [
  'mod-1!',
  'ModLog {a:1} Öhlins ä ö ü ß',
  'x'.repeat(220),
  JSON.stringify({
    app: 'ModLog', v: 1, t: 'vehicle',
    fz: { name: 'BMW M5 F90', jahr: 2019, farbe: 'Blue Stone', kuerzel: 'M5' },
    mods: [{ n: 'Akrapovič', k: 'Motor', d: '2025-03-01', ko: 6500, km: 12000, s: 'akrapovic.com', o: '', no: 'Titan' }],
    truncated: false,
  }),
];

function raster(q, scale, quiet) {
  const n = q.size, dim = (n + quiet * 2) * scale;
  const img = new Uint8ClampedArray(dim * dim * 4).fill(255);
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
  return { img, dim };
}

test('decodeMatrix round-trips with the encoder across ECC levels', () => {
  for (const t of PAYLOADS) {
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      const q = QR.generate(t, { ecl });
      assert.equal(QRD.decodeMatrix(q.modules), t, `ecl=${ecl} len=${t.length}`);
    }
  }
});

test('decodeMatrix recovers from injected module errors (Reed-Solomon)', () => {
  for (const ecl of ['M', 'Q', 'H']) {
    const t = 'ModLog import resilience test Öäü ' + 'z'.repeat(60);
    const q = QR.generate(t, { ecl });
    const mod = q.modules.map(r => r.slice());
    // ein paar Module kippen (innerhalb der ECC-Kapazität)
    let flips = 0;
    for (let i = 0; i < 3000 && flips < 4; i++) {
      const x = 2 + Math.floor(Math.random() * (q.size - 4));
      const y = 2 + Math.floor(Math.random() * (q.size - 4));
      mod[y][x] = !mod[y][x];
      flips++;
    }
    assert.equal(QRD.decodeMatrix(mod), t, `recovered ecl=${ecl}`);
  }
});

test('decodeImage decodes clean rasters (cross-checked with jsqr)', () => {
  for (const t of PAYLOADS) {
    for (const scale of [3, 4, 6]) {
      const q = QR.generate(t, { ecl: 'L' });
      const { img, dim } = raster(q, scale, 4);
      assert.equal(QRD.decodeImage(img, dim, dim), t, `mine scale=${scale} len=${t.length}`);
      const ref = jsQR(img, dim, dim);
      assert.equal(ref && ref.data, t, `jsqr oracle scale=${scale} len=${t.length}`);
    }
  }
});

test('decodeMatrix throws on an undecodable grid', () => {
  const blank = Array.from({ length: 21 }, () => new Array(21).fill(false));
  assert.throws(() => QRD.decodeMatrix(blank)); // Format/ RS nicht lesbar
  assert.throws(() => QRD.decodeMatrix([[true, false], [false, true]]), e => e.code === 'bad_dimension');
});

test('end-to-end: build payload → QR → image → decode → parse → import', () => {
  const db = loadDb();
  const payloadStr = JSON.stringify(db.dbBuildQrPayload('fz1', { maxBytes: 1000 }));
  const q = QR.generate(payloadStr, { ecl: 'L' });
  const { img, dim } = raster(q, 4, 4);

  const scanned = QRD.decodeImage(img, dim, dim);
  assert.equal(scanned, payloadStr, 'gescannter Text == Original-Payload');

  const parsed = db.dbParseQrPayload(scanned);
  const res = db.dbImportVehicle(parsed, 'neu');
  assert.ok(res.count >= 1);
  const imported = db.dbGetEintraege({ fz: res.fahrzeugId });
  assert.ok(imported.some(e => e.name.includes('Öhlins')), 'Umlaut über die ganze Kette erhalten');
});
