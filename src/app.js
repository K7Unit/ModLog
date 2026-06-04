/**
 * ModLog — app.js
 * UI-Logik: Tabs, Rendering, Modals, Events.
 * Greift ausschliesslich über db.js-Funktionen auf Daten zu.
 *
 * Erweiterungsideen:
 * - Suchfeld (Filter nach name/shop/oem)
 * - Foto-Anhänge pro Eintrag (FileReader → base64 → IndexedDB)
 * - CSV-Export
 * - Share-Sheet (Web Share API)
 * - PWA / Service Worker für Offline-Nutzung
 * - Dark/Light-Mode-Toggle
 */

// ---- Konstanten ----

const KATS = ['Alle', 'Motor', 'Fahrwerk', 'Antrieb', 'Exterieur', 'Elektronik', 'Sonstiges'];

const KAT_BADGE_CLASS = {
  Motor:      'badge-motor',
  Fahrwerk:   'badge-fahrwerk',
  Antrieb:    'badge-antrieb',
  Exterieur:  'badge-exterieur',
  Elektronik: 'badge-elektronik',
  Sonstiges:  'badge-sonstiges',
};

// ---- State ----

let activeFz  = 'all';
let activeKat = 'all';
let activeJahr = 'all';
let searchTerm = '';
let editingId = null;
let currentTab = 'log';

// Foto-State des Add/Edit-Modals.
// modalPhotos: [{ key, persistedId|null, data, w, h }]
//   persistedId gesetzt = bereits in IndexedDB; null = neu, noch nicht gespeichert.
// modalRemovedIds: persistierte Foto-IDs, die beim Speichern gelöscht werden.
let modalPhotos = [];
let modalRemovedIds = [];
let detailPhotos = [];   // Fotos des aktuell offenen Detail-Modals (für Viewer).

// ---- Helpers ----

function katBadge(k) {
  const cls = KAT_BADGE_CLASS[k] || 'badge-sonstiges';
  return `<span class="badge ${cls}">${k}</span>`;
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtChf(n) {
  return (n || 0).toLocaleString('de-CH');
}

function getFz(id) {
  return dbGetFahrzeuge().find(f => f.id === id);
}

function getFzKuerzel(id) {
  const fz = getFz(id);
  return fz ? fz.kuerzel : '?';
}

// ---- Theme (Dark/Light) ----

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// Spiegelt das aktive Theme in Toggle-Icon und theme-color-Meta.
function updateThemeUi(theme) {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) icon.className = theme === 'light' ? 'ti ti-moon' : 'ti ti-sun';
    btn.setAttribute('aria-label', theme === 'light' ? 'Dunkles Thema' : 'Helles Thema');
  }
  // theme-color an die Oberfläche anpassen (Manifest bleibt amber, Branding).
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#e7e4df' : '#0f0f0f');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeUi(theme);
}

function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  dbSetTheme(next);     // persistiert in modlog_theme_v1
  applyTheme(next);     // sofort, ohne Reload
}

// ---- Tabs ----

function showTab(t) {
  currentTab = t;
  ['log', 'stats', 'fahrzeuge'].forEach(n => {
    document.getElementById('view-' + n).style.display = n === t ? 'block' : 'none';
    document.getElementById('tab-' + n).classList.toggle('active', n === t);
  });
  document.getElementById('fab-btn').style.display = (t === 'stats') ? 'none' : 'flex';
  if (t === 'log')       renderLog();
  if (t === 'stats')     renderStats();
  if (t === 'fahrzeuge') renderFahrzeuge();
}

// ---- LOG ----

function renderLog() {
  renderVehicleFilter();
  renderKatFilter();
  renderYearFilter();
  renderLogList();
}

// Rendert nur die Eintragsliste neu (z.B. bei Live-Suche), ohne die
// Filter-Reihen anzufassen, damit der Fokus im Suchfeld erhalten bleibt.
async function renderLogList() {
  const list = document.getElementById('log-list');
  const entries = dbGetEintraege({ fz: activeFz, kat: activeKat, q: searchTerm, jahr: activeJahr });

  if (!entries.length) {
    list.innerHTML = searchTerm.trim()
      ? `
      <div class="empty">
        <i class="ti ti-search-off"></i>
        Keine Treffer für „${searchTerm.trim()}".
      </div>`
      : `
      <div class="empty">
        <i class="ti ti-tool"></i>
        Noch keine Einträge.<br>Tippe + um loszulegen.
      </div>`;
    return;
  }

  // Foto-Anzahl je Eintrag (für Badge). Fehlt IndexedDB → leeres Mapping.
  let counts = {};
  try { counts = await dbGetPhotoCounts(); } catch (_) { counts = {}; }

  list.innerHTML = entries.map(e => {
    const pc = counts[e.id] || 0;
    return `
    <div class="card" onclick="showDetail('${e.id}')">
      <div class="card-header">
        <div>
          ${katBadge(e.kat)}
          <div class="card-title">${e.name}</div>
          <div class="card-sub">
            ${getFzKuerzel(e.fz)} · ${formatDate(e.datum)}
            ${e.km ? ' · ' + e.km.toLocaleString('de-CH') + ' km' : ''}
            ${pc ? ` · <span class="photo-badge"><i class="ti ti-camera"></i>${pc}</span>` : ''}
          </div>
        </div>
        <div class="cost-chip">CHF ${fmtChf(e.kosten)}</div>
      </div>
      ${e.notiz ? `<div class="card-desc">${e.notiz}</div>` : ''}
    </div>`;
  }).join('');
}

function renderVehicleFilter() {
  const row = document.getElementById('vehicle-filter-row');
  const fzList = [{ id: 'all', kuerzel: 'Alle' }, ...dbGetFahrzeuge()];
  row.innerHTML = fzList.map(f => `
    <div class="vehicle-chip ${activeFz === f.id ? 'active' : ''}"
         onclick="setFzFilter('${f.id}')">
      ${f.kuerzel}
    </div>
  `).join('');
}

function renderKatFilter() {
  const row = document.getElementById('kat-filter-row');
  row.innerHTML = KATS.map(k => {
    const v = k === 'Alle' ? 'all' : k;
    return `
      <div class="filter-chip ${activeKat === v ? 'active' : ''}"
           onclick="setKatFilter('${v}')">
        ${k}
      </div>`;
  }).join('');
}

function setFzFilter(id)  { activeFz  = id; clearSearch(); renderLog(); }
function setKatFilter(k)  { activeKat = k;  clearSearch(); renderLog(); }

// Jahr ist mit allen anderen Filtern UND der Suche kombinierbar, daher
// wird die Suche beim Jahreswechsel NICHT zurückgesetzt. Das gewählte Jahr
// bleibt zudem beim Wechsel von Fahrzeug/Kategorie erhalten.
function setJahrFilter(j) { activeJahr = j; renderLogList(); }

function renderYearFilter() {
  const sel = document.getElementById('year-select');
  if (!sel) return;
  const jahre = dbGetJahre();
  // Gewähltes Jahr zurücksetzen, falls es nicht mehr existiert (z.B. nach Import).
  if (activeJahr !== 'all' && !jahre.includes(activeJahr)) activeJahr = 'all';
  sel.innerHTML = ['<option value="all">Alle Jahre</option>']
    .concat(jahre.map(j => `<option value="${j}">${j}</option>`))
    .join('');
  sel.value = activeJahr;
}

// ---- SEARCH ----

function setSearch(v) {
  searchTerm = v;
  renderLogList();
}

// Setzt das Suchfeld zurück (beim Wechsel von Fahrzeug- oder Kategorie-Filter).
function clearSearch() {
  searchTerm = '';
  const el = document.getElementById('search-input');
  if (el) el.value = '';
}

// ---- STATS ----

function renderStats() {
  const fahrzeuge = dbGetFahrzeuge();
  const total = dbGesamtkosten();
  const allEntries = dbGetEintraege();
  const byKat = dbKostenNachKat();

  // Kosten pro Fahrzeug
  const kostenFz = {};
  fahrzeuge.forEach(f => {
    kostenFz[f.id] = dbGesamtkosten(f.id);
  });
  const maxFz = Math.max(...Object.values(kostenFz), 1);

  // Stats-Grid
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Gesamtkosten</div>
      <div class="stat-value accent">CHF ${fmtChf(total)}</div>
      <div class="stat-sub">${allEntries.length} Einträge</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Fahrzeuge</div>
      <div class="stat-value">${fahrzeuge.length}</div>
      <div class="stat-sub">im Mod-Log</div>
    </div>
    ${fahrzeuge.map(f => `
    <div class="stat-card" style="grid-column: span 2">
      <div class="stat-label">${f.name}</div>
      <div class="stat-value" style="font-size:16px; margin-bottom:6px">
        CHF ${fmtChf(kostenFz[f.id])}
      </div>
      <div class="cost-bar">
        <div class="cost-bar-fill" style="width:${Math.round(kostenFz[f.id] / maxFz * 100)}%"></div>
      </div>
    </div>`).join('')}
  `;

  // Kat-Breakdown
  const sorted = Object.entries(byKat)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v > 0);

  const katDiv = document.getElementById('kat-breakdown');
  katDiv.innerHTML = `<div class="section-h">Kosten nach Kategorie</div>` +
    (sorted.length
      ? sorted.map(([k, v]) => `
        <div class="detail-line">
          <span class="detail-key">${katBadge(k)}</span>
          <span class="detail-val" style="font-family:var(--font-mono)">CHF ${fmtChf(v)}</span>
        </div>`).join('')
      : '<div style="color:var(--text3);font-size:12px;text-align:center;padding:12px">Keine Daten</div>'
    );

  // Export-Button-Label an aktiven Fahrzeugfilter anpassen
  const exportLabel = document.getElementById('export-label');
  if (exportLabel) {
    exportLabel.textContent = activeFz !== 'all'
      ? `CSV exportieren (${getFzKuerzel(activeFz)})`
      : 'CSV exportieren (alle)';
  }
}

// ---- CSV-EXPORT ----

function exportCsv() {
  const entries = dbGetEintraege(activeFz !== 'all' ? { fz: activeFz } : {});
  if (!entries.length) {
    alert('Keine Einträge zum Exportieren.');
    return;
  }

  const csv = dbExportCsv(activeFz);
  // BOM-Prefix (%EF%BB%BF) sorgt dafür dass Excel/Numbers UTF-8 erkennt.
  const uri = 'data:text/csv;charset=utf-8,%EF%BB%BF' + encodeURIComponent(csv);

  const fzPart = activeFz !== 'all' ? '_' + (getFzKuerzel(activeFz) || 'fz') : '';
  const a = document.createElement('a');
  a.href = uri;
  a.download = `modlog${fzPart}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ---- BACKUP / RESTORE ----

async function exportBackup() {
  let backup;
  try {
    backup = await dbExportBackup();
  } catch (err) {
    alert('Backup fehlgeschlagen: ' + err.message);
    return;
  }
  // Blob statt data: URI — Fotos können gross sein und die URI-Länge sprengen.
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `modlog-backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerImport() {
  document.getElementById('restore-input').click();
}

async function importBackup(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!confirm('Aktuelle Daten werden überschrieben.')) return;

  try {
    const obj = JSON.parse(await file.text());
    await dbImportBackup(obj);
    activeFz = 'all';
    activeKat = 'all';
    clearSearch();
    renderStats();
    alert('Wiederherstellung erfolgreich.');
  } catch (err) {
    alert('Wiederherstellung fehlgeschlagen: ' + err.message);
  }
}

// ---- FAHRZEUGE ----

function renderFahrzeuge() {
  const list   = document.getElementById('fz-list');
  const fzList = dbGetFahrzeuge();

  if (!fzList.length) {
    list.innerHTML = `<div class="empty"><i class="ti ti-car"></i>Noch kein Fahrzeug.</div>`;
    return;
  }

  list.innerHTML = fzList.map(f => {
    const kosten = dbGesamtkosten(f.id);
    const count  = dbGetEintraege({ fz: f.id }).length;
    return `
    <div class="card" style="cursor:default">
      <div class="card-header">
        <div>
          <div class="card-title">${f.name}</div>
          <div class="card-sub">${f.jahr} · ${f.farbe}</div>
        </div>
        <div class="cost-chip">CHF ${fmtChf(kosten)}</div>
      </div>
      <div class="card-meta"><i class="ti ti-tool"></i>${count} Mods</div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm"
                onclick="event.stopPropagation(); showQrForVehicle('${f.id}')">
          <i class="ti ti-qrcode"></i> QR teilen
        </button>
        <button class="btn btn-danger btn-sm"
                onclick="event.stopPropagation(); deleteFahrzeug('${f.id}')">
          <i class="ti ti-trash"></i> Löschen
        </button>
      </div>
    </div>`;
  }).join('');
}

// ---- DETAIL ----

async function showDetail(id) {
  const e  = dbGetEintraege().find(x => x.id === id);
  if (!e) return;
  const fz = getFz(e.fz);

  document.getElementById('detail-body').innerHTML = `
    <div style="margin-bottom:14px">
      ${katBadge(e.kat)}
      <span style="font-size:15px;font-weight:500;color:var(--text);margin-left:8px">${e.name}</span>
    </div>
    <div class="detail-line">
      <span class="detail-key">Fahrzeug</span>
      <span class="detail-val">${fz ? fz.name : '–'}</span>
    </div>
    <div class="detail-line">
      <span class="detail-key">Datum</span>
      <span class="detail-val">${formatDate(e.datum)}</span>
    </div>
    ${e.km ? `
    <div class="detail-line">
      <span class="detail-key">Kilometerstand</span>
      <span class="detail-val" style="font-family:var(--font-mono)">${e.km.toLocaleString('de-CH')} km</span>
    </div>` : ''}
    <div class="detail-line">
      <span class="detail-key">Kosten</span>
      <span class="detail-val" style="font-family:var(--font-mono);color:var(--accent)">
        CHF ${fmtChf(e.kosten)}
      </span>
    </div>
    ${e.shop ? `
    <div class="detail-line">
      <span class="detail-key">Shop / Lieferant</span>
      <span class="detail-val">${e.shop}</span>
    </div>` : ''}
    ${e.oem ? `
    <div class="detail-line">
      <span class="detail-key">Teile-Nr</span>
      <span class="detail-val" style="font-family:var(--font-mono);font-size:11px">${e.oem}</span>
    </div>` : ''}
    ${e.notiz ? `
    <div style="margin-top:12px;padding:10px;background:var(--bg);border:1px solid var(--border);
                border-radius:var(--r);font-size:12px;color:var(--text2);line-height:1.6">
      ${e.notiz}
    </div>` : ''}
    <div class="photo-strip" id="detail-photo-strip"></div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="shareEntry('${e.id}')">
        <i class="ti ti-share"></i> Teilen
      </button>
      <button class="btn btn-ghost btn-sm" onclick="editEntry('${e.id}')">
        <i class="ti ti-edit"></i> Bearbeiten
      </button>
      <button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')">
        <i class="ti ti-trash"></i> Löschen
      </button>
    </div>
  `;

  openModal('modal-detail');

  // Fotos nachladen (async) und in den Strip rendern.
  detailPhotos = [];
  try { detailPhotos = await dbGetPhotos(id); } catch (_) { detailPhotos = []; }
  const strip = document.getElementById('detail-photo-strip');
  if (strip && detailPhotos.length) {
    strip.innerHTML = detailPhotos.map((p, i) =>
      `<img class="photo-strip-img" src="${p.data}" alt="Foto ${i + 1}"
            onclick="openPhotoViewer(${i})">`
    ).join('');
  }
}

// ---- FOTO-VIEWER (Fullscreen) ----

function openPhotoViewer(index) {
  const p = detailPhotos[index];
  if (!p) return;
  document.getElementById('photo-viewer-img').src = p.data;
  document.getElementById('photo-viewer').classList.add('open');
  // In-flow Overlay sitzt am Dokumentanfang → nach oben scrollen.
  window.scrollTo(0, 0);
}

function closePhotoViewer() {
  document.getElementById('photo-viewer').classList.remove('open');
  document.getElementById('photo-viewer-img').src = '';
}

// ---- TEILEN (Web Share API + Clipboard-Fallback) ----

// Baut die Text-Zusammenfassung eines Eintrags.
function buildShareText(e) {
  const fz = getFz(e.fz);
  const lines = [
    e.name,
    `Fahrzeug: ${fz ? fz.name : '–'}`,
    `Kategorie: ${e.kat}`,
    `Kosten: CHF ${fmtChf(e.kosten)}`,
    `Datum: ${formatDate(e.datum)}`,
  ];
  if (e.notiz) lines.push(`Notizen: ${e.notiz}`);
  return lines.join('\n');
}

async function shareEntry(id) {
  const e = dbGetEintraege().find(x => x.id === id);
  if (!e) return;

  const text = buildShareText(e);
  const shareData = { title: `ModLog – ${e.name}`, text };

  // Erstes Foto (falls vorhanden) als Datei vorbereiten.
  let file = null;
  if (detailPhotos && detailPhotos.length) {
    try {
      const blob = await (await fetch(detailPhotos[0].data)).blob();
      file = new File([blob], 'modlog.jpg', { type: blob.type || 'image/jpeg' });
    } catch (_) { file = null; }
  }

  // 1) Mit Foto teilen, wenn der Browser File-Sharing unterstützt.
  if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ ...shareData, files: [file] });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;  // Nutzer hat abgebrochen
      // sonst: weiter zum Text-Share
    }
  }

  // 2) Nur Text teilen.
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      // sonst: Fallback
    }
  }

  // 3) Fallback: in die Zwischenablage kopieren + Toast.
  await copyToClipboard(text);
  showToast('In die Zwischenablage kopiert');
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (_) { /* fällt auf execCommand zurück */ }

  // Legacy-Fallback (kein position:fixed — temporäres Off-Screen-Textfeld).
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'absolute';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) { /* ignore */ }
  document.body.removeChild(ta);
}

let _toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---- QR-SHARE ----

let qrPayloadJson = '';   // rohes JSON des zuletzt angezeigten QR (für Kopieren)

function showQrForVehicle(fzId) {
  const payload = dbBuildQrPayload(fzId, { maxBytes: 1000 });
  if (!payload) return;
  qrPayloadJson = JSON.stringify(payload);

  let qr;
  try {
    qr = QR.generate(qrPayloadJson, { ecl: 'L' });
  } catch (err) {
    showToast('QR konnte nicht erzeugt werden');
    return;
  }

  // Auf Canvas zeichnen — QR immer schwarz auf weiss mit heller Ruhezone,
  // damit Scanner es in beiden Themes lesen können.
  const quiet = 4;
  const canvas = document.getElementById('qr-canvas');
  const cssSize = 264;                                   // Anzeigegrösse in px
  const dpr = window.devicePixelRatio || 1;
  const modulesPerSide = qr.size + quiet * 2;
  const scale = Math.max(1, Math.floor((cssSize * dpr) / modulesPerSide));
  const px = modulesPerSide * scale;
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = cssSize + 'px';
  canvas.style.height = cssSize + 'px';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
  }

  const fz = getFz(fzId);
  document.getElementById('qr-title').textContent = `// ${fz ? fz.name : 'QR'}`;
  const note = document.getElementById('qr-note');
  note.textContent = payload.truncated
    ? 'Fotos werden nicht geteilt. Liste gekürzt — QR eignet sich für kleinere Setups.'
    : 'Fotos werden nicht geteilt.';

  openQrViewer();
}

function openQrViewer() {
  document.getElementById('qr-viewer').classList.add('open');
  window.scrollTo(0, 0);
}

function closeQrViewer() {
  document.getElementById('qr-viewer').classList.remove('open');
}

async function copyQrPayload() {
  if (!qrPayloadJson) return;
  await copyToClipboard(qrPayloadJson);
  showToast('JSON in die Zwischenablage kopiert');
}

// ---- ADD / EDIT ----

function openAddModal() {
  editingId = null;
  document.getElementById('modal-title-text').textContent = '// NEUER EINTRAG';
  document.getElementById('f-name').value   = '';
  document.getElementById('f-kat').value    = 'Motor';
  document.getElementById('f-datum').value  = new Date().toISOString().split('T')[0];
  document.getElementById('f-kosten').value = '';
  document.getElementById('f-km').value     = '';
  document.getElementById('f-shop').value   = '';
  document.getElementById('f-oem').value    = '';
  document.getElementById('f-notiz').value  = '';
  modalPhotos = [];
  modalRemovedIds = [];
  renderPhotoEditStrip();
  populateFzSelect(null);
  openModal('modal-add');
}

async function editEntry(id) {
  const e = dbGetEintraege().find(x => x.id === id);
  if (!e) return;
  editingId = id;
  closeModal('modal-detail');
  document.getElementById('modal-title-text').textContent = '// BEARBEITEN';
  populateFzSelect(e.fz);
  document.getElementById('f-name').value   = e.name;
  document.getElementById('f-kat').value    = e.kat;
  document.getElementById('f-datum').value  = e.datum;
  document.getElementById('f-kosten').value = e.kosten || '';
  document.getElementById('f-km').value     = e.km     || '';
  document.getElementById('f-shop').value   = e.shop   || '';
  document.getElementById('f-oem').value    = e.oem    || '';
  document.getElementById('f-notiz').value  = e.notiz  || '';

  // Bestehende Fotos laden.
  modalRemovedIds = [];
  modalPhotos = [];
  renderPhotoEditStrip();
  openModal('modal-add');
  try {
    const photos = await dbGetPhotos(id);
    modalPhotos = photos.map(p => ({
      key: p.id, persistedId: p.id, data: p.data, w: p.w, h: p.h,
    }));
    renderPhotoEditStrip();
  } catch (_) { /* IndexedDB nicht verfügbar – ohne Fotos weiter */ }
}

function populateFzSelect(selectedId) {
  const sel  = document.getElementById('f-fz');
  const fzList = dbGetFahrzeuge();
  const fallback = fzList[0]?.id;
  sel.innerHTML = fzList.map(f =>
    `<option value="${f.id}" ${(selectedId || fallback) === f.id ? 'selected' : ''}>${f.name}</option>`
  ).join('');
}

// ---- FOTO-PICKER (Modal) ----

// Liest eine Bilddatei, skaliert sie via Canvas auf max. 1600px (längste
// Kante) und gibt einen komprimierten JPEG-dataURL zurück.
function processImageFile(file) {
  const MAX = 1600;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else        { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ data: canvas.toDataURL('image/jpeg', 0.82), w, h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onPhotoPick(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';  // erlaubt erneute Auswahl derselben Datei
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const { data, w, h } = await processImageFile(file);
      modalPhotos.push({ key: dbNewId('tmp'), persistedId: null, data, w, h });
      renderPhotoEditStrip();
    } catch (err) {
      console.warn('[ModLog] Foto konnte nicht verarbeitet werden:', err);
    }
  }
}

function renderPhotoEditStrip() {
  const strip = document.getElementById('photo-edit-strip');
  if (!strip) return;
  strip.innerHTML = modalPhotos.map(p => `
    <div class="photo-thumb">
      <img src="${p.data}" alt="">
      <button type="button" class="photo-thumb-x" onclick="removePhotoFromModal('${p.key}')">
        <i class="ti ti-x"></i>
      </button>
    </div>`).join('');
}

function removePhotoFromModal(key) {
  const idx = modalPhotos.findIndex(p => p.key === key);
  if (idx < 0) return;
  const p = modalPhotos[idx];
  if (p.persistedId) modalRemovedIds.push(p.persistedId);
  modalPhotos.splice(idx, 1);
  renderPhotoEditStrip();
}

async function saveEntry() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { document.getElementById('f-name').focus(); return; }

  const data = {
    fz:     document.getElementById('f-fz').value,
    name,
    kat:    document.getElementById('f-kat').value,
    datum:  document.getElementById('f-datum').value,
    kosten: parseFloat(document.getElementById('f-kosten').value) || 0,
    km:     parseInt(document.getElementById('f-km').value)       || 0,
    shop:   document.getElementById('f-shop').value.trim(),
    oem:    document.getElementById('f-oem').value.trim(),
    notiz:  document.getElementById('f-notiz').value.trim(),
  };

  let entryId = editingId;
  if (editingId) {
    dbUpdateEintrag(editingId, data);
  } else {
    entryId = dbAddEintrag(data).id;
  }

  // Foto-Änderungen persistieren: entfernte löschen, neue hinzufügen.
  try {
    await Promise.all(modalRemovedIds.map(pid => dbDeletePhoto(pid)));
    for (const p of modalPhotos) {
      if (!p.persistedId) await dbAddPhoto(entryId, p.data, p.w, p.h);
    }
  } catch (err) {
    console.warn('[ModLog] Fotos speichern fehlgeschlagen:', err);
  }

  modalPhotos = [];
  modalRemovedIds = [];
  closeModal('modal-add');
  renderLog();
}

function deleteEntry(id) {
  if (!confirm('Eintrag löschen?')) return;
  dbDeleteEintrag(id);
  closeModal('modal-detail');
  renderLog();
}

// ---- FAHRZEUG ADD ----

function openAddFzModal() {
  ['fz-name', 'fz-jahr', 'fz-farbe', 'fz-kuerzel'].forEach(id => {
    document.getElementById(id).value = '';
  });
  openModal('modal-fz');
}

function saveFahrzeug() {
  const name = document.getElementById('fz-name').value.trim();
  if (!name) { document.getElementById('fz-name').focus(); return; }

  dbAddFahrzeug({
    name,
    jahr:    parseInt(document.getElementById('fz-jahr').value)   || new Date().getFullYear(),
    farbe:   document.getElementById('fz-farbe').value.trim(),
    kuerzel: (document.getElementById('fz-kuerzel').value.trim().toUpperCase()
              || name.slice(0, 4).toUpperCase()),
  });

  closeModal('modal-fz');
  renderFahrzeuge();
}

function deleteFahrzeug(id) {
  const count = dbGetEintraege({ fz: id }).length;
  const msg   = count > 0
    ? `Fahrzeug löschen? ${count} Einträge werden ebenfalls gelöscht.`
    : 'Fahrzeug löschen?';
  if (!confirm(msg)) return;
  dbDeleteFahrzeug(id);
  if (activeFz === id) activeFz = 'all';
  renderFahrzeuge();
}

// ---- MODALS ----

function openModal(id)  { document.getElementById(id).classList.add('open');    }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Schliessen bei Klick auf Overlay
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ---- Service Worker (PWA / Offline) ----

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('[ModLog] SW-Registrierung fehlgeschlagen:', err)
    );
  });
}

// ---- Init ----
// Theme-UI mit dem bereits (in db.js) gesetzten <html data-theme> synchronisieren.
if (document.documentElement) updateThemeUi(currentTheme());
renderLog();
