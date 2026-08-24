/* CryoSTAR-Base — runner.js
   Part of CryoSTAR-Base frontend
   Lukas W. Bauer und Claude — 2026 */

// ── Tabs — works across both Overview and Workflow rows ──
function cTab(t){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  document.querySelectorAll('.tp').forEach(p=>p.classList.toggle('on',p.id==='tp-'+t));
  if(t==='notes'){loadNotes();nbPending=false;const badge=$('nbBadge');if(badge)badge.classList.remove('show');}
  if(t==='people'){
    loadInvestigators();
    if(curProj)api('/api/projects/'+curProj+'/config').then(function(c){renderConnections(c.connected_projects||[]);}).catch(function(){});
  }
  var _wfTabs=['particles','warptools','tmanalysis','tools','relion','py2rely','computing','missalign'];
  if(_wfTabs.indexOf(t)>=0){showWorkflowRow();if(!_workflowOpen)toggleWorkflowRow();}
  var _cryoetTabs=['cryoet-setup','isonet','ais'];
  if(_cryoetTabs.indexOf(t)>=0){
    var crow=document.getElementById('cryoetTabsRow');
    if(crow)crow.style.display='';
    if(!_cryoetOpen)toggleCryoetRow();
  }
  if(t==='tools'){progLoadSaved();}
  if(t==='missalign'){
    // Init mode display on first open
    if(typeof maWfSetMode==='function') maWfSetMode(_maWfMode||'aretomo');
  }
  if(t==='computing'){compLoad();}
  if(t==='relion'){relionAutoFill();relionAnalysisAutoFill();icInitAll();}
  if(t==='preproc'){warpAutoFill();if(typeof preprocOnTabOpen==='function')preprocOnTabOpen();}
  if(t==='mtools'){mtAutoFill();icInitAll();}
  if(t==='inspect'){if(typeof insLoadBadTilts==='function')insLoadBadTilts();}
  if(t==='preliproc'){if(typeof preliProcOnTabOpen==='function')preliProcOnTabOpen();}
  if(t==='particles'){icInitAll();}
  if(t==='py2rely'){
    py2relyRefreshDirs();
    py2relyUpdateCmdPreview();
    // Check current status
    api('/api/dashboard/status').then(function(s){py2relyUpdateStatus(s);}).catch(function(){});
    // Wire port input to update preview
    var portEl=document.getElementById('py2relyPort');
    if(portEl&&!portEl._wired){portEl._wired=true;portEl.addEventListener('input',py2relyUpdateCmdPreview);}
    // Also add 'py2rely' to workflow tabs so pipeline strip shows
    var _wfTabsEl=document.querySelectorAll('[data-t="py2rely"]');
    _wfTabsEl.forEach(function(b){b.classList.toggle('on',true);});
  }
}

// ── Files ──
async function fGo(p){
  curP=p;
  try{
    // Workspace-relative paths stay sandboxed; absolute paths (e.g. a
    // preprocessing/WarpTools/AreTomo3 dir living outside the workspace,
    // the common case) fall back to the unrestricted finder-panel endpoint.
    const isAbs=p.startsWith('/')||p==='..';
    const endpoint=isAbs?'/api/files/browse_free?path=':'/api/files/browse?path=';
    const d=await api(endpoint+encodeURIComponent(p));
    $('fP').textContent=d.path||'.';
    var fL=$('fL');fL.innerHTML='';
    if(!d.items.length){fL.innerHTML='<div class="empty">Empty</div>';}
    else d.items.forEach(function(i){
      var row=document.createElement('div');
      row.className='fitem'+(i.is_dir?' dir':'');
      row.onclick=i.is_dir?function(){fGo(i.path);}:function(){fOpen(i.path);};
      var fn=document.createElement('span');
      fn.className='fn';
      fn.textContent=i.name+(i.is_link?' ->':'');
      var fs=document.createElement('span');
      fs.className='fsize';
      fs.textContent=i.size!=null?sz(i.size):'';
      row.appendChild(fn);row.appendChild(fs);
      fL.appendChild(row);
    });
  }catch(e){$('fL').innerHTML='<div class="dim" style="padding:.5rem">'+e.message+'</div>';}
}
function fUp(){
  var isAbs=curP.startsWith('/');
  var p=curP.split('/').filter(Boolean);p.pop();
  var joined=p.join('/');
  fGo(isAbs?('/'+joined):(joined||'.'));
}

// ── Server (SMB/NFS) file browser — uses browse_server ──
var curPS = '';  // current server path

async function fGoServer(p){
  curPS = p || '';
  var url = '/api/files/browse_server' + (p ? '?path=' + encodeURIComponent(p) : '');
  try{
    const d = await api(url);
    if(d.error === 'no_server_configured'){
      $('fP').textContent = 'No server configured';
      $('fL').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.78rem">'
        + 'Enter a server URL above and click Save.</div>';
      return;
    }
    if(d.error === 'not_mounted'){
      $('fP').textContent = 'Server not mounted';
      $('fL').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.78rem">'
        + (d.message || 'Mount the server share first.') + '</div>';
      return;
    }
    curPS = d.path || p || '';
    $('fP').textContent = d.path || '';
    var absEl = document.getElementById('fileAbsPath');
    if(absEl){ absEl.textContent = d.abs || d.path || ''; absEl.style.display = ''; }
    var fLs = $('fL'); fLs.innerHTML = '';
    if(!(d.items && d.items.length)){ fLs.innerHTML = '<div class="empty">Empty</div>'; }
    else d.items.forEach(function(i){
      var row = document.createElement('div');
      row.className = 'fitem' + (i.is_dir ? ' dir' : '');
      row.onclick = i.is_dir ? function(){ fGoServer(i.path); } : function(){ fOpen(i.path); };
      var fn = document.createElement('span');
      fn.className = 'fn';
      fn.textContent = i.name + (i.is_link ? ' ->' : '');
      var fs = document.createElement('span');
      fs.className = 'fsize';
      fs.textContent = i.size != null ? sz(i.size) : '';
      row.appendChild(fn); row.appendChild(fs);
      fLs.appendChild(row);
    });
  }catch(e){
    $('fL').innerHTML = '<div class="dim" style="padding:.5rem">' + e.message + '</div>';
  }
}

function fUpServer(){
  if(!curPS || curPS === '/') return;
  var parent = curPS.replace(/\/[^/]+\/?$/, '') || '/';
  fGoServer(parent);
}
async function fOpen(p){
  try{
    const d=await api('/api/files/read?path='+encodeURIComponent(p));
    $('fV').style.display='';
    $('fVN').textContent=p.split('/').pop();
    $('fC').textContent=d.type==='text'?d.content:'['+d.type+']';
  }catch(e){$('fC').textContent=e.message;$('fV').style.display='';}
}

// ── Tab status badges ──
const TAB_REQUIRED = {
  tomo:      ['tDate','tVoltage','tCs','tAmpCon','tX','tY','tZ','tRaw','tBin',
              'tMicroscope','tCamera','tSlitWidth','tC2aperture','tTargetDefocus',
              'tCollSoftware','tCollSoftVer','tTiltScheme','tTiltRange','tTiltStep',
              'tStartAngle','tNTilts','tPreTilt','tTotalDose','tDosePerTilt','tFlux',
              'tFramesPerTilt','tCDSMode','tSampleType','tLamellaThick'],
  sample:    ['sDate','sDesc','sProto'],
  people:    [],
  particles: ['pDiam','pBox'],
  warptools: ['tWarpVer'],
  computing: ['compInfra','compGPUs'],
};

function computeTabStatus(tabId){
  if(tabId==='people'){
    var chips=document.querySelectorAll('#invList .inv-chip');
    return chips.length>0?'complete':'empty';
  }
  if(tabId==='particles') return typeof computeParticlesStatus!=='undefined'&&computeParticlesStatus?computeParticlesStatus():'empty';
  var fields=TAB_REQUIRED[tabId]||[];
  if(!fields.length)return 'empty';
  var filled=fields.filter(function(id){
    var el=document.getElementById(id);
    return el&&el.value&&el.value.trim()!=='';
  });
  if(filled.length===0)return 'empty';
  if(filled.length===fields.length)return 'complete';
  return 'partial';
}

function renderTabStatus(tabStatus){
  var ts=tabStatus||{};
  var icons={complete:'✓',partial:'⚠',empty:'⚠'};
  var cls={complete:'complete',partial:'partial',empty:'empty'};
  ['tomo','sample','particles','warptools','computing'].forEach(function(t){
    var el=document.getElementById('ts-'+t);
    if(!el)return;
    var s=ts[t]||'empty';
    el.textContent=icons[s]||'';
    el.className='tab-status '+(cls[s]||'');
  });
}

async function updateTabStatus(tabId){
  if(!curProj)return;
  var status=computeTabStatus(tabId);
  try{
    await post('/api/projects/'+curProj+'/tab_status',{[tabId]:status});
    var el=document.getElementById('ts-'+tabId);
    if(el){
      var icons={complete:'✓',partial:'⚠',empty:'⚠'};
      el.textContent=icons[status]||'';
      el.className='tab-status '+status;
    }
  }catch(e){}
}


// ── Init server browse root on startup ──────────────────────────────────────
(async function initServerBrowseRoot(){
  try{
    var ds = await fetch('/api/data_server').then(function(r){ return r.json(); });
    if(ds && ds.mounted && ds.gvfs_path){
      // Use saved server start dir if set, else GVFS root
      var savedStart = localStorage.getItem('serverBrowseStartDir') || '';
      window._serverGvfsPath = savedStart || ds.gvfs_path;
      // Populate start dir input if present
      var sinp = document.getElementById('fileServerStartDir');
      if(sinp && savedStart) sinp.value = savedStart;
      var saved = localStorage.getItem('browseRoot');
      window._activeBrowseRoot = (saved === 'local') ? 'local' : 'server';
      var tog = document.getElementById('browseRootToggle');
      if(tog) tog.style.display = 'flex';
      _updateBrowseToggleUI();
    }
  }catch(e){ /* silent */ }
})();

function setBrowseRoot(mode){
  window._activeBrowseRoot = mode;
  localStorage.setItem('browseRoot', mode);
  _updateBrowseToggleUI();
}

function _updateBrowseToggleUI(){
  var mode = window._activeBrowseRoot || 'local';
  var lblL = document.getElementById('browseLocalBtn');
  var lblS = document.getElementById('browseServerBtn');
  if(!lblL || !lblS) return;
  if(mode === 'server'){
    lblS.style.borderColor = 'var(--gn)';
    lblS.style.color       = 'var(--gn)';
    lblS.style.background  = 'rgba(63,185,80,.15)';
    lblL.style.borderColor = 'var(--bd)';
    lblL.style.color       = 'var(--dm)';
    lblL.style.background  = 'var(--sf2)';
  } else {
    lblL.style.borderColor = 'var(--ac)';
    lblL.style.color       = 'var(--ac)';
    lblL.style.background  = 'rgba(88,166,255,.15)';
    lblS.style.borderColor = 'var(--bd)';
    lblS.style.color       = 'var(--dm)';
    lblS.style.background  = 'var(--sf2)';
  }
}

init();