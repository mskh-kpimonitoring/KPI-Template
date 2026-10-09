/**
 * ==========================================================================
 * FLIPBOOK APPLICATION CORE ENGINE (UI/UX Pro Max Edition)
 * High-Performance Virtualized Viewer for large documents (571 Pages)
 * ==========================================================================
 */

(function () {
  'use strict';

  const log = (...args) => console.log(...args);
  const warn = (...args) => console.warn(...args);
  const error = (...args) => console.error(...args);

  // Set PDF.js worker path
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
  }

  /* --------------------------------------------------------------------------
     1. State Management & Configuration
     -------------------------------------------------------------------------- */
  const state = {
    pdfDoc: null,
    totalPages: 0,
    currentPage: 1,       // 1-based index for UI
    pageFlip: null,
    aspectRatio: 1.414,   // Default A4 portrait
    pageWidth: 550,
    pageHeight: 778,
    
    // Zoom & Pan
    zoomLevel: 1.0,
    minZoom: 1.0,
    maxZoom: 2.5,
    zoomStep: 0.25,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,

    // Reading & UI Options
    isAutoPlaying: false,
    autoPlayTimer: null,
    autoPlayInterval: 4000,
    soundEnabled: true,
    theme: 'obsidian',
    isZenMode: false,
    zenTimer: null,
    
    // Memory Cache Window
    renderedPages: new Map(), // pageNum -> { canvas, skeleton, renderTask, renderedScale }
    maxCachedPages: 10,       // LRU Cache limit
    zoomDebounceTimer: null,
    
    // Bookmarks
    bookmarks: [],
    storageKey: 'flipbook_bookmarks_lem',

    // Table of Contents
    tocItems: window.FLIPBOOK_TOC || [],
    tocFilter: 'all',
    tocSearchQuery: ''
  };
  window.flipbookState = state;

  /* --------------------------------------------------------------------------
     2. Web Audio Realistic Paper Flip Synthesizer
     -------------------------------------------------------------------------- */
  class PaperAudioSynthesizer {
    constructor() {
      this.ctx = null;
    }

    init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
    }

    play() {
      if (!state.soundEnabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }

        const now = this.ctx.currentTime;
        const duration = 0.24; // 240ms soft rustle
        const bufferSize = Math.floor(this.ctx.sampleRate * duration);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        // Pink/Brownish noise for organic paper friction
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99 * b0 + white * 0.05;
          b1 = 0.96 * b1 + white * 0.11;
          b2 = 0.86 * b2 + white * 0.25;
          data[i] = (b0 + b1 + b2) * 1.5;
        }

        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = buffer;

        // Bandpass filter to simulate page curvature acoustic sweep
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(650, now);
        filter.frequency.exponentialRampToValueAtTime(260, now + duration);
        filter.Q.setValueAtTime(1.8, now);

        // Soft volume envelope
        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0.001, now);
        gainNode.gain.linearRampToValueAtTime(0.28, now + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noiseNode.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        noiseNode.start(now);
        noiseNode.stop(now + duration);
      } catch (err) {
        console.warn('Audio synthesis note:', err);
      }
    }
  }

  const audioSynth = new PaperAudioSynthesizer();

  /* --------------------------------------------------------------------------
     3. DOM Elements Cache
     -------------------------------------------------------------------------- */
  const dom = {
    appRoot: document.getElementById('app-root'),
    topBar: document.getElementById('top-bar'),
    docTitle: document.getElementById('doc-title'),
    docBadge: document.getElementById('doc-badge'),
    bottomDock: document.getElementById('bottom-dock'),
    stage: document.getElementById('stage-container'),
    bookViewport: document.getElementById('book-viewport'),
    flipbook: document.getElementById('flipbook'),
    spineOverlay: document.getElementById('spine-overlay'),

    // Nav buttons
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnPrevFloating: document.getElementById('btn-prev-floating'),
    btnNextFloating: document.getElementById('btn-next-floating'),
    
    // Page jump & slider
    pageInput: document.getElementById('page-input'),
    totalPages: document.getElementById('total-pages'),
    pageSlider: document.getElementById('page-slider'),
    sliderTooltip: document.getElementById('slider-tooltip'),
    
    // Zoom
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnZoomReset: document.getElementById('btn-zoom-reset'),
    zoomLevelText: document.getElementById('zoom-level-text'),
    btnViewMode: document.getElementById('btn-view-mode'),
    
    // Tools
    btnSound: document.getElementById('btn-sound'),
    btnAutoPlay: document.getElementById('btn-autoplay'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnTheme: document.getElementById('btn-theme'),
    themeMenu: document.getElementById('theme-menu'),
    btnHelp: document.getElementById('btn-help'),
    btnDownload: document.getElementById('btn-download'),

    // Drawers
    btnToc: document.getElementById('btn-toc'),
    btnThumbnails: document.getElementById('btn-thumbnails'),
    btnBookmarks: document.getElementById('btn-bookmarks'),
    drawerBackdrop: document.getElementById('drawer-backdrop'),
    drawerToc: document.getElementById('drawer-toc'),
    drawerThumbnails: document.getElementById('drawer-thumbnails'),
    drawerBookmarks: document.getElementById('drawer-bookmarks'),
    tocList: document.getElementById('toc-list'),
    tocSearch: document.getElementById('toc-search'),
    tocSearchClear: document.getElementById('toc-search-clear'),
    filterPills: document.querySelectorAll('.filter-pill'),
    thumbnailsTrack: document.getElementById('thumbnails-track'),
    bookmarksList: document.getElementById('bookmarks-list'),
    bookmarkInput: document.getElementById('bookmark-input'),
    btnAddBookmark: document.getElementById('btn-add-bookmark'),

    // Modal
    modalShortcuts: document.getElementById('modal-shortcuts'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    
    // Dropzone fallback
    dropzoneOverlay: document.getElementById('dropzone-overlay'),
    fileInput: document.getElementById('file-input')
  };

  /* --------------------------------------------------------------------------
     4. PDF Loading & Initialization
     -------------------------------------------------------------------------- */
  async function initApplication() {
    loadSavedSettings();
    bindUserInteractions();

    showLoadingToast('กำลังเปิดไฟล์เอกสาร...');

    // Try candidate paths: ASCII aliases routed by server ('doc.pdf', 'book.pdf') first to prevent
    // Windows HTTP.SYS Thai URL corruption, then fallback to direct 'เล่ม.pdf' and URL-encoded.
    const candidateUrls = [
      'doc.pdf',
      'book.pdf',
      encodeURIComponent('เล่ม.pdf'),
      'เล่ม.pdf'
    ];

    // If hosted on GitHub Pages, add raw.githubusercontent fallback URLs in case GitHub Pages returns 404 for Thai filenames
    if (window.location && window.location.hostname && window.location.hostname.endsWith('github.io')) {
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const repo = pathParts[0];
        const org = window.location.hostname.split('.')[0];
        candidateUrls.push(
          `https://raw.githubusercontent.com/${org}/${repo}/main/doc.pdf`,
          `https://raw.githubusercontent.com/${org}/${repo}/main/${encodeURIComponent('เล่ม.pdf')}`
        );
      }
    }

    let loaded = false;

    for (const url of candidateUrls) {
      try {
        await loadPdfDocument(url);
        loaded = true;
        break;
      } catch (err) {
        // Continue trying next candidate URL
      }
    }

    if (!loaded) {
      hideLoadingToast();
      // Fallback: Reveal friendly drag-and-drop / file picker (works on file:// protocol too)
      dom.dropzoneOverlay.classList.remove('hidden');
    }
  }

  async function loadPdfDocument(source) {
    let loadingTask;
    if (typeof source === 'string') {
      // Fetch via standard HTTP GET into ArrayBuffer to bypass HEAD/Range streaming issues
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} when fetching ${source}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      loadingTask = pdfjsLib.getDocument({
        data,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true
      });
    } else {
      // Uint8Array or ArrayBuffer from file picker / drag-and-drop
      loadingTask = pdfjsLib.getDocument({
        data: source,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true
      });
    }

    state.pdfDoc = await loadingTask.promise;
    state.loadedPdfUrl = typeof source === 'string' ? source : null;
    state.totalPages = state.pdfDoc.numPages;
    dom.totalPages.textContent = state.totalPages;
    if (dom.docBadge) {
      dom.docBadge.textContent = `${state.totalPages} หน้า`;
    }
    dom.pageSlider.max = state.totalPages;
    dom.pageInput.max = state.totalPages;

    // Hide dropzone if visible
    dom.dropzoneOverlay.classList.add('hidden');

    // Get First Page to determine physical aspect ratio
    const firstPage = await state.pdfDoc.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1.0 });
    state.aspectRatio = viewport.height / viewport.width;

    // Calculate dimensions based on viewport
    calculatePageDimensions();

    // Build Book DOM & Setup PageFlip
    buildBookDOM();
    setupPageFlip();

    // Render TOC & Preload First Spread
    loadTableOfContents();
    renderPageSpread(state.currentPage);

    // Setup Thumbnails Drawer
    setupThumbnailsDrawer();

    showLoadingToast(`โหลดเอกสารเรียบร้อย (${state.totalPages} หน้า)`, 2500);
  }

  function calculatePageDimensions() {
    const stageWidth = dom.stage.clientWidth;
    const stageHeight = dom.stage.clientHeight;
    const isMobile = stageWidth < 900;

    let targetHeight = stageHeight * 0.86;
    let targetWidth = targetHeight / state.aspectRatio;

    if (!isMobile) {
      // Double page spread check
      if (targetWidth * 2 > stageWidth * 0.92) {
        targetWidth = (stageWidth * 0.92) / 2;
        targetHeight = targetWidth * state.aspectRatio;
      }
    } else {
      // Single page mobile
      if (targetWidth > stageWidth * 0.92) {
        targetWidth = stageWidth * 0.92;
        targetHeight = targetWidth * state.aspectRatio;
      }
    }

    state.pageWidth = Math.round(targetWidth);
    state.pageHeight = Math.round(targetHeight);
  }

  /* --------------------------------------------------------------------------
     5. Build Book DOM & St.PageFlip Engine
     -------------------------------------------------------------------------- */
  function buildBookDOM() {
    dom.flipbook.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (let i = 1; i <= state.totalPages; i++) {
      const pageEl = document.createElement('div');
      pageEl.className = `book-page ${i % 2 === 0 ? 'page-left' : 'page-right'}`;
      pageEl.dataset.page = i;

      pageEl.innerHTML = `
        <div class="page-content">
          <canvas class="page-canvas" id="canvas-page-${i}"></canvas>
          <div class="page-skeleton" id="skeleton-page-${i}">
            <div class="spinner"></div>
            <span>หน้า ${i}</span>
          </div>
          <div class="page-number-footer">${i}</div>
        </div>
      `;
      fragment.appendChild(pageEl);
    }

    dom.flipbook.appendChild(fragment);
  }

  function setupPageFlip() {
    if (state.pageFlip) {
      try { state.pageFlip.destroy(); } catch (e) {}
    }

    state.pageFlip = new St.PageFlip(dom.flipbook, {
      width: state.pageWidth,
      height: state.pageHeight,
      size: 'fixed',
      minWidth: 280,
      maxWidth: 1600,
      minHeight: 400,
      maxHeight: 2200,
      drawShadow: true,
      maxShadowOpacity: 0.45,
      showCover: true,
      usePortrait: true,
      startPage: 0,
      flippingTime: 650,
      useMouseEvents: true,
      mobileScrollSupport: false,
      swipeDistance: 35
    });

    state.pageFlip.loadFromHTML(dom.flipbook.querySelectorAll('.book-page'));

    // Events
    state.pageFlip.on('flip', (e) => {
      // e.data is 0-indexed page in PageFlip
      const newPage = e.data + 1;
      onPageChanged(newPage);
      audioSynth.play();
    });

    state.pageFlip.on('changeOrientation', (e) => {
      // Toggle spine overlay in single-page mode vs dual-page mode
      if (dom.spineOverlay) {
        dom.spineOverlay.style.display = e.data === 'portrait' ? 'none' : 'block';
      }
    });

    // Initial spine state
    if (dom.spineOverlay) {
      dom.spineOverlay.style.display = state.pageFlip.getOrientation() === 'portrait' ? 'none' : 'block';
    }
  }

  /* --------------------------------------------------------------------------
     6. High-Performance Virtualized Page Rendering (Ultra-Sharp UHD Engine)
     -------------------------------------------------------------------------- */
  function getOptimalRenderScale(page, isZoomed = false) {
    // Base scale 2.5x ensures dense Thai tables and small text are razor sharp
    let scale = 2.5;
    if (isZoomed && state.zoomLevel > 1.0) {
      scale = 2.5 * Math.min(1.6, state.zoomLevel);
    }
    return Math.min(3.8, Math.max(2.2, scale));
  }

  async function renderSinglePage(pageNum, forceReRender = false) {
    if (pageNum < 1 || pageNum > state.totalPages) return;
    
    const isZoomed = state.zoomLevel > 1.0;
    const canvas = document.getElementById(`canvas-page-${pageNum}`);
    const skeleton = document.getElementById(`skeleton-page-${pageNum}`);
    if (!canvas) return;

    // Check if already rendered at sufficient resolution
    if (state.renderedPages.has(pageNum)) {
      const entry = state.renderedPages.get(pageNum);
      const targetScale = getOptimalRenderScale(null, isZoomed);
      
      if (!forceReRender || (entry.renderedScale && entry.renderedScale >= targetScale)) {
        // Touch for LRU
        state.renderedPages.delete(pageNum);
        state.renderedPages.set(pageNum, entry);
        return;
      }

      // If forcing re-render at higher scale, cancel previous render if still in progress
      if (entry.renderTask) {
        try { entry.renderTask.cancel(); } catch (e) {}
      }
    }

    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const scale = getOptimalRenderScale(page, isZoomed);
      const scaledViewport = page.getViewport({ scale });

      // Physical canvas bitmap dimensions (High-DPI)
      canvas.width = Math.round(scaledViewport.width);
      canvas.height = Math.round(scaledViewport.height);

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const renderTask = page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
        intent: 'display'
      });

      // Save to LRU cache with rendered scale
      state.renderedPages.set(pageNum, { canvas, skeleton, renderTask, renderedScale: scale });

      await renderTask.promise;

      if (skeleton) skeleton.classList.add('hidden');

      // Enforce LRU cache eviction
      pruneMemoryCache();
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.warn(`Render error on page ${pageNum}:`, err);
      }
    }
  }

  function pruneMemoryCache() {
    if (state.renderedPages.size <= state.maxCachedPages) return;

    // Pages furthest from current page get evicted
    let furthestPage = -1;
    let maxDistance = -1;

    for (const pageNum of state.renderedPages.keys()) {
      const dist = Math.abs(pageNum - state.currentPage);
      if (dist > maxDistance) {
        maxDistance = dist;
        furthestPage = pageNum;
      }
    }

    if (furthestPage !== -1 && maxDistance > 3) {
      const entry = state.renderedPages.get(furthestPage);
      if (entry) {
        if (entry.canvas) {
          entry.canvas.width = 1;
          entry.canvas.height = 1;
        }
        if (entry.skeleton) {
          entry.skeleton.classList.remove('hidden');
        }
      }
      state.renderedPages.delete(furthestPage);
    }
  }

  function renderPageSpread(centerPage) {
    // Current spread + preload window
    const targetPages = [
      centerPage,
      centerPage + 1,
      centerPage - 1,
      centerPage + 2,
      centerPage - 2,
      centerPage + 3
    ].filter(p => p >= 1 && p <= state.totalPages);

    // Prioritize visible spread first
    targetPages.forEach(p => renderSinglePage(p));
  }

  function onPageChanged(newPage) {
    state.currentPage = newPage;
    dom.pageInput.value = newPage;
    dom.pageSlider.value = newPage;

    // Update Floating Nav state
    dom.btnPrevFloating.classList.toggle('disabled', newPage <= 1);
    dom.btnNextFloating.classList.toggle('disabled', newPage >= state.totalPages);

    // Render active window
    renderPageSpread(newPage);

    // Update active state in thumbnail drawer & TOC
    updateActiveThumbnail(newPage);
    updateActiveTocItem(newPage);
  }

  /* --------------------------------------------------------------------------
     7. Navigation & Jump Controls
     -------------------------------------------------------------------------- */
  function flipPrev() {
    if (state.pageFlip) {
      state.pageFlip.flipPrev();
    }
  }

  function flipNext() {
    if (state.pageFlip) {
      state.pageFlip.flipNext();
    }
  }

  function jumpToPage(pageNum) {
    const page = Math.max(1, Math.min(pageNum, state.totalPages));
    if (state.pageFlip) {
      // 0-indexed in PageFlip
      state.pageFlip.turnToPage(page - 1);
    }
  }

  /* --------------------------------------------------------------------------
     8. Zoom & Pan System
     -------------------------------------------------------------------------- */
  function applyZoom(newZoom) {
    state.zoomLevel = Math.max(state.minZoom, Math.min(newZoom, state.maxZoom));
    dom.zoomLevelText.textContent = `${Math.round(state.zoomLevel * 100)}%`;

    if (state.zoomLevel === 1.0) {
      state.panX = 0;
      state.panY = 0;
      dom.bookViewport.style.transform = `scale(1) translate(0px, 0px)`;
      dom.bookViewport.classList.remove('is-dragging');
    } else {
      dom.bookViewport.style.transform = `scale(${state.zoomLevel}) translate(${state.panX}px, ${state.panY}px)`;
    }

    // Debounced crisp re-render for visible pages when zooming
    clearTimeout(state.zoomDebounceTimer);
    state.zoomDebounceTimer = setTimeout(() => {
      reRenderVisiblePagesForZoom();
    }, 200);
  }

  function reRenderVisiblePagesForZoom() {
    const visible = [state.currentPage];
    if (state.pageFlip && state.pageFlip.getOrientation() === 'landscape' && state.currentPage + 1 <= state.totalPages) {
      visible.push(state.currentPage + 1);
    }
    visible.forEach(p => {
      renderSinglePage(p, true);
    });
  }

  function zoomIn() {
    applyZoom(state.zoomLevel + state.zoomStep);
  }

  function zoomOut() {
    applyZoom(state.zoomLevel - state.zoomStep);
  }

  function resetZoom() {
    applyZoom(1.0);
  }

  function toggleViewMode() {
    if (!state.pageFlip) return;
    const curOrientation = state.pageFlip.getOrientation();
    const newOrientation = curOrientation === 'portrait' ? 'landscape' : 'portrait';
    state.pageFlip.updateOrientation(newOrientation);
    dom.btnViewMode.classList.toggle('active', newOrientation === 'portrait');
    showLoadingToast(newOrientation === 'portrait' ? 'โหมด 1 หน้า (Single Page)' : 'โหมด 2 หน้า (Book Spread)', 1800);
  }

  /* --------------------------------------------------------------------------
     9. Thumbnails Drawer with Lazy Loading (IntersectionObserver)
     -------------------------------------------------------------------------- */
  function setupThumbnailsDrawer() {
    dom.thumbnailsTrack.innerHTML = '';
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const pageNum = parseInt(card.dataset.page, 10);
          renderThumbnailCanvas(card, pageNum);
          observer.unobserve(card);
        }
      });
    }, { root: dom.thumbnailsTrack, rootMargin: '100px' });

    for (let i = 1; i <= state.totalPages; i++) {
      const card = document.createElement('div');
      card.className = `thumb-card ${i === state.currentPage ? 'active' : ''}`;
      card.dataset.page = i;
      card.id = `thumb-card-${i}`;
      card.innerHTML = `
        <canvas class="thumb-canvas" id="thumb-canvas-${i}"></canvas>
        <span class="thumb-badge">${i}</span>
      `;
      card.addEventListener('click', () => {
        jumpToPage(i);
        closeAllDrawers();
      });
      dom.thumbnailsTrack.appendChild(card);
      observer.observe(card);
    }
  }

  async function renderThumbnailCanvas(card, pageNum) {
    const canvas = card.querySelector('.thumb-canvas');
    if (!canvas) return;

    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.25 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      console.warn('Thumb render error', e);
    }
  }

  function updateActiveThumbnail(activePage) {
    const prev = dom.thumbnailsTrack.querySelector('.thumb-card.active');
    if (prev) prev.classList.remove('active');

    const cur = document.getElementById(`thumb-card-${activePage}`);
    if (cur) {
      cur.classList.add('active');
      if (dom.drawerThumbnails.classList.contains('open')) {
        cur.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }

  /* --------------------------------------------------------------------------
     10. Table of Contents (PDF Outline / Real PDF TOC)
     -------------------------------------------------------------------------- */
  async function loadTableOfContents() {
    if (window.FLIPBOOK_TOC && window.FLIPBOOK_TOC.length > 0) {
      state.tocItems = window.FLIPBOOK_TOC;
      updateTocPillCounts();
      renderTableOfContents();
      setupTocListeners();
      return;
    }

    dom.tocList.innerHTML = '';
    let outline = null;
    try {
      outline = await state.pdfDoc.getOutline();
    } catch (e) {}

    if (outline && outline.length > 1) {
      renderOutlineTree(outline, dom.tocList);
    } else {
      // Smart Fallback Milestones for 569 Pages
      const milestones = [
        { title: 'หน้าปก (Cover)', page: 1, docPage: 'ปก', type: 'cover' },
        { title: 'คำนำ (หน้า ก)', page: 2, docPage: 'ก', type: 'preface' },
        { title: 'สารบัญ (หน้า ข)', page: 3, docPage: 'ข', type: 'toc' },
        { title: 'ช่วงหน้า 50', page: 50, docPage: 33, type: 'section' },
        { title: 'ช่วงหน้า 100', page: 100, docPage: 83, type: 'section' },
        { title: 'ช่วงหน้า 150', page: 150, docPage: 133, type: 'section' },
        { title: 'ช่วงหน้า 200', page: 200, docPage: 183, type: 'section' },
        { title: 'ช่วงหน้า 250', page: 250, docPage: 233, type: 'section' },
        { title: 'ช่วงหน้า 300', page: 300, docPage: 283, type: 'section' },
        { title: 'ช่วงหน้า 350', page: 350, docPage: 333, type: 'section' },
        { title: 'ช่วงหน้า 400', page: 400, docPage: 383, type: 'section' },
        { title: 'ช่วงหน้า 450', page: 450, docPage: 433, type: 'section' },
        { title: 'ช่วงหน้า 500', page: 500, docPage: 483, type: 'section' },
        { title: 'ช่วงหน้า 550', page: 550, docPage: 533, type: 'section' },
        { title: 'หน้าสุดท้าย (Back Cover)', page: state.totalPages, docPage: 552, type: 'cover' }
      ];
      state.tocItems = milestones;
      updateTocPillCounts();
      renderTableOfContents();
      setupTocListeners();
    }
  }

  function updateTocPillCounts() {
    if (!state.tocItems || !dom.filterPills) return;
    const totalCount = state.tocItems.length;
    const kpiCount = state.tocItems.filter(i => i.type === 'kpi').length;
    const okrCount = state.tocItems.filter(i => i.type === 'okr').length;

    dom.filterPills.forEach(pill => {
      const f = pill.dataset.filter;
      if (f === 'all') pill.textContent = `ทั้งหมด (${totalCount})`;
      if (f === 'kpi') pill.textContent = `เฉพาะ KPI (${kpiCount})`;
      if (f === 'okr') pill.textContent = `เฉพาะ OKR (${okrCount})`;
    });
  }

  function renderTableOfContents() {
    dom.tocList.innerHTML = '';
    const query = (state.tocSearchQuery || '').toLowerCase().trim();
    const filter = state.tocFilter || 'all';

    const filtered = (state.tocItems || []).filter(item => {
      // Filter category
      if (filter === 'kpi' && item.type !== 'kpi') return false;
      if (filter === 'okr' && item.type !== 'okr') return false;
      if (filter === 'intro' && !['cover', 'preface', 'toc'].includes(item.type)) return false;

      // Filter search (matches title, printed page, or PDF page)
      if (query) {
        const matchTitle = (item.title || '').toLowerCase().includes(query);
        const matchPdfPage = String(item.page).includes(query);
        const matchDocPage = String(item.docPage || '').includes(query);
        return matchTitle || matchPdfPage || matchDocPage;
      }
      return true;
    });

    if (filtered.length === 0) {
      dom.tocList.innerHTML = `
        <div class="toc-empty">
          ไม่พบรายการที่ตรงกับ "${state.tocSearchQuery}"
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(item => {
      const li = document.createElement('li');
      const isActive = item.page === state.currentPage;
      li.className = `toc-item ${isActive ? 'active' : ''}`;
      li.dataset.page = item.page;

      let badgeClass = 'badge-kpi';
      let badgeText = 'KPI';
      if (item.type === 'okr') {
        badgeClass = 'badge-okr';
        badgeText = 'OKR';
      } else if (['cover', 'preface', 'toc', 'section'].includes(item.type)) {
        badgeClass = 'badge-intro';
        badgeText = item.type === 'cover' ? 'ปก' : (item.type === 'preface' ? 'คำนำ' : (item.type === 'toc' ? 'สารบัญ' : 'หมวด'));
      }

      const displayPage = item.docPage !== undefined ? `น. ${item.docPage}` : `น. ${item.page}`;
      const pageTooltip = item.docPage !== undefined 
        ? `หน้าในเล่ม: ${item.docPage} (หน้า PDF: ${item.page})` 
        : `หน้า: ${item.page}`;

      li.innerHTML = `
        <div class="toc-item-left">
          <span class="toc-type-badge ${badgeClass}">${badgeText}</span>
          <span class="toc-item-title">${item.title}</span>
        </div>
        <span class="toc-item-page" title="${pageTooltip}">${displayPage}</span>
      `;

      li.addEventListener('click', () => {
        jumpToPage(item.page);
        closeAllDrawers();
        const pageLabel = item.docPage !== undefined ? `หน้า ${item.docPage}` : `หน้า ${item.page}`;
        showLoadingToast(`ไปยัง: ${item.title} (${pageLabel})`, 2000);
      });

      fragment.appendChild(li);
    });

    dom.tocList.appendChild(fragment);
  }

  function setupTocListeners() {
    if (dom.tocSearch && !dom.tocSearch.dataset.bound) {
      dom.tocSearch.dataset.bound = 'true';
      dom.tocSearch.addEventListener('input', (e) => {
        state.tocSearchQuery = e.target.value;
        if (dom.tocSearchClear) {
          dom.tocSearchClear.style.display = state.tocSearchQuery ? 'block' : 'none';
        }
        renderTableOfContents();
      });

      if (dom.tocSearchClear) {
        dom.tocSearchClear.addEventListener('click', () => {
          dom.tocSearch.value = '';
          state.tocSearchQuery = '';
          dom.tocSearchClear.style.display = 'none';
          renderTableOfContents();
          dom.tocSearch.focus();
        });
      }
    }

    if (dom.filterPills) {
      dom.filterPills.forEach(pill => {
        if (!pill.dataset.bound) {
          pill.dataset.bound = 'true';
          pill.addEventListener('click', () => {
            dom.filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            state.tocFilter = pill.dataset.filter;
            renderTableOfContents();
          });
        }
      });
    }
  }

  function updateActiveTocItem(pageNum) {
    const prev = dom.tocList.querySelector('.toc-item.active');
    if (prev) prev.classList.remove('active');

    const cur = dom.tocList.querySelector(`.toc-item[data-page="${pageNum}"]`);
    if (cur) {
      cur.classList.add('active');
      if (dom.drawerToc && dom.drawerToc.classList.contains('open')) {
        cur.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function renderOutlineTree(items, parentEl) {
    items.forEach(async (item) => {
      const li = document.createElement('li');
      li.className = 'toc-item';
      let targetPage = 1;

      if (typeof item.dest === 'string') {
        const dest = await state.pdfDoc.getDestination(item.dest);
        if (dest) {
          const refIndex = await state.pdfDoc.getPageIndex(dest[0]);
          targetPage = refIndex + 1;
        }
      } else if (Array.isArray(item.dest) && item.dest[0]) {
        const refIndex = await state.pdfDoc.getPageIndex(item.dest[0]);
        targetPage = refIndex + 1;
      }

      li.innerHTML = `
        <div class="toc-item-left">
          <span class="toc-type-badge badge-intro">หัวข้อ</span>
          <span class="toc-item-title">${item.title}</span>
        </div>
        <span class="toc-item-page">น. ${targetPage}</span>
      `;
      li.addEventListener('click', () => {
        jumpToPage(targetPage);
        closeAllDrawers();
      });
      parentEl.appendChild(li);

      if (item.items && item.items.length > 0) {
        const subList = document.createElement('ul');
        subList.className = 'toc-list';
        subList.style.paddingLeft = '16px';
        renderOutlineTree(item.items, subList);
        parentEl.appendChild(subList);
      }
    });
  }

  /* --------------------------------------------------------------------------
     11. Bookmarks & Notes System
     -------------------------------------------------------------------------- */
  function loadBookmarks() {
    try {
      const saved = localStorage.getItem(state.storageKey);
      state.bookmarks = saved ? JSON.parse(saved) : [];
    } catch (e) {
      state.bookmarks = [];
    }
    renderBookmarksList();
  }

  function saveBookmarks() {
    try {
      localStorage.setItem(state.storageKey, JSON.stringify(state.bookmarks));
    } catch (e) {}
  }

  function addBookmark(note) {
    const page = state.currentPage;
    const existingIndex = state.bookmarks.findIndex(b => b.page === page);
    const title = note.trim() || `หน้าที่คั่นไว้ (${page})`;

    if (existingIndex >= 0) {
      state.bookmarks[existingIndex].title = title;
    } else {
      state.bookmarks.push({ page, title, date: new Date().toLocaleDateString('th-TH') });
      state.bookmarks.sort((a, b) => a.page - b.page);
    }

    saveBookmarks();
    renderBookmarksList();
    showLoadingToast(`คั่นหน้า ${page} แล้ว`, 2000);
  }

  function removeBookmark(page) {
    state.bookmarks = state.bookmarks.filter(b => b.page !== page);
    saveBookmarks();
    renderBookmarksList();
  }

  function renderBookmarksList() {
    dom.bookmarksList.innerHTML = '';
    if (state.bookmarks.length === 0) {
      dom.bookmarksList.innerHTML = `
        <div class="empty-state">
          ยังไม่มีที่คั่นหน้า<br>คลิก "คั่นหน้านี้" เพื่อบันทึกหน้าสำคัญ
        </div>
      `;
      return;
    }

    state.bookmarks.forEach(bm => {
      const li = document.createElement('li');
      li.className = 'bookmark-item';
      li.innerHTML = `
        <div class="bookmark-meta">
          <span class="bookmark-title">${bm.title}</span>
          <span class="bookmark-page">หน้า ${bm.page} • ${bm.date}</span>
        </div>
        <button class="btn-delete-bookmark" title="ลบที่คั่นหน้านี้" aria-label="ลบที่คั่นหน้า">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;

      li.querySelector('.bookmark-meta').addEventListener('click', () => {
        jumpToPage(bm.page);
        closeAllDrawers();
      });

      li.querySelector('.btn-delete-bookmark').addEventListener('click', (e) => {
        e.stopPropagation();
        removeBookmark(bm.page);
      });

      dom.bookmarksList.appendChild(li);
    });
  }

  /* --------------------------------------------------------------------------
     12. Auto-Play Slideshow
     -------------------------------------------------------------------------- */
  function toggleAutoPlay() {
    state.isAutoPlaying = !state.isAutoPlaying;
    dom.btnAutoPlay.classList.toggle('active', state.isAutoPlaying);

    if (state.isAutoPlaying) {
      showLoadingToast('เริ่มเล่นอัตโนมัติ (Auto-flip)', 1800);
      state.autoPlayTimer = setInterval(() => {
        if (state.currentPage >= state.totalPages) {
          toggleAutoPlay(); // Stop at end
        } else {
          flipNext();
        }
      }, state.autoPlayInterval);
    } else {
      clearInterval(state.autoPlayTimer);
      state.autoPlayTimer = null;
      showLoadingToast('หยุดเล่นอัตโนมัติ', 1500);
    }
  }

  /* --------------------------------------------------------------------------
     13. Zen Mode & Auto-Hide Controls
     -------------------------------------------------------------------------- */
  function resetZenTimer() {
    if (state.isZenMode) {
      state.isZenMode = false;
      dom.topBar.classList.remove('zen-hidden');
      dom.bottomDock.classList.remove('zen-hidden');
    }

    clearTimeout(state.zenTimer);
    state.zenTimer = setTimeout(() => {
      // Auto-hide only if no drawer or modal is open
      const hasOpenDrawer = document.querySelector('.drawer.open, .modal-overlay.open');
      if (!hasOpenDrawer) {
        state.isZenMode = true;
        dom.topBar.classList.add('zen-hidden');
        dom.bottomDock.classList.add('zen-hidden');
      }
    }, 4500);
  }

  /* --------------------------------------------------------------------------
     14. Drawers & Modals Controller
     -------------------------------------------------------------------------- */
  function toggleDrawer(drawerEl, triggerBtn) {
    const isOpen = drawerEl.classList.contains('open');
    closeAllDrawers();

    if (!isOpen) {
      drawerEl.classList.add('open');
      dom.drawerBackdrop.classList.add('open');
      if (triggerBtn) triggerBtn.classList.add('active');

      if (drawerEl === dom.drawerThumbnails) {
        const activeCard = document.getElementById(`thumb-card-${state.currentPage}`);
        if (activeCard) {
          setTimeout(() => activeCard.scrollIntoView({ behavior: 'smooth', inline: 'center' }), 100);
        }
      }
    }
  }

  function closeAllDrawers() {
    document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
    dom.drawerBackdrop.classList.remove('open');
    dom.btnToc.classList.remove('active');
    dom.btnThumbnails.classList.remove('active');
    dom.btnBookmarks.classList.remove('active');
    dom.themeMenu.classList.remove('open');
  }

  /* --------------------------------------------------------------------------
     15. User Interactions & Event Handlers
     -------------------------------------------------------------------------- */
  function bindUserInteractions() {
    // Navigation
    dom.btnPrev.addEventListener('click', flipPrev);
    dom.btnNext.addEventListener('click', flipNext);
    dom.btnPrevFloating.addEventListener('click', flipPrev);
    dom.btnNextFloating.addEventListener('click', flipNext);

    // Page input
    dom.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = parseInt(dom.pageInput.value, 10);
        if (!isNaN(val)) jumpToPage(val);
      }
    });
    dom.pageInput.addEventListener('change', () => {
      const val = parseInt(dom.pageInput.value, 10);
      if (!isNaN(val)) jumpToPage(val);
    });

    // Slider scrubbing
    dom.pageSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      dom.sliderTooltip.textContent = `หน้า ${val}`;
      dom.sliderTooltip.style.left = `${((val - 1) / (state.totalPages - 1)) * 100}%`;
    });

    dom.pageSlider.addEventListener('change', (e) => {
      jumpToPage(parseInt(e.target.value, 10));
    });

    // Zoom & View Mode
    dom.btnZoomIn.addEventListener('click', zoomIn);
    dom.btnZoomOut.addEventListener('click', zoomOut);
    dom.btnZoomReset.addEventListener('click', resetZoom);
    if (dom.zoomLevelText) {
      dom.zoomLevelText.addEventListener('click', resetZoom);
    }
    if (dom.btnViewMode) {
      dom.btnViewMode.addEventListener('click', toggleViewMode);
    }

    // Double click to zoom / reset (Desktop)
    dom.bookViewport.addEventListener('dblclick', () => {
      if (state.zoomLevel > 1.0) resetZoom();
      else applyZoom(1.5);
    });

    // Mobile double-tap zoom
    let lastTapTime = 0;
    dom.bookViewport.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1 && !state.isPanning) {
        const now = Date.now();
        if (now - lastTapTime < 320) {
          if (state.zoomLevel > 1.0) resetZoom();
          else applyZoom(1.5);
          lastTapTime = 0;
        } else {
          lastTapTime = now;
        }
      }
    }, { passive: true });

    // Drag to pan when zoomed (Mouse)
    dom.bookViewport.addEventListener('mousedown', (e) => {
      if (state.zoomLevel > 1.0) {
        state.isPanning = true;
        state.startX = e.clientX - state.panX;
        state.startY = e.clientY - state.panY;
        dom.bookViewport.classList.add('is-dragging');
      }
    });

    window.addEventListener('mousemove', (e) => {
      resetZenTimer();
      if (state.isPanning && state.zoomLevel > 1.0) {
        state.panX = e.clientX - state.startX;
        state.panY = e.clientY - state.startY;
        dom.bookViewport.style.transform = `scale(${state.zoomLevel}) translate(${state.panX}px, ${state.panY}px)`;
      }
    });

    window.addEventListener('mouseup', () => {
      state.isPanning = false;
      dom.bookViewport.classList.remove('is-dragging');
    });

    // Touch drag to pan when zoomed (Mobile)
    dom.bookViewport.addEventListener('touchstart', (e) => {
      if (state.zoomLevel > 1.0 && e.touches.length === 1) {
        state.isPanning = true;
        state.startX = e.touches[0].clientX - state.panX;
        state.startY = e.touches[0].clientY - state.panY;
        dom.bookViewport.classList.add('is-dragging');
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      resetZenTimer();
      if (state.isPanning && state.zoomLevel > 1.0 && e.touches.length === 1) {
        state.panX = e.touches[0].clientX - state.startX;
        state.panY = e.touches[0].clientY - state.startY;
        dom.bookViewport.style.transform = `scale(${state.zoomLevel}) translate(${state.panX}px, ${state.panY}px)`;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      state.isPanning = false;
      dom.bookViewport.classList.remove('is-dragging');
    });

    // Drawers
    dom.btnToc.addEventListener('click', () => toggleDrawer(dom.drawerToc, dom.btnToc));
    dom.btnThumbnails.addEventListener('click', () => toggleDrawer(dom.drawerThumbnails, dom.btnThumbnails));
    dom.btnBookmarks.addEventListener('click', () => toggleDrawer(dom.drawerBookmarks, dom.btnBookmarks));
    dom.drawerBackdrop.addEventListener('click', closeAllDrawers);

    document.querySelectorAll('.drawer-close-btn').forEach(btn => {
      btn.addEventListener('click', closeAllDrawers);
    });

    // Bookmarks form
    dom.btnAddBookmark.addEventListener('click', () => {
      addBookmark(dom.bookmarkInput.value);
      dom.bookmarkInput.value = '';
    });
    dom.bookmarkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        addBookmark(dom.bookmarkInput.value);
        dom.bookmarkInput.value = '';
      }
    });

    // Sound toggle
    dom.btnSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      dom.btnSound.classList.toggle('active', state.soundEnabled);
      updateSoundIcon();
      localStorage.setItem('flipbook_sound', state.soundEnabled);
      showLoadingToast(state.soundEnabled ? 'เปิดเสียงเปิดหน้า' : 'ปิดเสียง', 1500);
    });

    // Auto Play
    dom.btnAutoPlay.addEventListener('click', toggleAutoPlay);

    // Fullscreen
    dom.btnFullscreen.addEventListener('click', toggleFullscreen);

    // Theme selector
    dom.btnTheme.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.themeMenu.classList.toggle('open');
    });

    document.querySelectorAll('.theme-option').forEach(opt => {
      opt.addEventListener('click', () => {
        setTheme(opt.dataset.theme);
        dom.themeMenu.classList.remove('open');
      });
    });

    // Shortcuts modal
    dom.btnHelp.addEventListener('click', () => dom.modalShortcuts.classList.add('open'));
    dom.modalCloseBtn.addEventListener('click', () => dom.modalShortcuts.classList.remove('open'));
    dom.modalShortcuts.addEventListener('click', (e) => {
      if (e.target === dom.modalShortcuts) dom.modalShortcuts.classList.remove('open');
    });

    // Download
    dom.btnDownload.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = state.loadedPdfUrl || 'doc.pdf';
      a.download = 'เล่ม.pdf';
      a.click();
    });

    // Keyboard Shortcuts (UI/UX Pro Max WCAG 2.2 Standard)
    window.addEventListener('keydown', handleKeyboardShortcuts);

    // Window Resize
    window.addEventListener('resize', debounce(() => {
      calculatePageDimensions();
      if (state.pageFlip) {
        state.pageFlip.update();
      }
    }, 200));

    // Drag and Drop PDF File Fallback
    setupDropzone();
  }

  function handleKeyboardShortcuts(e) {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    switch (e.key) {
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        flipPrev();
        break;
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault();
        flipNext();
        break;
      case 'Home':
        e.preventDefault();
        jumpToPage(1);
        break;
      case 'End':
        e.preventDefault();
        jumpToPage(state.totalPages);
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 't':
      case 'T':
        e.preventDefault();
        toggleDrawer(dom.drawerThumbnails, dom.btnThumbnails);
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        toggleDrawer(dom.drawerToc, dom.btnToc);
        break;
      case 'b':
      case 'B':
        e.preventDefault();
        toggleDrawer(dom.drawerBookmarks, dom.btnBookmarks);
        break;
      case ' ':
        e.preventDefault();
        toggleAutoPlay();
        break;
      case '+':
      case '=':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
      case '_':
        e.preventDefault();
        zoomOut();
        break;
      case '0':
        e.preventDefault();
        resetZoom();
        break;
      case 'Escape':
        closeAllDrawers();
        dom.modalShortcuts.classList.remove('open');
        resetZoom();
        break;
    }
  }

  /* --------------------------------------------------------------------------
     16. Theme & Local Storage Settings
     -------------------------------------------------------------------------- */
  function loadSavedSettings() {
    const savedTheme = localStorage.getItem('flipbook_theme') || 'obsidian';
    setTheme(savedTheme);

    const savedSound = localStorage.getItem('flipbook_sound');
    if (savedSound !== null) {
      state.soundEnabled = savedSound === 'true';
      dom.btnSound.classList.toggle('active', state.soundEnabled);
      updateSoundIcon();
    }

    loadBookmarks();
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('flipbook_theme', theme);
  }

  function updateSoundIcon() {
    dom.btnSound.innerHTML = state.soundEnabled ? `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    ` : `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>
    `;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      dom.btnFullscreen.classList.add('active');
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      dom.btnFullscreen.classList.remove('active');
    }
  }

  /* --------------------------------------------------------------------------
     17. Drag-and-Drop & File Picker Handler (CORS-Proof)
     -------------------------------------------------------------------------- */
  function setupDropzone() {
    const dropCard = document.querySelector('.dropzone-card');

    dropCard.addEventListener('click', (e) => {
      // Don't trigger duplicate click if user clicked fileInput directly
      if (e.target !== dom.fileInput) {
        dom.fileInput.click();
      }
    });

    dom.fileInput.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        processUploadedFile(e.target.files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      window.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropCard.classList.add('drag-over');
      });
    });

    ['dragleave'].forEach(eventName => {
      window.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropCard.classList.remove('drag-over');
      });
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropCard.classList.remove('drag-over');
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        processUploadedFile(dt.files[0]);
      }
    });
  }

  function processUploadedFile(file) {
    const isPdf = (file.type && file.type === 'application/pdf') || 
                  (file.name && file.name.toLowerCase().endsWith('.pdf'));
    if (!isPdf) {
      alert('กรุณาเลือกไฟล์เอกสาร PDF เท่านั้น');
      return;
    }

    if (dom.docTitle) {
      dom.docTitle.textContent = file.name;
    }

    showLoadingToast(`กำลังอ่านไฟล์ ${file.name}...`);
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const typedArray = new Uint8Array(e.target.result);
        await loadPdfDocument(typedArray);
      } catch (err) {
        alert('เกิดข้อผิดพลาดในการเปิดไฟล์ PDF: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* --------------------------------------------------------------------------
     18. Toast Notification Utility
     -------------------------------------------------------------------------- */
  function hideLoadingToast() {
    const toast = document.getElementById('app-toast');
    if (toast) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
    }
  }

  function showLoadingToast(msg, duration = 3000) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 84px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(15, 23, 42, 0.95);
        color: #ffffff;
        padding: 8px 18px;
        border-radius: 9999px;
        font-size: 14px;
        font-weight: 500;
        border: 1px solid rgba(255,255,255,0.15);
        backdrop-filter: blur(12px);
        box-shadow: 0 10px 25px rgba(0,0,0,0.4);
        z-index: 999;
        opacity: 0;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }

    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, duration);
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Launch on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApplication);
  } else {
    initApplication();
  }

})();
