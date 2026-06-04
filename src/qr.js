/**
 * ModLog — qr.js
 * Selbstständiger, abhängigkeitsfreier QR-Code-Encoder (Byte-Modus,
 * Version 1–40, Fehlerkorrektur L/M/Q/H). KEINE Laufzeit-Abhängigkeit,
 * kein CDN/npm — die Datei ist lokal in src/ vendored.
 *
 * Original-Implementierung für ModLog nach ISO/IEC 18004. Der Algorithmus
 * (Reed-Solomon über GF(256), Masken + Penalty-Bewertung, Format- und
 * Versionsinfo, Datenplatzierung) folgt der öffentlich dokumentierten
 * Vorgehensweise der "QR Code generator library" von Project Nayuki
 * (https://www.nayuki.io/page/qr-code-generator-library).
 *
 * MIT License — Copyright (c) Project Nayuki (Algorithmus) / ModLog (Port).
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

(function (global) {
  'use strict';

  // Fehlerkorrektur-Level: format-Bits (für Formatinfo) + Tabellen-Index.
  const ECL = {
    L: { bits: 1, idx: 0 },
    M: { bits: 0, idx: 1 },
    Q: { bits: 3, idx: 2 },
    H: { bits: 2, idx: 3 },
  };

  // ECC-Codewörter pro Block, indiziert [eclIdx][version]. Index 0 = ungenutzt.
  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];

  // Anzahl ECC-Blöcke, indiziert [eclIdx][version]. Index 0 = ungenutzt.
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  const getBit = (x, i) => ((x >>> i) & 1) !== 0;

  // ---- Galois-Feld GF(256), primitives Polynom 0x11D ----
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function rsComputeDivisor(degree) {
    const result = [];
    for (let i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsComputeRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  }

  // ---- Versions-Helfer ----
  function getNumRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(ver, eclIdx) {
    return Math.floor(getNumRawDataModules(ver) / 8)
      - ECC_CODEWORDS_PER_BLOCK[eclIdx][ver] * NUM_ERROR_CORRECTION_BLOCKS[eclIdx][ver];
  }

  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = (ver === 32) ? 26
      : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [];
    for (let i = 0, pos = ver * 4 + 10; i < numAlign - 1; i++, pos -= step) {
      result.unshift(pos);
    }
    result.unshift(6);
    return result;
  }

  function byteCharCountBits(ver) {
    return ver <= 9 ? 8 : 16; // Byte-Modus: 8 Bit (V1–9), sonst 16 Bit
  }

  // ---- UTF-8-Bytes ----
  function toUtf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        const c2 = str.charCodeAt(++i);
        c = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F),
                 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  // ---- Daten-Codewörter aus Text bauen ----
  function makeDataCodewords(bytes, ver, eclIdx) {
    const capacityBits = getNumDataCodewords(ver, eclIdx) * 8;
    const cci = byteCharCountBits(ver);
    const bits = [];
    const appendBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    appendBits(0x4, 4);            // Modus: Byte
    appendBits(bytes.length, cci); // Zeichenanzahl
    for (const b of bytes) appendBits(b, 8);

    // Terminator (bis zu 4 Bit), dann auf Byte-Grenze auffüllen
    appendBits(0, Math.min(4, capacityBits - bits.length));
    appendBits(0, (8 - bits.length % 8) % 8);
    // Füll-Bytes 0xEC / 0x11 im Wechsel
    for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) {
      appendBits(pad, 8);
    }

    const codewords = new Array(bits.length / 8).fill(0);
    for (let i = 0; i < bits.length; i++) {
      codewords[i >>> 3] |= bits[i] << (7 - (i & 7));
    }
    return codewords;
  }

  // ECC anhängen und Blöcke interleaven
  function addEccAndInterleave(data, ver, eclIdx) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[eclIdx][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[eclIdx][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShort = numBlocks - rawCodewords % numBlocks;
    const shortLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const rsDiv = rsComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const datLen = shortLen - blockEccLen + (i < numShort ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = rsComputeRemainder(dat, rsDiv);
      if (i < numShort) dat.push(0); // Platzhalter zum Ausrichten
      blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        // Platzhalter-Byte in kurzen Blöcken überspringen
        if (i !== shortLen - blockEccLen || j >= numShort) result.push(blocks[j][i]);
      }
    }
    return result;
  }

  // ---- Matrix-Aufbau ----
  function QrMatrix(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.modules = [];
    this.isFn = [];
    for (let y = 0; y < this.size; y++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFn.push(new Array(this.size).fill(false));
    }
  }

  QrMatrix.prototype.setFn = function (x, y, dark) {
    this.modules[y][x] = dark;
    this.isFn[y][x] = true;
  };

  QrMatrix.prototype.drawFinder = function (x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  QrMatrix.prototype.drawAlignment = function (x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QrMatrix.prototype.drawFormatBits = function (eclBits, mask) {
    const data = (eclBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFn(8, i, getBit(bits, i));
    this.setFn(8, 7, getBit(bits, 6));
    this.setFn(8, 8, getBit(bits, 7));
    this.setFn(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFn(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFn(8, this.size - 15 + i, getBit(bits, i));
    this.setFn(8, this.size - 8, true); // immer dunkles Modul
  };

  QrMatrix.prototype.drawVersion = function () {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + i % 3;
      const b = Math.floor(i / 3);
      this.setFn(a, b, bit);
      this.setFn(b, a, bit);
    }
  };

  QrMatrix.prototype.drawFunctionPatterns = function (eclBits) {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);

    const align = getAlignmentPatternPositions(this.ver);
    const n = align.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) {
          this.drawAlignment(align[i], align[j]);
        }
      }
    }

    this.drawFormatBits(eclBits, 0); // reserviert die Formatinfo-Module
    this.drawVersion();
  };

  QrMatrix.prototype.drawCodewords = function (data) {
    const size = this.size;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.isFn[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QrMatrix.prototype.applyMask = function (mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFn[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: invert = false;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  // ---- Penalty-Bewertung (für automatische Maskenwahl) ----
  function finderPenaltyCountPatterns(rh) {
    const n = rh[1];
    const core = n > 0 && rh[2] === n && rh[3] === n * 3 && rh[4] === n && rh[5] === n;
    return (core && rh[0] >= n * 4 && rh[6] >= n ? 1 : 0)
         + (core && rh[6] >= n * 4 && rh[0] >= n ? 1 : 0);
  }
  function finderPenaltyAddHistory(run, rh, size) {
    if (rh[0] === 0) run += size; // heller Rand vor erstem Run
    rh.pop();
    rh.unshift(run);
  }
  function finderPenaltyTerminate(color, run, rh, size) {
    if (color) { finderPenaltyAddHistory(run, rh, size); run = 0; }
    run += size;
    finderPenaltyAddHistory(run, rh, size);
    return finderPenaltyCountPatterns(rh);
  }

  QrMatrix.prototype.penalty = function () {
    const size = this.size, m = this.modules;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    let result = 0;

    for (let y = 0; y < size; y++) {
      let color = false, run = 0;
      const rh = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (m[y][x] === color) {
          run++;
          if (run === 5) result += N1; else if (run > 5) result++;
        } else {
          finderPenaltyAddHistory(run, rh, size);
          if (!color) result += finderPenaltyCountPatterns(rh) * N3;
          color = m[y][x];
          run = 1;
        }
      }
      result += finderPenaltyTerminate(color, run, rh, size) * N3;
    }
    for (let x = 0; x < size; x++) {
      let color = false, run = 0;
      const rh = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (m[y][x] === color) {
          run++;
          if (run === 5) result += N1; else if (run > 5) result++;
        } else {
          finderPenaltyAddHistory(run, rh, size);
          if (!color) result += finderPenaltyCountPatterns(rh) * N3;
          color = m[y][x];
          run = 1;
        }
      }
      result += finderPenaltyTerminate(color, run, rh, size) * N3;
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += N2;
      }
    }

    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * N4;
    return result;
  };

  // ---- Öffentliche API ----
  /**
   * @param {string} text
   * @param {{ecl?:('L'|'M'|'Q'|'H'), version?:number, mask?:number}} [opts]
   * @returns {{size:number, version:number, mask:number, modules:boolean[][]}}
   */
  function generate(text, opts) {
    opts = opts || {};
    const ecl = ECL[opts.ecl || 'M'];
    if (!ecl) throw new Error('Ungültiges ECC-Level: ' + opts.ecl);
    const bytes = toUtf8Bytes(text);

    // Version wählen (kleinste passende) oder erzwungene Version prüfen
    let ver = opts.version;
    if (ver) {
      const need = 4 + byteCharCountBits(ver) + 8 * bytes.length;
      if (need > getNumDataCodewords(ver, ecl.idx) * 8) {
        throw new Error('Daten passen nicht in erzwungene QR-Version ' + ver);
      }
    } else {
      ver = 0;
      for (let v = 1; v <= 40; v++) {
        const need = 4 + byteCharCountBits(v) + 8 * bytes.length;
        if (need <= getNumDataCodewords(v, ecl.idx) * 8) { ver = v; break; }
      }
      if (!ver) throw new Error('Daten zu gross für QR (über Version 40)');
    }

    const dataCodewords = makeDataCodewords(bytes, ver, ecl.idx);
    const allCodewords = addEccAndInterleave(dataCodewords, ver, ecl.idx);

    const qr = new QrMatrix(ver);
    qr.drawFunctionPatterns(ecl.bits);
    qr.drawCodewords(allCodewords);

    let mask = opts.mask;
    if (mask === undefined || mask === null) {
      // Beste Maske per Penalty wählen
      let best = -1, minScore = Infinity;
      for (let m = 0; m < 8; m++) {
        qr.applyMask(m);
        qr.drawFormatBits(ecl.bits, m);
        const score = qr.penalty();
        if (score < minScore) { minScore = score; best = m; }
        qr.applyMask(m); // zurücksetzen (XOR ist selbstinvers)
      }
      mask = best;
    }
    qr.applyMask(mask);
    qr.drawFormatBits(ecl.bits, mask);

    return { size: qr.size, version: ver, mask, modules: qr.modules };
  }

  const QR = { generate };

  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  else global.QR = QR;
})(typeof self !== 'undefined' ? self : this);
