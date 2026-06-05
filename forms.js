// js/forms.js
// ─────────────────────────────────────────────────────────────
// Manual entry form builder — standard fields + comic specialist form
// ─────────────────────────────────────────────────────────────

import { _state, FIELD_LABELS, COMIC_SPECIAL, CONDITION_OPTIONS, BINDING_OPTIONS } from './state.js';

// Comic tag selection state (reset on each openAddModal call)
export let _comicTagSelected = {};
export function resetComicTags() { _comicTagSelected = {}; }

// ── Main form builder ─────────────────────────────────────────
export function buildManualForm() {
  const mt   = _state.selectedType;
  if (!mt) return;
  const wrap = document.getElementById('manual-form-fields');
  wrap.innerHTML = '';

  // Cover image row (always shown)
  wrap.innerHTML += `
    <div class="form-group">
      <label class="form-label">Cover image (optional)</label>
      <div style="display:flex;gap:10px;align-items:center">
        <div id="cover-preview" style="width:48px;height:64px;background:var(--bg3);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:22px;overflow:hidden;border:1px solid var(--border)">${mt.icon}</div>
        <button class="btn-ghost" onclick="document.getElementById('cover-file').click()" type="button">Upload cover</button>
        <input type="file" id="cover-file" accept="image/*" style="display:none" onchange="window.previewCover(event)">
      </div>
    </div>`;

  if (mt.isComic) { _buildComicForm(wrap); return; }

  // Generic fields
  mt.fields.forEach(f => {
    const label = FIELD_LABELS[f] || f;
    if (f === 'condition') {
      wrap.innerHTML += `
        <div class="form-group">
          <label class="form-label">${label}</label>
          <select class="form-select" data-field="${f}">
            <option value="">— Select —</option>
            ${CONDITION_OPTIONS.map(o => `<option>${o}</option>`).join('')}
          </select>
        </div>`;
    } else if (f === 'binding') {
      wrap.innerHTML += `
        <div class="form-group">
          <label class="form-label">${label}</label>
          <select class="form-select" data-field="${f}">
            <option value="">— Select —</option>
            ${BINDING_OPTIONS.map(o => `<option>${o}</option>`).join('')}
          </select>
        </div>`;
    } else if (f === 'complete') {
      wrap.innerHTML += `
        <div class="form-group">
          <label class="form-label">${label}</label>
          <select class="form-select" data-field="${f}">
            <option>No</option><option>Yes</option>
          </select>
        </div>`;
    } else if (f === 'notes' || f === 'description') {
      wrap.innerHTML += `
        <div class="form-group">
          <label class="form-label">${label}</label>
          <textarea class="form-input" data-field="${f}" rows="2" style="resize:vertical" placeholder="Additional notes…"></textarea>
        </div>`;
    } else {
      wrap.innerHTML += `
        <div class="form-group">
          <label class="form-label">${label}</label>
          <input class="form-input" data-field="${f}" placeholder="${label}">
        </div>`;
    }
  });
}

// ── Comic specialist form ─────────────────────────────────────
function _buildComicForm(wrap) {
  wrap.innerHTML += `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Title</label><input class="form-input" data-field="title" placeholder="Amazing Spider-Man"></div>
      <div class="form-group"><label class="form-label">Issue #</label><input class="form-input" data-field="issue" placeholder="#129"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Publisher</label><input class="form-input" data-field="publisher" placeholder="Marvel Comics"></div>
      <div class="form-group"><label class="form-label">Publication Date</label><input class="form-input" data-field="pub_date" placeholder="Feb 1974"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Writer</label><input class="form-input" data-field="writer"></div>
      <div class="form-group"><label class="form-label">Cover Artist</label><input class="form-input" data-field="cover_artist"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Penciler</label><input class="form-input" data-field="penciler"></div>
      <div class="form-group"><label class="form-label">Inker</label><input class="form-input" data-field="inker"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Edition / Copy Type</label>
      <div class="comic-tags-wrap">
        ${COMIC_SPECIAL.edition_type.map(v =>
          `<div class="comic-tag" data-field="edition_type" data-val="${v}" onclick="window.toggleComicTag(this)">${v}</div>`
        ).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Variant</label>
      <div class="comic-tags-wrap">
        ${COMIC_SPECIAL.variant.map(v =>
          `<div class="comic-tag" data-field="variant" data-val="${v}" onclick="window.toggleComicTag(this)">${v}</div>`
        ).join('')}
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Condition (raw)</label>
        <select class="form-select" data-field="condition">
          <option value="">— Select —</option>
          ${CONDITION_OPTIONS.map(o => `<option>${o}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Printing</label><input class="form-input" data-field="printing" placeholder="1st printing"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Professional Grade</label>
      <div class="comic-tags-wrap">
        ${COMIC_SPECIAL.grade.map(v =>
          `<div class="comic-tag" data-field="grade" data-val="${v}" onclick="window.toggleComicTag(this, 'grade')">${v}</div>`
        ).join('')}
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Graded By</label>
        <select class="form-select" data-field="grader">
          <option value="">Not graded</option>
          ${COMIC_SPECIAL.grader.map(o => `<option>${o}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Newsstand Copy?</label>
        <select class="form-select" data-field="newsstand"><option>No</option><option>Yes</option></select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Signed?</label>
        <select class="form-select" data-field="signed"><option>No</option><option>Yes</option></select>
      </div>
      <div class="form-group"><label class="form-label">Stamp / Sticker</label><input class="form-input" data-field="stamp" placeholder="Convention stamp…"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-input" data-field="notes" rows="2" style="resize:vertical"></textarea>
    </div>`;
}

// ── Comic tag toggle ──────────────────────────────────────────
export function toggleComicTag(el, group) {
  const field = el.dataset.field;
  const val   = el.dataset.val;

  if (field === 'grade' || group === 'grade') {
    // Grade is single-select
    document.querySelectorAll('[data-field="grade"]').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    _comicTagSelected[field] = val;
  } else {
    // Everything else is multi-select
    el.classList.toggle('active');
    if (!_comicTagSelected[field]) _comicTagSelected[field] = [];
    const arr = _comicTagSelected[field];
    const idx = arr.indexOf(val);
    if (idx > -1) arr.splice(idx, 1); else arr.push(val);
  }
}
window.toggleComicTag = toggleComicTag;

// ── Cover image preview ───────────────────────────────────────
export function previewCover(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const el = document.getElementById('cover-preview');
    if (el) el.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover">`;
    _state.editingItem._coverData = ev.target.result;
  };
  reader.readAsDataURL(file);
}
window.previewCover = previewCover;