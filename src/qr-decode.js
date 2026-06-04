/**
 * ModLog — qr-decode.js
 * Selbstständiger, abhängigkeitsfreier QR-Code-DECODER (Byte-Modus, Version
 * 1–40, ECC L/M/Q/H). Gegenstück zu src/qr.js. KEINE Laufzeit-Abhängigkeit,
 * kein CDN/npm — lokal in src/ vendored.
 *
 * Original-Implementierung für ModLog nach ISO/IEC 18004. Der Decode-
 * Algorithmus (Finder-Erkennung, Format-BCH-Korrektur, Maske, De-Interleave,
 * Reed-Solomon-Fehlerkorrektur über GF(256), Byte-Segment-Parsing) folgt der
 * öffentlich dokumentierten QR-Spezifikation. Aufbau/Modul-Layout sind exakt
 * spiegelbildlich zum Encoder in src/qr.js.
 *
 * MIT License — Copyright (c) ModLog.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction... (Standard-MIT-Text). THE SOFTWARE IS
 * PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

(function (global) {
  'use strict';

  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
  const ECL_FROM_BITS = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };
  const ECL_IDX = { L: 0, M: 1, Q: 2, H: 3 };

  const getBit = (x, i) => ((x >>> i) & 1) !== 0;

  function decodeError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  // ---- GF(256), primitives Polynom 0x11D ----
  const EXP = new Array(512);
  const LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  const ginv = (a) => EXP[255 - LOG[a]];
  const gpow = (x, p) => x === 0 ? 0 : EXP[(LOG[x] * p) % 255];

  // ---- Versions-Helfer (wie im Encoder) ----
  function getNumRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [];
    for (let i = 0, pos = ver * 4 + 10; i < numAlign - 1; i++, pos -= step) result.unshift(pos);
    result.unshift(6);
    return result;
  }
  const byteCharCountBits = (ver) => ver <= 9 ? 8 : 16;

  // ---- Funktionsmodul-Karte (spiegelbildlich zum Encoder) ----
  function buildFunctionMap(ver, size) {
    const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) isFn[y][x] = true; };
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy); };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }
    const pos = getAlignmentPatternPositions(ver);
    const n = pos.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy);
    }
    for (let i = 0; i <= 5; i++) set(8, i);
    set(8, 7); set(8, 8); set(7, 8);
    for (let i = 9; i < 15; i++) set(14 - i, 8);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i);
    set(8, size - 8);
    if (ver >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b); set(b, a);
      }
    }
    return isFn;
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      default: return false;
    }
  }

  // ---- Formatinfo lesen (BCH(15,5)-Korrektur) ----
  const VALID_FORMATS = (function () {
    const out = [];
    for (let d = 0; d < 32; d++) {
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      out.push({ data: d, cw: ((d << 10) | rem) ^ 0x5412 });
    }
    return out;
  })();
  const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };

  function decodeFormatBits(raw15) {
    let best = null, bestDist = 99;
    for (const f of VALID_FORMATS) {
      const d = popcount(raw15 ^ f.cw);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    if (bestDist > 3) return null;
    const data = best.data;
    const eclBits = data >> 3;
    const mask = data & 7;
    const ecl = ECL_FROM_BITS[eclBits];
    if (!ecl) return null;
    return { ecl, mask };
  }

  function readFormat(modules, size) {
    // Kopie A
    let a = 0;
    const aCoords = [];
    for (let i = 0; i <= 5; i++) aCoords.push([8, i]);
    aCoords.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) aCoords.push([14 - i, 8]);
    aCoords.forEach(([x, y], i) => { if (modules[y][x]) a |= (1 << i); });
    let res = decodeFormatBits(a);
    if (res) return res;
    // Kopie B
    let b = 0;
    const bCoords = [];
    for (let i = 0; i < 8; i++) bCoords.push([size - 1 - i, 8]);
    for (let i = 8; i < 15; i++) bCoords.push([8, size - 15 + i]);
    bCoords.forEach(([x, y], i) => { if (modules[y][x]) b |= (1 << i); });
    return decodeFormatBits(b);
  }

  // ---- Reed-Solomon-Decode (Fehler-Korrektur via BM + lineares GS) ----
  function gfPolyEval(p, x) { let y = p[0]; for (let i = 1; i < p.length; i++) y = gmul(y, x) ^ p[i]; return y; }
  function gfPolyScale(p, s) { return p.map(c => gmul(c, s)); }
  function gfPolyAdd(a, b) {
    const r = new Array(Math.max(a.length, b.length)).fill(0);
    for (let i = 0; i < a.length; i++) r[i + r.length - a.length] = a[i];
    for (let i = 0; i < b.length; i++) r[i + r.length - b.length] ^= b[i];
    return r;
  }
  function rsErrorLocator(synd) {
    let errLoc = [1], oldLoc = [1];
    for (let i = 0; i < synd.length; i++) {
      oldLoc.push(0);
      let delta = synd[i];
      for (let j = 1; j < errLoc.length; j++) delta ^= gmul(errLoc[errLoc.length - 1 - j], synd[i - j]);
      if (delta !== 0) {
        if (oldLoc.length > errLoc.length) {
          const newLoc = gfPolyScale(oldLoc, delta);
          oldLoc = gfPolyScale(errLoc, ginv(delta));
          errLoc = newLoc;
        }
        errLoc = gfPolyAdd(errLoc, gfPolyScale(oldLoc, delta));
      }
    }
    return errLoc;
  }
  function gfSolve(A, b) {
    const t = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < t; col++) {
      let piv = -1;
      for (let r = col; r < t; r++) if (M[r][col] !== 0) { piv = r; break; }
      if (piv < 0) throw decodeError('decode_failed', 'RS: singuläres System');
      const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      const inv = ginv(M[col][col]);
      for (let j = col; j <= t; j++) M[col][j] = gmul(M[col][j], inv);
      for (let r = 0; r < t; r++) {
        if (r !== col && M[r][col] !== 0) {
          const f = M[r][col];
          for (let j = col; j <= t; j++) M[r][j] ^= gmul(f, M[col][j]);
        }
      }
    }
    return M.map(row => row[t]);
  }
  // Korrigiert ein Codewort (highest-degree-first) mit nsym ECC-Bytes.
  function rsCorrect(cw, nsym) {
    const synd = [];
    let allZero = true;
    for (let k = 0; k < nsym; k++) { synd.push(gfPolyEval(cw, EXP[k])); if (synd[k] !== 0) allZero = false; }
    if (allZero) return cw.slice();

    const errLoc = rsErrorLocator(synd);
    const numErr = errLoc.length - 1;
    const n = cw.length;
    const positions = [];
    for (let i = 0; i < n; i++) {
      if (gfPolyEval(errLoc, EXP[(255 - i) % 255]) === 0) positions.push(n - 1 - i);
    }
    if (positions.length !== numErr || numErr === 0 || numErr > Math.floor(nsym / 2)) {
      throw decodeError('decode_failed', 'RS: nicht korrigierbar');
    }
    // Magnituden lösen: S_k = Σ Y_e · X_e^k, k=0..t-1
    const t = positions.length;
    const X = positions.map(p => EXP[(n - 1 - p) % 255]);
    const A = [];
    for (let k = 0; k < t; k++) A.push(X.map(xe => gpow(xe, k)));
    const Y = gfSolve(A, synd.slice(0, t));
    const out = cw.slice();
    for (let e = 0; e < t; e++) out[positions[e]] ^= Y[e];
    // Verifizieren
    for (let k = 0; k < nsym; k++) if (gfPolyEval(out, EXP[k]) !== 0) throw decodeError('decode_failed', 'RS: Verifikation fehlgeschlagen');
    return out;
  }

  // ---- UTF-8-Decode ----
  function utf8Decode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
      else if (b >= 0xC0 && b < 0xE0) { out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F)); i += 2; }
      else if (b >= 0xE0 && b < 0xF0) { out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F)); i += 3; }
      else {
        const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        const u = cp - 0x10000;
        out += String.fromCharCode(0xD800 + (u >> 10), 0xDC00 + (u & 0x3FF));
        i += 4;
      }
    }
    return out;
  }

  /**
   * Decodiert eine bereits abgetastete Modul-Matrix (boolean[][], true=dunkel).
   * @param {boolean[][]} modules
   * @returns {string}
   */
  function decodeMatrix(modules) {
    const size = modules.length;
    const ver = (size - 17) / 4;
    if (!Number.isInteger(ver) || ver < 1 || ver > 40) throw decodeError('bad_dimension', 'Ungültige QR-Grösse: ' + size);

    const fmt = readFormat(modules, size);
    if (!fmt) throw decodeError('format_unreadable', 'Formatinfo nicht lesbar');
    const { mask, ecl } = fmt;
    const eclIdx = ECL_IDX[ecl];

    const isFn = buildFunctionMap(ver, size);
    const total = Math.floor(getNumRawDataModules(ver) / 8);
    const codewords = new Array(total).fill(0);
    let bitIdx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFn[y][x] && bitIdx < total * 8) {
            let bit = modules[y][x] ? 1 : 0;
            if (maskBit(mask, x, y)) bit ^= 1;
            codewords[bitIdx >>> 3] |= bit << (7 - (bitIdx & 7));
            bitIdx++;
          }
        }
      }
    }

    // De-Interleave (Umkehrung von addEccAndInterleave)
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[eclIdx][ver];
    const blockEcc = ECC_CODEWORDS_PER_BLOCK[eclIdx][ver];
    const numShort = numBlocks - total % numBlocks;
    const shortLen = Math.floor(total / numBlocks);
    const maxLen = shortLen + 1;
    const blocks = Array.from({ length: numBlocks }, () => []);
    let pos = 0;
    for (let i = 0; i < maxLen; i++) {
      for (let j = 0; j < numBlocks; j++) {
        if (i === shortLen - blockEcc && j < numShort) blocks[j].push(0); // Platzhalter
        else blocks[j].push(codewords[pos++]);
      }
    }

    const dataStream = [];
    for (let j = 0; j < numBlocks; j++) {
      let cw;
      if (j < numShort) {
        cw = blocks[j].slice(0, shortLen - blockEcc).concat(blocks[j].slice(shortLen - blockEcc + 1));
      } else {
        cw = blocks[j];
      }
      const corrected = rsCorrect(cw, blockEcc);
      const dataLen = cw.length - blockEcc;
      for (let i = 0; i < dataLen; i++) dataStream.push(corrected[i]);
    }

    // Bitstrom parsen (Byte-Modus)
    let bp = 0;
    const read = (nbits) => {
      let v = 0;
      for (let i = 0; i < nbits; i++) {
        const byte = dataStream[bp >>> 3] || 0;
        const bit = (byte >> (7 - (bp & 7))) & 1;
        v = (v << 1) | bit;
        bp++;
      }
      return v;
    };
    const totalBits = dataStream.length * 8;
    const outBytes = [];
    while (totalBits - bp >= 4) {
      const mode = read(4);
      if (mode === 0) break;              // Terminator
      if (mode === 4) {                   // Byte-Modus
        const len = read(byteCharCountBits(ver));
        for (let k = 0; k < len; k++) outBytes.push(read(8));
      } else {
        break;                            // andere Modi erzeugt der Encoder nie
      }
    }
    return utf8Decode(outBytes);
  }

  // ---- Bild-Pipeline (Kamera-Frames) ----
  function toGray(data, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      g[i] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
    }
    return g;
  }
  function otsu(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = -1, thr = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (wB === 0) continue;
      const wF = total - wB; if (wF === 0) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; thr = i; }
    }
    return thr;
  }

  function findFinders(gray, thr, w, h) {
    const cands = [];
    const check = (lens) => {
      const totalLen = lens[0] + lens[1] + lens[2] + lens[3] + lens[4];
      if (totalLen < 7) return 0;
      const unit = totalLen / 7;
      const tol = unit * 0.5;
      const exp = [1, 1, 3, 1, 1];
      for (let i = 0; i < 5; i++) if (Math.abs(lens[i] - exp[i] * unit) > exp[i] * tol) return 0;
      return unit;
    };
    for (let y = 0; y < h; y++) {
      // Lauflängen der Zeile
      const runs = [];
      let dark = gray[y * w] <= thr, start = 0;
      for (let x = 1; x <= w; x++) {
        const d = x < w ? (gray[y * w + x] <= thr) : !dark;
        if (d !== dark) { runs.push({ dark, len: x - start, end: x }); start = x; dark = d; }
      }
      for (let i = 0; i + 4 < runs.length; i++) {
        if (!runs[i].dark) continue;
        const lens = [runs[i].len, runs[i + 1].len, runs[i + 2].len, runs[i + 3].len, runs[i + 4].len];
        const unit = check(lens);
        if (unit) {
          const cx = runs[i + 2].end - runs[i + 2].len / 2;
          cands.push({ x: cx, y: y + 0.5, unit });
        }
      }
    }
    // Cluster nach Nähe
    const clusters = [];
    for (const c of cands) {
      let merged = false;
      for (const cl of clusters) {
        if (Math.abs(cl.x - c.x) <= cl.unit && Math.abs(cl.y - c.y) <= cl.unit * 3.5) {
          cl.x = (cl.x * cl.n + c.x) / (cl.n + 1);
          cl.y = (cl.y * cl.n + c.y) / (cl.n + 1);
          cl.unit = (cl.unit * cl.n + c.unit) / (cl.n + 1);
          cl.n++;
          merged = true;
          break;
        }
      }
      if (!merged) clusters.push({ x: c.x, y: c.y, unit: c.unit, n: 1 });
    }
    let result = clusters.filter(c => c.n >= 2);
    // Zentren sub-pixel-genau nachjustieren (Cluster-Schwerpunkt kann durch
    // benachbarte Datenmodule leicht verzogen sein) → exakte Affin-Basis.
    for (const c of result) refineCenter(gray, thr, w, h, c);
    // Echte Finder erfüllen das 1:1:3:1:1-Verhältnis auch VERTIKAL — das
    // verwirft die meisten zufälligen Treffer aus dem Datenbereich.
    result = result.filter(c => verifyFinderVertical(gray, thr, w, h, c));
    result.sort((a, b) => b.n - a.n);
    return result.slice(0, 9);
  }

  // Prüft das vertikale 1:1:3:1:1-Muster durch das Finder-Zentrum.
  function verifyFinderVertical(gray, thr, w, h, c) {
    const rx = Math.round(c.x);
    if (rx < 0 || rx >= w) return false;
    const runs = [];
    let dark = gray[rx] <= thr, start = 0;
    for (let y = 1; y <= h; y++) {
      const d = y < h ? (gray[y * w + rx] <= thr) : !dark;
      if (d !== dark) { runs.push({ dark, len: y - start, end: y }); start = y; dark = d; }
    }
    let idx = -1;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].end - runs[i].len <= c.y && c.y < runs[i].end) { idx = i; break; }
    }
    if (idx < 2 || idx + 2 >= runs.length) return false;
    if (!runs[idx].dark || !runs[idx - 2].dark) return false;
    const lens = [runs[idx - 2].len, runs[idx - 1].len, runs[idx].len, runs[idx + 1].len, runs[idx + 2].len];
    const total = lens[0] + lens[1] + lens[2] + lens[3] + lens[4];
    if (total < 7) return false;
    const unit = total / 7, tol = unit * 0.6, exp = [1, 1, 3, 1, 1];
    for (let i = 0; i < 5; i++) if (Math.abs(lens[i] - exp[i] * unit) > exp[i] * tol) return false;
    return true;
  }

  // Verlängert den zentralen dunklen Lauf des Finders horizontal & vertikal
  // durch das Zentrum und setzt c.x/c.y auf dessen Mitte.
  function refineCenter(gray, thr, w, h, c) {
    const darkAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h && gray[y * w + x] <= thr;
    const span = (fixed, val, horizontal) => {
      let a = val, b = val;
      const isD = (i) => horizontal ? darkAt(i, fixed) : darkAt(fixed, i);
      if (!isD(val)) return null;
      const lim = horizontal ? w : h;
      while (a - 1 >= 0 && isD(a - 1)) a--;
      while (b + 1 < lim && isD(b + 1)) b++;
      return (a + b) / 2;
    };
    const ry = Math.round(c.y);
    const nx = span(ry, Math.round(c.x), true);
    if (nx != null) c.x = nx;
    const rx = Math.round(c.x);
    const ny = span(rx, Math.round(c.y), false);
    if (ny != null) c.y = ny;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // ---- Perspektiv-Transform (ZXing-Methode, Modul- → Bildkoordinaten) ----
  // Matrix als [a11,a21,a31, a12,a22,a32, a13,a23,a33].
  function ptSquareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
    const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (dx3 === 0 && dy3 === 0) {
      return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
    }
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const denom = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / denom;
    const a23 = (dx1 * dy3 - dx3 * dy1) / denom;
    return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
  }
  function ptAdjoint(m) {
    return [
      m[4] * m[8] - m[5] * m[7], m[5] * m[6] - m[3] * m[8], m[3] * m[7] - m[4] * m[6],
      m[7] * m[2] - m[1] * m[8], m[0] * m[8] - m[6] * m[2], m[6] * m[1] - m[0] * m[7],
      m[1] * m[5] - m[2] * m[4], m[2] * m[3] - m[0] * m[5], m[0] * m[4] - m[1] * m[3],
    ];
  }
  function ptTimes(a, b) {
    return [
      a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
      a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
      a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    ];
  }
  function ptApply(m, x, y) {
    const den = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / den, (m[3] * x + m[4] * y + m[5]) / den];
  }
  function quadToQuad(s, d) {
    const sToQ = ptSquareToQuad(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
    const qToS = ptAdjoint(ptSquareToQuad(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]));
    return ptTimes(sToQ, qToS);
  }

  // Lokalisiert das Zentrum des unteren rechten Alignment-Patterns nahe (ex,ey).
  // Sucht das isolierte zentrale Modul (kleine, vom Lichtring umschlossene
  // dunkle Komponente) per begrenztem Flood-Fill und liefert dessen Schwerpunkt.
  function locateAlignment(gray, thr, w, h, ex, ey, unit) {
    if (!isFinite(ex) || !isFinite(ey)) return null;
    const win = Math.max(5, Math.round(unit * 3));
    const x0 = Math.max(0, Math.round(ex - win)), x1 = Math.min(w - 1, Math.round(ex + win));
    const y0 = Math.max(0, Math.round(ey - win)), y1 = Math.min(h - 1, Math.round(ey + win));
    if (x1 < x0 || y1 < y0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const seen = new Uint8Array(bw * bh);
    let best = null, bestD = Infinity;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const li = (yy - y0) * bw + (xx - x0);
        if (seen[li] || gray[yy * w + xx] > thr) continue;
        let sx = 0, sy = 0, cnt = 0, minx = xx, maxx = xx, miny = yy, maxy = yy;
        const stack = [[xx, yy]]; seen[li] = 1;
        while (stack.length) {
          const cur = stack.pop(); const cx = cur[0], cy = cur[1];
          sx += cx; sy += cy; cnt++;
          if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
          if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
          const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (let n = 0; n < 4; n++) {
            const nx = nb[n][0], ny = nb[n][1];
            if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
            const nl = (ny - y0) * bw + (nx - x0);
            if (!seen[nl] && gray[ny * w + nx] <= thr) { seen[nl] = 1; stack.push([nx, ny]); }
          }
        }
        // isoliertes zentrales Modul ~ unit×unit (kein grosser Ring/Block)
        if ((maxx - minx + 1) <= unit * 2 && (maxy - miny + 1) <= unit * 2 && cnt >= unit * unit * 0.3) {
          const cxv = sx / cnt, cyv = sy / cnt;
          const d = Math.hypot(cxv - ex, cyv - ey);
          if (d < bestD) { bestD = d; best = { x: cxv, y: cyv }; }
        }
      }
    }
    return best;
  }

  // Ordnet ein Kandidaten-Tripel zu TL + zwei Achsenpunkten und bewertet, wie
  // gut es einem QR-Finder-Tripel entspricht (klein = besser).
  function orderTriple(p, q, r) {
    const dpq = dist(p, q), dpr = dist(p, r), dqr = dist(q, r);
    let tl, a, b;
    if (dqr >= dpq && dqr >= dpr) { tl = p; a = q; b = r; }       // längste Seite q-r → Ecke p
    else if (dpr >= dpq && dpr >= dqr) { tl = q; a = p; b = r; }
    else { tl = r; a = p; b = q; }
    const l1 = dist(tl, a), l2 = dist(tl, b);
    if (l1 === 0 || l2 === 0) return null;
    const v1x = a.x - tl.x, v1y = a.y - tl.y, v2x = b.x - tl.x, v2y = b.y - tl.y;
    const perp = Math.abs(v1x * v2x + v1y * v2y) / (l1 * l2);     // 0 = rechtwinklig
    const bal = Math.abs(l1 - l2) / Math.max(l1, l2);            // 0 = gleich lange Schenkel
    const mu = (tl.unit + a.unit + b.unit) / 3;
    const uvar = Math.sqrt(((tl.unit - mu) ** 2 + (a.unit - mu) ** 2 + (b.unit - mu) ** 2) / 3) / mu;
    return { tl, a, b, score: perp + bal + uvar };
  }

  function sampleGrid(map, dim, gray, thr, w, h) {
    const modules = [];
    for (let r = 0; r < dim; r++) {
      const row = [];
      for (let c = 0; c < dim; c++) {
        const p = map(c, r);
        const xi = Math.round(p[0]), yi = Math.round(p[1]);
        row.push(xi >= 0 && yi >= 0 && xi < w && yi < h ? (gray[yi * w + xi] <= thr) : false);
      }
      modules.push(row);
    }
    try { return decodeMatrix(modules); } catch (_) { return null; }
  }

  // Tastet aus 3 Findern ab. Zuerst per Affin-Basis (genügt für kleine/mittlere
  // Codes); schlägt das fehl, ab Version 2 das untere rechte Alignment-Pattern
  // lokalisieren und per Perspektiv-Transform erneut abtasten (korrigiert
  // Akkumulation und perspektivische Verzerrung).
  function sampleAndDecode(tl, axisA, axisB, gray, thr, w, h) {
    const unit = (tl.unit + axisA.unit + axisB.unit) / 3;
    let dim = Math.round(dist(tl, axisA) / unit) + 7;
    dim = Math.round((dim - 17) / 4) * 4 + 17;
    if (dim < 21 || dim > 177) return null;

    const ax = (axisA.x - tl.x) / (dim - 7), ay = (axisA.y - tl.y) / (dim - 7);
    const bx = (axisB.x - tl.x) / (dim - 7), by = (axisB.y - tl.y) / (dim - 7);
    const affine = (c, r) => [tl.x + ax * (c - 3) + bx * (r - 3), tl.y + ay * (c - 3) + by * (r - 3)];

    let res = sampleGrid(affine, dim, gray, thr, w, h);
    if (res !== null) return res;

    const ver = (dim - 17) / 4;
    if (ver >= 2) {
      const est = affine(dim - 7, dim - 7);
      const al = locateAlignment(gray, thr, w, h, est[0], est[1], unit);
      if (al) {
        const pt = quadToQuad(
          [3, 3, dim - 4, 3, dim - 7, dim - 7, 3, dim - 4],
          [tl.x, tl.y, axisA.x, axisA.y, al.x, al.y, axisB.x, axisB.y],
        );
        res = sampleGrid((c, r) => ptApply(pt, c, r), dim, gray, thr, w, h);
        if (res !== null) return res;
      }
    }
    return null;
  }

  /**
   * Decodiert ein RGBA-Bild (z.B. Kamera-Frame). Gibt den Text oder null.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA
   * @param {number} width
   * @param {number} height
   * @returns {string|null}
   */
  function decodeImage(data, width, height) {
    const gray = toGray(data, width, height);
    const thr = otsu(gray);
    const cands = findFinders(gray, thr, width, height);
    if (cands.length < 3) return null;

    // Aus den Kandidaten alle Tripel bilden, geometrisch bewerten und das
    // plausibelste zuerst versuchen. decodeMatrix (Format-BCH + RS) verwirft
    // falsche Tripel, daher ist die Auswahl selbstkorrigierend.
    const pool = cands.slice(0, 8);
    const triples = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let k = j + 1; k < pool.length; k++) {
          const t = orderTriple(pool[i], pool[j], pool[k]);
          if (t) triples.push(t);
        }
      }
    }
    triples.sort((a, b) => a.score - b.score);

    for (const t of triples) {
      const res = sampleAndDecode(t.tl, t.a, t.b, gray, thr, width, height)
               || sampleAndDecode(t.tl, t.b, t.a, gray, thr, width, height);
      if (res !== null) return res;
    }
    return null;
  }

  const QRDecode = { decodeMatrix, decodeImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = QRDecode;
  else global.QRDecode = QRDecode;
})(typeof self !== 'undefined' ? self : this);
