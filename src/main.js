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
const uploadSection        = document.getElementById('upload-section');
const viewerSection        = document.getElementById('viewer-section');
const viewerCanvas         = document.getElementById('viewer-canvas');
const musicContainer       = document.getElementById('music-container');
const musicContainerFull   = document.getElementById('music-container-full');
const fileInput            = document.getElementById('file-input');
const statusBar            = document.getElementById('status-bar');
const loader               = document.getElementById('loader');

const newPassageBtn        = document.getElementById('new-passage-btn');
const uploadNewBtn         = document.getElementById('upload-new-btn');
const passageLengthSelect  = document.getElementById('passage-length');
const passageControls      = document.getElementById('passage-controls');
const fullScoreControls    = document.getElementById('full-score-controls');
const toggleFullScoreBtn   = document.getElementById('toggle-full-score-btn');
const prevPageBtn          = document.getElementById('prev-page-btn');
const nextPageBtn          = document.getElementById('next-page-btn');
const pageIndicator        = document.getElementById('page-indicator');
const fullscreenBtn        = document.getElementById('fullscreen-btn');
const scoreNavWrapper      = document.getElementById('score-nav-wrapper');
const exitFullscreenBtn    = document.getElementById('exit-fullscreen-btn');

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
    request.onerror  = () => reject(request.error);
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
      req.onerror  = () => resolve(null);
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
  statusBar.textContent = `Passage: measures ${startMeasure}–${Math.min(totalMeasures, startMeasure + passageLength - 1)} of ${totalMeasures}`;
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
  osmdPassage.Zoom = 1.0;
  osmdPassage.render();
  viewerCanvas.style.opacity = '1';
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

  // Make it responsive: fill width, auto height, bounded by container
  svgClone.setAttribute('width',  '100%');
  svgClone.setAttribute('height', 'auto');
  svgClone.style.width    = '100%';
  svgClone.style.height   = 'auto';
  svgClone.style.display  = 'block';
  svgClone.style.maxWidth = '100%';

  // Replace container contents with just this SVG
  musicContainerFull.innerHTML = '';
  musicContainerFull.appendChild(svgClone);

  // Reset any inline sizing we applied previously
  musicContainerFull.style.width    = '';
  musicContainerFull.style.height   = '';
  musicContainerFull.style.overflow = 'visible';
  musicContainerFull.style.position = '';

  pageIndicator.textContent = `${currentPageIndex + 1} / ${totalPages}`;
  statusBar.textContent     = `Full Score – page ${currentPageIndex + 1} of ${totalPages}`;
  viewerCanvas.style.opacity = '1';
}

// ─── Mode Toggle UI helpers ───────────────────────────────────────────────────
function enterFullScoreUI() {
  document.querySelector('.setting-group').classList.add('hidden');
  passageControls.classList.add('hidden');
  fullScoreControls.classList.remove('hidden');
  toggleFullScoreBtn.innerHTML = '<span class="material-symbols-outlined">casino</span> Back to Passages';
  prevPageBtn.classList.remove('hidden');
  nextPageBtn.classList.remove('hidden');
  viewerCanvas.classList.add('full-score-view');
  musicContainer.classList.add('hidden');
  musicContainerFull.classList.remove('hidden');
}

function exitFullScoreUI() {
  document.querySelector('.setting-group').classList.remove('hidden');
  passageControls.classList.remove('hidden');
  fullScoreControls.classList.add('hidden');
  toggleFullScoreBtn.innerHTML = '<span class="material-symbols-outlined">menu_book</span> View Full Score';
  prevPageBtn.classList.add('hidden');
  nextPageBtn.classList.add('hidden');
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

toggleFullScoreBtn.addEventListener('click', async () => {
  isFullScoreMode = !isFullScoreMode;

  if (isFullScoreMode) {
    enterFullScoreUI();
    await renderFullScore();
  } else {
    exitFullScoreUI();
    showRandomPassage();
  }
});

prevPageBtn.addEventListener('click', () => {
  if (isFullScoreMode) {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      showCurrentPage();
    }
  } else {
    currentStartMeasure = Math.max(1, currentStartMeasure - passageLength);
    showRandomPassage();
  }
});

nextPageBtn.addEventListener('click', () => {
  if (isFullScoreMode) {
    if (currentPageIndex < totalPages - 1) {
      currentPageIndex++;
      showCurrentPage();
    }
  } else {
    if (currentStartMeasure + passageLength <= totalMeasures) {
      currentStartMeasure += passageLength;
      showRandomPassage();
    }
  }
});

// Fullscreen
fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    scoreNavWrapper.requestFullscreen().catch(err =>
      console.error(`Fullscreen error: ${err.message}`)
    );
  } else {
    document.exitFullscreen();
  }
});

exitFullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
});

document.addEventListener('fullscreenchange', () => {
  const icon = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
  fullscreenBtn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
});

// Keyboard navigation
window.addEventListener('keydown', (e) => {
  if (!isFullScoreMode || viewerSection.classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft')  prevPageBtn.click();
  if (e.key === 'ArrowRight') nextPageBtn.click();
});

// Resize: re-render current view
window.addEventListener('resize', () => {
  if (viewerSection.classList.contains('hidden')) return;
  if (isFullScoreMode && osmdFull) {
    osmdFull.render();
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
