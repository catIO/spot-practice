import './style.css'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// ─── State ────────────────────────────────────────────────────────────────────
let osmdPassage = null;   // OSMD instance for Passage Mode (Endless)
let osmdFull = null;      // OSMD instance for Full Score Mode (A4_P)
let totalMeasures = 0;
const PREF_PASSAGE_LENGTH = 'spot_passage_length';
const PREF_ZOOM = 'spot_current_zoom';
const PREF_SHOW_MEASURES = 'spot_show_measures';
let passageLength = parseInt(localStorage.getItem(PREF_PASSAGE_LENGTH) || '2', 10);
let drawMeasures = localStorage.getItem(PREF_SHOW_MEASURES) !== 'false'; // Default to true
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
const startMeasureSelect = document.getElementById('start-measure');
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
const toggleMeasuresBtn = document.getElementById('toggle-measures-btn');
const measuresIcon = document.getElementById('measures-icon');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');

let currentZoom = parseFloat(localStorage.getItem(PREF_ZOOM) || '1.0');
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
    drawMeasureNumbers: drawMeasures,
    drawMeasureNumbersOnlyAtSystemStart: false,
    defaultColorMusic: '#000000',
    coloringEnabled: true,
    coloringMode: 0, // 0 = XML
    colorStemsLikeNoteheads: true,
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

  osmdPassage.EngravingRules.MeasureNumberInterval = 1;
  osmdFull.EngravingRules.MeasureNumberInterval = 1;
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
  
  // Repopulate the dropdown if it exists
  if (startMeasureSelect) {
    const currentVal = startMeasureSelect.value;
    startMeasureSelect.innerHTML = '<option value="random">Random</option>';
    for (let i = 1; i <= totalMeasures; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      startMeasureSelect.appendChild(opt);
    }
    if (currentVal && [...startMeasureSelect.options].some(o => o.value === currentVal)) {
      startMeasureSelect.value = currentVal;
    }
  }

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
    const success = await loadMusicData(file.name, content);
    if (success) {
      saveFileToStorage(file.name, content);
    }
  };
  if (file.name.endsWith('.mxl')) {
    reader.readAsBinaryString(file);
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

    if (startMeasureSelect) startMeasureSelect.value = 'random';
    resetAvailableStarts();

    // Reset to passage mode on new file load
    if (isFullScoreMode) {
      isFullScoreMode = false;
      exitFullScoreUI();
    }

    showRandomPassage();
    return true;
  } catch (err) {
    console.error('OSMD Load Error:', err);
    alert('Error parsing MusicXML data.');
    uploadSection.classList.remove('hidden');
    viewerSection.classList.add('hidden');
    return false;
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

  let startMeasure;
  const selected = startMeasureSelect.value;
  
  if (selected === 'random') {
    if (availableStarts.length === 0) resetAvailableStarts();
    startMeasure = availableStarts.pop();
  } else {
    startMeasure = parseInt(selected, 10);
  }

  renderPassage(startMeasure, passageLength);
}

function renderPassage(startMeasure, length) {
  const endMeasure = Math.min(totalMeasures, startMeasure + length - 1);

  // Determine how many measures per line makes sense
  let measuresPerLine = length;
  if (length >= 8) measuresPerLine = 4; // Break long passages into 4-bar systems

  osmdPassage.setOptions({
    drawFromMeasureNumber: startMeasure,
    drawUpToMeasureNumber: endMeasure,
    drawMeasureNumbers: drawMeasures,
    drawMeasureNumbersOnlyAtSystemStart: false,
    measureNumberInterval: 1
  });

  osmdPassage.EngravingRules.NewSystemAtXMLNewSystemAttribute = false;
  osmdPassage.EngravingRules.NewPageAtXMLNewPageAttribute = false;
  osmdPassage.EngravingRules.RenderXMeasuresPerLineAkaSystem = measuresPerLine;
  osmdPassage.EngravingRules.ColoringEnabled = true;
  osmdPassage.EngravingRules.ColoringMode = 0;
  osmdPassage.EngravingRules.MeasureNumberInterval = 1;
  osmdPassage.EngravingRules.EvenlySpaceMeasures = true;
  osmdPassage.EngravingRules.StretchLastSystemLine = true;
  
  // Temporarily force the container to be very wide so OSMD never auto-wraps due to space
  const originalWidth = musicContainer.style.width;
  musicContainer.style.width = '4000px';

  osmdPassage.Zoom = currentZoom;
  osmdPassage.render();

  // Restore container width
  musicContainer.style.width = originalWidth;

  // Make the resulting SVG responsive so it scales down to fit the screen
  const svg = musicContainer.querySelector('svg');
  if (svg) {
    svg.style.width = '100%';
    svg.style.height = 'auto';
  }

  viewerCanvas.style.opacity = '1';
}

function updateZoomDisplay() {
  zoomDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
}

function applyZoom() {
  updateZoomDisplay();
  if (!isFullScoreMode) {
    localStorage.setItem(PREF_ZOOM, currentZoom.toString());
  }
  
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
      osmdPassage.Zoom = currentZoom;
      osmdPassage.render();
      // After render, we need to re-apply the responsive SVG fix
      const svg = musicContainer.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.height = 'auto';
      }
    }
  }
}

// ─── Full Score Mode ──────────────────────────────────────────────────────────
async function renderFullScore() {
  if (!osmdFull || totalMeasures === 0) return;
  showLoader(true);

  try {
    // OSMD auto-distributes measures based on note density and available width.
    osmdFull.EngravingRules.NewSystemAtXMLNewSystemAttribute = false;
    osmdFull.EngravingRules.NewPageAtXMLNewPageAttribute = false;
    
    // Force a consistent number of measures and systems for an even look
    osmdFull.EngravingRules.RenderXMeasuresPerLineAkaSystem = 4;
    osmdFull.EngravingRules.MaxSystemsPerVerticalPage = 3;
    osmdFull.EngravingRules.EvenlySpaceMeasures = true;
    osmdFull.EngravingRules.StretchLastSystemLine = true;

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
  prevPageBtn.classList.remove('hidden');
  nextPageBtn.classList.remove('hidden');
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
  prevPageBtn.classList.add('hidden');
  nextPageBtn.classList.add('hidden');
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
  if (startMeasureSelect) startMeasureSelect.value = 'random';
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
  updateZoomDisplay();
  
  // Set initial state for measures toggle
  if (drawMeasures) {
    toggleMeasuresBtn.classList.add('active');
    toggleMeasuresBtn.title = 'Measure Numbers: On';
  } else {
    toggleMeasuresBtn.classList.remove('active');
    toggleMeasuresBtn.title = 'Measure Numbers: Off';
  }
})();

passageLengthSelect.addEventListener('change', () => {
  passageLength = parseInt(passageLengthSelect.value, 10);
  localStorage.setItem(PREF_PASSAGE_LENGTH, String(passageLength));
  resetAvailableStarts();
  showRandomPassage();
});

startMeasureSelect.addEventListener('change', () => {
  showRandomPassage();
});

toggleModeBtn.addEventListener('click', async () => {
  isFullScoreMode = !isFullScoreMode;

  if (isFullScoreMode) {
    currentZoom = 1.0;
    enterFullScoreUI();
    await renderFullScore();
  } else {
    currentZoom = parseFloat(localStorage.getItem(PREF_ZOOM) || '1.0');
    exitFullScoreUI();
    showRandomPassage();
  }
  updateZoomDisplay();
});

toggleMeasuresBtn.addEventListener('click', () => {
  drawMeasures = !drawMeasures;
  localStorage.setItem(PREF_SHOW_MEASURES, String(drawMeasures));
  
  // Update UI state
  toggleMeasuresBtn.classList.toggle('active', drawMeasures);
  toggleMeasuresBtn.title = `Measure Numbers: ${drawMeasures ? 'On' : 'Off'}`;
  
  // Apply to both instances
  if (osmdPassage) {
    osmdPassage.setOptions({ 
      drawMeasureNumbers: drawMeasures,
      drawMeasureNumbersOnlyAtSystemStart: false,
      measureNumberInterval: 1
    });
  }
  if (osmdFull) {
    osmdFull.setOptions({ 
      drawMeasureNumbers: drawMeasures,
      drawMeasureNumbersOnlyAtSystemStart: false,
      measureNumberInterval: 1
    });
  }
  
  // Re-render current view
  if (isFullScoreMode) {
    showCurrentPage();
  } else {
    osmdPassage.render();
    // After render, we need to re-apply the responsive SVG fix
    const svg = musicContainer.querySelector('svg');
    if (svg) {
      svg.style.width = '100%';
      svg.style.height = 'auto';
    }
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

prevPageBtn.addEventListener('click', () => {
  if (currentPageIndex > 0) {
    currentPageIndex--;
    showCurrentPage();
  }
});

nextPageBtn.addEventListener('click', () => {
  if (currentPageIndex < totalPages - 1) {
    currentPageIndex++;
    showCurrentPage();
  }
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
  fullscreenToolbarBtn.classList.toggle('active', isFs);

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
      const success = await loadMusicData(saved.name, saved.content);
      if (!success) {
        uploadSection.classList.remove('hidden');
      }
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
