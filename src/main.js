import './style.css'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// ─── State ────────────────────────────────────────────────────────────────────
let osmdPassage = null;   // OSMD instance for Passage Mode (Endless)
let osmdFull = null;      // OSMD instance for Full Score Mode (A4_P)
let totalMeasures = 0;
const PREF_PASSAGE_LENGTH = 'spot_passage_length';
const PREF_ZOOM = 'spot_current_zoom';
const PREF_SHOW_MEASURES = 'spot_show_measures';
const PREF_CURRENT_SPOT = 'spot_current_spot';
const PREF_UNPLAYED_SPOTS = 'spot_unplayed_spots';
const PREF_SPOT_NUMBER = 'spot_current_number';
const PREF_CYCLE_COUNT = 'spot_cycle_count';
const PREF_SELECTED_START = 'spot_selected_start';
let passageLength = parseInt(localStorage.getItem(PREF_PASSAGE_LENGTH) || '2', 10);
let drawMeasures = localStorage.getItem(PREF_SHOW_MEASURES) !== 'false'; // Default to true

// ─── Spot & Cycle Tracking State ──────────────────────────────────────────────
let allSpots = [];          // All non-overlapping start measures: [1, 1+L, 1+2L, ...]
let unplayedSpots = [];     // Remaining unplayed start measures in current cycle
let currentSpotStart = 1;   // The start measure currently displayed
let currentSpotNumber = 1;  // 1-based index in the current cycle for display (e.g. Spot 3 / 8)
let cycleCount = 1;         // How many full passes through the piece have been completed

let isFullScoreMode = false;
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
const spotProgress = document.getElementById('spot-progress');
const cycleToast = document.getElementById('cycle-toast');
const cycleToastText = document.getElementById('cycle-toast-text');
let cycleToastTimer = null;

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

function showCycleToast(message) {
  if (!cycleToast) return;
  if (cycleToastText) cycleToastText.textContent = message;
  cycleToast.classList.remove('hidden');
  clearTimeout(cycleToastTimer);
  cycleToastTimer = setTimeout(() => {
    cycleToast.classList.add('hidden');
  }, 2400);
}

function updateSpotProgressDisplay() {
  if (!spotProgress) return;
  const total = allSpots.length || 1;
  const current = Math.min(total, Math.max(1, currentSpotNumber));
  spotProgress.textContent = `${current} / ${total}`;
  const remaining = unplayedSpots.length;
  spotProgress.title = `Spot ${current} of ${total} (Cycle ${cycleCount}, ${remaining} remaining)`;
}

function saveSpotCycleState() {
  try {
    localStorage.setItem(PREF_CURRENT_SPOT, String(currentSpotStart));
    localStorage.setItem(PREF_UNPLAYED_SPOTS, JSON.stringify(unplayedSpots));
    localStorage.setItem(PREF_SPOT_NUMBER, String(currentSpotNumber));
    localStorage.setItem(PREF_CYCLE_COUNT, String(cycleCount));
    if (startMeasureSelect) {
      localStorage.setItem(PREF_SELECTED_START, startMeasureSelect.value);
    }
  } catch (err) {
    console.warn('Failed to save spot cycle state to localStorage:', err);
  }
}

function clearSpotCycleState() {
  localStorage.removeItem(PREF_CURRENT_SPOT);
  localStorage.removeItem(PREF_UNPLAYED_SPOTS);
  localStorage.removeItem(PREF_SPOT_NUMBER);
  localStorage.removeItem(PREF_CYCLE_COUNT);
  localStorage.removeItem(PREF_SELECTED_START);
}

function restoreSavedSpotState() {
  try {
    const savedSpot = localStorage.getItem(PREF_CURRENT_SPOT);
    const savedUnplayed = localStorage.getItem(PREF_UNPLAYED_SPOTS);
    const savedNumber = localStorage.getItem(PREF_SPOT_NUMBER);
    const savedCycle = localStorage.getItem(PREF_CYCLE_COUNT);
    const savedSelected = localStorage.getItem(PREF_SELECTED_START);

    if (savedSpot && savedUnplayed) {
      const parsedUnplayed = JSON.parse(savedUnplayed);
      const spot = parseInt(savedSpot, 10);
      if (allSpots.includes(spot) && Array.isArray(parsedUnplayed)) {
        currentSpotStart = spot;
        unplayedSpots = parsedUnplayed;
        currentSpotNumber = parseInt(savedNumber, 10) || (allSpots.length - unplayedSpots.length);
        cycleCount = parseInt(savedCycle, 10) || 1;
        if (savedSelected && startMeasureSelect && [...startMeasureSelect.options].some(o => o.value === savedSelected)) {
          startMeasureSelect.value = savedSelected;
        }
        updateSpotProgressDisplay();
        return true;
      }
    }
  } catch (err) {
    console.warn('Failed to restore spot cycle state:', err);
  }
  return false;
}

function initSpotsCycle(preserveProgress = false) {
  if (totalMeasures === 0) return;
  passageLength = parseInt(passageLengthSelect.value, 10) || 2;

  // Non-overlapping spots: 1, 1+L, 1+2L, ... covering the entire score
  allSpots = [];
  for (let s = 1; s <= totalMeasures; s += passageLength) {
    allSpots.push(s);
  }

  // Repopulate startMeasureSelect dropdown with distinct spot ranges
  if (startMeasureSelect) {
    const currentVal = startMeasureSelect.value;
    startMeasureSelect.innerHTML = '<option value="random">Random</option>';
    for (const s of allSpots) {
      const end = Math.min(totalMeasures, s + passageLength - 1);
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = s === end ? `m. ${s}` : `mm. ${s}–${end}`;
      startMeasureSelect.appendChild(opt);
    }
    if (currentVal && [...startMeasureSelect.options].some(o => o.value === currentVal)) {
      startMeasureSelect.value = currentVal;
    }
  }

  if (!preserveProgress || unplayedSpots.length === 0) {
    unplayedSpots = shuffle([...allSpots]);
    currentSpotNumber = 0;
  }
  updateSpotProgressDisplay();
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
    const success = await loadMusicData(file.name, content, true);
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

async function loadMusicData(name, content, isNewUpload = false) {
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

    if (isNewUpload) {
      clearSpotCycleState();
    }

    initSpotsCycle(true);
    const restored = !isNewUpload && restoreSavedSpotState();

    // Reset to passage mode on new file load
    if (isFullScoreMode) {
      isFullScoreMode = false;
      exitFullScoreUI();
    }

    if (restored) {
      renderPassage(currentSpotStart, passageLength);
    } else {
      if (startMeasureSelect) startMeasureSelect.value = 'random';
      cycleCount = 1;
      unplayedSpots = shuffle([...allSpots]);
      currentSpotNumber = 0;
      showRandomPassage();
    }
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
  const selected = startMeasureSelect ? startMeasureSelect.value : 'random';
  
  if (selected === 'random') {
    // If all spots have been played at least once, start a new cycle and reshuffle
    if (unplayedSpots.length === 0) {
      cycleCount++;
      unplayedSpots = shuffle([...allSpots]);
      showCycleToast(`Cycle ${cycleCount - 1} complete! Reshuffled.`);
    }
    startMeasure = unplayedSpots.pop();
    currentSpotNumber = allSpots.length - unplayedSpots.length;
  } else {
    startMeasure = parseInt(selected, 10);
    // Mark spot as played by removing from unplayed pool if present
    const idx = unplayedSpots.indexOf(startMeasure);
    if (idx !== -1) {
      unplayedSpots.splice(idx, 1);
    }
    currentSpotNumber = allSpots.length - unplayedSpots.length;
  }

  currentSpotStart = startMeasure;
  updateSpotProgressDisplay();
  saveSpotCycleState();
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
  clearSpotCycleState();
  initSpotsCycle(false);
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
    renderPassage(currentSpotStart, passageLength);
  }
  updateZoomDisplay();
});

toggleMeasuresBtn.addEventListener('click', async () => {
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
    await renderFullScore();
  } else {
    renderPassage(currentSpotStart, passageLength);
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
  if (viewerSection.classList.contains('hidden')) return;

  if (isFullScoreMode) {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      if (currentPageIndex > 0) {
        currentPageIndex--;
        showCurrentPage();
      }
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      if (currentPageIndex < totalPages - 1) {
        currentPageIndex++;
        showCurrentPage();
      }
    }
  } else {
    // In Spot mode: Spacebar or ArrowRight triggers "New Spot"
    if (e.code === 'Space' || e.key === 'ArrowRight') {
      if (document.activeElement && (document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'INPUT')) {
        return;
      }
      e.preventDefault();
      newPassageBtn.click();
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
    renderPassage(currentSpotStart, passageLength);
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
