// ── Inspect Data Tab ─────────────────────────────────────────────────────────
// Tilt stack viewer with bad tilt marking
// Bad tilts stored in:        {project_dir}/inspect_bad_tilts.json
// Lukas W. Bauer und Claude — 2026
// Miss Alignment selections:  {project_dir}/inspect_selections.json
// Stack selection list:        warptools_dir/selected_stacks.txt

// ── Viewer resize ─────────────────────────────────────────────────────────────
function _insResizeViewer(delta){
  var el=document.getElementById('insImgWrap');
  if(!el) return;
  el.style.height=Math.max(150,Math.min(1200,(el.offsetHeight||420)+delta))+'px';
  el.style.flex='none';
}
function _tomResizeViewer(delta){
  var el=document.getElementById('tomImgWrap');
  if(!el) return;
  el.style.height=Math.max(150,Math.min(1200,(el.offsetHeight||420)+delta))+'px';
  el.style.flex='none';
}

var _ins = {
  folder:   '',       // current folder path
  files:    [],       // [{name, path, nSlices, bad:[]}] list of MRC files
  cur:      -1,       // current file index
  slice:    0,        // current slice index
  nSlices:  0,        // total slices in current file
  cmin:     null,     // contrast min
  cmax:     null,     // contrast max
  loading:  false,
  badTilts: {},       // {filename: [sliceIndex, ...]}
  selected: {},       // {filename: true/false} — explicit selection
  prefetch: {},       // {path_index: img element}
  selectionPath: '',  // path to save selected_stacks.txt
};

// ── Sub-tab switching ─────────────────────────────────────────────────────────
function insSubTab(name){
  ['stacks','tomos'].forEach(function(t){
    var btn = document.getElementById('insSub-'+t);
    var pane = document.getElementById('insPane-'+t);
    if(btn) btn.className = 'ins-subtab' + (t===name?' on':'');
    if(pane) pane.style.display = t===name ? 'flex' : 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

var _insInitDone = false;
function insInit(){
  // Load bad tilts from server if project is open
  insLoadBadTilts();
  // Only register event listeners and resize handles once
  if(_insInitDone) return;
  _insInitDone = true;
  // Keyboard shortcuts
  document.addEventListener('keydown', insKeydown);
  // Init resize handles
  insInitResize('insFileListWrap', 'insDivider');
  // Hide controls initially
  insUpdateControls();
}

function insUpdateControls(){
  var hasFile = _ins.cur >= 0;
  var ids = ['insSliceRow','insContrastRow','insNavRow','insBadRow'];
  ids.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.style.display = hasFile ? '' : 'none';
  });
  var wrap = document.getElementById('insImgWrap');
  if(wrap && !hasFile){
    wrap.innerHTML = '<div class="dim" style="font-size:.8rem">Open a tilt stack to begin</div>';
  }
}

async function insLoadBadTilts(){
  if(!curProj) return;
  // Prefill selection path directly from project config (same pattern as warpAutoFill)
  try {
    var c = await api('/api/projects/' + curProj + '/config');
    var el = document.getElementById('insSelectionPath');
    if(c.warptools_dir){
      var path = c.warptools_dir.replace(/\/+$/, '');
      _ins.selectionPath = path;
      if(el) el.value = path;
    } else {
      _ins.selectionPath = '';
      if(el) el.value = '';
    }
    // Autofill tilt stacks folder with warp_tiltseries/ (flat .mrc files post-ts_import)
    var folderEl = document.getElementById('insFolderPath');
    if(folderEl && !folderEl.value && c.warptools_dir){
      folderEl.value = c.warptools_dir.replace(/\/+$/, '') + '/warp_tiltseries';
    }
  } catch(e){}
  try {
    const d = await api('/api/inspect/bad_tilts?project=' + encodeURIComponent(curProj));
    _ins.badTilts = d.bad_tilts || {};
    insRenderFileList();
  } catch(e) { /* no file yet, ok */ }
}

// ── Resizable panel ─────────────────────────────────────────────────────────────
function insInitResize(listId, dividerId){
  var divider = document.getElementById(dividerId);
  var list = document.getElementById(listId);
  if(!divider || !list) return;
  var dragging = false, startX, startW;
  divider.addEventListener('mousedown', function(e){
    dragging = true; startX = e.clientX; startW = list.offsetWidth;
    document.body.style.cursor = 'col-resize'; e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if(!dragging) return;
    var w = Math.max(120, Math.min(400, startW + e.clientX - startX));
    list.style.width = w + 'px'; list.style.flexShrink = '0';
  });
  document.addEventListener('mouseup', function(){ dragging = false; document.body.style.cursor = ''; });
}

// ── Folder selection ──────────────────────────────────────────────────────────

function insSetFolder(path){
  if(!path) return;
  _ins.folder = path;
  document.getElementById('insFolderPath').value = path;
  insLoadFiles();
}

async function insLoadFiles(){
  const folder = _ins.folder;
  if(!folder){ return; }
  document.getElementById('insFileList').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.75rem">Loading...</div>';
  try {
    const d = await api('/api/inspect/list?folder=' + encodeURIComponent(folder));
    _ins.files = d.files || [];
    _ins.cur = -1;
    insRenderFileList();
    if(_ins.files.length > 0) insOpenFile(0);
  } catch(e) {
    document.getElementById('insFileList').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.75rem">Error: ' + e.message + '</div>';
  }
}

function insRenderFileList(){
  const el = document.getElementById('insFileList');
  if(!_ins.files.length){
    el.innerHTML = '<div class="dim" style="padding:.5rem;font-size:.75rem">No MRC files found</div>';
    return;
  }
  // Init selection if empty (all selected by default)
  _ins.files.forEach(function(f){ if(_ins.selected[f.name]===undefined) _ins.selected[f.name]=true; });
  var selCount = _ins.files.filter(function(f){ return _ins.selected[f.name]!==false; }).length;
  var cntEl = document.getElementById('insSelCount');
  if(cntEl) cntEl.textContent = selCount + ' selected · ' + (_ins.files.length-selCount) + ' excluded';
  el.innerHTML = _ins.files.map(function(f, i){
    var isCur = i === _ins.cur;
    var isSel = _ins.selected[f.name] !== false;
    var badSlices = (_ins.badTilts[f.name] || []);
    var hasBad = badSlices.length > 0;
    return '<div class="ins-fitem' + (isCur?' on':'') + (hasBad?' has-bad':'') + (!isSel?' ins-excluded':'') + '" onclick="insOpenFile('+i+')" title="'+f.name+'" style="gap:.3rem">'
      + '<input type="checkbox" '+(isSel?'checked':'')+' onclick="event.stopPropagation();insToggleSelect('+i+',this.checked)" style="flex-shrink:0;cursor:pointer">'
      + '<span class="ins-fname">'+f.name+'</span>'
      + (hasBad ? '<span class="ins-bad-badge">'+badSlices.length+' bad</span>' : '<span class="ins-ok-badge">✓</span>')
      + '</div>';
  }).join('');
}

function insToggleSelect(idx, checked){
  if(idx<0||idx>=_ins.files.length) return;
  _ins.selected[_ins.files[idx].name] = checked;
  insRenderFileList();
}
function insSelectAll(){ _ins.files.forEach(function(f){ _ins.selected[f.name]=true; }); insRenderFileList(); }
function insDeselectAll(){ _ins.files.forEach(function(f){ _ins.selected[f.name]=false; }); insRenderFileList(); }

// ── Open file ─────────────────────────────────────────────────────────────────

async function insOpenFile(idx){
  if(idx < 0 || idx >= _ins.files.length) return;
  _ins.cur = idx;
  _ins.slice = 0;
  _ins.prefetch = {};
  const f = _ins.files[idx];

  insRenderFileList();
  insUpdateControls();
  document.getElementById('insFileName').textContent = f.name;
  document.getElementById('insSliceLabel').textContent = '…';

  try {
    const info = await api('/api/inspect/info?path=' + encodeURIComponent(f.path));
    _ins.nSlices = info.n_slices;
    _ins.cmin = info.p2;   // 2nd percentile as default min
    _ins.cmax = info.p98;  // 98th percentile as default max
    _ins.files[idx].nSlices = info.n_slices;

    // Update UI
    const slider = document.getElementById('insSliceSlider');
    slider.max = Math.max(0, info.n_slices - 1);
    slider.value = 0;
    insUpdateContrastUI();
    insUpdateBadUI();
    insLoadSlice(0);
  } catch(e) {
    document.getElementById('insImgWrap').innerHTML = '<div class="dim" style="padding:1rem">Error loading file</div>';
  }
}

// ── Load slice ────────────────────────────────────────────────────────────────

async function insLoadSlice(idx){
  if(_ins.cur < 0) return;
  const f = _ins.files[_ins.cur];
  _ins.slice = idx;
  _ins.loading = true;

  const sliderEl = document.getElementById('insSliceSlider');
  sliderEl.value = idx;
  const tiltLabel = insGetTiltLabel(idx);
  document.getElementById('insSliceLabel').textContent = `Tilt ${idx + 1} / ${_ins.nSlices}${tiltLabel ? '  (' + tiltLabel + ')' : ''}`;

  insUpdateBadUI();

  const url = `/api/inspect/slice?path=${encodeURIComponent(f.path)}&index=${idx}&cmin=${_ins.cmin}&cmax=${_ins.cmax}`;

  const img = new Image();
  img.onload = () => {
    const wrap = document.getElementById('insImgWrap');
    wrap.innerHTML = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;border-radius:4px;';
    wrap.appendChild(img);
    _ins.loading = false;
    // Prefetch neighbours ±3 — browser caches JPEGs via Cache-Control max-age=120
    [-3,-2,-1,1,2,3].forEach(function(d){ insPrefetch(idx+d); });
  };
  img.onerror = () => {
    document.getElementById('insImgWrap').innerHTML = '<div class="dim" style="padding:1rem;text-align:center">Could not load slice</div>';
    _ins.loading = false;
  };

  // Use prefetch cache if available
  const key = f.path + '_' + idx;
  if(_ins.prefetch[key]){
    img.src = _ins.prefetch[key].src;
  } else {
    img.src = url;
  }
}

function insPrefetch(idx){
  if(idx < 0 || idx >= _ins.nSlices || _ins.cur < 0) return;
  const f = _ins.files[_ins.cur];
  const key = f.path + '_' + idx;
  if(_ins.prefetch[key]) return;
  const url = `/api/inspect/slice?path=${encodeURIComponent(f.path)}&index=${idx}&cmin=${_ins.cmin}&cmax=${_ins.cmax}`;
  const img = new Image();
  img.src = url;
  _ins.prefetch[key] = img;
}

// ── Tilt label (from tomostar if available) ───────────────────────────────────

function insGetTiltLabel(idx){
  if(_ins.cur < 0) return '';
  // Could be enhanced to read tomostar tilt angles
  return '';
}

// ── Navigation ────────────────────────────────────────────────────────────────

function insPrevSlice(){
  if(_ins.slice > 0) insLoadSlice(_ins.slice - 1);
}
function insNextSlice(){
  if(_ins.slice < _ins.nSlices - 1) insLoadSlice(_ins.slice + 1);
}
function insPrevFile(){
  if(_ins.cur > 0) insOpenFile(_ins.cur - 1);
}
function insNextFile(){
  if(_ins.cur < _ins.files.length - 1) insOpenFile(_ins.cur + 1);
}
function insOnSlider(val){
  insLoadSlice(parseInt(val));
}

// ── Contrast ──────────────────────────────────────────────────────────────────

function insUpdateContrastUI(){
  const f = _ins.files[_ins.cur];
  if(!f) return;
  const mn = document.getElementById('insContrastMin');
  const mx = document.getElementById('insContrastMax');
  if(mn) mn.value = _ins.cmin !== null ? _ins.cmin.toFixed(1) : '';
  if(mx) mx.value = _ins.cmax !== null ? _ins.cmax.toFixed(1) : '';
}

function insApplyContrast(){
  const mn = parseFloat(document.getElementById('insContrastMin').value);
  const mx = parseFloat(document.getElementById('insContrastMax').value);
  if(!isNaN(mn)) _ins.cmin = mn;
  if(!isNaN(mx)) _ins.cmax = mx;
  _ins.prefetch = {};  // clear prefetch cache when contrast changes
  insLoadSlice(_ins.slice);
}

// ── Bad tilt marking ──────────────────────────────────────────────────────────

function insUpdateBadUI(){
  if(_ins.cur < 0) return;
  const f = _ins.files[_ins.cur];
  const bad = _ins.badTilts[f.name] || [];
  const isBad = bad.includes(_ins.slice);
  const btn = document.getElementById('insBadBtn');
  const cnt = document.getElementById('insBadCount');
  if(btn){
    btn.textContent = isBad ? '✓ Marked Bad' : 'Mark Bad';
    btn.style.background = isBad ? 'rgba(239,68,68,.25)' : '';
    btn.style.borderColor = isBad ? 'rgba(239,68,68,.6)' : '';
    btn.style.color = isBad ? '#f87171' : '';
  }
  if(cnt) cnt.textContent = bad.length + ' bad tilt' + (bad.length !== 1 ? 's' : '') + ' in this stack';
}

function insToggleBad(){
  if(_ins.cur < 0) return;
  const f = _ins.files[_ins.cur];
  if(!_ins.badTilts[f.name]) _ins.badTilts[f.name] = [];
  const arr = _ins.badTilts[f.name];
  const idx = arr.indexOf(_ins.slice);
  if(idx >= 0) arr.splice(idx, 1);
  else arr.push(_ins.slice);
  // Sort for consistency
  arr.sort((a, b) => a - b);
  if(arr.length === 0) delete _ins.badTilts[f.name];
  insUpdateBadUI();
  insRenderFileList();
  insSaveBadTilts();
}

// ── Mark a range of tilts as bad ─────────────────────────────────────────────
// Input: "1-6, 30-32" → marks tilts 1,2,3,4,5,6,30,31,32 (1-based, user-facing)
// Internally stored as 0-based indices (same as insToggleBad)
function insMarkRange(inputStr){
  if(_ins.cur < 0){ alert('Open a tilt stack first.'); return; }
  if(!inputStr || !inputStr.trim()){ alert('Enter a range, e.g. 1-6, 30-32'); return; }
  const f = _ins.files[_ins.cur];
  const nSlices = _ins.nSlices || 0;
  if(!_ins.badTilts[f.name]) _ins.badTilts[f.name] = [];
  const arr = _ins.badTilts[f.name];

  // Parse "1-6, 30-32, 40" into 0-based indices
  const newIndices = [];
  const parts = inputStr.split(',');
  for(var i = 0; i < parts.length; i++){
    const part = parts[i].trim();
    if(!part) continue;
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const singleMatch = part.match(/^(\d+)$/);
    if(rangeMatch){
      const from = parseInt(rangeMatch[1]);
      const to   = parseInt(rangeMatch[2]);
      if(isNaN(from) || isNaN(to) || from < 1 || to < from) continue;
      for(var n = from; n <= to; n++){
        const idx0 = n - 1; // convert 1-based → 0-based
        if(nSlices > 0 && idx0 >= nSlices) continue; // out of range
        newIndices.push(idx0);
      }
    } else if(singleMatch){
      const idx0 = parseInt(singleMatch[1]) - 1;
      if(isNaN(idx0) || idx0 < 0) continue;
      if(nSlices > 0 && idx0 >= nSlices) continue;
      newIndices.push(idx0);
    }
  }
  if(newIndices.length === 0){ alert('No valid tilt indices found in: ' + inputStr); return; }

  // Union: add new indices that are not already marked
  var added = 0;
  newIndices.forEach(function(idx){
    if(arr.indexOf(idx) < 0){ arr.push(idx); added++; }
  });
  arr.sort(function(a, b){ return a - b; });
  if(arr.length === 0) delete _ins.badTilts[f.name];

  // Clear input field
  var inp = document.getElementById('insBadRangeInput');
  if(inp) inp.value = '';

  insUpdateBadUI();
  insRenderFileList();
  insSaveBadTilts();

  // Brief feedback
  var fb = document.getElementById('insBadRangeFeedback');
  if(fb){
    fb.textContent = added > 0 ? ('+ ' + added + ' tilt' + (added !== 1 ? 's' : '') + ' marked') : 'Already marked';
    fb.style.color = added > 0 ? 'var(--rd)' : 'var(--dm)';
    setTimeout(function(){ if(fb) fb.textContent = ''; }, 2000);
  }
}

async function insSaveBadTilts(){
  if(!curProj) return;
  try {
    await api('/api/inspect/bad_tilts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({project: curProj, bad_tilts: _ins.badTilts})
    });
  } catch(e) { console.error('Failed to save bad tilts:', e); }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function insKeydown(e){
  // Only when inspect tab is active
  const tp = document.getElementById('tp-inspect');
  if(!tp || !tp.classList.contains('on')) return;
  if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if(e.key === 'ArrowLeft')  { e.preventDefault(); insPrevSlice(); }
  if(e.key === 'ArrowRight') { e.preventDefault(); insNextSlice(); }
  if(e.key === 'ArrowUp')    { e.preventDefault(); insPrevFile(); }
  if(e.key === 'ArrowDown')  { e.preventDefault(); insNextFile(); }
  if(e.key === 'b' || e.key === 'B') insToggleBad();
}

// ── Tilt Stack Selection — save + export for WarpTools ──────────────────────────

async function insSaveSelection(){
  if(!_ins.files.length){ alert('No files loaded.'); return; }
  var selected = _ins.files.filter(function(f){ return _ins.selected[f.name]!==false; });
  var stems = selected.map(function(f){ return f.name.replace(/\.[^.]+$/,''); });
  // Use the path from the Preprocessing list input field
  var el = document.getElementById('insSelectionPath');
  var savePath = (el && el.value.trim()) ? el.value.trim() : _ins.selectionPath;
  if(!savePath){ alert('Please set a Preprocessing list path first.'); return; }
  try {
    var r = await api('/api/inspect/save_selection', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path: savePath, stems: stems, project: curProj||''})
    });
    alert('Saved ' + r.count + ' stacks to:\n' + r.path + '\n\nThis path is now available for WarpTools import jobs.');
  } catch(e){ alert('Error: ' + e.message); }
}

// ── Tilt Stack Selection — export for WarpTools ──────────────────────────────
// Bad tilts saved, plus "excluded" stacks can be skipped in preprocessing

async function insExportSelection(){
  if(!_ins.folder){ alert('No folder selected.'); return; }
  var goodFiles = _ins.files.filter(function(f){
    return _ins.selected[f.name] !== false;
  });
  var allFiles = _ins.files;
  var outDir = _ins.folder.replace(/\/+$/, '') + '/selected_for_warp';
  try {
    var r = await api('/api/inspect/export_selection', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        folder: _ins.folder,
        selected: goodFiles.map(function(f){ return f.name; }),
        all_files: allFiles.map(function(f){ return f.name; }),
        output_dir: outDir,
        mode: 'symlink'
      })
    });
    alert('Done! ' + r.created + ' symlinks created in:\n' + r.output_dir
      + (r.skipped ? '\n' + r.skipped + ' stacks skipped (had bad tilts)' : ''));
  } catch(e) { alert('Error: ' + e.message); }
}

// ── File picker integration ───────────────────────────────────────────────────
// insFolderPath input uses oninput → insSetFolder() is called automatically
// when user types or selects via jbFilePicker browse modal

// ── Tomograms Sub-Tab ─────────────────────────────────────────────────────────
// Select tomograms for Miss Alignment — excluded XMLs moved to excl_dir

var _tom = {
  tomoFolder: '',
  xmlDir:     '',
  exclDir:    '',
  files:      [],   // [{name, path, stem}]
  selection:  {},   // {stem: true=include, false=exclude}
  cur:        -1,
  nSlices:    0,
  slice:      0,
  cmin:       null,
  cmax:       null,
};

async function tomInit(){
  // Auto-prefill from config
  if(!curProj) return;
  try {
    const cfg = await api('/api/projects/' + curProj + '/config');
    if(cfg.warptools_dir){
      var ts  = cfg.warptools_dir.replace(/\/+$/, '') + '/warp_tiltseries';
      var rec = ts + '/reconstruction';
      var excl = ts + '/xml_excluded_ma';
      var tomoEl = document.getElementById('tomTomoFolder');
      var xmlEl  = document.getElementById('tomXmlDir');
      var exclEl = document.getElementById('tomExclDir');
      if(tomoEl && !tomoEl.value){ tomoEl.value = rec; _tom.tomoFolder = rec; }
      if(xmlEl  && !xmlEl.value) { xmlEl.value  = ts;  _tom.xmlDir     = ts;  }
      if(exclEl && !exclEl.value){ exclEl.value = excl; _tom.exclDir   = excl; }
      if(_tom.tomoFolder) tomLoadFiles();
    }
    // Init resize for tomogram panel
    insInitResize('tomFileListWrap', 'tomDivider');
  } catch(e) { console.error('tomInit:', e); }
}

function tomSetFolders(){
  _tom.tomoFolder = (document.getElementById('tomTomoFolder')||{}).value || '';
  _tom.xmlDir     = (document.getElementById('tomXmlDir')||{}).value || '';
  _tom.exclDir    = (document.getElementById('tomExclDir')||{}).value || '';
  if(_tom.tomoFolder) tomLoadFiles();
}

async function tomLoadFiles(){
  if(!_tom.tomoFolder) return;
  document.getElementById('tomFileList').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.75rem">Loading...</div>';
  try {
    const [tomRes, xmlRes] = await Promise.all([
      api('/api/inspect/tomograms?folder=' + encodeURIComponent(_tom.tomoFolder)),
      _tom.xmlDir ? api('/api/inspect/xml_status?xml_dir=' + encodeURIComponent(_tom.xmlDir) + '&excl_dir=' + encodeURIComponent(_tom.exclDir)) : Promise.resolve({included:[], excluded:[]})
    ]);
    _tom.files = (tomRes.files || []).map(f => ({...f, stem: f.name.replace(/\.[^.]+$/, '')}));
    // Init selection: included by default, excluded if already in excl_dir
    const excl = new Set(xmlRes.excluded || []);
    _tom.files.forEach(f => { _tom.selection[f.stem] = !excl.has(f.stem); });
    _tom.cur = -1;
    tomRenderList();
    if(_tom.files.length > 0) tomOpenFile(0);
  } catch(e) {
    document.getElementById('tomFileList').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.75rem">Error: ' + e.message + '</div>';
  }
}

function tomRenderList(){
  const el = document.getElementById('tomFileList');
  if(!_tom.files.length){ el.innerHTML = '<div class="dim" style="padding:.5rem;font-size:.75rem">No tomograms found</div>'; return; }
  const included = _tom.files.filter(f => _tom.selection[f.stem] !== false).length;
  document.getElementById('tomStats').textContent = included + ' included · ' + (_tom.files.length - included) + ' excluded';
  el.innerHTML = _tom.files.map((f, i) => {
    const inc = _tom.selection[f.stem] !== false;
    const isCur = i === _tom.cur;
    return `<div class="ins-fitem${isCur?' on':''}${!inc?' has-bad':''}" onclick="tomOpenFile(${i})" style="gap:.4rem">
      <input type="checkbox" ${inc?'checked':''} onclick="event.stopPropagation();tomToggle(${i},this.checked)" style="flex-shrink:0;cursor:pointer">
      <span class="ins-fname" title="${f.name}">${f.name}</span>
      <span style="font-size:.65rem;color:${inc?'var(--gn)':'var(--rd)'};">${inc?'✓':'✗'}</span>
    </div>`;
  }).join('');
}

function tomToggle(idx, checked){
  if(idx < 0 || idx >= _tom.files.length) return;
  _tom.selection[_tom.files[idx].stem] = checked;
  tomRenderList();
}

function tomSelectAll(){ _tom.files.forEach(f => _tom.selection[f.stem] = true); tomRenderList(); }
function tomDeselectAll(){ _tom.files.forEach(f => _tom.selection[f.stem] = false); tomRenderList(); }

async function tomOpenFile(idx){
  if(idx < 0 || idx >= _tom.files.length) return;
  _tom.cur = idx;
  const f = _tom.files[idx];
  document.getElementById('tomFileName').textContent = f.name;
  tomRenderList();
  tomShowGifOrPlaceholder(f.path);
}

async function tomShowGifOrPlaceholder(mrcPath){
  var wrap = document.getElementById('tomImgWrap');
  wrap.innerHTML = '<div class="dim" style="padding:1rem;text-align:center;font-size:.75rem">Checking preview...</div>';
  try {
    var status = await api('/api/inspect/tomo_gif_status?path=' + encodeURIComponent(mrcPath));
    if(status.exists){
      tomDisplayGif(mrcPath);
    } else {
      var escaped = mrcPath.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      wrap.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:.8rem">'
        + '<div class="dim" style="font-size:.75rem">No preview generated yet</div>'
        + '<button class="bsm" style="padding:.4rem 1rem;font-weight:600" onclick="tomGenerateGif(\''+ escaped +'\')">'
        + '🎬 Generate GIF Preview</button>'
        + '<div class="dim" style="font-size:.68rem">Takes ~15-30s, cached for next time</div>'
        + '</div>';
    }
  } catch(e) { wrap.innerHTML = '<div class="dim" style="padding:1rem">Error</div>'; }
}

async function tomGenerateGif(mrcPath){
  var wrap = document.getElementById('tomImgWrap');
  wrap.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:.5rem">'
    + '<div style="font-size:.75rem;color:var(--ac)">⏳ Generating GIF preview...</div>'
    + '<div class="dim" style="font-size:.68rem">This may take 15-30 seconds</div>'
    + '</div>';
  try {
    var url = '/api/inspect/tomo_gif?path=' + encodeURIComponent(mrcPath);
    var resp = await fetch(url);
    if(!resp.ok) throw new Error('Failed');
    tomDisplayGif(mrcPath);
  } catch(e) {
    wrap.innerHTML = '<div class="dim" style="padding:1rem">Error generating GIF</div>';
  }
}

function tomDisplayGif(mrcPath){
  var wrap = document.getElementById('tomImgWrap');
  var url = '/api/inspect/tomo_gif?path=' + encodeURIComponent(mrcPath) + '&t=' + Date.now();
  var img = new Image();
  img.onload = function(){
    wrap.innerHTML = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;border-radius:4px;cursor:pointer;';
    img.title = 'Click to replay';
    img.onclick = function(){ img.src = url.split('&t=')[0] + '&t=' + Date.now(); };
    wrap.appendChild(img);
  };
  img.src = url;
}

function tomOnSlider(val){}
function tomApplyContrast(){}


// ── Generate GIF for currently selected tomogram ────────────────────────────────
async function tomGenerateSingleGif(){
  if(_tom.cur < 0){ alert('Select a tomogram first.'); return; }
  var f = _tom.files[_tom.cur];
  tomGenerateGif(f.path);
}

// ── Apply XML exclusion directly (no dialog) ─────────────────────────────────────
async function tomApplyDirect(){
  if(!_tom.xmlDir){ alert('Please set XML folder first.'); return; }
  var excl = _tom.files.filter(function(f){ return _tom.selection[f.stem]===false; }).map(function(f){ return f.stem; });
  var incl = _tom.files.filter(function(f){ return _tom.selection[f.stem]!==false; }).map(function(f){ return f.stem; });
  var exclDir = _tom.exclDir || _tom.xmlDir.replace(/\/+$/,'') + '/xml_excluded_ma';
  var msg = 'Apply XML exclusion?\n\nInclude: ' + incl.length + ' tilt series\nExclude: ' + excl.length + ' tilt series\n\nExcluded XMLs will be moved to:\n' + exclDir;
  if(!confirm(msg)) return;
  try {
    var r = await api('/api/inspect/apply_exclusions', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({xml_dir:_tom.xmlDir, excl_dir:exclDir, include:incl, exclude:excl})
    });
    alert('Done!\nMoved out: ' + r.moved_out.length + '\nMoved back: ' + r.moved_back.length + (r.errors.length ? '\nErrors: '+r.errors.join(', ') : ''));
    tomLoadFiles();
    if(curProj) tomSaveSelections();
  } catch(e){ alert('Error: '+e.message); }
}

// ── Generate GIF for all included tomograms ─────────────────────────────────
async function tomGenerateAllGifs(){
  var included = _tom.files.filter(function(f){ return _tom.selection[f.stem] !== false; });
  if(!included.length){ alert('No tomograms selected.'); return; }
  var wrap = document.getElementById('tomImgWrap');
  wrap.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:.6rem">'
    + '<div style="font-size:.75rem;color:var(--ac)" id="gifAllStatus">Starting...</div>'
    + '<div class="dim" style="font-size:.68rem" id="gifAllProgress"></div>'
    + '</div>';
  for(var i=0; i<included.length; i++){
    var f = included[i];
    var statusEl = document.getElementById('gifAllStatus');
    var progEl   = document.getElementById('gifAllProgress');
    if(statusEl) statusEl.textContent = '⏳ Generating GIF ' + (i+1) + ' / ' + included.length + ': ' + f.name;
    if(progEl)   progEl.textContent   = Math.round((i/included.length)*100) + '%';
    try {
      await fetch('/api/inspect/tomo_gif?path=' + encodeURIComponent(f.path));
    } catch(e) { /* continue on error */ }
  }
  if(document.getElementById('gifAllStatus'))
    document.getElementById('gifAllStatus').textContent = '✅ Done! ' + included.length + ' GIFs generated.';
  // Reload current file
  if(_tom.cur >= 0) tomShowGifOrPlaceholder(_tom.files[_tom.cur].path);
}

// Preview dialog
function tomPreview(){
  if(!_tom.xmlDir){ alert('Please set XML folder first.'); return; }
  const excl = _tom.files.filter(f => _tom.selection[f.stem] === false);
  const incl = _tom.files.filter(f => _tom.selection[f.stem] !== false);
  const msg = [
    `INCLUDE (${incl.length} tilt series) — stay in:`,
    `  ${_tom.xmlDir}`,
    '',
    `EXCLUDE (${excl.length} tilt series) — move to:`,
    `  ${_tom.exclDir || _tom.xmlDir + '/xml_excluded_ma/'}`,
    '',
    excl.map(f => `  ${f.stem}.xml`).join('\n') || '  (none)',
    '',
    '⚠ Files can be restored at any time via "Restore All".',
  ].join('\n');
  document.getElementById('tomPreviewText').textContent = msg;
  document.getElementById('tomPreviewDialog').style.display = '';
}

function tomCancelPreview(){ document.getElementById('tomPreviewDialog').style.display = 'none'; }

async function tomApply(){
  tomCancelPreview();
  const excl = _tom.files.filter(f => _tom.selection[f.stem] === false).map(f => f.stem);
  const incl = _tom.files.filter(f => _tom.selection[f.stem] !== false).map(f => f.stem);
  const exclDir = _tom.exclDir || _tom.xmlDir + '/xml_excluded_ma/';
  try {
    const r = await api('/api/inspect/apply_exclusions', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({xml_dir: _tom.xmlDir, excl_dir: exclDir, include: incl, exclude: excl})
    });
    alert(`Done!\nMoved out: ${r.moved_out.length}\nMoved back: ${r.moved_back.length}${r.errors.length?' \nErrors: '+r.errors.join(', '):''}`);
    tomLoadFiles();
    if(curProj) tomSaveSelections();
  } catch(e) { alert('Error: ' + e.message); }
}

async function tomRestoreAll(){
  if(!confirm('Move all excluded XMLs back to XML folder?')) return;
  const exclDir = _tom.exclDir || _tom.xmlDir + '/xml_excluded_ma/';
  try {
    const r = await api('/api/inspect/restore_all', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({xml_dir: _tom.xmlDir, excl_dir: exclDir})
    });
    alert(`Restored ${r.restored.length} XML files.`);
    tomLoadFiles();
  } catch(e) { alert('Error: ' + e.message); }
}

async function tomSaveSelections(){
  if(!curProj) return;
  var excl = _tom.files.filter(function(f){ return _tom.selection[f.stem] === false; }).map(function(f){ return f.stem; });
  try {
    await api('/api/inspect/selections', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        project: curProj,
        selections: {
          missalignment_excluded: excl,
          missalignment_xml_dir:  _tom.xmlDir,
          missalignment_excl_dir: _tom.exclDir
        }
      })
    });
  } catch(e) {}
}


// ── Trame Tomo Viewer ─────────────────────────────────────────────────────────
async function tomLaunchTrame(){
  var folder = (document.getElementById('tomTomoFolder') || {}).value || '';
  var viewerPath = 'tomo_web_viewer.py';
  var port = 8788;
  try {
    if(curProj){
      var cfg = await api('/api/projects/'+curProj+'/config');
      if(cfg.trame_viewer_path) viewerPath = cfg.trame_viewer_path;
      if(cfg.trame_viewer_port) port = cfg.trame_viewer_port;
    }
  } catch(e) {}
  try {
    var r = await post('/api/inspect/launch_trame', {
      folder: folder, viewer_path: viewerPath, port: port
    });
    if(r.ok){
      // Wait ~1.5s for trame server to start, then open new tab
      var msg = document.getElementById('tomStats');
      if(msg) msg.textContent = 'Starting Tomo Viewer on port 8788 — opening in 3s…';
      setTimeout(function(){
        window.open(r.url, '_blank');
        if(msg) msg.textContent = 'Tomo Viewer running at ' + r.url + ' (PID '+r.pid+')';
        setTimeout(function(){ if(msg) msg.textContent=''; }, 5000);
      }, 3000);
    } else {
      alert('Could not launch Tomo Viewer: '+(r.error||'unknown error'));
    }
  } catch(e){ alert('Launch failed: '+e.message); }
}