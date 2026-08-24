/* CryoSTAR-Base — jobs.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════════
//  HELPER: Get box size for current binning
// ══════════════════════════════════════════════════════════════
function getBoxSizeForBinning(binning) {
  if (!config) return 0;
  
  // Try box_sizes_by_binning dictionary first
  if (config.box_sizes_by_binning && Object.keys(config.box_sizes_by_binning).length > 0) {
    const binStr = String(binning || config.binning_factor || 1);
    if (config.box_sizes_by_binning[binStr]) {
      return config.box_sizes_by_binning[binStr];
    }
  }
  
  // Fallback to legacy single box_size
  return config.box_size || 0;
}

// ══════════════════════════════════════════════════════════════
//  PHASE 5 — Job Filter + Tags + Final Star
// ══════════════════════════════════════════════════════════════

// ── Job status filter ─────────────────────────────────────────
var _jobFilter = 'all';
var _jobTagFilter = null;

function setJobFilter(f){
  _jobFilter = f;
  var bgMap={all:'rgba(88,166,255,.12)',completed:'rgba(63,185,80,.12)',failed:'rgba(248,81,73,.12)',running:'rgba(210,153,34,.12)'};
  var bdMap={all:'rgba(88,166,255,.45)',completed:'rgba(63,185,80,.45)',failed:'rgba(248,81,73,.45)',running:'rgba(210,153,34,.45)'};
  var txMap={all:'var(--ac)',completed:'var(--gn)',failed:'var(--rd)',running:'var(--yl)'};
  document.querySelectorAll('.job-filter-btn').forEach(function(btn){
    var isOn=btn.dataset.filter===f;
    btn.classList.toggle('on',isOn);
    btn.style.color=txMap[btn.dataset.filter]||'var(--dm)';
    btn.style.opacity=isOn?'1':'0.55';
    btn.style.borderColor=isOn?bdMap[btn.dataset.filter]||'var(--ac)':'var(--bd)';
    btn.style.background=isOn?bgMap[btn.dataset.filter]||'rgba(88,166,255,.1)':'var(--sf2)';
    btn.style.fontWeight=isOn?'700':'500';
  });
  loadJobs();
}


function _updateJobTagFilterRow(allTags){
  var row = document.getElementById('jobTagFilterRow');
  var chips = document.getElementById('jobTagFilterChips');
  if(!row || !chips) return;
  var tags = Object.keys(allTags);
  if(!tags.length){ row.style.display='none'; return; }
  row.style.display = 'flex';
  chips.innerHTML = tags.slice(0,10).map(function(t){
    var active = _jobTagFilter === t;
    var isFinal = t === 'final';
    return '<button onclick="toggleJobTagFilter(\''+t+'\')" '
      +'style="all:unset;cursor:pointer;font-size:.6rem;padding:.1rem .3rem;border-radius:3px;'
      +'border:0.5px solid '+(active?'var(--ac)':'var(--bd)')+';'
      +'color:'+(active?'var(--ac)':isFinal?'var(--yl)':'var(--dm)')+';'
      +'background:'+(active?'rgba(88,166,255,.1)':'var(--sf2)')+';white-space:nowrap">'
      +(isFinal?'★ ':'')
      +t+' ('+allTags[t]+')</button>';
  }).join('');
}

function toggleJobTagFilter(tag){
  _jobTagFilter = (_jobTagFilter === tag) ? null : tag;
  loadJobs();
}

function clearJobTagFilter(){
  _jobTagFilter = null;
  loadJobs();
}

// ── Compare mode state (may not be defined if Phase 4 not applied) ──
if(typeof _compareMode === 'undefined') var _compareMode = false;
if(typeof _compareSelected === 'undefined') var _compareSelected = [];

function toggleCompareMode(){
  _compareMode = !_compareMode;
  var btn = document.getElementById('compareModeBtn');
  if(btn){
    btn.style.borderColor = _compareMode?'var(--ac)':'var(--bd)';
    btn.style.color = _compareMode?'var(--ac)':'var(--dm)';
    btn.style.background = _compareMode?'rgba(88,166,255,.1)':'var(--sf2)';
  }
  if(!_compareMode){ _compareSelected=[]; _updateCompareBar(); }
  loadJobs();
}

function _toggleJobSelect(jobId){
  var idx = _compareSelected.indexOf(jobId);
  if(idx===-1){ if(_compareSelected.length>=4)return; _compareSelected.push(jobId); }
  else _compareSelected.splice(idx,1);
  _updateCompareBar();
  var cb = document.querySelector('[data-compare-cb="'+jobId+'"]');
  if(cb) cb.checked = _compareSelected.includes(jobId);
}

function _updateCompareBar(){
  var bar=document.getElementById('compareBar');
  var lbl=document.getElementById('compareBarLabel');
  var n=_compareSelected.length;
  if(bar) bar.style.display=(_compareMode&&n>0)?'flex':'none';
  if(lbl) lbl.textContent=n===1?'1 job selected — pick 1 more':(n>1?n+' jobs selected':'');
}

function clearCompareSelection(){
  _compareSelected=[];
  _updateCompareBar();
  loadJobs();
}

// ── Mark as Final (from job detail panel) ─────────────────────
async function jdpMarkFinal(){
  if(!jdpCurrentJob) return;
  var tags = Array.from(new Set([...(jdpCurrentJob.tags||[]),'final']));
  jdpCurrentJob.tags = tags;
  jdpRenderTags(tags);
  _updateFinalBtn(true);
  // Save immediately
  try{
    await fetch('/api/projects/'+curProj+'/jobs/'+jdpCurrentJob.job_id,{
      method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tags})
    });
    await post('/api/notes',{project:curProj,text:'**'+jdpCurrentJob.job_id+'** marked as `final`.'});
    loadJobs();
  }catch(e){ console.error('markFinal',e); }
}

function _updateFinalBtn(isFinal){
  var btn = document.getElementById('jdpFinalBtn');
  if(!btn) return;
  if(isFinal){
    btn.textContent='★ Final';
    btn.style.color='var(--yl)'; btn.style.borderColor='rgba(210,153,34,.5)';
    btn.style.background='rgba(210,153,34,.1)';
  } else {
    btn.textContent='★ Mark Final';
    btn.style.color='var(--dm)'; btn.style.borderColor='var(--bd)';
    btn.style.background='var(--sf2)';
  }
}

function jdpFinalBtnHoverOut(){
  var isFinal = jdpCurrentJob&&(jdpCurrentJob.tags||[]).includes('final');
  if(!isFinal){
    var btn=document.getElementById('jdpFinalBtn');
    if(btn){btn.style.borderColor='var(--bd)';btn.style.color='var(--dm)';}
  }
}

// ── Tag suggestions ───────────────────────────────────────────
var _SUGGESTED_TAGS = [
  'final','preferred','test','bin4','bin8','best-resolution',
  'failed-convergence','too-aggressive','for-comparison','noise'
];

function jdpShowTagSuggestions(filter){
  var el = document.getElementById('jdpTagSuggest');
  if(!el) return;
  var existing = jdpCurrentJob?(jdpCurrentJob.tags||[]):[];
  var suggestions = _SUGGESTED_TAGS.filter(function(t){
    return !existing.includes(t) && (!filter||t.includes(filter));
  }).slice(0,6);
  el.innerHTML = suggestions.map(function(t){
    return '<button class="tag-suggest" onclick="jdpAddTagDirect(\''+t+'\')">'
      +(t==='final'?'★ ':'')+t+'</button>';
  }).join('');
}

function jdpAddTagDirect(tag){
  if(!jdpCurrentJob) return;
  if(!jdpCurrentJob.tags) jdpCurrentJob.tags=[];
  if(!jdpCurrentJob.tags.includes(tag)) jdpCurrentJob.tags.push(tag);
  jdpRenderTags(jdpCurrentJob.tags);
  jdpShowTagSuggestions('');
  if(tag==='final') _updateFinalBtn(true);
}

function jdpTagInputFilter(){
  var val = (document.getElementById('jdpTagInput')?.value||'').trim().toLowerCase();
  jdpShowTagSuggestions(val);
}

// Patch jdpOpen to update final btn and show suggestions
var _origJdpOpen = null;
function _patchJdpOpen(){
  if(_origJdpOpen||typeof jdpOpen==='undefined') return;
  _origJdpOpen = window.jdpOpen;
  window.jdpOpen = async function(jobId){
    await _origJdpOpen(jobId);
    var isFinal = jdpCurrentJob&&(jdpCurrentJob.tags||[]).includes('final');
    _updateFinalBtn(isFinal);
    jdpShowTagSuggestions('');
  };
}

// Reset filters on project change
function phase5OnProjectOpen(){
  _jobFilter='all';_jobTagFilter=null;
  document.querySelectorAll('.job-filter-btn').forEach(function(b){
    b.classList.toggle('on', b.dataset.filter==='all');
  });
}

async function init(){
  try{
    const h=await api('/api/health');
    $('stTxt').textContent='Connected';$('st').classList.add('ok');$('wsP').textContent=h.workspace;
    if(h.scripts_dir)window._raScriptsDir=h.scripts_dir;
    if(h.python_executable)window._raPythonExe=h.python_executable;
  }
  catch(e){$('stTxt').textContent='Offline'}
  loadProj();loadTpl();brGo('.');renderBoxGrid('boxGrid',0);icInitAll();_uPatchCTab();_patchJdpOpen();execModeUpdateWarnings('');
  // Start right panel collapsed
  // Right panel: start collapsed but header always visible
  var r=document.getElementById('right');if(r)r.classList.add('right-panel-collapsed');
  // Hide float btn (no longer needed since header is always visible)
  var f=document.getElementById('newJobFloatBtn');if(f)f.style.display='none';
  // Show placeholder in job builder when no job selected
  const ph=$('jobPlaceholder');if(ph)ph.style.display='block';
}

// ── Projects ──
async function loadProj(){
  try{
    const d=await api('/api/projects');
    $('projList').innerHTML=d.projects.length
      ? d.projects.map(p=>{
          const noData=!p.pixel_size||p.pixel_size===0||!p.tomo_dims||!p.tomo_dims.length;
          const inv=(p.investigators||[]).join(', ');
          return `<div class="pi ${curProj===p.folder?'on':''}" onclick="selProj('${p.folder}')">
            <div class="pi-row"><span class="pin">${p.name}</span>
              ${noData?'<span class="pi-setup">setup</span>':''}<span class="pib">${p.n_jobs} Jobs</span></div>
            ${inv?`<div class="pi-inv">${inv}</div>`:''}
          </div>`;
        }).join('')
      :'<div class="dim" style="padding:.4rem .7rem;font-size:.75rem">No projects yet</div>';
  }catch(e){$('projList').innerHTML=`<div class="dim" style="padding:.4rem .7rem">${e.message}</div>`}
}

// ── Processing Pipeline strip ──
// Defines the canonical pipeline steps, each mapped to job_type IDs
// Each step carries its category color and a dot indicator
// Job type → category color class
const JOB_CAT = {
  link_reconstruction:'cat-import', copy_xmls:'cat-import',
  extract_xml:'cat-import', slabify:'cat-import',
  create_template:'cat-pytom', create_mask:'cat-pytom',
  tm_single:'cat-pytom', tm_batch:'cat-pytom',
  extract_single:'cat-pytom', extract_batch:'cat-pytom',
  merge_stars:'cat-pytom', ang_to_pix:'cat-pytom',
  mtools_create_population:'cat-mtools', mtools_create_source:'cat-mtools',
  mtools_create_species:'cat-mtools', mcore_sanity_check:'cat-mtools', mcore_refine:'cat-mtools', mcore_ctf_refine:'cat-mtools',
  warp_create_settings_fs:'cat-warp-preproc', warp_create_settings_ts:'cat-warp-preproc',
  warp_fs_motion_ctf:'cat-warp-preproc', warp_filter_quality:'cat-warp-preproc',
  warp_ts_import:'cat-warp-preproc', warp_ts_etomo:'cat-warp-preproc',
  warp_ts_import_alignments:'cat-warp-preproc', warp_ts_defocus_hand:'cat-warp-preproc',
  warp_ts_ctf:'cat-warp-preproc', warp_ts_reconstruct:'cat-warp-preproc',
  warp_export_particles:'cat-warp', warp_export_slurm:'cat-warp',
  pytom2warp_convert:'cat-warp', star_score_match:'cat-warp',
  tm_analysis:'cat-pytom', relion_handler:'cat-other',
  xml_backup:'cat-other', mod2star:'cat-other',
  custom:'cat-other',
  isonet_denoise:'cat-other', star_recenter:'cat-other',
  relion_class3d:'cat-relion', relion_initial_model:'cat-relion',
  relion_class3d_align:'cat-relion', relion_class3d_noalign:'cat-relion',
  relion_select:'cat-relion', relion_mask_create:'cat-relion',
  relion_refine3d:'cat-relion', relion_postprocess:'cat-relion',
  aretomo3_mdoc_fix:'cat-aretomo3', aretomo3_batch:'cat-aretomo3', aretomo3_collect:'cat-aretomo3',
};

// Semantic tag → category class override
const TAG_CAT = {
  import:'cat-import', setup:'cat-import', xml:'cat-import',
  import_frames_warp:'cat-import', import_mdocs_warp:'cat-import',
  import_frames_aretomo3:'cat-import', import_mdocs_aretomo3:'cat-import', import_gainref:'cat-import',
  metadata:'cat-import', mask:'cat-import', lamella:'cat-import',
  template:'cat-pytom', emdb:'cat-pytom', tm:'cat-pytom',
  batch:'cat-pytom', single:'cat-pytom', extract:'cat-pytom',
  merge:'cat-pytom', test:'cat-meta', analysis:'cat-pytom',
  qc:'cat-meta', snr:'cat-meta', scores:'cat-warp',
  warptools:'cat-warp', extraction:'cat-warp', convert:'cat-warp',
  coordinates:'cat-warp', failed:'cat-meta', oom:'cat-meta',
  running:'cat-meta', final:'cat-meta', bin8:'cat-meta',
  bin4:'cat-meta', v2:'cat-meta', star:'cat-other',
  'bug-fix':'cat-warp',
};

function tagClass(tag, jobType){
  if(TAG_CAT[tag])return TAG_CAT[tag];
  if(jobType&&JOB_CAT[jobType])return JOB_CAT[jobType];
  return 'cat-meta';
}

const WF_STEPS = [
  { label: 'Import',         tab: 'tomo',      color: '#f59e0b', jobs: ['import_frames_warp','import_mdocs_warp','import_frames_aretomo3','import_mdocs_aretomo3','import_gainref','link_reconstruction','copy_xmls','extract_xml','slabify'] },
  { label: 'PyTom',          tab: 'particles', color: '#22c55e', jobs: ['create_template','create_mask','tm_single','tm_batch','extract_single','extract_batch','merge_stars','tm_analysis'] },
  { label: 'Pre-Processing', tab: 'preproc',   color: '#a78bfa', jobs: ['warp_create_settings_fs','warp_create_settings_ts','warp_fs_motion_ctf','warp_filter_quality','warp_ts_import','warp_ts_etomo','warp_ts_import_alignments','warp_ts_defocus_hand','warp_ts_ctf','warp_ts_reconstruct'] },
  { label: 'Warp M',         tab: 'warptools', color: '#a78bfa', jobs: ['warp_export_particles','warp_export_slurm','mtools_create_population','mtools_create_source','mtools_create_species','mcore_sanity_check','mcore_refine','mcore_ctf_refine'] },
  { label: 'RELION',         tab: 'relion',    color: '#3b82f6', jobs: [
    'relion_initial_model',
    'relion_class3d','relion_class3d_align','relion_class3d_noalign',
    'relion_select',
    'relion_mask_create','relion_refine3d','relion_postprocess'
  ]},
  { label: 'Miss Alignment', tab: 'missalign', color: '#a78bfa', jobs: ['miss_alignment_train'] },
  { label: 'Other',          tab: null,        color: '#888780', jobs: ['xml_backup','relion_handler','mod2star','isonet_denoise','star_recenter','custom'] },
  { label: 'Convert',        tab: null,        color: '#888780', jobs: ['pytom2warp_convert','star_score_match'] },
];

function renderWorkflowStrip(jobs){
  const strip=$('wfStrip');
  if(!strip)return;

  // Build map: job_type → highest-priority status
  const byType={};
  const rank={running:5,failed:4,completed:3,cancelled:2,queued:1};
  jobs.forEach(j=>{
    const prev=byType[j.job_type];
    if(!prev||(rank[j.status]||0)>(rank[prev]||0)) byType[j.job_type]=j.status;
  });

  strip.style.display='flex';
  strip.innerHTML=WF_STEPS.map(step=>{
    const col=step.color;
    const statuses=step.jobs.map(jt=>byType[jt]).filter(Boolean);
    const hasRunning=statuses.includes('running');
    const hasFailed=statuses.includes('failed');
    const anyDone=statuses.some(s=>s==='completed');
    const anyQueued=statuses.some(s=>s==='queued');

    // Determine state
    let state='none'; // no jobs at all
    if(hasRunning)       state='running';
    else if(hasFailed)   state='failed';
    else if(anyDone)     state='done';
    else if(anyQueued)   state='queued';

    // Status text and colors
    const STATE={
      none:    { text:'No jobs',    dotBg:'var(--rd)',  dotBorder:'rgba(248,81,73,.4)',  labelCol:'var(--dm)',   textCol:'var(--rd)',  barW:'100%', barOpacity:'.18' },
      queued:  { text:'Queued',     dotBg:'var(--yl)',  dotBorder:'rgba(210,153,34,.4)', labelCol:'var(--yl)',   textCol:'var(--yl)',  barW:'100%', barOpacity:'.22' },
      running: { text:'In progress',dotBg:col,          dotBorder:col+'66',             labelCol:col,           textCol:col,          barW:'100%', barOpacity:'.35' },
      failed:  { text:'Failed',     dotBg:'var(--rd)',  dotBorder:'rgba(248,81,73,.5)', labelCol:'var(--rd)',   textCol:'var(--rd)',  barW:'100%', barOpacity:'.3'  },
      done:    { text:'Completed',  dotBg:'var(--gn)',  dotBorder:'rgba(63,185,80,.4)', labelCol:col,           textCol:'var(--gn)', barW:'100%', barOpacity:'.5'  },
    };
    const s=STATE[state];
    const doneCount=statuses.filter(x=>x==='completed').length;
    const statusText=state==='done'&&doneCount>1?`${doneCount} completed`:s.text;

    // All steps clickable: primary tab nav + job log accordion
    const tabClick='onclick="wfStepClick(event, \'' + step.jobs.join(',') + '\', \'' + step.label + '\')"';
    return `<div class="wf-step" style="border-right:0.5px solid var(--bd);cursor:pointer;
        border-left:3px solid ${col};padding-left:.45rem" ${tabClick}>
      <div style="display:flex;align-items:center;gap:.28rem;margin-bottom:.15rem">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;
          background:${s.dotBg};flex-shrink:0"></span>
        <span style="font-size:.58rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:var(--tx);white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis">${step.label}</span>
      </div>
      <div style="font-size:.66rem;color:${state==='none'?'var(--dm)':s.textCol};white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;font-weight:${state==='done'?'600':'400'}">${statusText}</div>
    </div>`;
  }).join('');
}

async function selProj(f){
  curProj=f;loadProj();nbPending=false;
  // Always show the Processing Pipeline pill when a project is open
  var bar=document.getElementById('wfBar');
  if(bar)bar.style.display='flex';
  var row=document.getElementById('workflowTabsRow');
  if(row)row.style.display='';
  $('vWelcome').style.display='none';$('vCreate').style.display='none';$('vProj').style.display='';
  try{
    const c=await api(`/api/projects/${f}/config`);
    window._lastConfig = c;  // Store for misc.js access
    // Sync _execMode from config so queue modal shows correct state
    // without requiring user to open the Computing tab first
    if(c.compute_execution_mode && typeof execModeSelect === 'function'){
      execModeSelect(c.compute_execution_mode);
    }
    $('pTitle').textContent=c.project_name||f;
    const inv=c.investigators||[];
    $('pInvestigators').innerHTML=inv.length
      ? inv.map(n=>`<strong>${n}</strong>`).join(' · ')
      :'<span style="color:var(--dm);font-size:.72rem">No investigators — add in People tab</span>';
    const hasData=c.pixel_size&&c.pixel_size>0&&c.tomo_dims&&c.tomo_dims.length;

    // ── Auto-fill WarpTools Particle Export fields from project config ──
    // expCoordsApx = binned pixel size (what WarpTools export uses as input)
    var expCApx=document.getElementById('expCoordsApx');
    if(expCApx&&!expCApx.value&&c.pixel_size&&c.pixel_size>0) expCApx.value=c.pixel_size;
    // expBoxIn = box size from particles tab
    var expBIn=document.getElementById('expBoxIn');
    if(expBIn&&!expBIn.value&&c.box_size&&c.box_size>0) expBIn.value=c.box_size;
    // expDiam = particle diameter from particles tab
    var expD=document.getElementById('expDiam');
    if(expD&&!expD.value&&c.particle_diameter&&c.particle_diameter>0) expD.value=c.particle_diameter;
    // Trigger recalculation
    if((expCApx&&expCApx.value)||(expBIn&&expBIn.value)) try{calcExport();}catch(e){}

    $('pInfo').innerHTML=hasData
      ? `<div>Pixel: <span>${c.pixel_size}Å</span></div>`+
        `<div>Raw: <span>${c.raw_pixel_size||'?'}Å × ${c.binning_factor||'?'}</span></div>`+
        `<div>Dims: <span>${c.tomo_dims.join('×')}</span></div>`+
        (c.box_size?`<div>Box: <span>${c.box_size}px</span></div>`:'')+
        (c.symmetry&&c.symmetry>1?`<div>Sym: <span>C${c.symmetry}</span></div>`:'')+
        (c.warptools_dir?`<div>Warp: <span>${tr(c.warptools_dir,20)}</span></div>`:'')+
        `<span id="pInfoParticles" style="margin-left:.3rem"></span>`
      : `<span class="pi-warn">Data collection not set</span>`;
    // Load particle count from last extract job
    api(`/api/projects/${f}/particles/count`).then(d=>{
      const el=document.getElementById('pInfoParticles');
      if(el&&d.count) el.innerHTML=`<div style="color:var(--gn);font-weight:600">${d.count.toLocaleString()} particles</div>`;
    }).catch(()=>{});
    var _sb=$('setupBanner');if(_sb)_sb.style.display=hasData?'none':'flex';

    // Update path display from config
    var projPath=(c.project_dir)||(c.warptools_dir?c.warptools_dir.split('/').slice(0,-1).join('/'):'');
    if(!projPath&&ws&&ws.workspace_dir)projPath=ws.workspace_dir+'/'+f;
    var pathEl=$('curPathText');
    if(pathEl&&projPath)pathEl.textContent=projPath;
    var pathWrap=$('curPathDisplay');
    if(pathWrap&&projPath)pathWrap.title='Project directory: '+projPath;

    // Tomo tab — only fill if value was explicitly saved (non-zero, non-empty)
    if(c.tomo_dims&&c.tomo_dims.length>=2&&c.tomo_dims[0]>0){
      $('tX').value=c.tomo_dims[0];$('tY').value=c.tomo_dims[1];
      if(c.tomo_dims.length>=3&&c.tomo_dims[2]>0) $('tZ').value=c.tomo_dims[2];
      console.log('[selProj] Tomo dimensions loaded:', c.tomo_dims);
    } else {
      console.log('[selProj] No tomo_dims in config or X=0');
    }
    const tomoMap={
      tRaw:'raw_pixel_size',tBin:'binning_factor',tVoltage:'voltage',
      tCs:'spherical_aberration',tAmpCon:'amplitude_contrast',
      tMicroscope:'microscope',tCamera:'camera',tMagnification:'magnification',
      tSlitWidth:'energy_filter_slit',tC2aperture:'c2_aperture',
      tDefocusMin:'defocus_min',tDefocusMax:'defocus_max',
      tCollSoftware:'collection_software',tCollSoftVer:'collection_software_version',
      tTiltScheme:'tilt_scheme',tTiltMin:'tilt_min',tTiltMax:'tilt_max',
      tTiltStep:'tilt_step',tStartAngle:'start_angle',tPreTilt:'pre_tilt',
      tTotalDose:'total_dose',tFlux:'flux',
      tNTilts:'n_tilts',tDosePerTilt:'dose_per_tilt',
      tFramesPerTilt:'frames_per_tilt',tCDSMode:'cds_mode',
      tSampleType:'sample_type',tLamellaThick:'lamella_thickness',
    };
    Object.keys(tomoMap).forEach(id=>{
      const key=tomoMap[id];
      const v=c[key];
      const el=$(id);
      if(!el)return;
      // Load value if it exists (including 0 for numeric fields)
      if(v!==undefined&&v!==null&&v!==''){
        el.value=v;
      } else {
        el.value='';
      }
    });
    console.log('[selProj] Tomo fields loaded:', {
      tomo_dims: c.tomo_dims,
      raw_pixel_size: c.raw_pixel_size,
      binning_factor: c.binning_factor,
      voltage: c.voltage
    });
    if(c.collection_date)$('tDate').value=c.collection_date;
    else $('tDate').value='';
    if(document.getElementById('tPreproVer'))document.getElementById('tPreproVer').value=c.warptools_version||'';
    if(c.pixel_size&&c.pixel_size>0)$('tActual').value=c.pixel_size+' Å/px';
    else $('tActual').value='';
    // (newTomoFields removed — covered by tomoMap loop above)
    // After loading, update auto-calculations
    if(typeof updateTiltCalculations === 'function') updateTiltCalculations();
    // Sync frames to m_grid display
    if(c.frames_per_tilt){var mg=$('tMGridCalc');if(mg)mg.value='1x1x'+c.frames_per_tilt;}
    calcPx('t');

    // Sample — only fill if explicitly saved
    $('sDate').value=c.sample_prep_date||'';
    $('sDesc').value=c.sample_description||'';
    $('sProto').value=c.sample_protocols||'';

    // Particles
    if(c.particle_diameter)$('pDiam').value=c.particle_diameter;
    if(c.box_size)$('pBox').value=c.box_size;
    // Restore binning selector — find which binning the saved box_size corresponds to
    var _bsBin = document.getElementById('pBoxBinning');
    if(_bsBin && c.box_sizes_by_binning && Object.keys(c.box_sizes_by_binning).length>0){
      // Pick the binning that has a saved box_size — prefer highest binning
      var _savedBins = Object.keys(c.box_sizes_by_binning).map(Number).sort((a,b)=>b-a);
      if(_savedBins.length>0) _bsBin.value = String(_savedBins[0]);
    } else if(_bsBin && c.binning_factor){
      _bsBin.value = String(c.binning_factor);
    }
    if(c.symmetry)$('pSym').value=c.symmetry;
    if(c.mask_radius)$('pMask').value=c.mask_radius;
    renderBoxGrid('boxGrid',c.box_size||0);

    // Template checklist state
    tmCheckState=c.tm_check_state||{};
    renderTmChecklist();
    // Render stored status first, then recompute from DOM after prefill
    renderTabStatus(c.tab_status);
    setTimeout(tmaLoadHistory, 200);
    // Load warptools checklist state
    if(c.wt_check_state)wtCheckState=c.wt_check_state;
    else wtCheckState={};
    setTimeout(renderWtChecklist,100);
    // Short delay so DOM values are set before recomputing
    setTimeout(()=>{
      ['tomo','sample','particles','warptools','computing'].forEach(t=>{
        const s=computeTabStatus(t);
        const el=document.getElementById('ts-'+t);
        if(el){
          const icons={complete:'✓',partial:'⚠',empty:'⚠'};
          el.textContent=icons[s]||'';
          el.className='tab-status '+s;
        }
      });
      // People: use stored value
      const pEl=null//ts-people;
      const pts=(c.tab_status&&c.tab_status.people)||'empty';
      if(pEl){pEl.textContent=pts==='complete'?' ✓':pts==='partial'?' ⚠':pts==='empty'?' ⚠':'';pEl.className='tab-status '+pts;}
    },50);

    // WarpTools tab prefill — ONLY from warptools_version, not preprocessing_version
    if(c.tomo_suffix)document.getElementById('tSuffix').value=c.tomo_suffix;
    // Only fill tWarpVer if explicitly saved by saveWarpSettings
    var wv=document.getElementById('tWarpVer');
    if(wv)wv.value=c.warptools_version||'';
    if(c.warptools_settings){var ws2=document.getElementById('tWarpSettings');if(ws2)ws2.value=c.warptools_settings;}
    if(c.preprocessing_tool){var pt=document.getElementById('tPreproTool');if(pt){pt.value=c.preprocessing_tool||'warptools';checkPreproTool();}}
    var twd=document.getElementById('tWarpDir');
    if(twd){twd.value=c.warptools_dir||'';
      var twdp=document.getElementById('tWarpDirPreview');
      if(twdp&&c.warptools_dir)twdp.textContent='warp_tiltseries: '+c.warptools_dir+'/warp_tiltseries';}
    var nf=document.getElementById('tNoFlip');
    if(nf&&typeof c.use_no_flip!=='undefined')nf.value=c.use_no_flip?'true':'false';

    // Initial reference
    if(c.reference_method){
      const rm=c.reference_method==='pdb_molmap'?'pdb':c.reference_method==='manual_picking'?'manual':'';
      curRefMethod=rm;
      selectRef(rm);
    }
    if(c.reference_pdb_id)$('refPdbId').value=c.reference_pdb_id;
    if(c.reference_molmap_resolution)$('refPdbRes').value=c.reference_molmap_resolution;
    if(c.reference_pdb_id||c.reference_molmap_resolution)updateChimeraCmd();
    if(c.reference_picking_tool)$('refPickTool').value=c.reference_picking_tool;
    if(c.reference_picking_resolution)$('refPickRes').value=c.reference_picking_resolution;
    if(c.reference_handedness)$('refHandedness').value=c.reference_handedness;
    checkHandedness();
    if(c.reference_notes){
      const m=c.reference_method;
      if(m==='pdb_molmap')$('refPdbNotes').value=c.reference_notes;
      else if(m==='manual_picking')$('refPickNotes').value=c.reference_notes;
    }

    // Computing
    execModeLoad();
    if(c.compute_type)selectCompute(c.compute_type);
    if(c.compute_host)$('compFriendlyName').value=c.compute_host;
    if(c.compute_scheduler)$('compScheduler').value=c.compute_scheduler;
    if(c.compute_gpus)$('compGPUs').value=c.compute_gpus;
    if(c.compute_notes)$('compNotes').value=c.compute_notes;
    var _sEl=document.getElementById('slabifyEnvName');if(_sEl)_sEl.value=c.slabify_env||'';
    var _sType=document.getElementById('slabifyEnvType');
    if(_sType&&c.slabify_cmd){
      if(c.slabify_cmd.indexOf('conda run')>=0)_sType.value='conda';
      else if(c.slabify_cmd.indexOf('source')>=0)_sType.value='venv';
      else _sType.value='custom';
    }
    slabifyUpdateCmd();

    // Unit calc from project pixel size
    if(c.pixel_size&&c.pixel_size>0)$('ucPxSize').value=c.pixel_size;

    // Inv assignment
    renderInvAssign('tomoInvAssign',inv,c.collection_investigators||[]);
    renderInvAssign('sampleInvAssign',inv,c.sample_investigators||[]);
    renderInvAssign('particleInvAssign',inv,c.particle_investigators||[]);
    renderInvAssign('computeInvAssign',inv,c.compute_investigators||[]);

    // Connect tab
    renderConnections(c.connected_projects||[]);
  }catch(e){$('pTitle').textContent=f}
  curP=f;fGo(f);loadNotes();loadJobs();loadInvestigators();cTab('notes');
  $('jobsSec').style.display='';$('jobsProj').textContent=f.replace('_base','');
  $('wfSec').style.display='';$('wfProj').textContent=f.replace('_base','');
  loadWorkflows();
  if(typeof checkPreprocBanner==='function')checkPreprocBanner(f);
  if(typeof loadSharedPreprocessing==='function')loadSharedPreprocessing(f);
  const badge=$('nbBadge');if(badge)badge.classList.remove('show');
  // Prefill Inspect Data tab paths from project config (insLoadBadTilts handles the fetch+fill)
  if(typeof insLoadBadTilts==='function') setTimeout(insLoadBadTilts, 300);
}

// ── Investigator utils ──
function renderInvAssign(cid,all,assigned){
  const el=$(cid);if(!all||!all.length){el.innerHTML='<span class="dim" style="font-size:.72rem">No investigators — add in People tab first</span>';return}
  el.innerHTML='';
  all.forEach(function(n){
    const on=assigned.includes(n);
    const chip=document.createElement('span');
    chip.className='inv-assign-chip'+(on?' on':'');
    const dot=document.createElement('span');
    dot.className='dot-sm';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(n));
    chip.onclick=function(){chip.classList.toggle('on')};
    el.appendChild(chip);
  });
}
function getAssignedInv(cid){return Array.from(document.querySelectorAll(`#${cid} .inv-assign-chip.on`)).map(el=>el.textContent.trim())}
function toggleInvAssign(cid,name){const chip=Array.from(document.querySelectorAll(`#${cid} .inv-assign-chip`)).find(el=>el.textContent.trim()===name);if(chip)chip.classList.toggle('on')}
