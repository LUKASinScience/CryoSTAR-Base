/* CryoSTAR-Base — setup.js
   Part of CryoSTAR-Base frontend — Programs/Setup tab
   Depends on: core.js (api, post, $, curProj)
   Lukas W. Bauer und Claude — 2026 */

// ── Setup Tab — collapsible sections ──────────────────────────
function toggleSetupSection(key){
  var body=document.getElementById('setup-body-'+key);
  var chev=document.getElementById('setup-chev-'+key);
  if(!body)return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'';
  if(chev)chev.style.transform=open?'rotate(-90deg)':'rotate(0deg)';
}

// ── Program definitions (mirrors models.py PROGRAM_DEFS) ──────
var PROG_DEFS = [
  // IMPORTANT: never use "| head -1" — makes exit_code always 0 → false positives.
  // Primary check: "which tool" — exit_code 0 = found, hint confirms correct binary.
  // hint is ALWAYS required (non-empty) — exit_code alone is NOT trusted.
  {id:'warptools', label:'WarpTools',      color:'#a78bfa', defaultType:'conda',
   checkStrategies:[
     {cmd:'which WarpTools',   hint:'warptools'},
     {cmd:'WarpTools 2>&1',    hint:'warptools'},
   ]},
  {id:'missalign', label:'Miss Alignment', color:'#a78bfa', defaultType:'conda',
   checkStrategies:[
     {cmd:'which miss-alignment',       hint:'miss'},
     {cmd:'miss-alignment --help 2>&1', hint:'miss'},
   ]},
  {id:'pytom',     label:'PyTom',          color:'#22c55e', defaultType:'conda',
   checkStrategies:[
     {cmd:'which pytom_match_template.py',       hint:'pytom'},
     {cmd:'pytom_match_template.py --help 2>&1', hint:'pytom'},
   ]},
  {id:'relion',    label:'RELION',          color:'#3b82f6', defaultType:'system',
   checkStrategies:[
     {cmd:'which relion',          hint:'relion'},
     {cmd:'relion --version 2>&1', hint:'relion'},
   ]},
  {id:'imod',      label:'IMOD',            color:'#f59e0b', defaultType:'system',
   checkStrategies:[
     {cmd:'which imod',  hint:'imod'},
     {cmd:'which 3dmod', hint:'3dmod'},
   ]},
  {id:'aretomo3',  label:'AreTomo3',        color:'#f59e0b', defaultType:'system',
   checkStrategies:[
     {cmd:'which AreTomo3',  hint:'aretomo'},
     {cmd:'AreTomo3 2>&1',   hint:'aretomo'},
   ],
   extraFields:[{key:'binary', label:'Binary path',
     placeholder:'AreTomo3  or  /opt/AreTomo3/AreTomo3'}]},
  {id:'slabify',   label:'Slabify',         color:'#22c55e', defaultType:'conda',
   checkStrategies:[
     {cmd:'which slabify',       hint:'slabify'},
     {cmd:'slabify --help 2>&1', hint:'slabify'},
   ]},
  {id:'chimerax',  label:'ChimeraX',        color:'#06b6d4', defaultType:'system',
   checkStrategies:[
     {cmd:'which chimerax',          hint:'chimerax'},
     {cmd:'chimerax --version 2>&1', hint:'chimerax'},
   ]},
  {id:'isonet',    label:'IsoNet',          color:'#06b6d4', defaultType:'conda',
   checkStrategies:[
     {cmd:'which isonet.py', hint:'isonet'},
     {cmd:'which isonet2',   hint:'isonet'},
   ]},
  {id:'ais',       label:'Ais',             color:'#0891b2', defaultType:'conda',
   checkStrategies:[
     {cmd:'python -c "import ais; print(ais.__file__)"', hint:'ais'},
     {cmd:'which ais',                                    hint:'ais'},
   ]},
];

// In-memory programs state: {id: {type, env, cmd, version, extra}}
// Exposed as window._programs so templates.js can read activation cmds
var _programs = window._programs = {};

// Cached environment lists from server
var _condaEnvs = [];
var _moduleList = [];

// ── Initialise on project open ─────────────────────────────────
async function progInit(){
  // Load saved config
  await progLoadSaved();
  // Scan environments in background (don't block UI)
  progScanEnvs();
}

// ── Scan conda envs + modules ──────────────────────────────────
async function progScanEnvsBtn(){
  var btn = document.getElementById('scanEnvsBtn');
  var res = document.getElementById('scanEnvsResult');
  if(btn){ btn.textContent='⟳ Scanning…'; btn.disabled=true; }
  if(res){ res.style.display='none'; res.textContent=''; }
  await progScanEnvs();
  if(btn){ btn.textContent='⟳ Scan environments'; btn.disabled=false; }
}

async function progScanEnvs(){
  var res = document.getElementById('scanEnvsResult');
  try{
    var d = await api('/api/system/environments');
    _condaEnvs = d.conda_envs || [];
    _moduleList = d.modules    || [];
    var _foundBinaries   = d.binaries       || {};
    var _foundSrcScripts = d.source_scripts || {};
    PROG_DEFS.forEach(function(def){ progRefreshDatalist(def.id); });

    // FIX: Save conda_base_path to config field when scan finds it
    if(d.conda_base){
      var cbEl = document.getElementById('condaBasePath');
      if(cbEl && !cbEl.value) cbEl.value = d.conda_base;
    }

    // ── Collect scan results: separate empty vs already-set ──
    var ENV_HINTS = {
      'warptools': ['warp','warptools'],
      'missalign': ['miss-alignment','miss_alignment','missalignment'],
      'pytom':     ['pytom','pytom_tm','pytom-tm'],
      'relion':    ['relion','relion-5','relion5'],
      'slabify':   ['slabify'],
      'isonet':    ['isonet','isonet2','isonet2_environment'],
      'ais':       ['ais'],
    };

    // _pendingScanResults: what scan found, keyed by program id
    // {id: {type, env, binary, source_script, label, currentLabel}}
    window._pendingScanResults = {};

    // Conda envs
    PROG_DEFS.forEach(function(def){
      var hints = ENV_HINTS[def.id] || [];
      if(!hints.length) return;
      var match = _condaEnvs.find(function(e){
        return hints.some(function(h){ return e.toLowerCase().indexOf(h) !== -1; });
      });
      if(!match) return;
      var p = _programs[def.id] || {};
      var alreadySet = !!(p.env || p.binary || p.source_script);
      if(!window._pendingScanResults[def.id]) window._pendingScanResults[def.id] = {};
      window._pendingScanResults[def.id].env = match;
      window._pendingScanResults[def.id].type = 'conda';
      window._pendingScanResults[def.id].label = def.label;
      window._pendingScanResults[def.id].newVal = 'conda: '+match;
      window._pendingScanResults[def.id].currentVal = alreadySet ? (p.env||p.cmd||p.binary||'?') : null;
    });

    // Binaries
    Object.keys(_foundBinaries).forEach(function(tid){
      var binPath = _foundBinaries[tid];
      if(!binPath) return;
      var p = _programs[tid] || {};
      var alreadySet = !!(p.env || p.binary || p.source_script);
      if(!window._pendingScanResults[tid]) window._pendingScanResults[tid] = {};
      var def = PROG_DEFS.find(function(d){return d.id===tid;}) || {};
      window._pendingScanResults[tid].binary = binPath;
      window._pendingScanResults[tid].type = 'system';
      window._pendingScanResults[tid].label = def.label||tid;
      window._pendingScanResults[tid].newVal = 'binary: '+binPath.split('/').pop();
      if(!window._pendingScanResults[tid].currentVal)
        window._pendingScanResults[tid].currentVal = alreadySet ? (p.binary||p.env||p.cmd||'?') : null;
    });

    // Source scripts
    Object.keys(_foundSrcScripts).forEach(function(tid){
      var scriptPath = _foundSrcScripts[tid];
      if(!scriptPath) return;
      var p = _programs[tid] || {};
      var alreadySet = !!(p.env || p.binary || p.source_script);
      if(!window._pendingScanResults[tid]) window._pendingScanResults[tid] = {};
      var def = PROG_DEFS.find(function(d){return d.id===tid;}) || {};
      window._pendingScanResults[tid].source_script = scriptPath;
      window._pendingScanResults[tid].type = 'system';
      window._pendingScanResults[tid].label = def.label||tid;
      window._pendingScanResults[tid].newVal = 'script: '+scriptPath.split('/').pop();
      if(!window._pendingScanResults[tid].currentVal)
        window._pendingScanResults[tid].currentVal = alreadySet ? (p.source_script||p.env||p.cmd||'?') : null;
    });

    // Split into: empty (apply directly) vs conflicts (show banner)
    var _directApply = {};
    var _conflicts   = {};
    Object.keys(window._pendingScanResults).forEach(function(id){
      var r = window._pendingScanResults[id];
      if(r.currentVal) _conflicts[id] = r;
      else             _directApply[id] = r;
    });

    // Apply non-conflicting results directly
    progApplyScanResults(_directApply);

    // Show override banner if conflicts exist
    var banner = document.getElementById('scanOverrideBanner');
    var details = document.getElementById('scanOverrideDetails');
    if(Object.keys(_conflicts).length && banner && details){
      var lines = Object.keys(_conflicts).map(function(id){
        var r = _conflicts[id];
        return '<div style="font-size:.7rem;padding:.1rem 0">'
          +'<strong style="color:var(--tx)">'+r.label+'</strong>'
          +' <span style="color:var(--dm)">current: '+r.currentVal+'</span>'
          +' → <span style="color:var(--ac)">'+r.newVal+'</span></div>';
      });
      details.innerHTML = lines.join('');
      banner.style.display = '';
    } else if(banner){
      banner.style.display = 'none';
    }

    if(res){
      var parts = [];
      if(_condaEnvs.length) parts.push('✓ '+_condaEnvs.length+' conda env'+(_condaEnvs.length!==1?'s':'')+': '+_condaEnvs.join(', '));
      if(_moduleList.length) parts.push('✓ '+_moduleList.length+' module'+(_moduleList.length!==1?'s':''));
      var _nb = Object.keys(_foundBinaries||{}).length;
      var _ns = Object.keys(_foundSrcScripts||{}).length;
      if(_nb) parts.push('✓ '+_nb+' binary'+(_nb!==1?'s':'')+': '+Object.values(_foundBinaries).map(function(p){return p.split('/').pop();}).join(', '));
      if(_ns) parts.push('✓ '+_ns+' source script'+(_ns!==1?'s':''));
      if(!parts.length) parts.push('No environments found — is conda initialized?');
      res.textContent = parts.join(' · ');
      res.style.color = parts[0].startsWith('✓') ? 'var(--gn)' : 'var(--yl)';
      res.style.display = 'block';
    }
  }catch(e){
    if(res){
      res.textContent = '✗ Scan failed: '+e.message;
      res.style.color = 'var(--rd,#f85149)';
      res.style.display = 'block';
    }
  }
}

// ── Apply scan results to _programs + DOM ─────────────────────
function progApplyScanResults(results){
  Object.keys(results).forEach(function(id){
    var r = results[id];
    if(!_programs[id]) _programs[id]={type:'conda',env:'',cmd:'',version:'',extra:{},source_script:'',binary:''};
    var p = _programs[id];
    if(r.type) p.type = r.type;
    if(r.env)           { p.env = r.env; var el=document.getElementById('prog-env-'+id); if(el) el.value=r.env; }
    if(r.binary)        { p.binary = r.binary; var el=document.getElementById('prog-binary-'+id); if(el) el.value=r.binary; }
    if(r.source_script) { p.source_script = r.source_script; var el=document.getElementById('prog-source-'+id); if(el) el.value=r.source_script; }
    progAutoCmd(id);
    progRenderCard(id);
  });
}

// Called by Override button in scan banner
function progOverrideWithScan(){
  if(!window._pendingScanResults) return;
  progApplyScanResults(window._pendingScanResults);
  var banner = document.getElementById('scanOverrideBanner');
  if(banner) banner.style.display = 'none';
  window._pendingScanResults = {};
}

function progRefreshDatalist(id){
  var def = PROG_DEFS.find(function(d){return d.id===id;});
  if(!def) return;
  var type = (_programs[id]||{}).type || 'conda';
  var dl = document.getElementById('prog-dl-'+id);
  if(!dl) return;
  dl.innerHTML = '';
  var list = type==='conda' ? _condaEnvs : _moduleList;
  list.forEach(function(e){
    var opt = document.createElement('option');
    opt.value = e;
    dl.appendChild(opt);
  });
}

// ── Pill toggle: conda ↔ module ────────────────────────────────
function progToggleType(id, forceType){
  if(!_programs[id]) _programs[id] = {type:'conda',env:'',cmd:'',version:'',extra:{}};
  var def = PROG_DEFS.find(function(d){return d.id===id;});
  if(!def) return;
  if(def.condaOnly || def.systemOnly) return; // single-type tools
  if(forceType){
    _programs[id].type = forceType;
  } else {
    // cycle: conda → module → system → conda
    var cycle = ['conda','module','system','sbgrid'];
    var idx = cycle.indexOf(_programs[id].type);
    _programs[id].type = cycle[(idx+1) % cycle.length];
  }
  progRenderCard(id);
  progAutoCmd(id);
}

// ── Auto-generate cmd from type + env ─────────────────────────
function progAutoCmd(id){
  var p = _programs[id];
  if(!p) return;
  // Always explicitly set cmd — clears stale values when type changes
  if(p.type==='conda')  p.cmd = p.env ? 'conda activate '+p.env : '';
  if(p.type==='module') p.cmd = p.env ? 'module load '+p.env    : '';
  if(p.type==='system'){
    var src = (p.source_script||'').trim();
    var bin = (p.binary||'').trim();
    if(src && bin)  p.cmd = 'source '+src;
    else if(src)    p.cmd = 'source '+src;
    else if(bin)    p.cmd = bin;
    else            p.cmd = '';
  }
  if(p.type==='sbgrid'){
    var ver = (p.sbgrid_ver||'').trim();
    p.cmd = ver ? 'source /programs/sbgrid.shrc && export '+ver : 'source /programs/sbgrid.shrc';
  }
  var cmdEl = document.getElementById('prog-cmd-'+id);
  if(cmdEl) cmdEl.value = p.cmd||'';
}

// ── Input handlers ─────────────────────────────────────────────
function progEnvInput(id){
  if(!_programs[id]) _programs[id]={type:'conda',env:'',cmd:'',version:'',extra:{}};
  var el = document.getElementById('prog-env-'+id);
  if(el) _programs[id].env = el.value.trim();
  progAutoCmd(id);
}

function progCmdInput(id){
  if(!_programs[id]) _programs[id]={type:'conda',env:'',cmd:'',version:'',extra:{}};
  var el = document.getElementById('prog-cmd-'+id);
  if(el) _programs[id].cmd = el.value.trim();
}

function progVerInput(id){
  if(!_programs[id]) _programs[id]={type:'conda',env:'',cmd:'',version:'',extra:{}};
  var el = document.getElementById('prog-ver-'+id);
  if(el) _programs[id].version = el.value.trim();
}

function progExtraInput(id, key){
  if(!_programs[id]) _programs[id]={type:'conda',env:'',cmd:'',version:'',extra:{}};
  if(!_programs[id].extra) _programs[id].extra={};
  var el = document.getElementById('prog-extra-'+id+'-'+key);
  if(el) _programs[id].extra[key] = el.value.trim();
}

function progSourceScriptInput(id){
  if(!_programs[id]) _programs[id]={type:'system',env:'',cmd:'',version:'',extra:{}};
  var el = document.getElementById('prog-source-'+id);
  if(!el) return;
  _programs[id].source_script = el.value; // keep raw including underscores
  progAutoCmd(id);
}

function progBinaryInput(id){
  if(!_programs[id]) _programs[id]={type:'system',env:'',cmd:'',version:'',extra:{}};
  var el = document.getElementById('prog-binary-'+id);
  if(!el) return;
  _programs[id].binary = el.value; // keep raw including underscores
  progAutoCmd(id);
}

// ── Resolve alias → find script path ──────────────────────────
async function progResolveAlias(id){
  var srcEl = document.getElementById('prog-source-'+id);
  if(!srcEl) return;
  var alias = srcEl.value.trim();
  if(!alias){
    // Show a prompt to enter alias name
    alias = window.prompt('Enter alias name to resolve (e.g. activate_relion):');
    if(!alias) return;
  }
  var noteEl = document.getElementById('prog-note-'+id);
  if(noteEl){noteEl.textContent='Resolving alias…';noteEl.style.display='block';noteEl.style.color='var(--dm)';}
  try{
    var result = await post('/api/system/resolve_alias',{alias:alias});
    if(result.script_path){
      srcEl.value = result.script_path;
      progSourceScriptInput(id);
      if(noteEl){
        noteEl.textContent='✓ Resolved: '+result.script_path;
        noteEl.style.color='var(--gn)';
        noteEl.style.display='block';
      }
    } else {
      if(noteEl){
        noteEl.textContent='Could not resolve "'+alias+'" — '+( result.error||'not found');
        noteEl.style.color='var(--rd,#f85149)';
        noteEl.style.display='block';
      }
    }
  }catch(e){
    if(noteEl){noteEl.textContent='Error: '+e.message;noteEl.style.color='var(--rd,#f85149)';noteEl.style.display='block';}
  }
}

// ── Re-render a single card after toggle ──────────────────────
function progRenderCard(id){
  var def = PROG_DEFS.find(function(d){return d.id===id;});
  var p   = _programs[id] || {type:'conda',env:'',cmd:'',version:'',extra:{}};
  if(!def) return;

  // Pill buttons — update active state (conda/module/system/sbgrid)
  ['conda','module','system','sbgrid'].forEach(function(t){
    var btn = document.getElementById('prog-pill-'+t+'-'+id);
    if(btn) btn.className = 'pill-toggle-btn' + (p.type===t ? ' on' : '');
  });

  // Env field — hide for system-only, system type, or sbgrid type
  var envRow = document.getElementById('prog-env-row-'+id);
  if(envRow){
    var showEnv = p.type !== 'system' && p.type !== 'sbgrid' && !def.systemOnly;
    envRow.style.display = showEnv ? '' : 'none';
  }

  // SBGrid version field — show only when type===sbgrid
  var sbgridRow = document.getElementById('prog-sbgrid-row-'+id);
  if(sbgridRow) sbgridRow.style.display = p.type==='sbgrid' ? '' : 'none';
  var envEl = document.getElementById('prog-env-'+id);
  if(envEl){
    envEl.placeholder = p.type==='conda'
      ? (id+'-env  (conda env name)')
      : (id+'/2.0.0  (module name)');
  }

  // Cmd label — update to reflect type
  var cmdLabel = document.getElementById('prog-cmd-label-'+id);
  if(cmdLabel){
    if(p.type==='system') cmdLabel.textContent = 'activation cmd (optional)';
    else cmdLabel.textContent = 'activation cmd';
  }

  // Source script + binary rows — only show for system type
  var srcRow = document.getElementById('prog-source-row-'+id);
  if(srcRow) srcRow.style.display = p.type==='system' ? '' : 'none';
  var binRow = document.getElementById('prog-binary-row-'+id);
  if(binRow) binRow.style.display = p.type==='system' ? '' : 'none';

  // Refresh datalist
  progRefreshDatalist(id);
}

// ── Check a single program (multi-strategy) ───────────────────
async function progCheck(id){
  var def = PROG_DEFS.find(function(d){return d.id===id;});
  if(!def) return;
  var p = _programs[id] || {};
  var statusEl = document.getElementById('prog-status-'+id);
  var noteEl   = document.getElementById('prog-note-'+id);
  if(statusEl){statusEl.textContent='checking…';statusEl.className='prog-status checking';}
  if(noteEl){noteEl.textContent='';noteEl.style.display='none';}

  // Build strategies from checkStrategies or fall back to legacy checkCmd
  var strategies = _checkStrategies || def.checkStrategies ||
    [{cmd:(def.checkCmd||id+' --help 2>&1 | head -1'), hint:(def.checkHint||id)}];
  // For system type: build activation from source_script and/or binary
  var activation = '';
  if(p.type==='system'){
    var _src = (p.source_script||'').trim();
    var _bin = (p.binary||'').trim();
    if(_src) activation = 'source '+_src;
    else if(_bin) activation = '';  // binary is the command itself, no separate activation
    else activation = p.cmd||'';
  } else {
    activation = p.cmd||'';
  }
  // For system with binary: override checkStrategies to use binary directly
  var _checkStrategies = def.checkStrategies;
  if(p.type==='system' && (p.binary||'').trim()){
    var _b = (p.binary||'').trim();
    _checkStrategies = [
      {cmd: 'which '+_b+' || '+_b+' 2>&1 | head -1', hint: _b.split('/').pop().toLowerCase()},
    ].concat(def.checkStrategies||[]);
  }
  var lastResult = null;

  for(var si=0; si<strategies.length; si++){
    var strat = strategies[si];
    var cmd = activation ? (activation+' && '+strat.cmd) : strat.cmd;
    try{
      var result = await post('/api/scripts/run',{command:cmd,working_dir:'.'});
      var combined = ((result.stdout||'')+(result.stderr||'')).toLowerCase();
      var hint = (strat.hint||'').toLowerCase();
      // STRICT: hint MUST be found AND exit_code must be 0.
      // exit_code alone is not trusted (pipe operators can mask failures).
      var hintFound = hint ? combined.indexOf(hint) !== -1 : false;
      var ok = result.exit_code===0 && hintFound;
      lastResult = result;
      if(ok){
        if(statusEl){statusEl.textContent='✓ ok';statusEl.className='prog-status ok';}
        progUpdateTabStatus();
        if(noteEl){
          var lines = (result.stdout||result.stderr||'').trim().split('\n');
          var txt = lines.filter(function(l){return l.trim().length>2;})[0]||'';
          noteEl.textContent   = txt.slice(0,160);
          noteEl.style.display = txt?'block':'none';
          noteEl.style.color   = 'var(--gn)';
        }
        return;
      }
    }catch(e){ lastResult={stdout:'',stderr:e.message}; }
  }

  // All strategies failed
  if(statusEl){statusEl.textContent='✗ not found';statusEl.className='prog-status err';}
  progUpdateTabStatus();
  if(noteEl){
    var errTxt = lastResult
      ? ((lastResult.stderr||lastResult.stdout||'')).trim().split('\n')[0].slice(0,140)
      : '';
    noteEl.textContent   = errTxt || 'not found in PATH';
    noteEl.style.display = 'block';
    noteEl.style.color   = 'var(--rd,#f85149)';
  }
}

async function progCheckAll(){
  for(var i=0;i<PROG_DEFS.length;i++) await progCheck(PROG_DEFS[i].id);
}

// ── Save one ───────────────────────────────────────────────────
async function progSaveOne(id){
  if(!curProj) return;
  var p = _programs[id] || {};
  try{
    var programs = {};
    programs[id] = p;
    await post('/api/projects/'+curProj+'/config', {programs: programs, _merge_programs: true});
    // Keep window._lastConfig in sync so updPrev() gets current values
    if(window._lastConfig){ if(!window._lastConfig.programs) window._lastConfig.programs={}; window._lastConfig.programs[id]=p; }
    var noteEl = document.getElementById('prog-note-'+id);
    if(noteEl){
      noteEl.textContent='✓ Saved'; noteEl.style.display='block'; noteEl.style.color='var(--gn)';
      setTimeout(function(){noteEl.textContent='';noteEl.style.display='none';noteEl.style.color='var(--dm)';},1800);
    }
  }catch(e){
    var noteEl = document.getElementById('prog-note-'+id);
    if(noteEl){noteEl.textContent='Error: '+e.message;noteEl.style.display='block';}
  }
}

// ── Save all ───────────────────────────────────────────────────
async function progSaveAll(){
  if(!curProj) return;
  try{
    await post('/api/projects/'+curProj+'/config', {
      programs: _programs,
      conda_base_path: (document.getElementById('condaBasePath')||{}).value||''
    });
    var res = document.getElementById('progSaveRes');
    if(res){res.textContent='✓ Saved';setTimeout(function(){res.textContent='';},2500);}
    progUpdateTabStatus();
    // Notebook log
    var lines = ['[Programs saved]'];
    Object.keys(_programs).forEach(function(id){
      var p=_programs[id];
      if(p.env||p.cmd) lines.push('  '+id+' ('+p.type+'): '+(p.env||p.cmd));
    });
    await post('/api/notes',{project:curProj,text:lines.join('\n')});
    loadNotes(); nbMarkPending();
  }catch(e){
    var res=document.getElementById('progSaveRes');
    if(res) res.textContent='Error: '+e.message;
  }
}

// ── Load saved ─────────────────────────────────────────────────
async function progLoadSaved(){
  if(!curProj) return;
  // Only do a full re-render on first load or explicit tab switch
  // During job polling, just update _programs without re-rendering (preserves user edits)
  var _isFirstLoad = Object.keys(_programs).length === 0;
  var _setupTabActive = (document.querySelector('.tab[data-t="setup"]') || {}).classList &&
                        document.querySelector('.tab[data-t="setup"]').classList.contains('on');
  var _doRender = _isFirstLoad || _setupTabActive;
  try{
    var c = await api('/api/projects/'+curProj+'/config');
    if(_doRender) _programs = c.programs || {};
    else { var _saved = c.programs || {}; Object.keys(_saved).forEach(function(k){ if(!_programs[k]) _programs[k]=_saved[k]; }); }
    // Conda base path
    var cbEl = document.getElementById('condaBasePath');
    if(cbEl && c.conda_base_path) cbEl.value = c.conda_base_path;
    // Render all cards with saved values — only on first load or setup tab active
    PROG_DEFS.forEach(function(def){
      var defType = def.defaultType || 'conda';
      var p = _programs[def.id] || {type:defType,env:'',cmd:'',version:'',extra:{}};
      _programs[def.id] = p;
      if(_doRender) progRenderCard(def.id);
      // Fill inputs
      var envEl = document.getElementById('prog-env-'+def.id);
      var cmdEl = document.getElementById('prog-cmd-'+def.id);
      var verEl = document.getElementById('prog-ver-'+def.id);
      var srcEl = document.getElementById('prog-source-'+def.id);
      var binEl = document.getElementById('prog-binary-'+def.id);
      if(envEl) envEl.value = p.env||'';
      if(cmdEl) cmdEl.value = p.cmd||'';
      if(verEl) verEl.value = p.version||'';
      if(srcEl && p.source_script) srcEl.value = p.source_script;
      if(binEl && p.binary) binEl.value = p.binary;
      // SBGrid version field
      var sbVerEl = document.getElementById('prog-sbgrid-ver-'+def.id);
      if(sbVerEl && p.sbgrid_ver) sbVerEl.value = p.sbgrid_ver;
      // Extra fields
      if(def.extraFields && p.extra){
        def.extraFields.forEach(function(f){
          var el = document.getElementById('prog-extra-'+def.id+'-'+f.key);
          if(el && p.extra[f.key]) el.value = p.extra[f.key];
        });
      }
      // Show "saved" status if env/cmd filled
      if(p.env||p.cmd){
        var st = document.getElementById('prog-status-'+def.id);
        if(st && st.textContent==='—'){st.textContent='saved';st.className='prog-status checking';}
      }
    });
    progUpdateTabStatus();
  }catch(e){ progUpdateTabStatus(); }
}

// ── Tab status indicator ───────────────────────────────────────
function progUpdateTabStatus(){
  var core = ['warptools','pytom','relion','imod'];
  var allOk = core.every(function(id){
    var el=document.getElementById('prog-status-'+id);
    return el && el.classList.contains('ok');
  });
  var someOk = core.some(function(id){
    var el=document.getElementById('prog-status-'+id);
    return el && (el.classList.contains('ok')||el.classList.contains('checking'));
  });
  var ts = document.getElementById('ts-tools');
  if(!ts) return;
  if(allOk)      {ts.textContent=' ✓';ts.className='tab-status complete';}
  else if(someOk){ts.textContent=' ⚠';ts.className='tab-status partial';}
  else           {ts.textContent=' ⚠';ts.className='tab-status empty';}
}

// ── Phase2 hooks ───────────────────────────────────────────────
function phase2OnProjectOpen(){ resourcePollStart(); progInit(); }
function phase2OnProjectClose(){
  resourcePollStop();
  var card=document.getElementById('jobDashCard');
  if(card) card.style.display='none';
}
function phase2OnJobComplete(jobId,exitCode){
  if(exitCode===0) setTimeout(function(){showJobDashboard(jobId);},800);
}

// ── Checks (star / tomo / inspect) ────────────────────────────
async function ckStar(){const p=$('ckS').value;if(!p)return;try{const d=await api(`/api/check/star?path=${encodeURIComponent(p)}`);chks('ckSR',d.checks)}catch(e){res('ckSR',false,e.message)}}
async function ckTomo(){const p=$('ckT').value;if(!p)return;try{const d=await api(`/api/check/tomogram?path=${encodeURIComponent(p)}`);chks('ckTR',d.checks)}catch(e){res('ckTR',false,e.message)}}
async function ckInsp(){
  const p=$('ckI').value;if(!p)return;
  try{
    const d=await api(`/api/check/star/columns?path=${encodeURIComponent(p)}`);
    let h=`<div class="dim" style="margin-bottom:.4rem">${d.n_rows} rows</div>
      <table class="tbl"><thead><tr><th>Column</th><th>Type</th><th>Min</th><th>Max</th><th>Mean</th></tr></thead><tbody>`;
    d.columns.forEach(c=>{h+=c.type==='numeric'
      ?`<tr><td><code>${c.column}</code></td><td>num</td><td>${c.min.toFixed(2)}</td><td>${c.max.toFixed(2)}</td><td>${c.mean.toFixed(2)}</td></tr>`
      :`<tr><td><code>${c.column}</code></td><td>txt(${c.unique})</td><td colspan="3">${(c.examples||[]).slice(0,3).join(', ')}</td></tr>`});
    h+='</tbody></table>';$('ckIR').innerHTML=h;
  }catch(e){res('ckIR',false,e.message)}
}