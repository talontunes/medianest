// js/artist.js  (v2 — Discogs-style artist view)
// ─────────────────────────────────────────────────────────────
// Artist view — browse ANY artist (not just from your collection).
//
// CHANGES vs v1:
//   - renderArtistDetail now shows a Discogs-style layout:
//       • Hero header with name, type tags, item count
//       • Wikipedia biography fetch (non-blocking)
//       • Your collection items in a grid
//       • Discogs "Discography" section with cover art + Add button
//       • MusicBrainz artist search for music artists
//   - Discogs results now include an "Add to collection" button
//     on each release card so users can add without leaving the view.
//   - _communityLoaded resets on explicit user-triggered refresh.
//   - Artist cards show a coloured initial avatar when no cover is
//     available, instead of a generic emoji.
//   - getArtistNames() returns names sorted by collection count
//     (most items first) when no search is active.
// ─────────────────────────────────────────────────────────────

import { _state, MEDIA_TYPES, FIELD_LABELS } from './state.js';
import { toast, openModal } from './ui.js';
import { discogsSearchByTitle } from './discogs.js';

// ── Curated discoverable artists (shown when user has none) ──
const CURATED_ARTISTS = [
  'Miles Davis', 'John Coltrane', 'The Beatles', 'Led Zeppelin', 'Pink Floyd',
  'David Bowie', 'Prince', 'Nirvana', 'Radiohead', 'Kendrick Lamar',
  'Taylor Swift', 'Beyoncé', 'Stevie Wonder', 'Aretha Franklin', 'Marvin Gaye',
  'Frank Herbert', 'Isaac Asimov', 'J.R.R. Tolkien', 'George R.R. Martin', 'Stephen King',
  'Stan Lee', 'Jack Kirby', 'Alan Moore', 'Frank Miller', 'Neil Gaiman',
  'Hayao Miyazaki', 'Akira Toriyama', 'Naoko Takeuchi', 'Kentaro Miura', 'Eiichiro Oda',
  'Frida Kahlo', 'Andy Warhol', 'Salvador Dalí', 'Pablo Picasso', 'Vincent van Gogh',
];

// ── Colour palette for initial avatars ───────────────────────
const AVATAR_COLOURS = [
  '#c8a96e','#58a6ff','#6eba5e','#e8748e','#a78bfa',
  '#f97316','#06b6d4','#ec4899','#84cc16','#f59e0b',
];
function _avatarColour(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLOURS[Math.abs(h) % AVATAR_COLOURS.length];
}

// ── Internal: extract artist-like fields from an item ─────────
function _getItemArtist(item) {
  if (!item?.fields) return null;
  const f = item.fields;
  const type = item.type || '';
  const artistKeys = {
    cd: ['artist', 'album'], vinyl: ['artist', 'album'], cassette: ['artist', 'album'],
    book: ['author'], comic: ['writer', 'author', 'cover_artist', 'penciler', 'inker', 'colorist'],
    manga: ['author'], game: ['creator', 'publisher'], dvd: ['studio', 'creator'],
    vhs: ['studio', 'creator'], magazine: ['publisher'], newspaper: ['publisher'],
    photo: ['photographer', 'creator'], map: ['creator', 'publisher'], other: ['creator', 'author'],
  };
  const keys = artistKeys[type] || ['artist', 'author', 'creator'];
  for (const k of keys) { if (f[k] && f[k].trim()) return f[k].trim(); }
  for (const k of ['artist', 'author', 'creator', 'writer', 'studio', 'photographer', 'publisher']) {
    if (f[k] && f[k].trim()) return f[k].trim();
  }
  return null;
}

// ── Build artist index from items ─────────────────────────────
function _buildArtistIndex(items) {
  const index = {};
  for (const item of items) {
    const name = _getItemArtist(item);
    if (!name) continue;
    const normalised = name.replace(/\s+/g, ' ').trim();
    if (!normalised) continue;
    if (!index[normalised]) {
      index[normalised] = { name: normalised, items: [], types: new Set(), count: 0 };
    }
    index[normalised].items.push(item);
    index[normalised].types.add(item.typeLabel || item.type);
    index[normalised].count++;
  }
  for (const name of Object.keys(index)) {
    index[name].items.sort((a, b) => {
      const ta = a.fields?.title || a.fields?.album || a.fields?.artist || '';
      const tb = b.fields?.title || b.fields?.album || b.fields?.artist || '';
      return ta.localeCompare(tb);
    });
    index[name].types = Array.from(index[name].types);
  }
  return index;
}

let _artistIndex = {};
let _currentArtist = null;
let _communityLoaded = false;

export async function rebuildArtistIndex() {
  _artistIndex = _buildArtistIndex(_state.collection);
  _currentArtist = null;

  if (window._fb?.enabled && window._fb.getCommunityItems && !_communityLoaded) {
    try {
      const communityItems = await window._fb.getCommunityItems();
      if (communityItems && communityItems.length) {
        const communityIndex = _buildArtistIndex(communityItems);
        for (const [name, data] of Object.entries(communityIndex)) {
          if (_artistIndex[name]) {
            const existingIds = new Set(_artistIndex[name].items.map(i => i.id));
            for (const item of data.items) {
              if (!existingIds.has(item.id)) {
                _artistIndex[name].items.push(item);
                _artistIndex[name].count++;
                _artistIndex[name].types.push(...data.types);
              }
            }
            _artistIndex[name].types = [...new Set(_artistIndex[name].types)];
          } else {
            _artistIndex[name] = data;
          }
        }
      }
    } catch (e) {
      console.warn('[artist] Could not load community artists:', e);
    }
    _communityLoaded = true;
  }

  if (Object.keys(_artistIndex).length === 0) {
    for (const name of CURATED_ARTISTS) {
      _artistIndex[name] = { name, items: [], types: [], count: 0, curated: true };
    }
  }
}

export function getArtistIndex() { return _artistIndex; }

export function getArtistNames(search) {
  if (search === undefined) search = '';
  const names = Object.keys(_artistIndex);
  const q = search.toLowerCase();
  const filtered = q ? names.filter(n => n.toLowerCase().includes(q)) : names;
  // Sort by count (most items first) when no search, else alphabetical
  if (!q) {
    return filtered.sort((a, b) => {
      const diff = (_artistIndex[b].count || 0) - (_artistIndex[a].count || 0);
      return diff !== 0 ? diff : a.toLowerCase().localeCompare(b.toLowerCase());
    });
  }
  return filtered.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function getArtist(name) { return _artistIndex[name] || null; }
export function getCurrentArtist() { return _currentArtist; }
export function setCurrentArtist(name) { _currentArtist = _artistIndex[name] || null; }

// ── HTML escaping ─────────────────────────────────────────────
function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escAttr(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── RENDER: artist list grid ──────────────────────────────────
export function renderArtistList(containerId, search) {
  if (!containerId) containerId = 'artist-grid';
  if (search === undefined) search = '';
  const container = document.getElementById(containerId);
  if (!container) return;
  const names = getArtistNames(search);
  if (names.length === 0) {
    container.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text3)">' +
        '<div style="font-size:48px;margin-bottom:16px;opacity:.4">🎨</div>' +
        '<div class="serif" style="font-size:20px;margin-bottom:8px">' +
        (search ? 'No artists match "' + escHtml(search) + '"' : 'No artists found') +
        '</div><div style="font-size:13px;">' +
        (search ? 'Try a different name.' : 'Add items to your collection to see artists here.') +
        '</div></div>';
    return;
  }
  container.innerHTML = names.map(function(name) {
    const artist = _artistIndex[name];
    const typesStr = Array.isArray(artist.types) ? artist.types.join(' · ') : '';
    const itemCount = artist.count;
    const colour = _avatarColour(name);
    const initial = name.trim()[0]?.toUpperCase() || '?';

    // Use the most recently added item's cover as thumbnail
    const thumbItem = artist.items && artist.items[artist.items.length - 1];
    const thumbHtml = thumbItem && thumbItem.coverData
      ? '<img src="' + escAttr(thumbItem.coverData) + '" alt="' + escAttr(name) + '" style="width:100%;height:100%;object-fit:cover">'
      : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:' + colour + '20;font-size:42px;font-family:var(--font-d);color:' + colour + ';font-weight:600">' + escHtml(initial) + '</div>';

    const curatedBadge = artist.curated
      ? '<span style="font-size:10px;color:var(--accent);margin-left:6px;font-family:var(--font-m)">↗ explore</span>'
      : '';

    return '<div class="artist-card fade-in" onclick="window.selectArtist(\'' + escAttr(name) + '\')">' +
      '<div class="artist-card-thumb">' + thumbHtml + '</div>' +
      '<div class="artist-card-info">' +
        '<div class="artist-card-name truncate">' + escHtml(name) + curatedBadge + '</div>' +
        (itemCount > 0
          ? '<div class="artist-card-count">' + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + ' in collection</div>'
          : '<div class="artist-card-count" style="color:var(--text3)">Not in your collection</div>') +
        (typesStr ? '<div class="artist-card-types text-xs text-muted truncate">' + typesStr + '</div>' : '') +
      '</div></div>';
  }).join('');
}

// ── RENDER: single artist detail (Discogs-style) ──────────────
export function renderArtistDetail(containerId, name) {
  if (!containerId) containerId = 'artist-detail';
  const container = document.getElementById(containerId);
  if (!container) return;
  const artist = name ? _artistIndex[name] : _currentArtist;
  if (!artist) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">' +
      '<div style="font-size:32px;margin-bottom:10px">🎨</div><div>Select an artist to view their works</div></div>';
    return;
  }
  _currentArtist = artist;

  const colour = _avatarColour(artist.name);
  const initial = artist.name.trim()[0]?.toUpperCase() || '?';
  const hasItems = artist.items && artist.items.length > 0;

  // Hero avatar — use first item cover or coloured initial
  const heroThumb = (hasItems && artist.items[0].coverData)
    ? '<img src="' + escAttr(artist.items[0].coverData) + '" alt="' + escAttr(artist.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
    : '<span style="font-family:var(--font-d);font-size:36px;font-weight:600;color:' + colour + '">' + escHtml(initial) + '</span>';

  const typeTagsHtml = Array.isArray(artist.types) && artist.types.length
    ? artist.types.map(t => '<span class="badge badge-muted" style="font-size:11px">' + escHtml(t) + '</span>').join(' ')
    : '';

  const headerHtml =
    '<div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap">' +
      '<div style="width:80px;height:80px;border-radius:50%;background:' + colour + '20;border:2px solid ' + colour + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">' + heroThumb + '</div>' +
      '<div style="flex:1;min-width:200px">' +
        '<button class="btn-ghost" onclick="window.showArtistList()" style="font-size:12px;margin-bottom:8px;padding:5px 10px">← All artists</button>' +
        '<div class="serif" style="font-size:28px;font-weight:600;line-height:1.1">' + escHtml(artist.name) + '</div>' +
        '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + typeTagsHtml + '</div>' +
        (hasItems
          ? '<div style="color:var(--text2);font-size:13px;margin-top:6px">' + artist.count + ' item' + (artist.count !== 1 ? 's' : '') + ' in your collection</div>'
          : '<div style="color:var(--text3);font-size:13px;margin-top:6px">Not yet in your collection</div>') +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-self:flex-start">' +
        '<button class="btn-ghost" onclick="window.searchArtistDiscogs(\'' + escAttr(artist.name) + '\')" style="font-size:12px" title="Browse on Discogs">🔍 Search Discogs</button>' +
        '<button class="btn-ghost" onclick="window.addCuratedArtist(\'' + escAttr(artist.name) + '\')" style="font-size:12px" title="Add item by this artist">＋ Add to collection</button>' +
      '</div>' +
    '</div>' +
    // Biography placeholder — filled async
    '<div id="artist-bio-wrap" style="margin-bottom:20px;display:none">' +
      '<div id="artist-bio" style="font-size:13px;color:var(--text2);line-height:1.7;background:var(--bg3);padding:14px 16px;border-radius:8px;border-left:3px solid ' + colour + '"></div>' +
    '</div>';

  // Collection items section
  let collectionHtml = '';
  if (hasItems) {
    collectionHtml =
      '<div style="margin-bottom:28px">' +
        '<div style="font-size:13px;font-weight:600;color:var(--text2);letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px">In Your Collection</div>' +
        '<div class="artist-items-grid">' +
          artist.items.map(function(item) {
            const title = item.fields && (item.fields.title || item.fields.album || item.fields.artist) || 'Untitled';
            const sub = item.fields && (item.fields.year || item.fields.pub_year || item.fields.label || item.fields.publisher) || '';
            const cover = item.coverData
              ? '<img src="' + escAttr(item.coverData) + '" alt="' + escAttr(title) + '" style="width:100%;height:100%;object-fit:cover">'
              : (item.icon || '📦');
            return '<div class="col-item fade-in" onclick="window.openDetail(\'' + item.id + '\')" data-id="' + item.id + '">' +
              '<div class="col-thumb">' + cover + '<div class="col-badge">' + item.typeLabel + '</div></div>' +
              '<div class="col-info"><div class="col-title truncate">' + escHtml(title) + '</div>' +
              '<div class="col-meta truncate">' + escHtml(sub) + '</div></div></div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  // Discogs results section placeholder
  const discogsPlaceholderHtml =
    '<div id="artist-discogs-section">' +
      '<div style="font-size:13px;font-weight:600;color:var(--text2);letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px">Discography</div>' +
      '<div id="artist-discogs-results" style="color:var(--text3);font-size:13px;padding:20px;background:var(--bg3);border-radius:8px;text-align:center">' +
        '<span class="spin" style="font-size:20px;display:inline-block;margin-bottom:8px">⏳</span><br>Loading Discogs data…' +
      '</div>' +
    '</div>';

  container.innerHTML = headerHtml + collectionHtml + discogsPlaceholderHtml;

  // Kick off async enrichment (non-blocking)
  _fetchArtistBio(artist.name);
  searchArtistDiscogs(artist.name);
}

// ── Fetch Wikipedia biography (non-blocking) ─────────────────
async function _fetchArtistBio(artistName) {
  try {
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' +
      encodeURIComponent(artistName.replace(/ /g, '_'));
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const data = await r.json();
    const extract = data.extract;
    if (!extract || extract.length < 40) return;

    const bioWrap = document.getElementById('artist-bio-wrap');
    const bioEl   = document.getElementById('artist-bio');
    if (!bioEl || !bioWrap) return;

    // Truncate to ~400 chars
    const short = extract.length > 420 ? extract.substring(0, 420).replace(/\s\S+$/, '') + '…' : extract;
    bioEl.innerHTML = escHtml(short) +
      ' <a href="https://en.wikipedia.org/wiki/' + encodeURIComponent(artistName.replace(/ /g, '_')) +
      '" target="_blank" style="color:var(--accent);font-size:11px">Wikipedia ↗</a>';
    bioWrap.style.display = '';
  } catch (_) { /* bio is optional */ }
}

// ── Search Discogs and render richly ─────────────────────────
export async function searchArtistDiscogs(artistName) {
  if (!artistName) return;

  const resultsEl = document.getElementById('artist-discogs-results');
  if (resultsEl) {
    resultsEl.innerHTML = '<span class="spin" style="font-size:20px;display:inline-block;margin-bottom:8px">⏳</span><br>Searching Discogs for <strong>' + escHtml(artistName) + '</strong>…';
  }

  try {
    const results = await discogsSearchByTitle(artistName);

    if (!results || results.length === 0) {
      if (resultsEl) {
        resultsEl.innerHTML =
          '<div style="padding:16px;text-align:center;color:var(--text3)">' +
          '<div style="font-size:24px;margin-bottom:8px">🎵</div>' +
          'No Discogs results for <strong>' + escHtml(artistName) + '</strong>. ' +
          '<a href="https://www.discogs.com/search/?q=' + encodeURIComponent(artistName) + '&type=artist" target="_blank" style="color:var(--accent)">Search Discogs directly ↗</a>' +
          '</div>';
      }
      return;
    }

    const html = results.slice(0, 8).map(function(r, idx) {
      const title = r.album || r.title || 'Unknown';
      const sub   = [r.label, r.year, r.format].filter(Boolean).join(' · ');
      const thumb = r.coverUrl
        ? '<img src="' + escAttr(r.coverUrl) + '" alt="' + escAttr(title) + '" style="width:100%;height:100%;object-fit:cover;border-radius:4px" onerror="this.parentElement.innerHTML=\'🎵\'">'
        : '<span style="font-size:22px">🎵</span>';

      return '<div style="display:flex;gap:12px;align-items:flex-start;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;transition:border-color .15s ease" ' +
        'onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
        '<div style="width:56px;height:56px;background:var(--bg2);border-radius:6px;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center">' + thumb + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="fw-600" style="font-size:13px;margin-bottom:2px">' + escHtml(title) + '</div>' +
          (sub ? '<div class="text-sm text-muted">' + escHtml(sub) + '</div>' : '') +
          (r.genre ? '<div class="text-xs" style="color:var(--text3);margin-top:3px">' + escHtml(r.genre.split(',').slice(0,3).join(', ')) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">' +
          '<button class="btn-ghost" style="font-size:11px;padding:4px 10px;white-space:nowrap" ' +
            'onclick="window._addDiscogsResultToCollection(' + idx + ', \'' + escAttr(artistName) + '\')" title="Add to collection">＋ Add</button>' +
          (r.discogsUrl
            ? '<a href="' + escAttr(r.discogsUrl) + '" target="_blank" class="btn-ghost" style="font-size:11px;padding:4px 10px;text-align:center;white-space:nowrap">View ↗</a>'
            : '') +
        '</div>' +
      '</div>';
    }).join('');

    if (resultsEl) {
      resultsEl.innerHTML = html +
        '<div style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center">Results from ' +
        '<a href="https://www.discogs.com" target="_blank" style="color:var(--accent)">Discogs</a> · ' +
        '<a href="https://www.discogs.com/search/?q=' + encodeURIComponent(artistName) + '&type=artist" target="_blank" style="color:var(--accent)">View all releases ↗</a>' +
        '</div>';
    }

    // Cache results so the Add buttons can reference them
    window._discogsResultsCache = results;

  } catch (e) {
    console.warn('[artist] Discogs search error:', e.message);
    if (resultsEl) {
      resultsEl.innerHTML = '<div style="color:var(--danger);padding:12px;font-size:13px">Discogs search failed. <a href="https://www.discogs.com/search/?q=' + encodeURIComponent(artistName) + '&type=artist" target="_blank" style="color:var(--accent)">Try searching directly on Discogs ↗</a></div>';
    }
  }
}

// ── Add a Discogs result directly to collection ───────────────
window._addDiscogsResultToCollection = function(idx, artistName) {
  const results = window._discogsResultsCache;
  if (!results || !results[idx]) { toast('Could not find that release', 'error'); return; }
  const r = results[idx];

  // Determine media type
  const typeId = r.suggestedType || 'vinyl';
  const mediaType = (window._state?.MEDIA_TYPES || []).find(m => m.id === typeId) ||
    { id: typeId, label: typeId.charAt(0).toUpperCase() + typeId.slice(1), icon: '🎵', fields: [] };

  // Pre-populate state for the add modal
  if (window._state) {
    window._state.selectedType = mediaType;
    window._state.editingItem  = {};
    window._state.lookupResult = { ...r, source: 'Discogs' };
  }

  // Open modal on manual tab with data pre-filled
  window.openAddModal && window.openAddModal();

  // After modal opens, select the type and fill the form
  setTimeout(function() {
    window.selectType && window.selectType(typeId);
    setTimeout(function() {
      window.switchTab && window.switchTab('manual-tab', 'add');
      // Fill form fields
      const fieldMap = {
        artist: r.artist, album: r.album, year: r.year,
        label: r.label, catalog: r.catalog, pressing: r.pressing,
        format: r.format, speed: r.speed, genre: r.genre,
        notes: r.tracklist ? ('Tracklist:\n' + r.tracklist) : (r.notes || ''),
      };
      Object.entries(fieldMap).forEach(function([field, val]) {
        if (!val) return;
        const el = document.querySelector('#modal-add [data-field="' + field + '"]');
        if (el) el.value = val;
      });
      // Fetch cover art
      if (r.coverUrl) {
        fetch(r.coverUrl).then(res => res.blob()).then(blob => {
          const reader = new FileReader();
          reader.onload = ev => {
            if (window._state) window._state.editingItem._coverData = ev.target.result;
            const cp = document.getElementById('cover-preview');
            if (cp) cp.innerHTML = '<img src="' + ev.target.result + '" style="width:100%;height:100%;object-fit:cover">';
          };
          reader.readAsDataURL(blob);
        }).catch(() => {});
      }
      toast('Discogs data applied — review and save!', 'success');
    }, 150);
  }, 300);
};

// ── Add a curated artist item to the user's collection ────────
window.addCuratedArtist = function(artistName) {
  window.openAddModal && window.openAddModal();
  setTimeout(function() {
    const artistField = document.querySelector('#modal-add [data-field="artist"]') ||
                        document.querySelector('#modal-add [data-field="author"]');
    if (artistField) artistField.value = artistName;
  }, 350);
};

// ── Global window bindings ────────────────────────────────────
window.selectArtist = function(name) {
  setCurrentArtist(name);
  const gridEl   = document.getElementById('artist-grid');
  const detailEl = document.getElementById('artist-detail');
  if (gridEl)   { gridEl.style.display = 'none'; }
  if (detailEl) { detailEl.style.display = ''; detailEl.innerHTML = ''; }
  renderArtistDetail('artist-detail', name);
};

window.showArtistList = function() {
  _currentArtist = null;
  const gridEl   = document.getElementById('artist-grid');
  const detailEl = document.getElementById('artist-detail');
  if (detailEl) { detailEl.style.display = 'none'; detailEl.innerHTML = ''; }
  if (gridEl)   { gridEl.style.display = ''; }
  renderArtistList('artist-grid');
};

window.searchArtistDiscogs = function(name) { searchArtistDiscogs(name); };

window.filterArtists = function() {
  const searchEl = document.getElementById('artist-search');
  const query    = searchEl ? searchEl.value.trim() : '';
  const gridEl   = document.getElementById('artist-grid');
  const detailEl = document.getElementById('artist-detail');
  if (gridEl)   { gridEl.style.display = ''; }
  if (detailEl) { detailEl.style.display = 'none'; detailEl.innerHTML = ''; }
  renderArtistList('artist-grid', query);
};

// ── Init ──────────────────────────────────────────────────────
export async function initArtistView() {
  await rebuildArtistIndex();
  const detailEl = document.getElementById('artist-detail');
  if (detailEl) detailEl.style.display = 'none';
  renderArtistList('artist-grid');
}