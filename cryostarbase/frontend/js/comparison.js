/* CryoSTAR-Base — comparison.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════════
//  PHASE 4 — Job Comparison Modal
// ══════════════════════════════════════════════════════════════

var _cmpJobs = [];
var _cmpPreferred = -1;

async function openCompareModal(){
  if(_compareSelected.length < 2){ alert('Select at least 2 jobs to compare.'); return; }
  try{
    var jobs = [];
    for(var i=0; i<Math.min(_compareSelected.length,4); i++){
      var j = await api('/api/projects/'+curProj+'/jobs/'+_compareSelected[i]);
      jobs.push(j);
    }
    _cmpJobs = jobs;
    _cmpPreferred = -1;
    document.getElementById('cmpNotes').value = '';
    document.getElementById('cmpSaveStatus').textContent = '';
    document.getElementById('cmpMarkFinalBtn').style.display = 'none';
    _renderCompareModal(jobs);
    document.getElementById('compareOverlay').style.display = '';
  }catch(e){ alert('Error loading jobs: '+e.message); }
}

function closeCompareModal(){
  document.getElementById('compareOverlay').style.display = 'none';
  _cmpJobs = []; _cmpPreferred = -1;
}

function _renderCompareModal(jobs){
  var badgesEl = document.getElementById('cmpJobBadges');
  if(badgesEl){
    badgesEl.innerHTML = jobs.map(function(j,i){
      return '<span style="font-size:.7rem;padding:.12rem .45rem;border-radius:4px;background:var(--sf2);border:0.5px solid var(--bd);color:var(--dm)">'
        +'ABCD'[i]+': '+j.job_id+' — '+(j.custom_title||j.title||j.job_type)+'</span>';
    }).join('<span style="color:var(--dm);opacity:.5;margin:0 .2rem">vs</span>');
  }
  var prefA=document.getElementById('cmpPrefA'), prefB=document.getElementById('cmpPrefB');
  if(prefA&&jobs[0]) prefA.textContent='★ '+jobs[0].job_id;
  if(prefB&&jobs[1]) prefB.textContent='★ '+jobs[1].job_id;
  if(prefA){prefA.style.background='var(--sf2)';prefA.style.borderColor='var(--bd)';prefA.style.color='var(--dm)';}
  if(prefB){prefB.style.background='var(--sf2)';prefB.style.borderColor='var(--bd)';prefB.style.color='var(--dm)';}

  var grid = document.getElementById('cmpGrid');
  if(!grid) return;
  grid.style.gridTemplateColumns = 'repeat('+Math.min(jobs.length,2)+',1fr)';
  grid.innerHTML = jobs.slice(0,2).map(function(j,i){ return _renderJobCol(j,i); }).join('');
}

function _renderJobCol(j, colIdx){
  var statusColor={completed:'var(--gn)',running:'var(--ac)',failed:'var(--rd)',queued:'var(--dm)'}[j.status]||'var(--dm)';
  var borderRight = colIdx===0?'border-right:0.5px solid var(--bd);':'';
  var params = j.parameters||{};
  var paramRows = Object.entries(params).slice(0,10).map(function(kv){
    return '<div style="display:flex;gap:.4rem;padding:.15rem 0;border-bottom:0.5px solid var(--bd);font-size:.71rem">'
      +'<span style="color:var(--dm);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+kv[0]+'</span>'
      +'<span style="color:var(--tx);font-family:monospace;font-size:.67rem;flex-shrink:0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      +(kv[1]===''||kv[1]===null||kv[1]===undefined?'—':String(kv[1]))+'</span></div>';
  }).join('');
  var tags=(j.tags||[]).length
    ?j.tags.map(function(t){return '<span style="font-size:.6rem;padding:.07rem .25rem;border-radius:3px;background:var(--sf2);border:0.5px solid var(--bd);color:var(--dm)">'+t+'</span>';}).join('')
    :'<span style="font-size:.68rem;color:var(--dm);opacity:.5">—</span>';
  var dash=j.dashboard_data||{};
  var metrics=Object.entries(dash).filter(function(kv){return kv[0]!=='output_files'&&kv[0]!=='job_type'&&!kv[0].endsWith('_label');}).slice(0,4)
    .map(function(kv){var lbl=dash[kv[0]+'_label']||kv[0].replace(/_/g,' ');return '<div class="dash-metric"><span class="dash-metric-label">'+lbl+'</span><span class="dash-metric-value">'+kv[1]+'</span></div>';}).join('');
  var lbl='ABCD'[colIdx];
  return '<div style="padding:.6rem .75rem;'+borderRight+'">'
    +'<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;padding-bottom:.4rem;border-bottom:0.5px solid var(--bd)">'
    +'<span style="font-size:.68rem;font-weight:800;padding:.1rem .3rem;border-radius:4px;background:rgba(88,166,255,.1);color:var(--ac)">'+lbl+'</span>'
    +'<div style="flex:1;min-width:0"><div style="font-size:.8rem;font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(j.custom_title||j.title||j.job_type)+'</div>'
    +'<div style="font-size:.67rem;color:var(--dm)">'+j.job_id+' · <span style="color:'+statusColor+'">'+j.status+'</span>'+(j.finished_at?' · '+j.finished_at.slice(0,10):'')+'</div></div></div>'
    +(metrics?'<div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.45rem">'+metrics+'</div>':'')
    +'<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--dm);margin-bottom:.2rem">Parameters</div>'
    +'<div>'+paramRows+'</div>'
    +'<div style="margin-top:.4rem"><div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--dm);margin-bottom:.2rem">Tags</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:.2rem">'+tags+'</div></div></div>';
}

function cmpSetPreferred(idx){
  _cmpPreferred = idx;
  var prefA=document.getElementById('cmpPrefA'), prefB=document.getElementById('cmpPrefB');
  var lbl=document.getElementById('cmpPrefLabel'), fBtn=document.getElementById('cmpMarkFinalBtn');
  if(prefA){prefA.style.background=idx===0?'rgba(63,185,80,.12)':'var(--sf2)';prefA.style.borderColor=idx===0?'var(--gn)':'var(--bd)';prefA.style.color=idx===0?'var(--gn)':'var(--dm)';}
  if(prefB){prefB.style.background=idx===1?'rgba(63,185,80,.12)':'var(--sf2)';prefB.style.borderColor=idx===1?'var(--gn)':'var(--bd)';prefB.style.color=idx===1?'var(--gn)':'var(--dm)';}
  if(lbl&&_cmpJobs[idx]) lbl.textContent=_cmpJobs[idx].job_id+' preferred';
  if(fBtn){fBtn.style.display='';fBtn.textContent='★ Mark '+(_cmpJobs[idx]?.job_id||'')+' as Final';}
}

async function cmpMarkFinal(){
  if(_cmpPreferred<0||!_cmpJobs[_cmpPreferred])return;
  var job=_cmpJobs[_cmpPreferred];
  try{
    var tags=Array.from(new Set([...(job.tags||[]),'final']));
    await fetch('/api/projects/'+curProj+'/jobs/'+job.job_id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tags})});
    var btn=document.getElementById('cmpMarkFinalBtn');
    if(btn){btn.textContent='★ Marked as Final';btn.style.background='rgba(63,185,80,.12)';btn.style.borderColor='rgba(63,185,80,.4)';btn.style.color='var(--gn)';}
    await post('/api/notes',{project:curProj,text:'**'+job.job_id+'** marked as `final` via comparison.'});
  }catch(e){console.error('cmpMarkFinal',e);}
}

async function cmpSaveAndClose(){
  var notes=(document.getElementById('cmpNotes')?.value||'').trim();
  var preferred=_cmpPreferred>=0&&_cmpJobs[_cmpPreferred]?_cmpJobs[_cmpPreferred].job_id:null;
  var statusEl=document.getElementById('cmpSaveStatus');
  var nl='\n';
  var jobLabels=_cmpJobs.map(function(j,i){return 'ABCD'[i]+': **'+j.job_id+'** ('+(j.custom_title||j.title||j.job_type)+')';}).join(', ');
  var diffLines=[];
  if(_cmpJobs.length>=2){
    var parA=_cmpJobs[0].parameters||{}, parB=_cmpJobs[1].parameters||{};
    var allKeys=Array.from(new Set([...Object.keys(parA),...Object.keys(parB)]));
    allKeys.forEach(function(k){if(String(parA[k])!==String(parB[k]))diffLines.push('  '+k+': '+JSON.stringify(parA[k])+' -> '+JSON.stringify(parB[k]));});
  }
  var parts=['[Job Comparison]', jobLabels];
  if(preferred) parts.push('Preferred: **'+preferred+'**');
  if(diffLines.length) parts.push('Parameter differences:'+nl+diffLines.slice(0,8).join(nl));
  if(notes) parts.push('Notes: '+notes);
  try{
    await post('/api/notes',{project:curProj,text:parts.join(nl)});
    if(statusEl){statusEl.textContent='✓ Saved';setTimeout(function(){statusEl.textContent='';},2500);}
    loadNotes();
    setTimeout(closeCompareModal,1200);
  }catch(e){if(statusEl)statusEl.textContent='Error: '+e.message;}
}
