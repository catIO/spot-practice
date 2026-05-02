import './style.css'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// State management
let osmdLeft = null;
let osmdRight = null;
let totalMeasures = 0;
let currentFile = null;
let passageLength = 4; // Default number of bars to show
let availableStarts = []; // Pool for exhaustion logic

// Full Score State
let isFullScoreMode = false;
let currentStartMeasure = 1;
let layoutMode = 'single';

// DOM Elements
const uploadSection = document.getElementById('upload-section');
const viewerSection = document.getElementById('viewer-section');
const viewerCanvas = document.getElementById('viewer-canvas');
const musicContainerLeft = document.getElementById('music-container-left');
const musicContainerRight = document.getElementById('music-container-right');
const fileInput = document.getElementById('file-input');
const statusBar = document.getElementById('status-bar');
const loader = document.getElementById('loader');

const newPassageBtn = document.getElementById('new-passage-btn');
const uploadNewBtn = document.getElementById('upload-new-btn');
const passageLengthSelect = document.getElementById('passage-length');
const passageControls = document.getElementById('passage-controls');
const fullScoreControls = document.getElementById('full-score-controls');
const toggleFullScoreBtn = document.getElementById('toggle-full-score-btn');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const pageIndicator = document.getElementById('page-indicator');
const layoutModeSelect = document.getElementById('layout-mode');

// IndexedDB Persistence Helpers
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

// Initialize OSMD
function initOSMD() {
  const commonOptions = {
    autoResize: true,
    drawTitle: false,
    drawSubtitle: false,
    drawComposer: false,
    drawLyricist: false,
    drawMetronomeMarks: true,
    drawPartNames: false,
    drawPartAbbreviations: false,
    drawFingerings: true,
    drawMeasureNumbers: true,
    renderSingleHorizontalStaffline: false,
    drawingParameters: 'compact',
    defaultColorMusic: '#000000'
  };

  osmdLeft = new OpenSheetMusicDisplay(musicContainerLeft, commonOptions);
  osmdRight = new OpenSheetMusicDisplay(musicContainerRight, commonOptions);
}

// Shuffle utility (Fisher-Yates)
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Initialize/Reset the pool of available start points
function resetAvailableStarts() {
  if (totalMeasures === 0) return;
  
  passageLength = parseInt(passageLengthSelect.value) || 4;
  const maxStart = Math.max(1, totalMeasures - passageLength + 1);
  
  availableStarts = [];
  for (let i = 1; i <= maxStart; i++) {
    availableStarts.push(i);
  }
  
  shuffle(availableStarts);
  console.log(`Pool reset: ${availableStarts.length} possible starting points.`);
}

// File handling
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
  const files = e.dataTransfer.files;
  if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  if (!file.name.match(/\.(musicxml|xml|mxl)$/i)) {
    alert('Please upload a MusicXML or MXL file.');
    return;
  }

  currentFile = file;
  showLoader(true);
  
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target.result;
      await loadMusicData(file.name, content);
      // Save for persistence
      saveFileToStorage(file.name, content);
    };
    
    if (file.name.endsWith('.mxl')) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  } catch (err) {
    console.error('File Read Error:', err);
    showLoader(false);
  }
}

async function loadMusicData(name, content) {
  try {
    if (!osmdLeft) initOSMD();
    showLoader(true);
    
    // Load into both instances
    await Promise.all([
      osmdLeft.load(content),
      osmdRight.load(content)
    ]);
    
    totalMeasures = osmdLeft.Sheet.SourceMeasures.length;
    
    uploadSection.classList.add('hidden');
    viewerSection.classList.remove('hidden');
    
    resetAvailableStarts();
    showRandomPassage();
  } catch (err) {
    console.error('OSMD Load Error:', err);
    alert('Error parsing MusicXML data.');
  } finally {
    showLoader(false);
  }
}

function showRandomPassage() {
  if (!osmdLeft || totalMeasures === 0) return;

  if (isFullScoreMode) {
    renderFullScoreView();
    return;
  }

  // Passage Mode
  musicContainerRight.classList.add('hidden');
  viewerCanvas.classList.remove('double-page');

  if (availableStarts.length === 0) {
    resetAvailableStarts();
  }

  const startMeasure = availableStarts.pop();
  renderRange(osmdLeft, startMeasure, passageLength);
  
  statusBar.textContent = `Random Passage: Measures ${startMeasure} - ${Math.min(totalMeasures, startMeasure + passageLength - 1)} of ${totalMeasures}`;
}

function renderFullScoreView() {
  const baseChunk = parseInt(passageLengthSelect.value) || 4;
  const chunk = baseChunk * 4; 

  if (layoutMode === 'double') {
    musicContainerRight.classList.remove('hidden');
    viewerCanvas.classList.add('double-page');
    
    renderRange(osmdLeft, currentStartMeasure, chunk);
    
    const rightStart = currentStartMeasure + chunk;
    if (rightStart <= totalMeasures) {
      renderRange(osmdRight, rightStart, chunk);
      const endMeasure = Math.min(totalMeasures, rightStart + chunk - 1);
      statusBar.textContent = `Full Score: Measures ${currentStartMeasure} - ${endMeasure} of ${totalMeasures}`;
    } else {
      musicContainerRight.classList.add('hidden'); // Hide if nothing to show on right
      statusBar.textContent = `Full Score: Measures ${currentStartMeasure} - ${totalMeasures}`;
    }
  } else {
    musicContainerRight.classList.add('hidden');
    viewerCanvas.classList.remove('double-page');
    renderRange(osmdLeft, currentStartMeasure, chunk);
    const endMeasure = Math.min(totalMeasures, currentStartMeasure + chunk - 1);
    statusBar.textContent = `Full Score: Measures ${currentStartMeasure} - ${endMeasure} of ${totalMeasures}`;
  }
  
  // Page indicator
  const effectiveChunk = layoutMode === 'double' ? chunk * 2 : chunk;
  const totalPages = Math.ceil(totalMeasures / effectiveChunk);
  const currentPage = Math.ceil(currentStartMeasure / effectiveChunk);
  pageIndicator.textContent = `${currentPage} / ${totalPages}`;
}

function renderRange(instance, startMeasure, length) {
  const endMeasure = Math.min(totalMeasures, startMeasure + length - 1);
  
  instance.setOptions({
    drawFromMeasureNumber: startMeasure,
    drawUpToMeasureNumber: endMeasure
  });
  
  instance.EngravingRules.drawFromMeasureNumber = startMeasure;
  instance.EngravingRules.drawUpToMeasureNumber = endMeasure;
  
  if (isFullScoreMode) {
    instance.EngravingRules.RenderXMeasuresPerLineAkaSystem = 0; // Natural wrapping
    instance.EngravingRules.MinMeasureWidth = 15;
  } else {
    instance.EngravingRules.RenderXMeasuresPerLineAkaSystem = length;
    instance.EngravingRules.MinMeasureWidth = 20;
  }
  
  instance.EngravingRules.EvenlySpaceMeasures = true;
  instance.EngravingRules.StretchLastSystemLine = true;
  
  instance.render();
  viewerCanvas.style.opacity = 1;
}

function showLoader(show) {
  if (show) {
    loader.classList.remove('hidden');
    viewerCanvas.style.opacity = 0.5;
  } else {
    loader.classList.add('hidden');
    viewerCanvas.style.opacity = 1;
  }
}

// Control Actions
newPassageBtn.addEventListener('click', () => {
  viewerCanvas.style.opacity = 0;
  setTimeout(() => showRandomPassage(), 300);
});

uploadNewBtn.addEventListener('click', () => {
  viewerSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  fileInput.value = '';
});

passageLengthSelect.addEventListener('change', () => {
  resetAvailableStarts();
  if (isFullScoreMode) {
    currentStartMeasure = 1; // Reset to beginning if paging changes
  }
  showRandomPassage();
});

toggleFullScoreBtn.addEventListener('click', () => {
  isFullScoreMode = !isFullScoreMode;
  
  if (isFullScoreMode) {
    passageControls.classList.add('hidden');
    fullScoreControls.classList.remove('hidden');
    toggleFullScoreBtn.innerHTML = '<span class="material-symbols-outlined">casino</span> Back to Passages';
    currentStartMeasure = 1;
  } else {
    passageControls.classList.remove('hidden');
    fullScoreControls.classList.add('hidden');
    toggleFullScoreBtn.innerHTML = '<span class="material-symbols-outlined">menu_book</span> View Full Score';
    resetAvailableStarts();
  }
  
  showRandomPassage();
});

prevPageBtn.addEventListener('click', () => {
  const chunk = parseInt(passageLengthSelect.value) || 4;
  const effectiveChunk = layoutMode === 'double' ? chunk * 2 : chunk;
  currentStartMeasure = Math.max(1, currentStartMeasure - effectiveChunk);
  showRandomPassage();
});

nextPageBtn.addEventListener('click', () => {
  const chunk = parseInt(passageLengthSelect.value) || 4;
  const effectiveChunk = layoutMode === 'double' ? chunk * 2 : chunk;
  if (currentStartMeasure + effectiveChunk <= totalMeasures) {
    currentStartMeasure += effectiveChunk;
    showRandomPassage();
  }
});

layoutModeSelect.addEventListener('change', (e) => {
  layoutMode = e.target.value;
  showRandomPassage();
});

// Responsive handling
window.addEventListener('resize', () => {
  if (osmdLeft && viewerSection.classList.contains('hidden') === false) {
    osmdLeft.render();
    if (layoutMode === 'double' && !musicContainerRight.classList.contains('hidden')) {
      osmdRight.render();
    }
  }
});

// Startup: Check for saved file
async function initApp() {
  const splash = document.getElementById('splash-loader');
  
  try {
    const saved = await getSavedFileFromStorage();
    if (saved && saved.content) {
      console.log(`Restoring last file: ${saved.name}`);
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
