// js/main.js
// ─────────────────────────────────────────────────────────────
// App entry point. Loaded as <script type="module"> AFTER
// firebase.js in index.html. Waits for window._fbReady signal.
//
// FIXES vs original:
//   - Exports openEditItem to window so the Edit button in the
//     detail modal can find it reliably.
//   - Exposes applyLookupResult and applyCoverSearchResult so
//     inline onclick handlers in lookup results work correctly.
// ─────────────────────────────────────────────────────────────

import { loadState }                                from './storage.js';
import { applyTheme, buildThemePickers, toggleThemePicker } from './theme.js';
import { buildMediaGrids, navigate, openAddModal, selectType, backToStep1, openTrade, switchTab, closeModal, openModal, toast } from './ui.js';
import { updateNavForAuth, doLogin, doSignup, logout } from './auth.js';
import { saveItem, deleteItem, setCollectionView, renderCollection, openDetail, openEditItem } from './collection.js';
import { startCamera, stopCamera, captureFrame, handleScanDrop, handleScanFile, handleCoverScanDrop, handleCoverScanFile } from './scanner.js';
import { initArtistView, rebuildArtistIndex } from './artist.js';
import { lookupBarcode, searchBookByTitle, searchMediaByTitle, applyLookupResult, applyCoverSearchResult } from './lookup.js';
import { _state }                                    from './state.js';

// ─────────────────────────────────────────────────────────────
// Expose everything that index.html inline handlers need
// (all onclick="window.X()" attributes route through here)
// ─────────────────────────────────────────────────────────────
window.applyTheme          = applyTheme;
window.toggleThemePicker   = toggleThemePicker;
window.navigate            = navigate;
window.openAddModal        = openAddModal;
window.selectType          = selectType;
window.backToStep1         = backToStep1;
window.switchTab           = switchTab;
window.openModal           = openModal;
window.closeModal          = closeModal;
window.toast               = toast;

window.doLogin             = doLogin;
window.doSignup            = doSignup;
window.logout              = logout;
window.updateNavForAuth    = updateNavForAuth;

window.saveItem            = saveItem;
window.deleteItem          = deleteItem;
window.setCollectionView   = setCollectionView;
window.renderCollection    = renderCollection;
window.openDetail          = openDetail;
window.openEditItem        = openEditItem;   // FIX: was missing
window.openTrade           = openTrade;

window.startCamera         = startCamera;
window.stopCamera          = stopCamera;
window.captureFrame        = captureFrame;
window.handleScanDrop      = handleScanDrop;
window.handleScanFile      = handleScanFile;
window.handleCoverScanDrop = handleCoverScanDrop;
window.handleCoverScanFile = handleCoverScanFile;

window.lookupBarcode           = lookupBarcode;
window.searchBookByTitle       = searchBookByTitle;
window.searchMediaByTitle      = searchMediaByTitle;
window.applyLookupResult       = applyLookupResult;       // FIX: was missing
window.applyCoverSearchResult  = applyCoverSearchResult;  // FIX: was missing

// Artist view
window.initArtistView      = initArtistView;
window.rebuildArtistIndex  = rebuildArtistIndex;

window.renderProfile       = () => import('./ui.js').then(m => m.renderProfile());

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
function initApp() {
  loadState();
  applyTheme(_state.theme || 'dark');
  buildThemePickers();
  buildMediaGrids();

  if (window._fb?.enabled) {
    updateNavForAuth();
  } else {
    updateNavForAuth();
    navigate(_state.user ? 'collection' : 'home');
  }
}

if (window._fbReady) {
  initApp();
} else {
  window._fbReadyCb = initApp;
  setTimeout(() => {
    if (!window._fbReady) {
      window._fbReady = true;
      initApp();
    }
  }, 3000);
}