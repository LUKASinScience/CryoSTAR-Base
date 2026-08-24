/* CryoSTAR-Base — queue.js
   Job Queue Panel — Direct submission mode only
   Depends on: core.js (api, post, $, curProj, _execMode)
   Lukas W. Bauer und Claude — 2026 */

// ── State ──────────────────────────────────────────────────────
var _queuePollInterval = null;
var _queuePanelOpen   = false;

// ── Panel open/close ───────────────────────────────────────────
function toggleQueuePanel(){
  _queuePanelOpen = !_queuePanelOpen;
  var panel = document.getElementById('queuePanel');
  if(panel) panel.style.display = _queuePanelOpen ? '' : 'none';
  var btn = document.getElementById('queueToolbarBtn');
  if(btn){
    btn.style.background    = _queuePanelOpen ? 'rgba(88,166,255,.18)' : 'rgba(88,166,255,.08)';
    btn.style.borderColor   = _queuePanelOpen ? 'var(--ac)' : 'rgba(88,166,255,.5)';
  }
  if(_queuePanelOpen){ queueLoad(); queuePollStart(); }
  else                { queuePollStop(); }
}

function openQueuePanel(){
  if(!_queuePanelOpen) toggleQueuePanel();
}

// ── Polling ────────────────────────────────────────────────────
function queuePollStart(){
  if(_queuePollInterval) return;
  _queuePollInterval = setInterval(queueLoad, 3000);
}
function queuePollStop(){
  if(_queuePollInterval){ clearInterval(_queuePollInterval); _queuePollInterval = null; }
}

// ── Load & render ──────────────────────────────────────────────
async function queueLoad(){
  try{
    var d = await api('/api/queue');
    queueRender(d.entries || []);
  }catch(e){ /* silent — queue may not be available */ }
}

function queueRender(entries){
  var el = document.getElementById('queueList');
  if(!el) return;

  if(!entries.length){
    el.innerHTML = '<div style="font-size:.72rem;color:var(--dm);padding:.5rem .2rem">Queue is empty</div>';
    _queueUpdateBadge(0);
    return;
  }

  var waiting = entries.filter(function(e){ return e.status === 'waiting'; });
  var running = entries.filter(function(e){ return e.status === 'running'; });
  var done    = entries.filter(function(e){ return e.status === 'done' || e.status === 'failed'; });

  _queueUpdateBadge(waiting.length + running.length);

  var html = '';

  if(running.length){
    html += '<div style="font-size:.65rem;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.25rem">Running</div>';
    running.forEach(function(e){
      html += _queueEntryHtml(e);
    });
  }

  if(waiting.length){
    html += '<div style="font-size:.65rem;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.05em;margin:.4rem 0 .25rem">Waiting ('+waiting.length+')</div>';
    waiting.forEach(function(e){
      html += _queueEntryHtml(e);
    });
  }

  if(done.length){
    html += '<div style="font-size:.65rem;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.05em;margin:.4rem 0 .25rem">Completed</div>';
    done.slice(0, 5).forEach(function(e){
      html += _queueEntryHtml(e);
    });
  }

  el.innerHTML = html;
}

function _queueEntryHtml(e){
  var statusColor = {waiting:'var(--dm)', running:'var(--ac)', done:'var(--gn)', failed:'var(--rd)', cancelled:'var(--dm)'}[e.status] || 'var(--dm)';
  var statusIcon  = {waiting:'○', running:'●', done:'✓', failed:'✕', cancelled:'–'}[e.status] || '?';
  var gpuLabel    = e.gpu_ids && e.gpu_ids.length ? 'GPU ' + e.gpu_ids.join(', ') : 'CPU';
  var modeLabel   = e.mode === 'sequential' ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="5" rx="1"/><rect x="3" y="10" width="18" height="5" rx="1"/><rect x="3" y="17" width="18" height="5" rx="1"/></svg> Sequential' : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="8" height="16" rx="2"/><rect x="14" y="4" width="8" height="16" rx="2"/><line x1="4" y1="8" x2="8" y2="8"/><line x1="4" y1="12" x2="8" y2="12"/><line x1="16" y1="8" x2="20" y2="8"/><line x1="16" y1="12" x2="20" y2="12"/></svg> GPU-aware';
  var canRemove   = e.status === 'waiting';
  var canCancel   = e.status === 'running';

  return (
    '<div style="display:flex;align-items:flex-start;gap:.4rem;padding:.3rem .25rem;border-bottom:0.5px solid var(--bd)">'
    + '<span style="color:'+statusColor+';font-size:.75rem;flex-shrink:0;margin-top:.05rem">'+statusIcon+'</span>'
    + '<div style="flex:1;min-width:0">'
    +   '<div style="font-size:.73rem;font-weight:600;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+e.job_title+'">'+e.job_title+'</div>'
    +   '<div style="font-size:.65rem;color:var(--dm);margin-top:.1rem">'+gpuLabel+' · '+modeLabel+' · '+e.job_id+'</div>'
    + '</div>'
    + (canRemove ? '<button onclick="queueRemove(\''+e.queue_id+'\')" title="Remove from queue" style="all:unset;cursor:pointer;color:var(--dm);font-size:.75rem;padding:.1rem .2rem;border-radius:3px;flex-shrink:0" onmouseover="this.style.color=\'var(--rd)\'" onmouseout="this.style.color=\'var(--dm)\'">✕</button>' : '')
    + (canCancel ? '<button onclick="queueCancel(\''+e.queue_id+'\')" title="Cancel job" style="all:unset;cursor:pointer;color:var(--yl);font-size:.7rem;padding:.1rem .2rem;border-radius:3px;flex-shrink:0">Stop</button>' : '')
    + '</div>'
  );
}

function _queueUpdateBadge(count){
  var badge = document.getElementById('queueBadge');
  if(!badge) return;
  if(count > 0){
    badge.textContent = count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ── Actions ────────────────────────────────────────────────────
async function queueRemove(queueId){
  try{
    await fetch('/api/queue/'+queueId, {method:'DELETE'});
    queueLoad();
  }catch(e){ console.error('queueRemove', e); }
}

async function queueCancel(queueId){
  try{
    await post('/api/queue/'+queueId+'/cancel', {});
    queueLoad();
  }catch(e){ console.error('queueCancel', e); }
}

// ── Add to Queue modal ─────────────────────────────────────────
var _queuePendingJob = null; // {cmd, cwd, project, job_type, job_title, job_params}

async function queueShowModal(jobData){
  _queuePendingJob = jobData;

  // Show/hide Direct mode banner
  var banner = document.getElementById('queueDirectBanner');
  if(banner){
    var isDirect = (typeof _execMode !== 'undefined' && _execMode === 'direct');
    banner.style.display = isDirect ? 'none' : 'flex';
  }

  // Show modal immediately
  var modal = document.getElementById('queueModal');
  if(modal) modal.style.display = 'flex';

  // Default mode
  queueModeSelect('gpu_aware');

  // Detect GPUs + resources from command via backend
  var detEl  = document.getElementById('queueGpuDetected');
  var gpuHid = document.getElementById('queueModalGpu');
  var ovEl   = document.getElementById('queueGpuOverride');
  if(detEl) detEl.textContent = 'detecting...';
  if(ovEl)  ovEl.style.display = 'none';
  try{
    var r = await post('/api/queue/detect_gpus', {
      command: jobData.cmd,
      project: jobData.project || (typeof curProj !== 'undefined' ? curProj : '') || ''
    });
    if(detEl) detEl.textContent = r.resource_line || 'CPU only';
    window._queueDetectedGpus   = r.gpu_ids || [];
    window._queueAllowsOverride = !!r.allows_gpu_override;
    if(gpuHid) gpuHid.value = (r.gpu_ids || []).join(',');
    if(ovEl && r.allows_gpu_override && r.gpu_ids && r.gpu_ids.length > 0){
      var _pb = 'all:unset;cursor:pointer;padding:.18rem .5rem;border:1px solid var(--bd);border-radius:20px;font-size:.68rem;font-weight:600;display:inline-flex;align-items:center;transition:all .12s;margin-right:.25rem;margin-bottom:.2rem;color:var(--dm);background:var(--sf2)';
      var _pills = '';
      r.gpu_ids.forEach(function(g){
        _pills += '<button type="button" id="qovpill_'+g+'" onclick="queueGpuOverride(\'' + g + '\')" style="'+_pb+'">GPU '+g+'</button>';
      });
      if(r.gpu_ids.length > 1)
        _pills += '<button type="button" id="qovpill_all" onclick="queueGpuOverride(\'all\')" style="'+_pb+'">All GPUs</button>';
      ovEl.innerHTML = '<div style="font-size:.68rem;color:var(--dm);margin-bottom:.3rem">Override GPU:</div>'+_pills;
      ovEl.style.display = '';
      queueGpuOverride(r.gpu_ids.length > 1 ? 'all' : String(r.gpu_ids[0]));
    }
  }catch(e){
    if(detEl) detEl.textContent = 'Could not detect — will use project GPU config';
    window._queueDetectedGpus   = [];
    window._queueAllowsOverride = false;
  }
}

// ── GPU override pill selection ──────────────────────────────
function queueGpuOverride(val){
  var gpuHid = document.getElementById('queueModalGpu');
  var allIds = window._queueDetectedGpus || [];
  var selectedIds = val === 'all' ? allIds : [parseInt(val)];
  if(gpuHid) gpuHid.value = selectedIds.join(',');
  allIds.forEach(function(g){
    var p = document.getElementById('qovpill_'+g);
    var isActive = (val === 'all') || (String(g) === String(val));
    if(p){
      p.style.background  = isActive ? 'rgba(88,166,255,.15)' : 'var(--sf2)';
      p.style.borderColor = isActive ? 'var(--ac)' : 'var(--bd)';
      p.style.color       = isActive ? 'var(--ac)' : 'var(--dm)';
    }
  });
  var _all = document.getElementById('qovpill_all');
  if(_all){
    _all.style.background  = val === 'all' ? 'rgba(88,166,255,.15)' : 'var(--sf2)';
    _all.style.borderColor = val === 'all' ? 'var(--ac)' : 'var(--bd)';
    _all.style.color       = val === 'all' ? 'var(--ac)' : 'var(--dm)';
  }
}

function queueModeSelect(val){
  var hid = document.getElementById('queueModalMode');
  if(hid) hid.value = val;
  var btnGpu = document.getElementById('queuePillGpuAware');
  var btnSeq = document.getElementById('queuePillSeq');
  // Reset both to inactive state
  if(btnGpu){
    btnGpu.style.background   = 'var(--sf2)';
    btnGpu.style.borderColor  = 'var(--bd)';
    btnGpu.style.borderWidth  = '0.5px';
    var gpuTitle = btnGpu.querySelector('span');
    var gpuIcon  = btnGpu.querySelector('div');
    if(gpuTitle) gpuTitle.style.color = 'var(--tx)';
    if(gpuIcon)  gpuIcon.style.color  = 'var(--dm)';
  }
  if(btnSeq){
    btnSeq.style.background   = 'var(--sf2)';
    btnSeq.style.borderColor  = 'var(--bd)';
    btnSeq.style.borderWidth  = '0.5px';
    var seqTitle = btnSeq.querySelector('span');
    var seqIcon  = btnSeq.querySelector('div');
    if(seqTitle) seqTitle.style.color = 'var(--tx)';
    if(seqIcon)  seqIcon.style.color  = 'var(--dm)';
  }
  // Activate selected
  var active = val === 'sequential' ? btnSeq : btnGpu;
  if(active){
    active.style.background  = 'rgba(88,166,255,.08)';
    active.style.borderColor = 'var(--ac)';
    active.style.borderWidth = '2px';
    var aTitle = active.querySelector('span');
    var aIcon  = active.querySelector('div');
    if(aTitle) aTitle.style.color = 'var(--ac)';
    if(aIcon)  aIcon.style.color  = 'var(--ac)';
  }
}

function queueHideModal(){
  var modal = document.getElementById('queueModal');
  if(modal) modal.style.display = 'none';
  _queuePendingJob = null;
}

async function queueConfirmAdd(){
  if(!_queuePendingJob) return;

  var gpuHid  = document.getElementById('queueModalGpu');
  var modeHid = document.getElementById('queueModalMode');

  var gpuVal  = gpuHid  ? gpuHid.value.trim()  : '';
  var modeVal = modeHid ? modeHid.value.trim()  : 'gpu_aware';

  // gpu_ids already detected by backend; pass as array of ints
  var gpuIds = gpuVal ? gpuVal.split(',').map(function(g){ return parseInt(g.trim()); }).filter(function(n){ return !isNaN(n); }) : [];

  try{
    var r = await post('/api/queue/add', {
      project:     _queuePendingJob.project,
      job_type:    _queuePendingJob.job_type,
      job_title:   _queuePendingJob.job_title,
      parameters:  _queuePendingJob.job_params,
      working_dir: _queuePendingJob.cwd,
      gpu_ids:     gpuIds,
      mode:        modeVal,
      command:     _queuePendingJob.cmd,
    });
    queueHideModal();
    // Refresh jobs sidebar
    if(typeof loadJobs === 'function') loadJobs();
    // Open queue panel so user sees the new entry
    openQueuePanel();
    queueLoad();
  }catch(e){
    alert('Queue error: ' + e.message);
  }
}
