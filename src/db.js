/**
 * ModLog — db.js
 * Daten-Schicht: localStorage-basiertes Persistence Layer.
 * Alle CRUD-Operationen für Fahrzeuge und Mod-Einträge.
 *
 * Erweiterungsideen:
 * - IndexedDB für grössere Datensätze / Foto-Blobs
 * - Cloud-Sync (Supabase, Firebase o.ä.)
 * - CSV/JSON Export
 */

const STORAGE_KEY = 'modlog_data_v1';
const THEME_KEY   = 'modlog_theme_v1';

/**
 * Rohdaten aus localStorage laden.
 * @returns {{ fahrzeuge: Fahrzeug[], eintraege: ModEintrag[] }}
 */
function dbLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('[ModLog] Load error:', e);
  }
  return { fahrzeuge: [], eintraege: [] };
}

/**
 * Daten in localStorage persistieren.
 * @param {{ fahrzeuge: Fahrzeug[], eintraege: ModEintrag[] }} data
 */
function dbSave(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[ModLog] Save error:', e);
    alert('Speichern fehlgeschlagen – localStorage voll?');
  }
}

// ---- Theme ----
// Eigener localStorage-Key, völlig getrennt von den App-Daten (modlog_data_v1).

/**
 * Gespeichertes Theme lesen.
 * @returns {('light'|'dark'|null)} null wenn nichts gespeichert.
 */
function dbGetTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return (t === 'light' || t === 'dark') ? t : null;
  } catch (_) {
    return null;
  }
}

/**
 * Theme persistieren.
 * @param {('light'|'dark')} theme
 */
function dbSetTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    console.error('[ModLog] Theme save error:', e);
  }
}

/**
 * Effektives Theme bestimmen: gespeichertes zuerst, sonst Default dark —
 * prefers-color-scheme: light gilt nur als Erst-Fallback, wenn nichts
 * gespeichert ist.
 * @returns {('light'|'dark')}
 */
function dbResolveTheme() {
  const saved = dbGetTheme();
  if (saved) return saved;
  if (typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/**
 * Generiert eine simple eindeutige ID.
 * @param {string} prefix
 * @returns {string}
 */
function dbNewId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Fahrzeuge ----

/** @returns {Fahrzeug[]} */
function dbGetFahrzeuge() { return db.fahrzeuge; }

/**
 * @param {{ name: string, jahr: number, farbe: string, kuerzel: string }} data
 * @returns {Fahrzeug}
 */
function dbAddFahrzeug(data) {
  const fz = { id: dbNewId('fz'), ...data };
  db.fahrzeuge.push(fz);
  dbSave(db);
  return fz;
}

/**
 * @param {string} id
 * @param {Partial<Fahrzeug>} data
 */
function dbUpdateFahrzeug(id, data) {
  const idx = db.fahrzeuge.findIndex(f => f.id === id);
  if (idx >= 0) {
    db.fahrzeuge[idx] = { ...db.fahrzeuge[idx], ...data };
    dbSave(db);
  }
}

/**
 * Löscht Fahrzeug und alle zugehörigen Einträge.
 * @param {string} id
 */
function dbDeleteFahrzeug(id) {
  const removedIds = db.eintraege.filter(e => e.fz === id).map(e => e.id);
  db.fahrzeuge = db.fahrzeuge.filter(f => f.id !== id);
  db.eintraege = db.eintraege.filter(e => e.fz !== id);
  dbSave(db);
  // Fotos der gelöschten Einträge aufräumen (fire & forget).
  removedIds.forEach(eid => dbDeletePhotosForEntry(eid).catch(() => {}));
}

// ---- Mod-Einträge ----

/**
 * @param {{ fz?: string, kat?: string, q?: string, jahr?: string }} filter
 * @returns {ModEintrag[]}
 */
function dbGetEintraege(filter = {}) {
  let list = db.eintraege.slice();
  if (filter.fz && filter.fz !== 'all') list = list.filter(e => e.fz === filter.fz);
  if (filter.kat && filter.kat !== 'all') list = list.filter(e => e.kat === filter.kat);
  if (filter.jahr && filter.jahr !== 'all') {
    list = list.filter(e => (e.datum || '').slice(0, 4) === filter.jahr);
  }
  if (filter.q) {
    const q = filter.q.trim().toLowerCase();
    if (q) {
      list = list.filter(e =>
        [e.name, e.shop, e.oem, e.notiz].some(v => (v || '').toLowerCase().includes(q))
      );
    }
  }
  return list.sort((a, b) => b.datum.localeCompare(a.datum));
}

/**
 * @param {Omit<ModEintrag, 'id'>} data
 * @returns {ModEintrag}
 */
function dbAddEintrag(data) {
  const entry = { id: dbNewId('e'), ...data };
  db.eintraege.push(entry);
  dbSave(db);
  return entry;
}

/**
 * @param {string} id
 * @param {Partial<ModEintrag>} data
 */
function dbUpdateEintrag(id, data) {
  const idx = db.eintraege.findIndex(e => e.id === id);
  if (idx >= 0) {
    db.eintraege[idx] = { ...db.eintraege[idx], ...data };
    dbSave(db);
  }
}

/** @param {string} id */
function dbDeleteEintrag(id) {
  db.eintraege = db.eintraege.filter(e => e.id !== id);
  dbSave(db);
  // Zugehörige Fotos aus IndexedDB aufräumen (fire & forget).
  dbDeletePhotosForEntry(id).catch(() => {});
}

/**
 * Distinkte Jahre aus den Einträgen (absteigend sortiert) — für den
 * Jahresfilter in der Log-Ansicht.
 * @returns {string[]} z.B. ['2026', '2025', '2024']
 */
function dbGetJahre() {
  const set = new Set();
  db.eintraege.forEach(e => {
    if (e.datum && e.datum.length >= 4) set.add(e.datum.slice(0, 4));
  });
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

// ---- Statistik-Helpers ----

/**
 * Gesamtkosten aller oder eines Fahrzeugs.
 * @param {string} [fzId]
 * @returns {number}
 */
function dbGesamtkosten(fzId) {
  const list = fzId ? db.eintraege.filter(e => e.fz === fzId) : db.eintraege;
  return list.reduce((s, e) => s + (e.kosten || 0), 0);
}

/**
 * Kosten aufgeschlüsselt nach Kategorie.
 * @returns {Record<string, number>}
 */
function dbKostenNachKat() {
  const result = {};
  db.eintraege.forEach(e => {
    result[e.kat] = (result[e.kat] || 0) + (e.kosten || 0);
  });
  return result;
}

// ---- CSV-Export ----

/**
 * Baut eine CSV-Repräsentation der Einträge (UTF-8, CRLF, RFC-4180-Escaping).
 * Kosten/Kilometerstand bleiben als rohe Zahlen, damit Excel/Numbers sie
 * als Zahl erkennt (kein Schweizer Tausender-Apostroph im Export).
 * @param {string} [fzId] Optional auf ein Fahrzeug filtern ('all' = alle).
 * @returns {string} CSV-Text ohne BOM.
 */
function dbExportCsv(fzId) {
  const list = dbGetEintraege(fzId && fzId !== 'all' ? { fz: fzId } : {});
  const cols = ['Fahrzeug', 'Bezeichnung', 'Kategorie', 'Datum', 'Kosten CHF',
                'Kilometerstand', 'Shop', 'Teile-Nr', 'Notizen'];

  const fzName = id => {
    const f = db.fahrzeuge.find(x => x.id === id);
    return f ? f.name : '';
  };
  const esc = v => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const rows = list.map(e => [
    fzName(e.fz), e.name, e.kat, e.datum,
    e.kosten || 0, e.km || 0, e.shop || '', e.oem || '', e.notiz || '',
  ].map(esc).join(','));

  return [cols.join(','), ...rows].join('\r\n');
}

// ---- IndexedDB: Foto-Anhänge ----
//
// Fotos sind zu gross für localStorage und leben deshalb in einer eigenen
// IndexedDB-Datenbank. Object-Store `photos`, keyPath `id`, Index `entryId`
// für die Zuordnung zum Mod-Eintrag. Foto-Record:
//   { id, entryId, data: <dataURL>, w, h, created }

const PHOTO_DB         = 'modlog_photos';
const PHOTO_DB_VERSION = 1;
const PHOTO_STORE      = 'photos';
let _photoDbPromise    = null;

/**
 * Öffnet (und erzeugt bei Bedarf) die Foto-IndexedDB. Gecacht.
 * @returns {Promise<IDBDatabase>}
 */
function dbOpenPhotos() {
  if (_photoDbPromise) return _photoDbPromise;
  _photoDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB nicht verfügbar'));
      return;
    }
    const req = indexedDB.open(PHOTO_DB, PHOTO_DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(PHOTO_STORE)) {
        const store = idb.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        store.createIndex('entryId', 'entryId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _photoDbPromise;
}

/**
 * Speichert ein Foto für einen Eintrag.
 * @param {string} entryId
 * @param {string} dataUrl  Bereits clientseitig skalierter dataURL.
 * @param {number} [w]
 * @param {number} [h]
 * @returns {Promise<object>} Der gespeicherte Foto-Record.
 */
function dbAddPhoto(entryId, dataUrl, w, h) {
  return dbOpenPhotos().then(idb => new Promise((resolve, reject) => {
    const tx    = idb.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    const rec   = { id: dbNewId('p'), entryId, data: dataUrl, w: w || 0, h: h || 0, created: Date.now() };
    const r = store.add(rec);
    r.onsuccess = () => resolve(rec);
    r.onerror   = () => reject(r.error);
  }));
}

/**
 * Alle Fotos eines Eintrags (nach Erstellzeit sortiert).
 * @param {string} entryId
 * @returns {Promise<object[]>}
 */
function dbGetPhotos(entryId) {
  return dbOpenPhotos().then(idb => new Promise((resolve, reject) => {
    const store = idb.transaction(PHOTO_STORE, 'readonly').objectStore(PHOTO_STORE);
    const r = store.index('entryId').getAll(entryId);
    r.onsuccess = () => resolve((r.result || []).sort((a, b) => a.created - b.created));
    r.onerror   = () => reject(r.error);
  }));
}

/**
 * @param {string} photoId
 * @returns {Promise<void>}
 */
function dbDeletePhoto(photoId) {
  return dbOpenPhotos().then(idb => new Promise((resolve, reject) => {
    const store = idb.transaction(PHOTO_STORE, 'readwrite').objectStore(PHOTO_STORE);
    const r = store.delete(photoId);
    r.onsuccess = () => resolve();
    r.onerror   = () => reject(r.error);
  }));
}

/**
 * Löscht alle Fotos eines Eintrags.
 * @param {string} entryId
 * @returns {Promise<void>}
 */
function dbDeletePhotosForEntry(entryId) {
  return dbGetPhotos(entryId)
    .then(photos => Promise.all(photos.map(p => dbDeletePhoto(p.id))))
    .then(() => undefined);
}

/**
 * Alle Foto-Records (für Backup).
 * @returns {Promise<object[]>}
 */
function dbGetAllPhotos() {
  return dbOpenPhotos().then(idb => new Promise((resolve, reject) => {
    const store = idb.transaction(PHOTO_STORE, 'readonly').objectStore(PHOTO_STORE);
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror   = () => reject(r.error);
  }));
}

/**
 * Anzahl Fotos je Eintrag (für Badge auf den Log-Karten).
 * @returns {Promise<Record<string, number>>}
 */
function dbGetPhotoCounts() {
  return dbGetAllPhotos().then(all => {
    const counts = {};
    all.forEach(p => { counts[p.entryId] = (counts[p.entryId] || 0) + 1; });
    return counts;
  });
}

/**
 * Ersetzt den gesamten Foto-Store (für Restore).
 * @param {object[]} records
 * @returns {Promise<void>}
 */
function dbReplaceAllPhotos(records) {
  return dbOpenPhotos().then(idb => new Promise((resolve, reject) => {
    const tx    = idb.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    store.clear();
    (records || []).forEach(rec => { if (rec && rec.id) store.put(rec); });
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  }));
}

// ---- Backup / Restore ----

/**
 * Baut ein vollständiges Backup-Objekt (Fahrzeuge + Einträge + Fotos).
 * @returns {Promise<object>}
 */
function dbExportBackup() {
  return dbGetAllPhotos().catch(() => []).then(photos => ({
    app: 'ModLog',
    version: 1,
    exportedAt: new Date().toISOString(),
    fahrzeuge: db.fahrzeuge,
    eintraege: db.eintraege,
    photos,
  }));
}

/**
 * Prüft die Grundstruktur eines Backup-Objekts.
 * @param {any} obj
 * @returns {boolean}
 */
function dbValidateBackup(obj) {
  return !!obj && typeof obj === 'object'
    && Array.isArray(obj.fahrzeuge)
    && Array.isArray(obj.eintraege)
    && (obj.photos === undefined || Array.isArray(obj.photos));
}

/**
 * Ersetzt den kompletten Datenbestand durch ein Backup (verlustfrei).
 * @param {object} obj
 * @returns {Promise<void>}
 */
function dbImportBackup(obj) {
  if (!dbValidateBackup(obj)) {
    return Promise.reject(new Error('Ungültiges Backup-Format.'));
  }
  db = { fahrzeuge: obj.fahrzeuge, eintraege: obj.eintraege };
  dbSave(db);
  return dbReplaceAllPhotos(obj.photos || []);
}

// ---- QR-Share-Payload ----

// UTF-8-Bytelänge ohne Abhängigkeit (für QR-Kapazitätsabschätzung).
function _utf8Len(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/**
 * Baut ein kompaktes, teilbares Payload-Objekt für ein Fahrzeug (Meta + Mods).
 * Fotos werden bewusst NIE eingebettet (Scanbarkeit). Wird das JSON grösser
 * als maxBytes, werden Einträge (neueste zuerst) weggelassen und truncated=true
 * gesetzt — im Extremfall bleibt nur die Fahrzeug-Meta.
 * @param {string} fzId
 * @param {{maxBytes?:number}} [opts]
 * @returns {object|null} null wenn das Fahrzeug nicht existiert.
 */
function dbBuildQrPayload(fzId, opts = {}) {
  const maxBytes = opts.maxBytes || 1000;
  const fz = db.fahrzeuge.find(f => f.id === fzId);
  if (!fz) return null;

  const meta = { name: fz.name, jahr: fz.jahr, farbe: fz.farbe, kuerzel: fz.kuerzel };
  const allMods = db.eintraege
    .filter(e => e.fz === fzId)
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))
    .map(e => ({
      n: e.name, k: e.kat, d: e.datum,
      ko: e.kosten || 0, km: e.km || 0,
      s: e.shop || '', o: e.oem || '', no: e.notiz || '',
    }));

  const make = (mods, truncated) => ({ app: 'ModLog', v: 1, t: 'vehicle', fz: meta, mods, truncated });

  let payload = make(allMods, false);
  if (_utf8Len(JSON.stringify(payload)) <= maxBytes) return payload;

  for (let count = allMods.length - 1; count >= 0; count--) {
    payload = make(allMods.slice(0, count), true);
    if (_utf8Len(JSON.stringify(payload)) <= maxBytes) return payload;
  }
  return make([], true);
}

// ---- QR-Import (Gegenstück zu dbBuildQrPayload) ----

// Typisierter Fehler mit .code für differenzierte UI-Meldungen.
function _qrError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const _IMPORT_KATS = ['Motor', 'Fahrwerk', 'Antrieb', 'Exterieur', 'Elektronik', 'Sonstiges'];

/**
 * Parst und validiert ein QR-/JSON-Payload (Format von dbBuildQrPayload) und
 * normalisiert es zu { fahrzeug, eintraege, truncated }. Wirft bei Problemen
 * einen typisierten Fehler (.code: invalid_json | not_modlog |
 * unsupported_version | invalid_structure).
 * @param {string} str
 * @returns {{ fahrzeug: object, eintraege: object[], truncated: boolean }}
 */
function dbParseQrPayload(str) {
  let obj;
  try {
    obj = JSON.parse(str);
  } catch (_) {
    throw _qrError('invalid_json', 'Kein gültiges JSON.');
  }
  if (!obj || typeof obj !== 'object' || obj.app !== 'ModLog' || obj.t !== 'vehicle') {
    throw _qrError('not_modlog', 'Kein ModLog-Fahrzeug-Code.');
  }
  if (obj.v !== 1) {
    throw _qrError('unsupported_version', 'Nicht unterstützte Version: ' + obj.v);
  }
  const fz = obj.fz;
  if (!fz || typeof fz !== 'object' || typeof fz.name !== 'string' || !fz.name.trim()) {
    throw _qrError('invalid_structure', 'Fahrzeugdaten fehlen oder sind ungültig.');
  }
  if (!Array.isArray(obj.mods)) {
    throw _qrError('invalid_structure', 'Eintragsliste fehlt.');
  }

  const fahrzeug = {
    name: String(fz.name).trim(),
    jahr: Number.isFinite(fz.jahr) ? fz.jahr : (parseInt(fz.jahr, 10) || new Date().getFullYear()),
    farbe: typeof fz.farbe === 'string' ? fz.farbe : '',
    kuerzel: typeof fz.kuerzel === 'string' ? fz.kuerzel : '',
  };
  const eintraege = obj.mods.map(m => ({
    name: typeof m.n === 'string' ? m.n.trim() : '',
    kat: _IMPORT_KATS.includes(m.k) ? m.k : 'Sonstiges',
    datum: typeof m.d === 'string' ? m.d : '',
    kosten: Number(m.ko) || 0,
    km: Number(m.km) || 0,
    shop: typeof m.s === 'string' ? m.s : '',
    oem: typeof m.o === 'string' ? m.o : '',
    notiz: typeof m.no === 'string' ? m.no : '',
  })).filter(e => e.name); // Einträge ohne Bezeichnung verwerfen

  return { fahrzeug, eintraege, truncated: !!obj.truncated };
}

/**
 * Sucht ein bestehendes Fahrzeug mit identischem name+kuerzel (case-insensitiv)
 * — Kandidat fürs Zusammenführen. Gibt null zurück, wenn keins existiert.
 * @param {{name?:string, kuerzel?:string}} fahrzeug
 * @returns {Fahrzeug|null}
 */
function dbFindImportMatch(fahrzeug) {
  if (!fahrzeug) return null;
  const name = (fahrzeug.name || '').trim().toLowerCase();
  const kuerzel = (fahrzeug.kuerzel || '').trim().toLowerCase();
  return db.fahrzeuge.find(f =>
    (f.name || '').trim().toLowerCase() === name &&
    (f.kuerzel || '').trim().toLowerCase() === kuerzel
  ) || null;
}

// Eindeutige id garantieren (auch bei Batch-Import im selben Millisekunden-Tick).
function _freshId(prefix, used) {
  let id;
  do { id = dbNewId(prefix); } while (used.has(id));
  used.add(id);
  return id;
}

/**
 * Importiert ein Fahrzeug + Einträge aus geparsten Daten. IMMER mit frischen
 * ids — bestehende Datensätze werden nie überschrieben.
 *   mode 'neu'             → neues Fahrzeug anlegen (Default)
 *   mode 'zusammenfuehren' → Einträge an bestehendes (name+kuerzel) anhängen;
 *                            wirft 'no_merge_target', wenn keins existiert.
 * @param {{fahrzeug:object, eintraege:object[]}} data
 * @param {('neu'|'zusammenfuehren')} [mode]
 * @returns {{ fahrzeugId: string, count: number, mode: string }}
 */
function dbImportVehicle(data, mode = 'neu') {
  if (!data || !data.fahrzeug) throw _qrError('invalid_structure', 'Keine Importdaten.');
  const eintraege = Array.isArray(data.eintraege) ? data.eintraege : [];

  const used = new Set([
    ...db.fahrzeuge.map(f => f.id),
    ...db.eintraege.map(e => e.id),
  ]);

  let targetId;
  if (mode === 'zusammenfuehren') {
    const match = dbFindImportMatch(data.fahrzeug);
    if (!match) throw _qrError('no_merge_target', 'Kein passendes Fahrzeug zum Zusammenführen.');
    targetId = match.id;
  } else {
    const fz = {
      id: _freshId('fz', used),
      name: data.fahrzeug.name,
      jahr: data.fahrzeug.jahr,
      farbe: data.fahrzeug.farbe || '',
      kuerzel: data.fahrzeug.kuerzel || '',
    };
    db.fahrzeuge.push(fz);
    targetId = fz.id;
  }

  let count = 0;
  for (const e of eintraege) {
    db.eintraege.push({
      id: _freshId('e', used),
      fz: targetId,
      name: e.name,
      kat: e.kat,
      datum: e.datum,
      kosten: e.kosten || 0,
      km: e.km || 0,
      shop: e.shop || '',
      oem: e.oem || '',
      notiz: e.notiz || '',
    });
    count++;
  }
  dbSave(db);
  return { fahrzeugId: targetId, count, mode: mode === 'zusammenfuehren' ? 'zusammenfuehren' : 'neu' };
}

// ---- Seed-Daten (Demo) ----
/**
 * Befüllt die DB mit Beispieldaten wenn leer.
 * Entfernen oder anpassen für Produktiveinsatz.
 */
function dbSeedIfEmpty() {
  if (db.fahrzeuge.length > 0) return;

  db.fahrzeuge = [
    { id: 'fz1', name: 'BMW 135i E82', jahr: 2010, farbe: 'Space Grey', kuerzel: '135i' },
    { id: 'fz2', name: 'BMW M5 F90',   jahr: 2019, farbe: 'Blue Stone',  kuerzel: 'M5'   },
  ];

  const ago = months => {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().split('T')[0];
  };

  db.eintraege = [
    {
      id: 'e1', fz: 'fz1', kat: 'Motor', datum: ago(3),
      name: 'Wagner EVO1 LLK', kosten: 620, km: 84500,
      shop: 'wagnertuning.com', oem: '',
      notiz: 'Deutlich kühlere Ladelufttemps. Zusammen mit Downpipes eingebaut.',
    },
    {
      id: 'e2', fz: 'fz1', kat: 'Antrieb', datum: ago(2),
      name: 'Westwood Drexler Sperrdiff', kosten: 2200, km: 85000,
      shop: 'westwoodperformance.co.uk', oem: '',
      notiz: 'GT-Clubsport, 3.08 Übersetzung. Massive Verbesserung beim Driften.',
    },
    {
      id: 'e3', fz: 'fz1', kat: 'Fahrwerk', datum: ago(1),
      name: 'Öhlins R&T Fahrwerk', kosten: 1850, km: 85200,
      shop: 'ohlins.com', oem: '',
      notiz: 'Höchste Stufe. Sturz -1.5°. Absolut präzise auf dem Track.',
    },
    {
      id: 'e4', fz: 'fz1', kat: 'Motor', datum: ago(1),
      name: 'NGK Kerzen 0.55mm', kosten: 80, km: 85200,
      shop: 'NGK direkt', oem: 'ILZKR7B8EG',
      notiz: '',
    },
    {
      id: 'e5', fz: 'fz1', kat: 'Antrieb', datum: new Date().toISOString().split('T')[0],
      name: 'PTB Racing EMS Kupplung', kosten: 890, km: 87100,
      shop: 'ptbracing.de', oem: '',
      notiz: '2-Scheiben Sinter. Perfekt fürs Driften, etwas hart im Alltag.',
    },
  ];

  dbSave(db);
}

// ---- Init ----
let db = dbLoad();
dbSeedIfEmpty();

// Theme so früh wie möglich auf <html> setzen (db.js wird im <head> geladen),
// damit beim Start kein Flash des falschen Themes entsteht. Im Node-Test-
// Harness fehlt document.documentElement → übersprungen.
if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.setAttribute('data-theme', dbResolveTheme());
}
