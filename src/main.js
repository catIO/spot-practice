import './style.css'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// ─── State ────────────────────────────────────────────────────────────────────
let osmdPassage = null;   // OSMD instance for Passage Mode (Endless)
let osmdFull = null;      // OSMD instance for Full Score Mode (A4_P)
let totalMeasures = 0;
const PREF_PASSAGE_LENGTH = 'spot_passage_length';
let passageLength = parseInt(localStorage.getItem(PREF_PASSAGE_LENGTH) || '2', 10);
let availableStarts = [];

let isFullScoreMode = false;
let currentStartMeasure = 1;
let currentPageIndex = 0;
let totalPages = 1;
let osmdFullSVGs = []; // Extracted per-page SVGs from OSMD

// ─── DOM ──────────────────────────────────────────────────────────────────────
const uploadSection = document.getElementById('upload-section');
const viewerSection = document.getElementById('viewer-section');
const viewerCanvas = document.getElementById('viewer-canvas');
const musicContainer = document.getElementById('music-container');
const musicContainerFull = document.getElementById('music-container-full');
const fileInput = document.getElementById('file-input');
const loader = document.getElementById('loader');

const newPassageBtn = document.getElementById('new-passage-btn');
const uploadNewBtn = document.getElementById('upload-new-btn');
const passageLengthSelect = document.getElementById('passage-length');
const scoreNavWrapper = document.getElementById('score-nav-wrapper');

// Toolbar Elements
const toggleModeBtn = document.getElementById('toggle-mode-btn');
const modeIcon = document.getElementById('mode-icon');
const modeLabel = document.getElementById('mode-label');
const navSectionSpot = document.getElementById('nav-section-spot');
const navSectionFull = document.getElementById('nav-section-full');
const pageInput = document.getElementById('page-input');
const totalPagesDisplay = document.getElementById('total-pages-display');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomDisplay = document.getElementById('zoom-display');
const fullscreenToolbarBtn = document.getElementById('fullscreen-toolbar-btn');
const fsIcon = document.getElementById('fs-icon');

let currentZoom = 1.0;
let baseScale = 1.0;

// ─── IndexedDB ────────────────────────────────────────────────────────────────
const DB_NAME = 'SpotPracticeDB';
const STORE_NAME = 'lastFile';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveFileToStorage(name, content) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ name, content, timestamp: Date.now() }, 'current');
  } catch (err) {
    console.error('Failed to save to IndexedDB:', err);
  }
}

async function getSavedFileFromStorage() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return new Promise((resolve) => {
      const req = tx.objectStore(STORE_NAME).get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.error('Failed to read from IndexedDB:', err);
    return null;
  }
}

// ─── OSMD Initialisation ──────────────────────────────────────────────────────
function initOSMD() {
  const sharedOptions = {
    autoResize: false,          // We handle sizing ourselves
    drawTitle: false,
    drawSubtitle: false,
    drawComposer: false,
    drawLyricist: false,
    drawMetronomeMarks: true,
    drawPartNames: false,
    drawPartAbbreviations: false,
    drawFingerings: true,
    drawMeasureNumbers: true,
    defaultColorMusic: '#000000',
  };

  // Passage instance – endless scroll, dynamic slicing
  osmdPassage = new OpenSheetMusicDisplay(musicContainer, {
    ...sharedOptions,
    pageFormat: 'Endless',
    drawingParameters: 'compact',
  });

  // Full Score instance – respects physical page layout from XML
  osmdFull = new OpenSheetMusicDisplay(musicContainerFull, {
    ...sharedOptions,
    pageFormat: 'A4_P',
    drawTitle: true,
    drawSubtitle: true,
    drawComposer: true,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function resetAvailableStarts() {
  if (totalMeasures === 0) return;
  passageLength = parseInt(passageLengthSelect.value) || 4;
  const maxStart = Math.max(1, totalMeasures - passageLength + 1);
  availableStarts = [];
  for (let i = 1; i <= maxStart; i++) availableStarts.push(i);
  shuffle(availableStarts);
}

function showLoader(show) {
  if (show) {
    loader.classList.remove('hidden');
    viewerCanvas.style.opacity = '0.5';
  } else {
    loader.classList.add('hidden');
    viewerCanvas.style.opacity = '1';
  }
}

// ─── File Handling ────────────────────────────────────────────────────────────
uploadSection.addEventListener('click', () => fileInput.click());

uploadSection.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadSection.classList.add('drag-over');
});
uploadSection.addEventListener('dragleave', () => {
  uploadSection.classList.remove('drag-over');
});
uploadSection.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadSection.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  if (!file.name.match(/\.(musicxml|xml|mxl)$/i)) {
    alert('Please upload a MusicXML or MXL file.');
    return;
  }
  showLoader(true);
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    await loadMusicData(file.name, content);
    saveFileToStorage(file.name, content);
  };
  if (file.name.endsWith('.mxl')) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}

async function loadMusicData(name, content) {
  try {
    if (!osmdPassage) initOSMD();
    showLoader(true);

    // Load into both instances in parallel
    await Promise.all([
      osmdPassage.load(content),
      osmdFull.load(content),
    ]);

    totalMeasures = osmdPassage.Sheet.SourceMeasures.length;

    uploadSection.classList.add('hidden');
    viewerSection.classList.remove('hidden');

    resetAvailableStarts();

    // Reset to passage mode on new file load
    if (isFullScoreMode) {
      isFullScoreMode = false;
      exitFullScoreUI();
    }

    showRandomPassage();
  } catch (err) {
    console.error('OSMD Load Error:', err);
    alert('Error parsing MusicXML data.');
  } finally {
    showLoader(false);
  }
}

// ─── Passage Mode ─────────────────────────────────────────────────────────────
function showRandomPassage() {
  if (!osmdPassage || totalMeasures === 0) return;

  // Make sure the right container is visible
  musicContainer.classList.remove('hidden');
  musicContainerFull.classList.add('hidden');
  viewerCanvas.classList.remove('full-score-view');

  if (availableStarts.length === 0) resetAvailableStarts();

  const startMeasure = availableStarts.pop();
  renderPassage(startMeasure, passageLength);
}

function renderPassage(startMeasure, length) {
  const endMeasure = Math.min(totalMeasures, startMeasure + length - 1);

  osmdPassage.setOptions({
    drawFromMeasureNumber: startMeasure,
    drawUpToMeasureNumber: endMeasure,
  });
  osmdPassage.EngravingRules.drawFromMeasureNumber = startMeasure;
  osmdPassage.EngravingRules.drawUpToMeasureNumber = endMeasure;
  osmdPassage.EngravingRules.RenderXMeasuresPerLineAkaSystem = length;
  osmdPassage.EngravingRules.MinMeasureWidth = 20;
  osmdPassage.EngravingRules.EvenlySpaceMeasures = true;
  osmdPassage.EngravingRules.StretchLastSystemLine = true;
  osmdPassage.Zoom = currentZoom * 0.8; // Calibrated so 100% UI matches old 80% size
  osmdPassage.render();
  viewerCanvas.style.opacity = '1';
}

function updateZoomDisplay() {
  zoomDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
}

function applyZoom() {
  updateZoomDisplay();
  if (isFullScoreMode) {
    const svg = musicContainerFull.querySelector('svg');
    if (svg) {
      const viewBox = svg.getAttribute('viewBox') || '0 0 800 1131';
      const parts = viewBox.split(' ');
      const nativeWidth = parseFloat(parts[2] || 800);
      const nativeHeight = parseFloat(parts[3] || 1131);

      const actualScale = baseScale * currentZoom;

      svg.style.width = `${nativeWidth * actualScale}px`;
      svg.style.height = `${nativeHeight * actualScale}px`;
      svg.style.maxWidth = 'none';
      svg.style.maxHeight = 'none';
    }
  } else {
    if (osmdPassage) {
      osmdPassage.Zoom = currentZoom * 0.8;
      osmdPassage.render();
    }
  }
}

// ─── Full Score Mode ──────────────────────────────────────────────────────────
async function renderFullScore() {
  if (!osmdFull || totalMeasures === 0) return;
  showLoader(true);

  try {
    // Ignore printed-paper system/page breaks — they don't translate to screen.
    // OSMD auto-distributes measures based on note density and available width.
    osmdFull.EngravingRules.NewSystemAtXMLNewSystemAttribute = false;
    osmdFull.EngravingRules.NewPageAtXMLNewPageAttribute = false;
    osmdFull.EngravingRules.RenderXMeasuresPerLineAkaSystem = 0; // auto

    // Wait for browser to paint the now-visible container before rendering.
    // Without this, OSMD measures 0px width and produces blank output.
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Extra tick for browsers that need two frames to fully lay out flex children
    await new Promise(resolve => requestAnimationFrame(resolve));

    console.log('Container width before render:', musicContainerFull.clientWidth);
    osmdFull.render();

    // Extract SVGs from OSMD wrapper divs so we can show them independently.
    // OSMD uses absolute positioning inside 0×0 wrappers, which causes overflow
    // clipping issues. Extracting the SVG gives us full control over sizing.
    osmdFullSVGs = [];
    Array.from(musicContainerFull.children).forEach(div => {
      const svg = div.querySelector('svg');
      if (svg) {
        // Ensure viewBox is set so the SVG scales correctly
        const w = svg.getAttribute('width');
        const h = svg.getAttribute('height');
        if (w && h && !svg.getAttribute('viewBox')) {
          svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
        }
        osmdFullSVGs.push(svg.cloneNode(true));
      }
    });

    console.log(`Extracted ${osmdFullSVGs.length} page SVGs`);
    totalPages = osmdFullSVGs.length || 1;
    currentPageIndex = 0;
    showCurrentPage();
  } catch (err) {
    console.error('Full Score render error:', err);
  } finally {
    showLoader(false);
  }
}

function showCurrentPage() {
  if (!osmdFullSVGs.length) return;

  totalPages = osmdFullSVGs.length;

  // Clone the active page SVG and inject it directly into the container
  const svgClone = osmdFullSVGs[currentPageIndex].cloneNode(true);

  // Replace container contents with just this SVG
  musicContainerFull.innerHTML = '';
  musicContainerFull.appendChild(svgClone);

  // Calculate base scale so that 100% zoom perfectly fits the screen
  const isFs = !!document.fullscreenElement;
  const availableHeight = isFs ? window.innerHeight - 80 : window.innerHeight - 150;
  const availableWidth = musicContainerFull.clientWidth || window.innerWidth - 64;

  const viewBox = svgClone.getAttribute('viewBox') || '0 0 800 1131';
  const parts = viewBox.split(' ');
  const nativeWidth = parseFloat(parts[2] || 800);
  const nativeHeight = parseFloat(parts[3] || 1131);

  const scaleFitHeight = availableHeight / nativeHeight;
  const scaleFitWidth = availableWidth / nativeWidth;
  baseScale = Math.min(scaleFitHeight, scaleFitWidth);

  // Prepare SVG for explicit pixel sizing
  svgClone.style.display = 'block';
  svgClone.style.margin = '0 auto';
  svgClone.style.overflow = 'visible';

  pageInput.value = currentPageIndex + 1;
  totalPagesDisplay.textContent = totalPages;
  viewerCanvas.style.opacity = '1';
  
  applyZoom();
}

// ─── Mode Toggle UI helpers ───────────────────────────────────────────────────
function enterFullScoreUI() {
  navSectionSpot.classList.add('hidden');
  navSectionFull.classList.remove('hidden');
  modeIcon.textContent = 'casino'; // switch to spot practice icon
  if (modeLabel) modeLabel.textContent = 'Spot Practice';
  toggleModeBtn.title = 'Switch to Spot Practice';
  viewerCanvas.classList.add('full-score-view');
  musicContainer.classList.add('hidden');
  musicContainerFull.classList.remove('hidden');
}

function exitFullScoreUI() {
  navSectionSpot.classList.remove('hidden');
  navSectionFull.classList.add('hidden');
  modeIcon.textContent = 'menu_book'; // switch to full score icon
  if (modeLabel) modeLabel.textContent = 'Full Score';
  toggleModeBtn.title = 'Switch to Full Score';
  viewerCanvas.classList.remove('full-score-view');
  musicContainerFull.classList.add('hidden');
  musicContainer.classList.remove('hidden');
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
newPassageBtn.addEventListener('click', () => {
  viewerCanvas.style.opacity = '0';
  setTimeout(() => showRandomPassage(), 300);
});

uploadNewBtn.addEventListener('click', () => {
  viewerSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  fileInput.value = '';
});

// Restore saved preference into the dropdown
(function () {
  const saved = localStorage.getItem(PREF_PASSAGE_LENGTH);
  if (saved && passageLengthSelect.querySelector(`option[value="${saved}"]`)) {
    passageLengthSelect.value = saved;
  }
})();

passageLengthSelect.addEventListener('change', () => {
  passageLength = parseInt(passageLengthSelect.value, 10);
  localStorage.setItem(PREF_PASSAGE_LENGTH, String(passageLength));
  resetAvailableStarts();
  showRandomPassage();
});

toggleModeBtn.addEventListener('click', async () => {
  isFullScoreMode = !isFullScoreMode;

  if (isFullScoreMode) {
    enterFullScoreUI();
    await renderFullScore();
  } else {
    exitFullScoreUI();
    showRandomPassage();
  }
});

pageInput.addEventListener('change', () => {
  if (!isFullScoreMode) return;
  let p = parseInt(pageInput.value, 10);
  if (isNaN(p)) p = 1;
  if (p < 1) p = 1;
  if (p > totalPages) p = totalPages;
  pageInput.value = p;
  currentPageIndex = p - 1;
  showCurrentPage();
});

zoomInBtn.addEventListener('click', () => {
  currentZoom += 0.1;
  applyZoom();
});

zoomOutBtn.addEventListener('click', () => {
  currentZoom = Math.max(0.2, currentZoom - 0.1);
  applyZoom();
});

// Fullscreen
fullscreenToolbarBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    viewerSection.requestFullscreen().catch(err =>
      console.error(`Fullscreen error: ${err.message}`)
    );
  } else {
    document.exitFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  fsIcon.textContent = isFs ? 'fullscreen_exit' : 'fullscreen';

  // Re-scale the SVG to fit the new fullscreen dimensions (give the browser a tick to layout)
  setTimeout(() => {
    if (isFullScoreMode) showCurrentPage();
  }, 50);
});

// Keyboard navigation
window.addEventListener('keydown', (e) => {
  if (!isFullScoreMode || viewerSection.classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      showCurrentPage();
    }
  }
  if (e.key === 'ArrowRight') {
    if (currentPageIndex < totalPages - 1) {
      currentPageIndex++;
      showCurrentPage();
    }
  }
});

// Resize: re-render current view
window.addEventListener('resize', () => {
  if (viewerSection.classList.contains('hidden')) return;

  // Re-scale the score to fit the new window size
  if (isFullScoreMode) {
    showCurrentPage();
  } else if (osmdPassage) {
    osmdPassage.render();
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function initApp() {
  const splash = document.getElementById('splash-loader');
  try {
    const saved = await getSavedFileFromStorage();
    if (saved && saved.content) {
      await loadMusicData(saved.name, saved.content);
    } else {
      uploadSection.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Initialization error:', err);
    uploadSection.classList.remove('hidden');
  } finally {
    if (splash) splash.classList.add('hidden');
    document.body.classList.add('loaded');
  }
}

initApp();
