/* CryoSTAR-Base — resources.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════════
//  PHASE 2 — Resource Monitor + Job Dashboard + Copy/Paste
// ══════════════════════════════════════════════════════════════

// ── GPU / System Resource polling ─────────────────────────────
var _resourcePollInterval = null;
var _gpuTooltipEl = null;

function resourcePollStart(){
  if(_resourcePollInterval) return;
  _resourcePollInterval = setInterval(resourcePollTick, 5000);
  resourcePollTick(); // immediate first tick
}

function resourcePollStop(){
  if(_resourcePollInterval){ clearInterval(_resourcePollInterval); _resourcePollInterval=null; }
  var chips = document.getElementById('gpuChips');
  if(chips){ chips.style.display='none'; chips.innerHTML=''; }
}

async function resourcePollTick(){
  try{
    var d = await api('/api/system/resources');
    renderGpuChips(d);
  }catch(e){ /* silent fail — server may not have psutil/nvidia-smi */ }
}

function renderGpuChips(data){
  var chips = document.getElementById('gpuChips');
  if(!chips) return;
  var gpus = data.gpus || [];
  if(!gpus.length && !data.available){ chips.style.display='none'; return; }

  var html = '';

  // GPU chips
  gpus.forEach(function(g){
    var label = 'GPU ' + g.index;
    if(g.utilization_pct > 0) label += ' ' + g.utilization_pct + '%';
    var tooltip = [
      '<strong>' + g.name + '</strong>',
      'VRAM: ' + g.mem_used_gb + ' / ' + g.mem_total_gb + ' GB',
      'Utilization: ' + g.utilization_pct + '%',
      'Status: ' + g.status
    ].join('<br>');
    html += '<div class="gpu-chip ' + g.status + '" data-tip="' + escAttr(tooltip) + '">'
          + '<div class="gpu-dot"></div>' + label + '</div>';
  });

  // CPU/RAM compact if no GPUs but psutil available
  if(!gpus.length && data.available){
    html += '<div class="gpu-chip" style="cursor:default">'
          + 'CPU ' + data.cpu_pct + '%'
          + ' · RAM ' + data.ram_used_gb + '/' + data.ram_total_gb + 'GB</div>';
  }

  chips.innerHTML = html;
  chips.style.display = html ? 'flex' : 'none';
  // Wire hover events via event delegation
  chips.onmouseenter = function(e){
    var chip = e.target.closest('.gpu-chip');
    if(chip) gpuTipShow(chip);
  };
  chips.onmouseleave = function(){ gpuTipHide(); };
}

function escAttr(s){ return s.replace(/'/g,"&#39;").replace(/"/g,'&quot;'); }

function gpuTipShow(el){
  gpuTipHide();
  var html = el.dataset.tip;
  if(!html) return;
  _gpuTooltipEl = document.createElement('div');
  _gpuTooltipEl.className = 'gpu-tooltip';
  _gpuTooltipEl.innerHTML = html;
  document.body.appendChild(_gpuTooltipEl);
  var r = el.getBoundingClientRect();
  _gpuTooltipEl.style.top  = (r.bottom + window.scrollY + 4) + 'px';
  _gpuTooltipEl.style.left = (r.left + window.scrollX) + 'px';
}

function gpuTipHide(){
  if(_gpuTooltipEl){ _gpuTooltipEl.remove(); _gpuTooltipEl=null; }
}


// ── Job Dashboard Card ─────────────────────────────────────────
async function showJobDashboard(jobId){
  if(!curProj || !jobId) return;
  try{
    var job = await api('/api/projects/'+curProj+'/jobs/'+jobId);
    var dash = await api('/api/projects/'+curProj+'/jobs/'+jobId+'/dashboard');
    renderDashCard(job, dash);
  }catch(e){ /* silent */ }
}

function renderDashCard(job, dash){
  var card = document.getElementById('jobDashCard');
  if(!card) return;

  // Header
  var titleEl = document.getElementById('dashCardTitle');
  var badgeEl = document.getElementById('dashCardBadge');
  var durEl   = document.getElementById('dashCardDuration');
  if(titleEl) titleEl.textContent = (job.custom_title||job.title||job.job_id);
  if(badgeEl){
    badgeEl.textContent = job.status;
    badgeEl.className = 'badge ' + (job.status==='completed'?'done':job.status==='failed'?'failed':'running');
  }
  if(durEl && dash.duration_str) durEl.textContent = dash.duration_str;

  // Metrics — pick the most relevant ones
  var metrics = buildMetrics(job, dash);
  var metricsEl = document.getElementById('dashCardMetrics');
  if(metricsEl){
    if(metrics.length){
      metricsEl.innerHTML = metrics.map(function(m){
        return '<div class="dash-metric"><span class="dash-metric-label">'+m.label+'</span>'
              +'<span class="dash-metric-value">'+m.value+'</span></div>';
      }).join('');
      metricsEl.style.display = 'flex';
    } else {
      metricsEl.style.display = 'none';
    }
  }

  // Output files
  var filesEl = document.getElementById('dashCardFiles');
  var noteEl  = document.getElementById('dashCardNoteLink');
  if(filesEl){
    var files = dash.output_files || [];
    if(files.length){
      filesEl.innerHTML = files.slice(0,5).map(function(f){
        return '<span class="dash-file-chip" title="'+f+'">'+f+'</span>';
      }).join('');
    } else {
      filesEl.innerHTML = '';
    }
  }
  if(noteEl) noteEl.style.display = 'inline';

  card.style.display = '';
}

function buildMetrics(job, dash){
  var m = [];
  // Priority order: tomograms, particles, aligned, score, classes, processed, collected
  var keys = [
    {k:'tomograms',      lk:'tomograms_label',  default_label:'Tomos'},
    {k:'particles',      lk:'particles_label',   default_label:'Particles'},
    {k:'aligned',        lk:'aligned_label',     default_label:'Aligned'},
    {k:'max_score',      lk:null,                default_label:'Max SNR', fmt:function(v){return v.toFixed(2);}},
    {k:'classes',        lk:null,                default_label:'Classes'},
    {k:'collected',      lk:'collected_label',   default_label:'Collected'},
    {k:'xf_files',       lk:null,                default_label:'Alignments'},
    {k:'star_files',     lk:null,                default_label:'STAR files'},
    {k:'settings_files', lk:null,                default_label:'Settings'},
  ];
  keys.forEach(function(spec){
    if(dash[spec.k] !== undefined && dash[spec.k] !== null){
      var label = (spec.lk && dash[spec.lk]) ? dash[spec.lk] : spec.default_label;
      var value = spec.fmt ? spec.fmt(dash[spec.k]) : String(dash[spec.k]);
      m.push({label:label, value:value});
    }
  });
  // Always add duration if available
  if(dash.duration_str && m.length > 0){
    m.push({label:'Duration', value:dash.duration_str});
  }
  return m.slice(0, 6); // max 6 metrics
}


// ── Parameter Copy/Paste ───────────────────────────────────────
var _paramClipboard = null; // {params, job_type, job_id, title}

async function jobCopyParams(jobId){
  if(!curProj || !jobId) return;
  try{
    var d = await post('/api/projects/'+curProj+'/jobs/'+jobId+'/copy_params', {});
    _paramClipboard = d;
    // Brief visual feedback
    var btn = document.querySelector('[data-copy-job="'+jobId+'"]');
    if(btn){ btn.textContent='✓ Copied'; setTimeout(function(){ btn.textContent='Copy params'; },1500); }
    // Show paste button if job builder is open and has a compatible type
    updatePasteBtn();
    return d;
  }catch(e){ console.error('copy_params failed', e); }
}

async function jobPasteParams(){
  if(!_paramClipboard || !curTpl) return;
  var params = _paramClipboard.params || {};
  var pasted = 0;
  (curTpl.parameters||[]).forEach(function(p){
    if(params[p.key] !== undefined){
      var el = document.getElementById('tp_'+p.key);
      if(el){ el.value = params[p.key]; pasted++; }
    }
  });
  updPrev();
  var btn = document.getElementById('pasteParamsBtn');
  if(btn && pasted > 0){
    btn.textContent = '✓ '+pasted+' pasted';
    setTimeout(function(){ updatePasteBtn(); }, 2000);
  }
}

function updatePasteBtn(){
  var btn = document.getElementById('pasteParamsBtn');
  if(!btn) return;
  if(_paramClipboard && curTpl){
    btn.style.display = '';
    // Check how many params match
    var params = _paramClipboard.params || {};
    var matchCount = (curTpl.parameters||[]).filter(function(p){
      return params[p.key] !== undefined;
    }).length;
    btn.textContent = matchCount > 0
      ? 'Paste params ('+matchCount+')'
      : 'Paste params (no match)';
    btn.disabled = matchCount === 0;
    btn.title = 'From: ' + (_paramClipboard.title||_paramClipboard.job_id||'?');
  } else {
    btn.style.display = 'none';
  }
}

// Keyboard shortcut: Cmd/Ctrl+Shift+C to copy from last completed job
document.addEventListener('keydown', function(e){
  if((e.metaKey||e.ctrlKey) && e.shiftKey && e.key==='c'){
    // Find most recent completed job
    if(!curProj) return;
    api('/api/projects/'+curProj+'/jobs').then(function(d){
      var completed = (d.jobs||[]).filter(function(j){return j.status==='completed';});
      if(completed.length) jobCopyParams(completed[completed.length-1].job_id);
    }).catch(function(){});
    e.preventDefault();
  }
  if((e.metaKey||e.ctrlKey) && e.shiftKey && e.key==='v'){
    jobPasteParams();
    e.preventDefault();
  }
});


// ── Auto-save Job Title ────────────────────────────────────────
var _titleSaveTimer = null;

function jdpTitleAutoSave(){
  // Called from job detail panel title input oninput
  if(!curProj || !jdpCurrentJob) return;
  var el = $('jdpTitle');
  if(!el) return;
  jdpCurrentJob.custom_title = el.value;
  clearTimeout(_titleSaveTimer);
  _titleSaveTimer = setTimeout(async function(){
    try{
      var r = await fetch('/api/projects/'+curProj+'/jobs/'+jdpCurrentJob.job_id+'/title', {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({title: el.value})
      });
      if(r.ok){
        // Brief "saved" indicator
        var ind = document.getElementById('titleSaveInd');
        if(ind){ ind.textContent='✓'; ind.style.opacity='1';
          setTimeout(function(){ind.style.opacity='0';},1200); }
      }
    }catch(e){}
  }, 600); // save 600ms after user stops typing
}

