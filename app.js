'use strict';

/* ══════════════════════════════════════════════════════════════
   MAĽOVANKY – JAR  |  App logic
   Vanilla JS, no dependencies, no build step.
══════════════════════════════════════════════════════════════ */

// ── Palette: 30 colours ─────────────────────────────────────────
const PALETTE = [
  '#fff066','#fbd24a',
  '#ffd1a8','#f5a623','#c9892e',
  '#d9534f',
  '#f7a8c1','#e85a8e',
  '#cdb6f0','#9b7fd6','#6a5acd','#3a4cad',
  '#b8e1eb','#7ec8dd','#4a9fb8','#2d7591','#085475',
  '#dff2b0','#a3d977','#4cb050','#1f8a5b',
  '#a35b2a','#8b5a2b','#5a4a3a','#3a2e26',
  '#000000','#7a7a7a','#bdbdbd','#e6e6e6','#ffffff',
];

// ── Brush thicknesses (canvas px at 1:1) ───────────────────────
const THICKNESSES = [
  { id: 0, label: 'Tenký',   px: 4  },
  { id: 1, label: 'Stredný', px: 10 },
  { id: 2, label: 'Hrubý',   px: 22 },
];

const COUNT_LOCAL = 8;
let   COUNT       = COUNT_LOCAL;
let   DRIVE_FILES = [];
const STORAGE_PRE = 'mlv-';

// ── GitHub repo source (auto-discovers SVGs, no config file needed) ────────
// Set GITHUB_SVG_SOURCE to your repo + folder, e.g.:
//   'https://api.github.com/repos/yourusername/yourrepo/contents/svgs'
// Leave empty ('') to use local svgs/ folder.
const GITHUB_SVG_SOURCE = 'https://api.github.com/repos/PcProfisro/moje-omalovanky/contents/';

async function loadGithubSources() {
  if (!GITHUB_SVG_SOURCE) return;
  try {
    const resp  = await fetch(GITHUB_SVG_SOURCE, {
      headers: { Accept: 'application/vnd.github.v3+json' }
    });
    const files = await resp.json();
    const svgs  = Array.isArray(files)
      ? files.filter(f => f.type === 'file' && f.name.toLowerCase().endsWith('.svg'))
             .sort((a, b) => a.name.localeCompare(b.name, 'sk', { numeric: true }))
      : [];
    if (svgs.length > 0) {
      DRIVE_FILES = svgs.map(f => ({ id: f.download_url, name: f.name.replace(/\.svg$/i, '') }));
      COUNT = svgs.length;
    }
  } catch (e) {
    console.warn('GitHub source load failed, falling back to local SVGs', e);
  }
}

// ── Drive loading (legacy / manual JSON config) ──────────────────────────
async function loadDriveSources() {
  if (GITHUB_SVG_SOURCE) return; // GitHub takes priority
  try {
    const resp = await fetch('drive-sources.json');
    const cfg  = await resp.json();
    const files = (cfg.files || []).filter(f => f.id && !f.id.startsWith('DRIVE_FILE_ID'));
    if (files.length > 0) {
      DRIVE_FILES = files;
      COUNT = files.length;
    }
  } catch { /* use local */ }
}

function driveUrl(fileId) {
  // For GitHub: download_url is already full URL
  // For Drive: construct download link
  if (fileId.startsWith('http')) return fileId;
  return 'https://drive.google.com/uc?export=download&id=' + fileId;
}
const PROXY = 'https://api.allorigins.win/get?url=';

async function fetchSVGFromDrive(fileId) {
  const url = driveUrl(fileId);
  // GitHub raw URLs: no proxy needed (CORS OK)
  if (url.includes('raw.githubusercontent.com') || url.includes('github.com')) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  }
  // Other sources: use CORS proxy
  const resp     = await fetch(PROXY + encodeURIComponent(url));
  const json     = await resp.json();
  const contents = json.contents || '';
  if (!contents.includes('<svg')) throw new Error('Not an SVG');
  return contents;
}



// ── App state ───────────────────────────────────────────────────
const S = {
  view:        'gallery',
  index:       null,
  tool:        'bucket',     // 'bucket' | 'eraser' | 'brush'
  color:       '#9b7fd6',
  thickness:   1,            // 0 | 1 | 2
  sound:       true,
  undoStack:   [],           // [{type:'svg', path, oldFill} | {type:'brush', imageData}]
  svgEl:       null,
  svgCache:    {},
  hovered:     null,
  origFill:    null,
  drawing:     false,
  lastX:       0,
  lastY:       0,
};

// ── LocalStorage ────────────────────────────────────────────────
function storedColors(i) {
  try { return JSON.parse(localStorage.getItem(STORAGE_PRE + i)) || {}; }
  catch { return {}; }
}
function persistColors() {
  if (!S.svgEl || S.index == null) return;
  const map = {};
  S.svgEl.querySelectorAll('[data-region]').forEach(p => {
    if (p.getAttribute('data-locked') === 'true') return;
    const f = p.getAttribute('fill');
    if (f && f !== '#ffffff' && f !== '#fff' && f !== 'white') {
      map[p.getAttribute('data-region')] = f;
    }
  });
  localStorage.setItem(STORAGE_PRE + S.index, JSON.stringify(map));
}
function hasProgress(i) {
  return Object.keys(storedColors(i)).length > 0 ||
         !!localStorage.getItem(STORAGE_PRE + 'canvas-' + i);
}
function saveBrushData() {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas || S.index == null) return;
  try {
    const data = canvas.toDataURL('image/png');
    localStorage.setItem(STORAGE_PRE + 'canvas-' + S.index, data);
  } catch (e) { /* quota */ }
}
function loadBrushData() {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas || S.index == null) return;
  const data = localStorage.getItem(STORAGE_PRE + 'canvas-' + S.index);
  if (!data) return;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = data;
}

// ── SVG fetching ────────────────────────────────────────────────
async function fetchSVG(i) {
  const key = 'svgcache-' + i;
  if (S.svgCache[key]) return S.svgCache[key];

  let text;
  if (DRIVE_FILES.length >= i) {
    // Load from Google Drive via CORS proxy
    text = await fetchSVGFromDrive(DRIVE_FILES[i - 1].id);
  } else {
    // Load from local svgs/ folder
    const r = await fetch('svgs/omalovanka-' + i + '.svg');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    text = await r.text();
  }
  S.svgCache[key] = text;
  return text;
}
function applyColorMap(svgEl, map) {
  for (const [id, color] of Object.entries(map)) {
    const p = svgEl.querySelector('[data-region="' + id + '"]');
    if (p && p.getAttribute('data-locked') !== 'true') p.setAttribute('fill', color);
  }
}

// ── Gallery ─────────────────────────────────────────────────────
function buildGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  for (let i = 1; i <= COUNT; i++) {
    const label = DRIVE_FILES[i - 1] ? DRIVE_FILES[i - 1].name : ('Omaľovánka ' + i);
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.index = i;
    const started = hasProgress(i);
    card.innerHTML =
      '<div class="gallery-card__thumb"><div class="thumb-placeholder">🎨</div></div>' +
      '<div class="gallery-card__footer">' +
        '<span class="gallery-card__num">' + label + '</span>' +
        (started ? '<span class="gallery-card__badge">MAĽUJEM</span>' : '') +
      '</div>';
    card.addEventListener('click', () => openColoring(i));
    grid.appendChild(card);
    loadThumb(i, card);
  }
}

async function loadThumb(i, card) {
  const thumbDiv = card.querySelector('.gallery-card__thumb');
  try {
    const text  = await fetchSVG(i);
    const doc   = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg   = doc.querySelector('svg');
    applyColorMap(svg, storedColors(i));
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.cssText = 'width:100%;height:100%;display:block;padding:6px;pointer-events:none';
    thumbDiv.innerHTML = '';
    thumbDiv.appendChild(svg);
  } catch (e) { console.warn('Thumb fail', i, e); }
}

// ── Canvas helpers ───────────────────────────────────────────────
function getCanvas()  { return document.getElementById('draw-canvas'); }
function getCtx()     { const c = getCanvas(); return c ? c.getContext('2d') : null; }

function setupCanvas() {
  const canvas = getCanvas();
  if (!canvas) return;
  const wrap = document.getElementById('svg-wrap');
  const w = wrap.offsetWidth  || 400;
  const h = wrap.offsetHeight || 400;
  canvas.width  = w;
  canvas.height = h;
  loadBrushData();
}

function clearCanvas() {
  const ctx = getCtx();
  const canvas = getCanvas();
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getCanvasPos(e) {
  const canvas = getCanvas();
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const src = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
  };
}

// ── Brush drawing ─────────────────────────────────────────────────
function startDraw(e) {
  if (S.tool !== 'brush') return;
  e.preventDefault();
  S.drawing = true;
  const pos = getCanvasPos(e);
  S.lastX = pos.x; S.lastY = pos.y;
  // Save snapshot for undo
  const ctx = getCtx();
  const canvas = getCanvas();
  const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
  S.undoStack.push({ type: 'brush', imageData: snap });
  if (S.undoStack.length > 60) S.undoStack.shift();
  refreshUndoBtn();
}

function doDraw(e) {
  if (!S.drawing || S.tool !== 'brush') return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  const ctx = getCtx();
  ctx.beginPath();
  ctx.moveTo(S.lastX, S.lastY);
  ctx.lineTo(pos.x, pos.y);
  ctx.strokeStyle = S.color;
  ctx.lineWidth   = THICKNESSES[S.thickness].px;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.stroke();
  S.lastX = pos.x; S.lastY = pos.y;
}

function stopDraw(e) {
  if (!S.drawing) return;
  S.drawing = false;
  saveBrushData();
}

// ── Coloring view ─────────────────────────────────────────────────
async function openColoring(i) {
  S.index      = i;
  S.undoStack  = [];
  S.hovered    = null;
  S.origFill   = null;
  S.svgEl      = null;
  S.drawing    = false;

  document.getElementById('view-gallery').classList.add('hidden');
  document.getElementById('view-coloring').classList.remove('hidden');

  const wrap = document.getElementById('svg-wrap');
  // Show loader (keep canvas in DOM)
  document.getElementById('svg-loading-indicator').style.display = 'flex';

  try {
    const text  = await fetchSVG(i);
    const doc   = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');

    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    applyColorMap(svgEl, storedColors(i));

    // Remove old SVG if any, insert before canvas
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    const canvas = getCanvas();
    wrap.insertBefore(svgEl, canvas);
    document.getElementById('svg-loading-indicator').style.display = 'none';

    S.svgEl = svgEl;

    resizeCanvas();
    attachSVGHandlers(svgEl);
    updateCursor();
    refreshUndoBtn();
    applyToolMode();

  } catch (e) {
    console.error('Failed to load SVG', i, e);
    document.getElementById('svg-loading-indicator').innerHTML = '<span>Chyba pri načítaní 😕</span>';
  }
}

function applyToolMode() {
  const canvas = getCanvas();
  if (!canvas) return;
  const isBrush = S.tool === 'brush';
  // Canvas captures events in brush mode; SVG regions do in bucket/eraser mode
  canvas.style.pointerEvents = isBrush ? 'all' : 'none';
  if (S.svgEl) {
    S.svgEl.style.pointerEvents = isBrush ? 'none' : 'all';
  }
}

// ── SVG click / hover ────────────────────────────────────────────
function attachSVGHandlers(svgEl) {
  svgEl.addEventListener('click',     onSVGClick);
  svgEl.addEventListener('mouseover', onSVGMouseover);
  svgEl.addEventListener('mouseout',  onSVGMouseout);
}

function isColorable(el) {
  return el && el.getAttribute && el.getAttribute('data-region') &&
         el.getAttribute('data-locked') !== 'true';
}

function onSVGClick(e) {
  const path = e.target.closest ? e.target.closest('[data-region]') : null;
  if (!isColorable(path)) return;

  if (S.hovered === path && S.origFill !== null) {
    path.setAttribute('fill', S.origFill);
    path.style.opacity = '';
    S.hovered = null; S.origFill = null;
  }

  const oldFill = path.getAttribute('fill') || '#ffffff';
  const newFill = S.tool === 'eraser' ? '#ffffff' : S.color;
  if (oldFill === newFill) return;

  path.setAttribute('fill', newFill);
  S.undoStack.push({ type: 'svg', path, oldFill, newFill });
  if (S.undoStack.length > 120) S.undoStack.shift();
  playSound('fill');
  persistColors();
  refreshUndoBtn();
}

function onSVGMouseover(e) {
  const path = e.target.closest ? e.target.closest('[data-region]') : null;
  if (!isColorable(path) || S.hovered === path) return;
  clearHover();
  S.hovered  = path;
  S.origFill = path.getAttribute('fill') || '#ffffff';
  if (S.tool === 'bucket') {
    path.setAttribute('fill', S.color);
    path.style.opacity = '0.75';
  } else if (S.tool === 'eraser') {
    path.style.opacity = '0.45';
  }
}

function onSVGMouseout(e) {
  const path = e.target.closest ? e.target.closest('[data-region]') : null;
  if (S.hovered && S.hovered === path) clearHover();
}

function clearHover() {
  if (!S.hovered) return;
  if (S.origFill !== null) S.hovered.setAttribute('fill', S.origFill);
  S.hovered.style.opacity = '';
  S.hovered = null; S.origFill = null;
}

// ── Tools ────────────────────────────────────────────────────────
function setTool(tool) {
  clearHover();
  S.tool = tool;
  document.getElementById('tool-bucket').classList.toggle('tool-btn--active', tool === 'bucket');
  document.getElementById('tool-eraser').classList.toggle('tool-btn--active', tool === 'eraser');
  document.getElementById('tool-brush').classList.toggle('tool-btn--active',  tool === 'brush');
  playSound('click');
  applyToolMode();
  updateCursor();
}

function setThickness(t) {
  S.thickness = t;
  [0, 1, 2].forEach(i => {
    document.getElementById('thick-' + i).classList.toggle('tool-btn--active', i === t);
  });
  playSound('click');
  if (S.tool !== 'brush') setTool('brush');
  else updateCursor();
}

function undo() {
  if (!S.undoStack.length) return;
  const last = S.undoStack.pop();
  if (last.type === 'svg') {
    last.path.setAttribute('fill', last.oldFill);
    persistColors();
  } else if (last.type === 'brush') {
    const ctx = getCtx();
    const canvas = getCanvas();
    ctx.putImageData(last.imageData, 0, 0);
    saveBrushData();
  }
  playSound('undo');
  refreshUndoBtn();
}

function refreshUndoBtn() {
  const btn = document.getElementById('tool-undo');
  if (btn) btn.disabled = S.undoStack.length === 0;
}

// ── Navigation ───────────────────────────────────────────────────
function goToGallery() {
  clearHover();
  S.svgEl = null; S.undoStack = []; S.index = null; S.drawing = false;
  document.getElementById('view-coloring').classList.add('hidden');
  document.getElementById('view-gallery').classList.remove('hidden');
  buildGallery();
}

// ── Save as PNG ──────────────────────────────────────────────────
function savePNG() {
  if (!S.svgEl) return;
  const serialized = new XMLSerializer().serializeToString(S.svgEl);
  const svgBlob    = new Blob([serialized], { type: 'image/svg+xml' });
  const svgUrl     = URL.createObjectURL(svgBlob);

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportCanvas.height = 1024;
  const ctx = exportCanvas.getContext('2d');
  const svgImg = new Image();

  svgImg.onload = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.drawImage(svgImg, 0, 0, 1024, 1024);
    URL.revokeObjectURL(svgUrl);

    // Composite brush layer on top
    const brushCanvas = getCanvas();
    if (brushCanvas && brushCanvas.width > 0) {
      ctx.drawImage(brushCanvas, 0, 0, 1024, 1024);
    }

    // Alfík logo — bottom-right corner
    if (ALFIK_IMG && ALFIK_IMG.complete && ALFIK_IMG.naturalWidth > 0) {
      const sz  = 110;
      const pad = 24;
      ctx.drawImage(ALFIK_IMG, 1024 - sz - pad, 1024 - sz - pad, sz, sz);
    }

    exportCanvas.toBlob(blob => {
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = 'malovanky-jar-' + S.index + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    }, 'image/png');
  };
  svgImg.onerror = () => URL.revokeObjectURL(svgUrl);
  svgImg.src = svgUrl;
  showToast('Sťahujem PNG…');
}

// ── Print ────────────────────────────────────────────────────────
function printColoring() {
  if (!S.svgEl) return;
  const svg     = new XMLSerializer().serializeToString(S.svgEl);
  const logoHtml = ALFIK_SVG
    ? `<div style="position:absolute;bottom:16px;right:16px;width:72px;height:72px">${ALFIK_SVG}</div>`
    : '';
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) { showToast('Povol vyskakovacie okná pre tlač.'); return; }
  win.document.write('<!doctype html><html lang="sk"><head><meta charset="utf-8">' +
    '<title>Maľovanky – Jar</title><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{position:relative;width:90vmin;height:90vmin;margin:auto;margin-top:5vmin}' +
    'svg,canvas{position:absolute;top:0;left:0;width:100%;height:100%}' +
    '@media print{body{width:95vmin;height:95vmin;margin-top:2.5vmin}}' +
    '</style></head><body>' + svg + logoHtml + '</body></html>');
  win.document.close();
  win.addEventListener('load', () => { win.focus(); win.print(); });
}

// ── Fullscreen / Sound ────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
}

function toggleSound() {
  S.sound = !S.sound;
  const icon = S.sound
    ? `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h4l7-5v18l-7-5H6z"/><path d="M22 11a6 6 0 010 10"/><path d="M25 7a11 11 0 010 18"/></svg>`
    : `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h4l7-5v18l-7-5H6z"/><path d="M22 12l8 8M30 12l-8 8"/></svg>`;
  ['btn-sound', 'btn-sound-m'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.innerHTML = icon;
  });
}

// ── Clear all ─────────────────────────────────────────────────────
function askClear() {
  document.getElementById('confirm-overlay').classList.remove('hidden');
}
function doClear() {
  document.getElementById('confirm-overlay').classList.add('hidden');
  if (S.svgEl) {
    S.svgEl.querySelectorAll('[data-region]').forEach(p => {
      if (p.getAttribute('data-locked') !== 'true') p.setAttribute('fill', '#ffffff');
    });
    persistColors();
  }
  clearCanvas();
  if (S.index != null) localStorage.removeItem(STORAGE_PRE + 'canvas-' + S.index);
  S.undoStack = [];
  playSound('clearall');
  refreshUndoBtn();
}

// ── Toast ─────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Palette ───────────────────────────────────────────────────────
function buildPalette() {
  const bar = document.getElementById('palette-bar');
  bar.innerHTML = '';
  PALETTE.forEach(hex => {
    const btn = document.createElement('button');
    btn.className  = 'color-chip' + (hex === S.color ? ' color-chip--active' : '');
    btn.title      = hex;
    btn.setAttribute('aria-label', 'Farba ' + hex);
    btn.style.background = hex;
    if (hex === '#ffffff') btn.style.boxShadow = '0 0 0 2px #ccc inset, 0 2px 6px rgba(0,0,0,.1)';
    btn.addEventListener('click', () => {
      S.color = hex;
      bar.querySelectorAll('.color-chip').forEach(c => c.classList.toggle('color-chip--active', c.title === hex));
      if (S.tool === 'eraser') setTool('bucket');
      else { updateCursor(); playSound('click'); }
    });
    bar.appendChild(btn);
  });
}

// ── Custom cursors ────────────────────────────────────────────────
const BUCKET_OUTLINE = 'M34.65,13.77c-10.22,1.1-16.22,4.63-19,9.11a13.37,13.37,0,0,0-1.23,10.65l.09.34,20.11-20.1ZM80.8,24.89c-7.29-7.3-14.66-13-20.73-16.17C55.76,6.5,52.4,5.61,50.75,6.55l-.82.82c-1.22,2-.51,6.26,1.78,11.58A68.81,68.81,0,0,0,66.22,39.47c6.94,6.94,14.39,12.14,20.73,15,4.51,2,8.21,2.9,10.35,2.32l1.91-1.92c.45-1.91-.5-5.14-2.49-9.13C93.63,39.53,88,32.08,80.8,24.89ZM62.94,3.15c6.66,3.43,14.58,9.57,22.31,17.3S99,36.15,102.34,43c3.75,7.51,4.35,13.92.69,17.58A8.23,8.23,0,0,1,101,62L61.88,101.1c-2.35,2.37-3.33,3.37-7.38,4.28a19.93,19.93,0,0,1-6.14.36,27.5,27.5,0,0,1-6.24-1.35c-8.33-2.8-17-8.66-24.22-15.86S4.63,72.6,1.7,64.25A30.28,30.28,0,0,1,.43,59.6,23.6,23.6,0,0,1,0,55.15a15.25,15.25,0,0,1,1.23-6.81A17.84,17.84,0,0,1,5,43.42l.16-.17,4.71-4.7A24.06,24.06,0,0,1,8.65,35.1a19.15,19.15,0,0,1,1.92-15.34C14.84,12.78,24.42,7.59,41,7.42l4.17-4.16a7.06,7.06,0,0,1,1.58-1.57,2.46,2.46,0,0,1,.67-.45C51.13-1,56.62-.11,62.94,3.15ZM91.48,62.61a35.83,35.83,0,0,1-7.11-2.42c-7-3.16-15.11-8.81-22.59-16.28A75.25,75.25,0,0,1,45.94,21.43a34.92,34.92,0,0,1-2.39-7.68L17.44,39.85a25.47,25.47,0,0,0,4.1,4.58c7.26,6.43,18.87,9.69,31.64,4.22a3,3,0,0,1,2.35,5.52c-15.21,6.51-29.17,2.52-38-5.25a32,32,0,0,1-4.42-4.78L9.44,47.85A12.66,12.66,0,0,0,6.9,51a9.73,9.73,0,0,0-.64,4.14,17.9,17.9,0,0,0,.33,3.3,25.29,25.29,0,0,0,1,3.74c2.61,7.43,8,15.27,14.71,21.89S36.71,96,44.11,98.45a21.48,21.48,0,0,0,4.8,1.06h0a13.6,13.6,0,0,0,4.2-.24,7,7,0,0,0,4.29-2.56c.06-.07.64-.64.63-.65L91.48,62.61Z';

function makeBucketCursor(color) {
  const c   = color.replace(/#/g, '%23');
  const bg  = '%23085475';
  // Flipped horizontally: drip moves to bottom-left → hotspot (5, 35)
  const svg =
    `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 122.88 112.71' width='36' height='36'%3E` +
    `%3Cg transform='translate(122.88%2C0) scale(-1%2C1)'%3E` +
    `%3Cpath fill='${c}' d='M6.56,52C33.11,57.3,43.18,89.47,86.29,67.8L58,96.06s-.57.58-.63.65a7,7,0,0,1-4.29,2.56,13.6,13.6,0,0,1-4.2.24h0a21.48,21.48,0,0,1-4.8-1.06c-7.4-2.48-15.17-7.8-21.79-14.37S10.22,69.62,7.61,62.19a25.29,25.29,0,0,1-1-3.74,17.9,17.9,0,0,1-.33-3.3A12.86,12.86,0,0,1,6.56,52Z'/%3E` +
    `%3Cpath fill='${c}' d='M111.24,72.76c.82,3.48,3.17,7.06,5.43,10.5,3.35,5.1,6.52,9.93,6.18,15.51l0,.22a14.76,14.76,0,0,1-10,12.68,17.35,17.35,0,0,1-6.85,1,17,17,0,0,1-6.73-1.76A14.85,14.85,0,0,1,91,97c0-3.86,2.79-8.22,5.83-13,2.46-3.84,5.11-8,5.86-11.25a4.41,4.41,0,0,1,8.59,0Z'/%3E` +
    `%3Cpath fill='${c}' d='M110.56,84.94c-1.21-1.85-2.44-3.72-3.61-5.64-1.35,2.26-2.77,4.48-4.15,6.64-3.51,5.48-6.72,10.51-6.72,12.55,0,4.65,2.24,7.71,5.23,9.21a12.56,12.56,0,0,0,4.94,1.25,13,13,0,0,0,5.16-.74,9.49,9.49,0,0,0,6.36-8c.13-4.1-3.44-9.53-7.21-15.27Z'/%3E` +
    `%3Cpath fill='${c}' d='M107,73.76c2.15,9.2,12,17.11,11.5,24.75-1.49,13.54-23.07,13-23.07-1.51,0-5.18,9.72-15.25,11.57-23.24Z'/%3E` +
    `%3Cpath fill='${bg}' fill-rule='evenodd' d='${BUCKET_OUTLINE}'/%3E` +
    `%3C/g%3E%3C/svg%3E`;
  return `url("data:image/svg+xml,${svg}") 5 35, crosshair`;
}

function makeBrushCursor(color) {
  const c  = color.replace(/#/g, '%23');
  const bg = '%23085475'; // brand blue for handle
  // viewBox 0 0 512 512; tip of bristles is at approx (1, 510) → hotspot (1,39) at 40px
  const handle   = 'M510.2 7.2c9.2 9.2-17 53.2-78.8 132.1s-113.6 138.8-155.5 180c-13.5 13.5-35.5 31.9-66 55.4-2.8 2.1-5.7.7-8.5-4.3-6.4-12.1-14.9-23.4-25.6-34.1-11.4-11.4-23.1-19.9-35.1-25.6-5.7-2.1-7.1-5-4.3-8.5 22.7-29.8 41.2-51.5 55.4-65C233.7 196 294.7 145.1 375 84.4S500.3-2 510.2 7.2z';
  const bristles = 'M62.9 351.2c13.5-12.1 28.6-17.2 45.3-15.4s32.1 9.8 46.3 24c14.9 14.2 23.4 29.6 25.6 46.3s-3.2 31.4-16 44.2c-30.5 29.8-71 47.9-121.4 54.3Q-2 511.05.1 497.1c0-1.4 1.1-3.2 3.2-5.3 18.5-21.3 29.8-47 34.1-77.2s12.7-51.3 25.5-63.4z';
  const svg =
    `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='40' height='40'%3E` +
    `%3Cpath fill='${bg}' d='${handle}'/%3E` +
    `%3Cpath fill='${c}' d='${bristles}'/%3E` +
    `%3C/svg%3E`;
  return `url("data:image/svg+xml,${svg}") 1 39, crosshair`;
}

const ERASER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32'%3E%3Cpath fill='none' stroke='%23085475' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M19 4l9 9-13 13H8l-4-4v-3L19 4z'/%3E%3Cpath fill='none' stroke='%23085475' stroke-width='2' stroke-linecap='round' d='M13 10l9 9'/%3E%3C/svg%3E") 4 28, crosshair`;

function updateCursor() {
  const wrap = document.getElementById('svg-wrap');
  if (!wrap) return;

  const cur = S.tool === 'eraser' ? ERASER_CURSOR
            : S.tool === 'brush'  ? makeBrushCursor(S.color)
            : makeBucketCursor(S.color);

  // Apply to the whole wrap so cursor shows everywhere in canvas area
  wrap.style.cursor = cur;

  // Also apply to canvas overlay (for brush mode)
  const canvas = getCanvas();
  if (canvas) canvas.style.cursor = cur;

  // Reset per-path cursors (no longer needed)
  if (S.svgEl) {
    S.svgEl.querySelectorAll('[data-region]:not([data-locked="true"])').forEach(p => {
      p.style.cursor = '';
    });
  }
}

// ── Audio ─────────────────────────────────────────────────────
let ALFIK_SVG  = null;
let ALFIK_IMG  = null;
const SOUNDS = {};
function initSounds() {
  ['fill','undo','clearall','click'].forEach(name => {
    const a = new Audio('audio/' + name + '.mp3');
    a.preload = 'auto';
    SOUNDS[name] = a;
  });
}
async function preloadLogo() {
  try {
    const r = await fetch('assets/icon_app_alfik.svg');
    ALFIK_SVG = await r.text();
    const blob = new Blob([ALFIK_SVG], {type: 'image/svg+xml'});
    const url  = URL.createObjectURL(blob);
    ALFIK_IMG  = new Image();
    ALFIK_IMG.src = url;
    ALFIK_IMG.onload = () => URL.revokeObjectURL(url);
  } catch (e) { console.warn('Logo preload failed', e); }
}
function playSound(name) {
  if (!S.sound) return;
  const a = SOUNDS[name];
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

// ── Viewport height fix (mobile Safari 100vh bug) ───────────────
function fixVH() {
  document.documentElement.style.setProperty('--real-vh', (window.innerHeight * 0.01) + 'px');
}

// ── Thickness popup (mobile) ──────────────────────────────────────
let _popupOpen = false;

function isMobile() { return window.innerWidth <= 767; }

function openThicknessPopup() {
  const popup = document.getElementById('thickness-popup');
  const btn   = document.getElementById('tool-brush');
  if (!popup || !btn) return;

  const r   = btn.getBoundingClientRect();
  const pw  = 62; // popup width estimate
  const ph  = 170; // popup height estimate (3 buttons + padding)

  // Position above the button, centered
  const left = Math.max(4, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 4));
  const top  = Math.max(4, r.top - ph - 8);

  popup.style.left   = left + 'px';
  popup.style.top    = top  + 'px';
  popup.style.bottom = 'auto';
  popup.classList.remove('hidden');
  _popupOpen = true;

  // Highlight active thickness in popup
  popup.querySelectorAll('.thickness-pill').forEach(b => {
    b.classList.toggle('tool-btn--active', +b.dataset.thickness === S.thickness);
  });

  setTimeout(() => {
    document.addEventListener('click', closeThicknessPopup, { once: true });
  }, 10);
}

function closeThicknessPopup() {
  const popup = document.getElementById('thickness-popup');
  if (popup) popup.classList.add('hidden');
  _popupOpen = false;
}

// ── Canvas resize ─────────────────────────────────────────────────
function resizeCanvas() {
  const area   = document.querySelector('.canvas-area');
  const wrap   = document.getElementById('svg-wrap');
  const canvas = getCanvas();
  if (!area || !wrap) return;

  function applySize() {
    const r = area.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const size = Math.max(Math.min(r.width, r.height) - 12, 80);
    if (parseInt(wrap.style.width) === size) return; // no change

    wrap.style.width  = size + 'px';
    wrap.style.height = size + 'px';

    if (!canvas) return;
    const old = (canvas.width > 0 && canvas.height > 0) ? canvas.toDataURL() : null;
    canvas.width  = size;
    canvas.height = size;
    if (old) {
      const img = new Image();
      img.onload = () => getCtx() && getCtx().drawImage(img, 0, 0, size, size);
      img.src = old;
    } else {
      loadBrushData();
    }
  }

  // Synchronous — works immediately on desktop
  applySize();
  // Deferred refinement — catches iOS Safari post-layout shifts
  requestAnimationFrame(() => requestAnimationFrame(applySize));
}

// ── Event wiring ──────────────────────────────────────────────────
function wireEvents() {
  // Toolbar icon buttons — intentionally passive (handled by parent player)
  // document.getElementById('btn-fullscreen') — no handler
  // document.getElementById('btn-close')      — no handler
  // document.getElementById('btn-close-m')    — no handler
  document.getElementById('gallery-fullscreen').addEventListener('click', toggleFullscreen);

  // Tool buttons
  document.getElementById('tool-bucket').addEventListener('click', () => setTool('bucket'));
  document.getElementById('tool-eraser').addEventListener('click', () => setTool('eraser'));
  document.getElementById('tool-brush').addEventListener('click', () => {
    if (_popupOpen) { closeThicknessPopup(); return; }
    setTool('brush');
    // Show popup on mobile OR always if thickness pills are hidden
    const pills = document.querySelector('.tool-rail > .btn-group:first-child');
    const pillsHidden = !pills || getComputedStyle(pills).display === 'none';
    if (pillsHidden) openThicknessPopup();
  });
  document.getElementById('tool-undo').addEventListener('click', undo);

  // Thickness
  [0, 1, 2].forEach(i => {
    document.getElementById('thick-' + i).addEventListener('click', () => setThickness(i));
  });

  // Action rail (desktop)
  document.getElementById('btn-sound').addEventListener('click', toggleSound);
  document.getElementById('btn-gallery').addEventListener('click', goToGallery);
  document.getElementById('btn-print').addEventListener('click', printColoring);
  document.getElementById('btn-save').addEventListener('click', savePNG);
  document.getElementById('btn-clear').addEventListener('click', askClear);

  // Action rail (mobile)
  document.getElementById('btn-sound-m').addEventListener('click', toggleSound);
  document.getElementById('btn-gallery-m').addEventListener('click', goToGallery);
  document.getElementById('btn-print-m').addEventListener('click', printColoring);
  document.getElementById('btn-save-m').addEventListener('click', savePNG);
  document.getElementById('btn-clear-m').addEventListener('click', askClear);

  // Canvas brush events
  const canvas = getCanvas();
  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', doDraw);
  canvas.addEventListener('pointerup',   stopDraw);
  canvas.addEventListener('pointerleave', stopDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove',  doDraw,    { passive: false });
  canvas.addEventListener('touchend',   stopDraw);

  // Confirm dialog
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.add('hidden');
  });
  document.getElementById('confirm-ok').addEventListener('click', doClear);
  document.getElementById('confirm-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget)
      document.getElementById('confirm-overlay').classList.add('hidden');
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    if (!e.ctrlKey && !e.metaKey) {
      if (e.key === 'v' || e.key === 'V') setTool('bucket');
      if (e.key === 'e' || e.key === 'E') setTool('eraser');
      if (e.key === 'b' || e.key === 'B') setTool('brush');
      if (e.key === 'Escape') {
        const ov = document.getElementById('confirm-overlay');
        if (!ov.classList.contains('hidden')) ov.classList.add('hidden');
        else if (S.view === 'coloring') goToGallery();
      }
    }
  });

  // Generic click sound for tool buttons and gallery cards (not toolbar icon-btns)
  document.querySelectorAll('.tool-btn, .gallery-card').forEach(el => {
    el.addEventListener('click', () => playSound('click'), { capture: true });
  });

  // Thickness popup buttons
  document.querySelectorAll('#thickness-popup .thickness-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setThickness(+btn.dataset.thickness);
      closeThicknessPopup();
    });
  });

  window.addEventListener('resize', () => { fixVH(); resizeCanvas(); updateCursor(); closeThicknessPopup(); });
  fixVH();
}

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadGithubSources();
  await loadDriveSources();
  wireEvents();
  buildPalette();
  buildGallery();
  initSounds();
  preloadLogo();
});
