/* CryoSTAR-Base — jobtree.js
   Job Tree modal — pipeline view (B) + table view (C) with toggle
   Depends on: core.js (api, $, curProj, JOB_CAT), jdp.js (jdpOpen)
   Lukas W. Bauer und Claude — 2026 */

var _jtJobs = [];
var _jtChildMap = {};   // jobId → [childIds]
var _jtSelJob = null;
var _jtView = 'pipeline';
var _jtCatFilter = null;

// Shared category color/label lookup for the Job Tree pipeline+table views
// (was copy-pasted 4x for colors, 2x for labels — kept as one source here).
var JT_CAT_COLORS = {
  'cat-import':'#f59e0b','cat-pytom':'#22c55e','cat-warp-preproc':'#a78bfa',
  'cat-warp':'#a78bfa','cat-relion':'#3b82f6','cat-mtools':'#a78bfa','cat-aretomo3':'#38bdf8','cat-other':'#888780'
};
var JT_CAT_NAMES = {
  'cat-import':'Import','cat-pytom':'PyTom','cat-warp-preproc':'Pre-Processing',
  'cat-warp':'Warp M','cat-relion':'RELION','cat-mtools':'M','cat-aretomo3':'AreTomo3','cat-other':'Other'
};

// ── Entry point ──────────────────────────────────────────────────────────────
async function openJobTreeModal(){
  if(!curProj){ alert('Open a project first.'); return; }
  const overlay = document.getElementById('jobTreeOverlay');
  if(!overlay) return;
  try{
    const d = await api('/api/projects/'+curProj+'/jobs');
    _jtJobs = d.jobs || [];
    _jtChildMap = _jtBuildChildMap(_jtJobs);
    _jtSelJob = null;
    _jtCatFilter = null;
    _jtView = 'pipeline';
    _jtRenderAll();
    overlay.style.display = '';
    // Update header
    const t = document.getElementById('jtTitle');
    if(t) t.textContent = 'Job Tree — '+(curProj||'');
    const b = document.getElementById('jtBadge');
    if(b) b.textContent = _jtJobs.length+' jobs';
    _jtUpdateToggleButtons();
    _jtRenderFilterBar();
  }catch(e){ console.error('openJobTreeModal',e); }
}

function closeJobTreeModal(){
  const o = document.getElementById('jobTreeOverlay');
  if(o) o.style.display = 'none';
}

// ── Build child map ───────────────────────────────────────────────────────────
function _jtBuildChildMap(jobs){
  var map = {};
  jobs.forEach(function(j){
    (j.parent_jobs||[]).forEach(function(pid){
      if(!map[pid]) map[pid] = [];
      if(!map[pid].includes(j.job_id)) map[pid].push(j.job_id);
    });
  });
  return map;
}

// ── View switching ───────────────────────────────────────────────────────────
function jtSwitchView(v){
  _jtView = v;
  _jtUpdateToggleButtons();
  document.getElementById('jtViewPipeline').style.display = v==='pipeline' ? '' : 'none';
  document.getElementById('jtViewTable').style.display    = v==='table'    ? '' : 'none';
}

function _jtUpdateToggleButtons(){
  var bB = document.getElementById('jtBtnB');
  var bC = document.getElementById('jtBtnC');
  if(!bB||!bC) return;
  var onStyle  = 'all:unset;cursor:pointer;font-size:.72rem;padding:.2rem .65rem;border-radius:4px;background:var(--sf);border:0.5px solid var(--bd);color:var(--tx);white-space:nowrap';
  var offStyle = 'all:unset;cursor:pointer;font-size:.72rem;padding:.2rem .65rem;border-radius:4px;background:transparent;color:var(--dm);white-space:nowrap';
  bB.style.cssText = _jtView==='pipeline' ? onStyle : offStyle;
  bC.style.cssText = _jtView==='table'    ? onStyle : offStyle;
}

// ── Filter bar ───────────────────────────────────────────────────────────────
function _jtRenderFilterBar(){
  var el = document.getElementById('jtFilters');
  if(!el) return;
  // Build unique categories
  var cats = {};
  _jtJobs.forEach(function(j){ if(j.job_type) cats[JOB_CAT[j.job_type]||'cat-other'] = true; });
  var html = '';
  Object.keys(cats).forEach(function(cat){
    var label = JT_CAT_NAMES[cat] || cat;
    var col   = JT_CAT_COLORS[cat] || '#888';
    var on    = _jtCatFilter === cat;
    html += '<button onclick="jtSetFilter(\''+cat+'\')" style="all:unset;cursor:pointer;'
      +'font-size:.68rem;padding:.15rem .55rem;border-radius:20px;'
      +'background:'+(on?'rgba('+_jtHexToRgb(col)+',.15)':'var(--sf2)')+';"'
      +'border:0.5px solid '+(on?col:'var(--bd)')+';color:'+(on?col:'var(--dm)')+'>'
      +label+'</button>';
  });
  el.innerHTML = html;
}

function jtSetFilter(cat){
  _jtCatFilter = (_jtCatFilter===cat) ? null : cat;
  _jtRenderAll();
  _jtRenderFilterBar();
}

function _jtHexToRgb(hex){
  var r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return r+','+g+','+b;
}

// ── Render both views ─────────────────────────────────────────────────────────
function _jtRenderAll(){
  var jobs = _jtCatFilter
    ? _jtJobs.filter(function(j){ return (JOB_CAT[j.job_type]||'cat-other')===_jtCatFilter; })
    : _jtJobs;
  _jtRenderPipeline(jobs);
  _jtRenderTable(jobs);
  jtSwitchView(_jtView);
}

// ── Pipeline view (B) ─────────────────────────────────────────────────────────
function _jtRenderPipeline(jobs){
  var el = document.getElementById('jtPipelineContent');
  if(!el) return;

  // Group by category preserving order
  var lanes = {};
  var laneOrder = [];
  jobs.forEach(function(j){
    var cat = JOB_CAT[j.job_type] || 'cat-other';
    if(!lanes[cat]){ lanes[cat]=[]; laneOrder.push(cat); }
    lanes[cat].push(j);
  });

  var html = '';
  laneOrder.forEach(function(cat){
    var col = JT_CAT_COLORS[cat]||'#888';
    var lname = JT_CAT_NAMES[cat]||cat;
    var items = lanes[cat];
    html += '<div style="margin-bottom:10px">';
    html += '<div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;'
      +'color:'+col+';padding:0 0 6px 2px">'+lname+'</div>';
    html += '<div style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:0;row-gap:6px">';
    items.forEach(function(j, idx){
      var isSel = _jtSelJob && _jtSelJob.job_id===j.job_id;
      var isFinal = (j.tags||[]).includes('final');
      var displayTitle = j.custom_title||j.title||j.job_type;
      var customTitle  = (j.custom_title && j.custom_title!==displayTitle) ? j.custom_title : '';
      var statusCol = j.status==='completed'?'#3B6D11':j.status==='running'?'#BA7517':j.status==='failed'?'#A32D2D':'#888780';
      var statusLbl = j.status==='completed'?'done':j.status;
      var isGpu = false;
      // check job_type compute from cached templates if available
      var nodeStyle = 'display:inline-flex;flex-direction:column;width:108px;flex-shrink:0;'
        +'background:var(--sf);border:'+(isSel?'1.5px solid '+col:'0.5px solid var(--bd)')+';;'
        +'border-radius:7px;padding:6px 8px;cursor:pointer;transition:border-color .1s;'
        +(isSel?'background:rgba('+_jtHexToRgb(col)+',.08)':'');
      html += '<div style="'+nodeStyle+'" onclick="jtSelectJob(\''+j.job_id+'\')">';
      html += '<div style="font-size:.6rem;font-family:monospace;color:var(--dm);margin-bottom:1px">'
        +j.job_id+(isFinal?' ★':'')+'</div>';
      html += '<div style="font-size:.72rem;font-weight:600;color:var(--tx);line-height:1.3;margin-bottom:1px">'
        +(j.title||j.job_type)+'</div>';
      if(j.custom_title && j.custom_title!==(j.title||j.job_type)){
        html += '<div style="font-size:.65rem;color:var(--dm);line-height:1.3">'+j.custom_title+'</div>';
      }
      html += '<div style="height:2px;border-radius:1px;margin-top:4px;background:'+col+'"></div>';
      html += '<div style="margin-top:3px"><span style="font-size:.6rem;padding:1px 5px;border-radius:20px;'
        +'background:rgba('+_jtHexToRgb(statusCol)+',.12);color:'+statusCol+'">'+statusLbl+'</span></div>';
      html += '</div>';
      // Arrow between items in the same lane
      if(idx < items.length-1){
        html += '<div style="display:flex;align-items:center;flex-shrink:0;width:16px;height:62px">'
          +'<div style="height:1px;width:10px;background:var(--bd)"></div>'
          +'<div style="width:0;height:0;border-top:3px solid transparent;border-bottom:3px solid transparent;border-left:5px solid var(--bd)"></div>'
          +'</div>';
      }
    });
    html += '</div></div>';
  });

  if(!html) html = '<div style="padding:1.5rem;text-align:center;font-size:.78rem;color:var(--dm)">No jobs yet</div>';
  el.innerHTML = html;
}

// ── Table view (C) ────────────────────────────────────────────────────────────
function _jtRenderTable(jobs){
  var tbody = document.getElementById('jtTableBody');
  if(!tbody) return;

  var html = '';
  jobs.forEach(function(j){
    var isSel = _jtSelJob && _jtSelJob.job_id===j.job_id;
    var cat   = JOB_CAT[j.job_type]||'cat-other';
    var col   = JT_CAT_COLORS[cat]||'#888';
    var isFinal = (j.tags||[]).includes('final');
    var statusCol = j.status==='completed'?'#3B6D11':j.status==='running'?'#BA7517':j.status==='failed'?'#A32D2D':'#888780';
    var statusLbl = j.status==='completed'?'done':j.status;

    // Key params: grab first 2-3 important ones
    var params = j.parameters||{};
    var keyPs = [];
    ['T','K','ini_high','lowpass','sigma_ang_flag','angpix','box_size'].forEach(function(k){
      if(params[k]&&String(params[k]).trim()){
        var v = String(params[k]).trim();
        if(v.startsWith('--')) v = v.replace('--','');
        keyPs.push(k+'='+v.slice(0,8));
      }
    });
    var keyStr = keyPs.slice(0,3).join(' · ');

    // Parents
    var parents = (j.parent_jobs||[]).map(function(pid){
      var pj = _jtJobs.find(function(x){return x.job_id===pid;});
      var plabel = pj ? (pj.custom_title||pj.title||pj.job_type) : pid;
      return '<span onclick="event.stopPropagation();jtSelectJob(\''+pid+'\')" title="'+plabel+'" '
        +'style="display:inline-flex;font-size:.65rem;padding:1px 5px;border-radius:20px;cursor:pointer;margin:1px;'
        +'background:var(--sf2);color:var(--dm);border:0.5px solid var(--bd)">'+pid+'</span>';
    }).join('');

    // Children
    var children = (_jtChildMap[j.job_id]||[]).map(function(cid){
      var cj = _jtJobs.find(function(x){return x.job_id===cid;});
      var clabel = cj ? (cj.custom_title||cj.title||cj.job_type) : cid;
      return '<span onclick="event.stopPropagation();jtSelectJob(\''+cid+'\')" title="'+clabel+'" '
        +'style="display:inline-flex;font-size:.65rem;padding:1px 5px;border-radius:20px;cursor:pointer;margin:1px;'
        +'background:rgba('+_jtHexToRgb(col)+',.1);color:'+col+';border:0.5px solid rgba('+_jtHexToRgb(col)+',.3)">'+cid+'</span>';
    }).join('');

    // Duration
    var dur = '';
    if(j.started_at&&j.finished_at){
      try{
        var secs = Math.round((new Date(j.finished_at)-new Date(j.started_at))/1000);
        dur = secs<60 ? secs+'s' : Math.floor(secs/60)+'m '+Math.round(secs%60)+'s';
      }catch(e){}
    }

    var rowBg = isSel ? 'rgba('+_jtHexToRgb(col)+',.06)' : '';
    html += '<tr onclick="jtSelectJob(\''+j.job_id+'\')" style="cursor:pointer;'
      +'border-bottom:0.5px solid var(--bd);background:'+rowBg+'" '
      +'onmouseover="this.style.background=\'var(--sf2)\'" '
      +'onmouseout="this.style.background=\''+rowBg+'\'" id="jtr-'+j.job_id+'">';

    html += '<td style="padding:.38rem .7rem;font-size:.68rem;font-family:monospace;color:var(--dm);white-space:nowrap">'
      +'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:'+col+';margin-right:4px;vertical-align:middle"></span>'
      +j.job_id+(isFinal?'<span style="color:#3B6D11;margin-left:2px">★</span>':'')+'</td>';

    html += '<td style="padding:.38rem .7rem"><div style="display:flex;flex-direction:column">'
      +'<span style="font-size:.73rem;font-weight:600;color:var(--tx)">'+(j.title||j.job_type)+'</span>'
      +(j.custom_title&&j.custom_title!==(j.title||j.job_type)
        ?'<span style="font-size:.67rem;color:var(--dm)">'+j.custom_title+'</span>':'')
      +'</div></td>';

    html += '<td style="padding:.38rem .7rem"><span style="font-size:.63rem;padding:1px 5px;border-radius:20px;'
      +'background:rgba('+_jtHexToRgb(statusCol)+',.12);color:'+statusCol+'">'+statusLbl+'</span></td>';

    html += '<td style="padding:.38rem .7rem;font-size:.65rem;font-family:monospace;color:var(--dm);'
      +'max-width:115px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+keyStr+'">'
      +(keyStr||'—')+'</td>';

    html += '<td style="padding:.38rem .7rem">'+(parents||'<span style="color:var(--dm);font-size:.65rem">—</span>')+'</td>';
    html += '<td style="padding:.38rem .7rem">'+(children||'<span style="color:var(--dm);font-size:.65rem">—</span>')+'</td>';
    html += '<td style="padding:.38rem .7rem;font-size:.65rem;color:var(--dm);white-space:nowrap">'+(dur||'—')+'</td>';
    html += '</tr>';
  });

  tbody.innerHTML = html || '<tr><td colspan="7" style="padding:1.5rem;text-align:center;font-size:.78rem;color:var(--dm)">No jobs yet</td></tr>';
}

// ── Job selection ─────────────────────────────────────────────────────────────
function jtSelectJob(jid){
  _jtSelJob = _jtJobs.find(function(j){return j.job_id===jid;});
  if(!_jtSelJob) return;
  _jtRenderAll();
  _jtRenderDetailBar(_jtSelJob);
}

function _jtRenderDetailBar(j){
  var bar = document.getElementById('jtDetailBar');
  var content = document.getElementById('jtDetailContent');
  if(!bar||!content) return;
  bar.style.display = 'flex';

  var col = JT_CAT_COLORS[JOB_CAT[j.job_type]||'cat-other']||'#888';

  var sectionStyle = 'min-width:80px';
  var labelStyle = 'font-size:.6rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dm);margin-bottom:2px';
  var valStyle = 'font-size:.75rem;color:var(--tx)';

  var html = '<div style="'+sectionStyle+'">'
    +'<div style="'+labelStyle+'">'+(j.custom_title&&j.custom_title!==(j.title||j.job_type)?'Custom title':'Job')+'</div>'
    +'<div style="font-size:.78rem;font-weight:600;color:'+col+'">'
    +(j.custom_title||j.title||j.job_type)+'</div>'
    +(j.custom_title&&j.custom_title!==(j.title||j.job_type)?'<div style="font-size:.65rem;color:var(--dm)">'+j.job_id+' · '+(j.title||j.job_type)+'</div>':'<div style="font-size:.65rem;color:var(--dm)">'+j.job_id+'</div>')
    +'</div>';

  // Parents
  var parents = j.parent_jobs||[];
  if(parents.length){
    html += '<div style="'+sectionStyle+'">'
      +'<div style="'+labelStyle+'">Inputs from</div><div>';
    parents.forEach(function(pid){
      var pj = _jtJobs.find(function(x){return x.job_id===pid;});
      html += '<span onclick="jtSelectJob(\''+pid+'\')" style="display:inline-flex;font-size:.65rem;'
        +'padding:1px 6px;border-radius:20px;cursor:pointer;margin:1px;'
        +'background:var(--sf2);color:var(--dm);border:0.5px solid var(--bd)">'
        +pid+(pj?' · '+(pj.custom_title||pj.title||pj.job_type).slice(0,12):'')+'</span>';
    });
    html += '</div></div>';
  }

  // Children
  var children = _jtChildMap[j.job_id]||[];
  if(children.length){
    html += '<div style="'+sectionStyle+'">'
      +'<div style="'+labelStyle+'">Used by</div><div>';
    children.forEach(function(cid){
      var cj = _jtJobs.find(function(x){return x.job_id===cid;});
      html += '<span onclick="jtSelectJob(\''+cid+'\')" style="display:inline-flex;font-size:.65rem;'
        +'padding:1px 6px;border-radius:20px;cursor:pointer;margin:1px;'
        +'background:rgba('+_jtHexToRgb(col)+',.1);color:'+col+';border:0.5px solid rgba('+_jtHexToRgb(col)+',.3)">'
        +cid+(cj?' · '+(cj.custom_title||cj.title||cj.job_type).slice(0,12):'')+'</span>';
    });
    html += '</div></div>';
  }

  // Status + duration
  var statusCol = j.status==='completed'?'#3B6D11':j.status==='running'?'#BA7517':j.status==='failed'?'#A32D2D':'#888780';
  var dur = '';
  if(j.started_at&&j.finished_at){
    try{
      var secs = Math.round((new Date(j.finished_at)-new Date(j.started_at))/1000);
      dur = secs<60?secs+'s':Math.floor(secs/60)+'m '+Math.round(secs%60)+'s';
    }catch(e){}
  }
  html += '<div style="'+sectionStyle+'">'
    +'<div style="'+labelStyle+'">Status</div>'
    +'<span style="font-size:.7rem;padding:2px 7px;border-radius:20px;'
    +'background:rgba('+_jtHexToRgb(statusCol)+',.12);color:'+statusCol+'">'
    +j.status+(dur?' · '+dur:'')+'</span></div>';

  content.innerHTML = html;
}

// ── Actions ───────────────────────────────────────────────────────────────────
function jtOpenJobDetail(){
  if(!_jtSelJob) return;
  closeJobTreeModal();
  jdpOpen(_jtSelJob.job_id);
}

function jtViewJobLog(){
  if(!_jtSelJob) return;
  closeJobTreeModal();
  jdpOpen(_jtSelJob.job_id);
  // jdpOpen already shows the log tab
}