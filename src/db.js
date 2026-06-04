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
  db.fahrzeuge = db.fahrzeuge.filter(f => f.id !== id);
  db.eintraege = db.eintraege.filter(e => e.fz !== id);
  dbSave(db);
}

// ---- Mod-Einträge ----

/**
 * @param {{ fz?: string, kat?: string, q?: string }} filter
 * @returns {ModEintrag[]}
 */
function dbGetEintraege(filter = {}) {
  let list = db.eintraege.slice();
  if (filter.fz && filter.fz !== 'all') list = list.filter(e => e.fz === filter.fz);
  if (filter.kat && filter.kat !== 'all') list = list.filter(e => e.kat === filter.kat);
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
