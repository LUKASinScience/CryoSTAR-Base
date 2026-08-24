/* CryoSTAR-Base — jdp.js
   Job Detail Panel
   Written together by Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════
// JOB DETAIL PANEL
// ══════════════════════════════════════════════════════════
let jdpCurrentJob = null;
var _jobPollTimer = null;
function _startJobPoll(){if(_jobPollTimer)return;_jobPollTimer=setInterval(async function(){if(curProj){await loadJobs();// sync open job detail status
if(jdpCurrentJob&&typeof jdpSyncStatus==='function'){try{var d=await api('/api/projects/'+curProj+'/jobs');jdpSyncStatus(d.jobs||[]);}catch(e){}}}},3000);}
function _stopJobPoll(){if(_jobPollTimer){clearInterval(_jobPollTimer);_jobPollTimer=null;}}

async function jdpOpen(jobId){
  if(!curProj)return;
  try{
    const j=await api('/api/projects/'+curProj+'/jobs/'+jobId);
    jdpCurrentJob=j;
    // Populate fields
    $('jdpTitle').value=j.custom_title||j.title||'';
    // Show copy params button for completed/failed jobs
    var cpBtn=document.getElementById('jdpCopyParamsBtn');
    if(cpBtn)cpBtn.style.display=(j.status==='completed'||j.status==='failed')?'':'none';
    $('jdpJobId').textContent=j.job_id+' · '+j.job_type;
    const statusEl=$('jdpStatus');
    statusEl.textContent=j.status;
    statusEl.className='badge '+(j.status||'queued');
    // Compute badge
    const tpl=(window._allTemplates||[]).find(function(t){return t.id===j.job_type;});
    const compEl=$('jdpCompute');
    if(tpl&&tpl.compute){
      compEl.innerHTML='<span class="tag compute-'+tpl.compute+'">'+tpl.compute.toUpperCase()+'</span>';
    }else{compEl.innerHTML='';}
    // Command
    $('jdpCmd').textContent=j.command||'';
    // Doc link
    const docSec=$('jdpDocSection');
    if(j.doc_url){
      docSec.style.display='';
      $('jdpDocLink').href=j.doc_url;
      // Shorten URL for display
      var urlShort=j.doc_url.replace('https://','').replace(/\/.*/,'...');
      $('jdpDocText').textContent=urlShort+' ↗';
    }else{docSec.style.display='none';}
    // Tags
    jdpRenderTags(j.tags||[]);
    // Parent jobs
    jdpRenderParents(j.parent_jobs||[]);
    // Notes
    $('jdpNotes').value=j.notes||'';
    // Timeline
    var tl='';
    if(j.created_at)tl+='<div><strong style="color:var(--tx)">Created:</strong> '+j.created_at+'</div>';
    if(j.started_at)tl+='<div><strong style="color:var(--tx)">Started:</strong> '+j.started_at+'</div>';
    if(j.finished_at)tl+='<div><strong style="color:var(--tx)">Finished:</strong> '+j.finished_at+'</div>';
    if(j.exit_code!==null&&j.exit_code!==undefined)tl+='<div><strong style="color:var(--tx)">Exit code:</strong> '+j.exit_code+'</div>';
    $('jdpTimeline').innerHTML=tl||'<span style="color:var(--dm)">Not started yet</span>';
    // Load log
    jdpLoadLog();
    // Show overlay
    $('jobDetailOverlay').style.display='flex';
    document.body.style.overflow='hidden';
  }catch(e){console.error('jdpOpen',e);}
}

function jdpClose(){
  $('jobDetailOverlay').style.display='none';
  document.body.style.overflow='';
  jdpCurrentJob=null;
  if(window._jdpLogRefreshTimer){
    clearInterval(window._jdpLogRefreshTimer);
    window._jdpLogRefreshTimer=null;
  }
}

// Called by loadJobs() to keep jdpCurrentJob.status in sync
function jdpSyncStatus(jobs){
  if(!jdpCurrentJob||!jobs) return;
  var fresh = jobs.find(function(j){return j.job_id===jdpCurrentJob.job_id;});
  if(!fresh) return;
  var prev = jdpCurrentJob.status;
  jdpCurrentJob.status = fresh.status;
  // If job just finished, do one final log load and stop timer
  if(prev==='running' && fresh.status!=='running'){
    jdpLoadLog();
    if(window._jdpLogRefreshTimer){
      clearInterval(window._jdpLogRefreshTimer);
      window._jdpLogRefreshTimer=null;
    }
  }
}

async function jdpRerun(){
  const j=jdpCurrentJob;
  if(!j||!j.job_type){alert('No job type found for this job.');return;}

  // Ask user: override existing job or create new one?
  var choice = window.confirm(
    'Rerun ' + (j.job_id||'job') + '\n\n'
    + 'OK  →  Override this job (same ID, results replaced)\n'
    + 'Cancel  →  Create a new job'
  );
  // Set rerun ID if user wants to override
  window._rerunJobId = choice ? (j.job_id || null) : null;

  // Close the detail panel
  jdpClose();
  // Open the right panel (Job Builder)
  if(typeof openRightPanel==='function') openRightPanel();
  // Fill job builder with existing params — user can review/edit before running
  await selTpl(j.job_type, j.parameters||{}, j.job_id);
  // Restore custom title if any
  var _jbT=document.getElementById('jbCustomTitle');
  if(_jbT && j.custom_title) _jbT.value=j.custom_title;
  // Show rerun banner in job builder
  var banner=document.getElementById('jbRerunBanner');
  if(banner){
    if(window._rerunJobId){
      banner.textContent='Rerunning ' + j.job_id + ' — will override existing results';
      banner.style.display='';
    } else {
      banner.textContent='Rerun as new job — ' + j.job_id + ' params loaded';
      banner.style.display='';
    }
  }
  // Scroll job builder into view
  var parP=document.getElementById('parP');
  if(parP) parP.scrollIntoView({behavior:'smooth',block:'start'});
}

// ══════════════════════════════════════════════════════════
// WORKFLOWS
// ══════════════════════════════════════════════════════════

var _wfListOpen = true;
var _curWf = null; // currently open workflow object
var _wfEditMode = 'new'; // 'new' | 'edit'
var _wfEditId = null;

// Predefined step templates matching WF_STEPS colours
var WF_STEP_PRESETS = [
  {label:'Import',   color:'#f59e0b', compute:'cpu',
   job_types:['link_reconstruction','copy_xmls','extract_xml'],
   desc:'Import recon · Copy XMLs · Extract XML'},
  {label:'PyTom',    color:'#22c55e', compute:'gpu',
   job_types:['create_template','create_mask','tm_batch'],
   desc:'Create template · Create mask · TM batch'},
  {label:'Extract',  color:'#22c55e', compute:'cpu',
   job_types:['extract_batch','merge_stars'],
   desc:'Extract batch · Merge stars'},
  {label:'Warp Export', color:'#bc8cff', compute:'gpu',
   job_types:['pytom2warp_convert','warp_export_particles'],
   desc:'Convert PyTom STAR · Export particles'},
  {label:'Convert',  color:'#f59e0b', compute:'cpu',
   job_types:['star_score_match','tm_analysis'],
   desc:'Match scores · TM Analysis'},
  {label:'RELION Class3D', color:'#3b82f6', compute:'gpu',
   job_types:['relion_class3d'],
   desc:'3D Classification — first round'},
  {label:'RELION Initial Model', color:'#3b82f6', compute:'gpu',
   job_types:['relion_initial_model'],
   desc:'De-novo 3D reference from manual picks'},
  {label:'AreTomo3 Fix MDOCs', color:'#38bdf8', compute:'cpu',
   job_types:['aretomo3_mdoc_fix'],
   desc:'Fix SubFramePath entries before running AreTomo3'},
  {label:'AreTomo3 Batch', color:'#38bdf8', compute:'gpu',
   job_types:['aretomo3_batch'],
   desc:'Batch alignment — run AreTomo3 on all MDOCs'},
  {label:'AreTomo3 Collect', color:'#38bdf8', compute:'cpu',
   job_types:['aretomo3_collect'],
   desc:'Collect .xf/.tlt alignment files for WarpTools'},
];

// Named workflow presets for the workflow builder selector
// Note: Workflow Builder runs jobs in Direct mode only.
// For SLURM submission use the scripts in cryostarbase/scripts/ directly.
// AreTomo3 is a manual pre-processing step run BEFORE the WarpTools pipeline —
// check tomograms, verify Z-value and alignments, then start the WarpTools workflow.
const WF_NAMED_PRESETS = [
  {
    name: 'WarpTools Pre-Processing (eTomo)',
    desc: 'WarpTools full pipeline with eTomo patch alignment: frames → motion/CTF → alignment → tomograms',
    color: '#38bdf8',
    steps: [
      {label:'Settings',        color:'#a78bfa', compute:'cpu', job_types:['warp_create_settings_fs','warp_create_settings_ts'], desc:'Frame series & tilt series settings'},
      {label:'Motion & CTF',    color:'#a78bfa', compute:'gpu', job_types:['warp_fs_motion_ctf','warp_filter_quality'],           desc:'Motion correction · CTF · Quality histograms'},
      {label:'TS Import',       color:'#a78bfa', compute:'cpu', job_types:['warp_ts_import'],                                     desc:'Import MDOCs → tomostar/'},
      {label:'Alignment',       color:'#a78bfa', compute:'cpu', job_types:['warp_ts_etomo'],                                      desc:'eTomo patch alignment'},
      {label:'CTF+Reconstruct', color:'#a78bfa', compute:'gpu', job_types:['warp_ts_defocus_hand','warp_ts_ctf','warp_ts_reconstruct'], desc:'Defocus hand · TS CTF · Reconstruct'},
    ]
  },
  {
    name: 'WarpTools Pre-Processing (AreTomo3)',
    desc: 'WarpTools pipeline importing AreTomo3 alignments — run AreTomo3 manually first, check tomograms, then start this workflow',
    color: '#38bdf8',
    steps: [
      {label:'Settings',        color:'#a78bfa', compute:'cpu', job_types:['warp_create_settings_fs','warp_create_settings_ts'], desc:'Frame series & tilt series settings'},
      {label:'Motion & CTF',    color:'#a78bfa', compute:'gpu', job_types:['warp_fs_motion_ctf','warp_filter_quality'],           desc:'Motion correction · CTF · Quality histograms'},
      {label:'TS Import',       color:'#a78bfa', compute:'cpu', job_types:['warp_ts_import','warp_ts_import_alignments'],         desc:'Import MDOCs → tomostar · import AreTomo3 alignments'},
      {label:'CTF+Reconstruct', color:'#a78bfa', compute:'gpu', job_types:['warp_ts_defocus_hand','warp_ts_ctf','warp_ts_reconstruct'], desc:'Defocus hand · TS CTF · Reconstruct'},
    ]
  },
  {
    name: 'WarpTools + Miss Alignment (eTomo)',
    desc: 'Full pipeline with Miss Alignment refinement: frames → motion/CTF → eTomo alignment → reconstruct → Miss Alignment → re-reconstruct',
    color: '#a78bfa',
    steps: [
      {label:'Settings',              color:'#a78bfa', compute:'cpu', job_types:['warp_create_settings_fs','warp_create_settings_ts'], desc:'Frame series & tilt series settings'},
      {label:'Motion & CTF',          color:'#a78bfa', compute:'gpu', job_types:['warp_fs_motion_ctf','warp_filter_quality'],           desc:'Motion correction · CTF · Quality filter'},
      {label:'TS Import',             color:'#a78bfa', compute:'cpu', job_types:['warp_ts_import'],                                     desc:'Import MDOCs → tomostar/'},
      {label:'Alignment',             color:'#a78bfa', compute:'cpu', job_types:['warp_ts_etomo'],                                      desc:'eTomo patch alignment'},
      {label:'CTF + Reconstruct',     color:'#a78bfa', compute:'gpu', job_types:['warp_ts_defocus_hand','warp_ts_ctf','warp_ts_reconstruct'], desc:'Defocus hand · TS CTF · Reconstruct (pre-Miss Alignment)'},
      {label:'Miss Alignment',        color:'#a78bfa', compute:'gpu', job_types:['miss_alignment_train'],                              desc:'Train → Predict → Update Warp XMLs'},
      {label:'Re-Reconstruct',        color:'#a78bfa', compute:'gpu', job_types:['warp_ts_reconstruct'],                               desc:'Reconstruct with corrected alignments (post-Miss Alignment)'},
    ]
  },
  {
    name: 'WarpTools + Miss Alignment (Import Alignments)',
    desc: 'Miss Alignment pipeline importing existing AreTomo3/IMOD alignments — run aligner first, then import and refine',
    color: '#a78bfa',
    steps: [
      {label:'Settings',              color:'#a78bfa', compute:'cpu', job_types:['warp_create_settings_fs','warp_create_settings_ts'], desc:'Frame series & tilt series settings'},
      {label:'Motion & CTF',          color:'#a78bfa', compute:'gpu', job_types:['warp_fs_motion_ctf','warp_filter_quality'],           desc:'Motion correction · CTF · Quality filter'},
      {label:'TS Import',             color:'#a78bfa', compute:'cpu', job_types:['warp_ts_import','warp_ts_import_alignments'],         desc:'Import MDOCs · Import alignments'},
      {label:'CTF + Reconstruct',     color:'#a78bfa', compute:'gpu', job_types:['warp_ts_defocus_hand','warp_ts_ctf','warp_ts_reconstruct'], desc:'Defocus hand · TS CTF · Reconstruct (pre-Miss Alignment)'},
      {label:'Miss Alignment',        color:'#a78bfa', compute:'gpu', job_types:['miss_alignment_train'],                              desc:'Train → Predict → Update Warp XMLs'},
      {label:'Re-Reconstruct',        color:'#a78bfa', compute:'gpu', job_types:['warp_ts_reconstruct'],                               desc:'Reconstruct with corrected alignments (post-Miss Alignment)'},
    ]
  },
  {
    name: 'TM-Workflow',
    desc: 'Full PyTom TM → WarpTools export → RELION pipeline',
    color: '#22c55e',
    steps: [
      {label:'Import',      color:'#f59e0b', compute:'cpu', job_types:['link_reconstruction','copy_xmls','extract_xml'], desc:'Link recon · Copy XMLs'},
      {label:'PyTom TM',    color:'#22c55e', compute:'gpu', job_types:['create_template','create_mask','tm_batch'],      desc:'Create template · TM batch'},
      {label:'Extract',     color:'#22c55e', compute:'cpu', job_types:['extract_batch','merge_stars'],                   desc:'Extract batch · Merge stars'},
      {label:'Warp Export', color:'#bc8cff', compute:'gpu', job_types:['pytom2warp_convert','warp_export_particles'],    desc:'Convert · Export particles'},
      {label:'Scores',      color:'#f59e0b', compute:'cpu', job_types:['star_score_match','tm_analysis'],                desc:'Match scores · TM Analysis'},
      {label:'RELION',      color:'#3b82f6', compute:'gpu', job_types:['relion_class3d'],                               desc:'3D Classification'},
    ]
  },
];

function toggleWfList(){
  _wfListOpen=!_wfListOpen;
  var list=document.getElementById('wfList');
  var chev=document.getElementById('wfListChev');
  if(list)list.style.display=_wfListOpen?'':'none';
  if(chev)chev.style.transform=_wfListOpen?'':'rotate(-90deg)';
}

async function loadWorkflows(){
  if(!curProj)return;
  try{
    const d=await api('/api/projects/'+curProj+'/workflows');
    const wfs=d.workflows||[];

    // ── Sidebar list ──
    const wfList=$('wfList');
    if(wfList){
      if(!wfs.length){
        wfList.innerHTML='<div style="padding:.35rem .7rem;font-size:.72rem;color:var(--dm)">No workflows yet</div>';
      }else{
        wfList.innerHTML=wfs.map(function(wf){
          var sc=wf.last_run_status;
          var dot=sc==='completed'?'var(--gn)':sc==='failed'?'var(--rd)':sc==='running'?'var(--ac)':'var(--dm)';
          var stepCount=(wf.steps||[]).length;
          return '<div class="ji" data-wfid="'+wf.workflow_id+'" style="flex-direction:column;align-items:flex-start;gap:.1rem;cursor:pointer" title="'+wf.workflow_id+'">'+
            '<div style="display:flex;align-items:center;gap:.35rem;width:100%">'+
              '<span style="width:.55rem;height:.55rem;border-radius:50%;background:'+dot+';flex-shrink:0"></span>'+
              '<span style="font-size:.75rem;font-weight:600;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+wf.name+'</span>'+
              '<span style="font-size:.6rem;color:var(--dm)">'+stepCount+' steps</span>'+
            '</div>'+
            (wf.description?'<div style="font-size:.65rem;color:var(--dm);padding-left:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+wf.description+'</div>':'')+
          '</div>';
        }).join('');
        if(!wfList._wired){
          wfList._wired=true;
          wfList.addEventListener('click',function(e){
            var el=e.target.closest('[data-wfid]');
            if(el)wfDetailOpen(el.getAttribute('data-wfid'));
          });
        }
      }
    }

    // ── Job Builder list ──
    var bSec=$('wfBuilderSec');
    var bList=$('wfBuilderList');
    if(bSec&&bList){
      bSec.style.display='';
      if(!wfs.length){
        bList.innerHTML='<div style="font-size:.68rem;color:var(--dm);padding:.2rem .3rem">No workflows yet — click + New</div>';
      }else{
        bList.innerHTML=wfs.map(function(wf){
          var sc=wf.last_run_status;
          var dotCol=sc==='completed'?'#3fb950':sc==='failed'?'#f85149':sc==='running'?'#58a6ff':'#8b949e';
          var scLabel=sc==='completed'?'completed':sc==='failed'?'failed':sc==='running'?'running':'not run yet';
          return '<div data-wfbid="'+wf.workflow_id+'" style="display:flex;align-items:center;gap:.4rem;padding:.3rem .45rem;'+
            'background:rgba(6,182,212,.04);border:0.5px solid rgba(6,182,212,.18);border-radius:5px;cursor:pointer;transition:background .1s" '+
            'onmouseover="this.style.background=\'rgba(6,182,212,.1)\'" '+
            'onmouseout="this.style.background=\'rgba(6,182,212,.04)\'" '+
            'onclick="wfBuilderSelect(\''+wf.workflow_id+'\')">'+
            '<div style="width:.55rem;height:.55rem;border-radius:50%;background:'+dotCol+';flex-shrink:0"></div>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:.74rem;font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+wf.name+'</div>'+
              '<div style="font-size:.62rem;color:var(--dm)">'+scLabel+' · '+(wf.steps||[]).length+' steps</div>'+
            '</div>'+
          '</div>';
        }).join('');
      }
    }
  }catch(e){console.error('loadWorkflows',e);}
}

async function wfDetailOpen(wfId){
  if(!curProj)return;
  try{
    const wf=await api('/api/projects/'+curProj+'/workflows/'+wfId);
    _curWf=wf;
    $('wfDetailName').textContent=wf.name;
    $('wfDetailMeta').textContent=wf.workflow_id+' · '+(wf.steps||[]).length+' steps'+(wf.last_run_at?' · last run '+wf.last_run_at.slice(0,10):'');
    var sc=wf.last_run_status||'';
    var sb=$('wfDetailStatus');
    sb.textContent=sc||'not run';
    sb.className='badge '+(sc==='completed'?'completed':sc==='failed'?'failed':sc==='running'?'running':'queued');

    // Render steps
    $('wfDetailSteps').innerHTML=(wf.steps||[]).map(function(step){
      var jobs=(step.job_types||[]).join(' · ');
      return '<div style="display:flex;align-items:flex-start;gap:.6rem;padding:.5rem 0;border-bottom:.5px solid var(--bd)">'+
        '<div style="width:.55rem;height:.55rem;border-radius:50%;background:'+step.color+';flex-shrink:0;margin-top:.25rem"></div>'+
        '<div style="flex:1">'+
          '<div style="font-size:.78rem;font-weight:600;color:var(--tx)">'+step.step_num+' · '+step.label+'</div>'+
          '<div style="font-size:.68rem;color:var(--dm);margin-top:.1rem">'+jobs+'</div>'+
          '<div style="display:flex;gap:.3rem;margin-top:.2rem">'+
            (step.wait_for_exit_zero?'<span style="font-size:.6rem;padding:.02rem .22rem;border-radius:3px;background:var(--sf2);color:var(--dm)">waits for prev</span>':'')+
            '<span style="font-size:.6rem;padding:.02rem .22rem;border-radius:3px;background:var(--sf2);color:var(--dm)">'+step.compute.toUpperCase()+'</span>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');

    // Show last run log if available
    var logSec=$('wfDetailLogSec');
    if(wf.last_run_job_ids&&wf.last_run_job_ids.length){
      logSec.style.display='';
      $('wfDetailLog').textContent='Last run jobs: '+wf.last_run_job_ids.join(', ');
    }else{
      logSec.style.display='none';
    }

    $('wfDetailOverlay').style.display='flex';
    document.body.style.overflow='hidden';
  }catch(e){console.error('wfDetailOpen',e);}
}

function wfDetailClose(){
  $('wfDetailOverlay').style.display='none';
  document.body.style.overflow='';
  _curWf=null;
}

function wfParClose(){
  $('wfParP').style.display='none';
  var ph=$('jobPlaceholder');if(ph)ph.style.display='block';
}

async function wfBuilderSelect(wfId){
  if(!curProj)return;
  try{
    const wf=await api('/api/projects/'+curProj+'/workflows/'+wfId);
    _curWf=wf;
    // Hide job params, show workflow panel
    var parP=$('parP');if(parP)parP.style.display='none';
    var ph=$('jobPlaceholder');if(ph)ph.style.display='none';
    // Fill panel
    $('wfParName').textContent=wf.name;
    $('wfParMeta').textContent=wf.workflow_id+' · '+(wf.steps||[]).length+' steps'+(wf.last_run_at?' · last run '+wf.last_run_at.slice(0,10):'');
    var sc=wf.last_run_status||'';
    var sb=$('wfParStatus');
    sb.textContent=sc||'not run';
    sb.className='badge '+(sc==='completed'?'completed':sc==='failed'?'failed':sc==='running'?'running':'queued');
    // Steps
    $('wfParSteps').innerHTML=(wf.steps||[]).map(function(step){
      return '<div style="display:flex;align-items:center;gap:.4rem;padding:.22rem .1rem;border-bottom:.5px solid var(--bd)">'+
        '<div style="width:.45rem;height:.45rem;border-radius:50%;background:'+step.color+';flex-shrink:0"></div>'+
        '<span style="font-size:.71rem;color:var(--tx);font-weight:600">'+step.step_num+' · '+step.label+'</span>'+
        '<span style="font-size:.62rem;color:var(--dm);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+
          (step.job_types||[]).join(', ')+'</span>'+
        '<span style="font-size:.6rem;color:var(--dm)">'+step.compute.toUpperCase()+'</span>'+
      '</div>';
    }).join('');
    $('wfParP').style.display='';
    openRightPanel();
  }catch(e){console.error('wfBuilderSelect',e);}
}

function _wfCheckRequired(){
  // Check that all required params in saved workflow steps have values
  var wf=_curWf;if(!wf)return {ok:false,missing:[]};
  var missing=[];
  (wf.steps||[]).forEach(function(step){
    (step.job_types||[]).forEach(function(jt){
      var tpl=(window._allTemplates||[]).find(function(t){return t.id===jt;});
      (tpl&&tpl.parameters||[]).forEach(function(p){
        if(p.required){
          var val=(step.parameters&&step.parameters[p.key])||'';
          // Also check autofill
          var autoKey=window.TPL_AUTOFILL&&TPL_AUTOFILL[p.key];
          var autoVal=autoKey&&window._wfProjCfg&&window._wfProjCfg[autoKey]?String(window._wfProjCfg[autoKey]):'';
          if(!val&&!autoVal)missing.push(step.label+': '+p.label);
        }
      });
    });
  });
  return {ok:missing.length===0,missing:missing};
}

async function wfRunFromBuilder(){
  if(!_curWf||!curProj)return;
  // Load cfg for required check
  await _wfLoadCfg();
  var check=_wfCheckRequired();
  if(!check.ok){
    alert('Cannot run — required parameters are missing:\n\n'+check.missing.map(function(m){return '• '+m;}).join('\n')+'\n\nOpen Edit to fill them in.');
    return;
  }
  if(!confirm('Run "'+_curWf.name+'"?\n\nAll steps run sequentially — pipeline stops if a step fails.'))return;
  var sb=$('wfParStatus');
  sb.textContent='running';sb.className='badge running';
  try{
    const result=await post('/api/projects/'+curProj+'/workflows/'+_curWf.workflow_id+'/run',{});
    var ok=result.status==='completed';
    sb.textContent=result.status;
    sb.className='badge '+(ok?'completed':'failed');
    loadWorkflows();loadJobs();
    if(!ok&&result.failed_at){
      alert('Pipeline stopped at: '+result.failed_at+'\nCheck the job log for details.');
    }
  }catch(e){
    sb.textContent='error';sb.className='badge failed';
    alert('Workflow error: '+(e.message||e));
  }
}

async function wfRun(){
  if(!_curWf||!curProj)return;
  if(!confirm('Run workflow "'+_curWf.name+'"?\n\nAll steps will run sequentially. The pipeline stops if any step fails.'))return;
  var sb=$('wfDetailStatus');
  sb.textContent='running';sb.className='badge running';
  try{
    const result=await post('/api/projects/'+curProj+'/workflows/'+_curWf.workflow_id+'/run',{});
    var ok=result.status==='completed';
    sb.textContent=result.status;
    sb.className='badge '+(ok?'completed':'failed');
    // Show job ids in log
    var logSec=$('wfDetailLogSec');logSec.style.display='';
    var completed=result.completed||[];
    $('wfDetailLog').textContent=completed.map(function(c){
      return c.job_id+' '+c.job_type+': '+c.status+(c.exit_code!==null?' (exit '+c.exit_code+')':'');
    }).join('\n')+(result.failed_at?'\nFailed at: '+result.failed_at:'');
    loadWorkflows();loadJobs();
  }catch(e){
    sb.textContent='error';sb.className='badge failed';
    alert('Workflow error: '+(e.message||e));
  }
}

async function wfDeleteConfirm(){
  if(!_curWf||!curProj)return;
  if(!confirm('Delete workflow "'+_curWf.name+'"?'))return;
  try{
    await del('/api/projects/'+curProj+'/workflows/'+_curWf.workflow_id);
    wfDetailClose();
    loadWorkflows();
  }catch(e){alert('Error: '+(e.message||e));}
}

// ── Edit / New ──
function wfPresetClose(){
  $('wfPresetOverlay').style.display='none';
}

async function wfNewOpen(){
  // Build preset list
  var list=$('wfPresetList');
  if(!list)return;
  var html='';
  WF_NAMED_PRESETS.forEach(function(p,i){
    html+='<div onclick="wfNewFromPreset('+i+')" style="cursor:pointer;padding:.5rem .6rem;margin-bottom:.35rem;'
      +'border:1px solid '+p.color+'55;border-radius:7px;background:'+p.color+'0d;transition:background .15s" '
      +'onmouseover="this.style.background=\''+p.color+'22\'" onmouseout="this.style.background=\''+p.color+'0d\'">'
      +'<div style="font-weight:700;color:'+p.color+';font-size:.82rem">'+p.name+'</div>'
      +'<div style="font-size:.72rem;color:var(--dm);margin-top:.15rem">'+p.desc+'</div>'
      +'</div>';
  });
  html+='<div onclick="wfNewBlank()" style="cursor:pointer;padding:.4rem .6rem;margin-top:.1rem;'
    +'border:1px solid var(--bd);border-radius:7px;text-align:center;font-size:.76rem;color:var(--dm);transition:background .15s" '
    +'onmouseover="this.style.background=\'var(--sf2)\'" onmouseout="this.style.background=\'\'">Start blank</div>';
  list.innerHTML=html;
  $('wfPresetOverlay').style.display='flex';
}

async function wfNewFromPreset(idx){
  wfPresetClose();
  var preset=WF_NAMED_PRESETS[idx];
  if(!preset){wfNewBlank();return;}
  _wfEditMode='new';_wfEditId=null;
  $('wfEditTitle').textContent='New Workflow';
  $('wfEditName').value=preset.name;
  $('wfEditDesc').value=preset.desc||'';
  _wfEditSteps=preset.steps.map(function(p,i){
    return {step_num:i+1,label:p.label,color:p.color,compute:p.compute,
            job_types:(p.job_types||[]).slice(),parameters:{},wait_for_exit_zero:true};
  });
  await _wfLoadCfg();
  _wfRenderEditSteps();
  $('wfDetailOverlay').style.display='none';
  $('wfEditOverlay').style.display='flex';
  document.body.style.overflow='hidden';
}

async function wfNewBlank(){
  wfPresetClose();
  _wfEditMode='new';_wfEditId=null;
  $('wfEditTitle').textContent='New Workflow';
  $('wfEditName').value='';$('wfEditDesc').value='';
  _wfEditSteps=WF_STEP_PRESETS.map(function(p,i){
    return {step_num:i+1,label:p.label,color:p.color,compute:p.compute,
            job_types:p.job_types.slice(),parameters:{},wait_for_exit_zero:true};
  });
  await _wfLoadCfg();
  _wfRenderEditSteps();
  $('wfDetailOverlay').style.display='none';
  $('wfEditOverlay').style.display='flex';
  document.body.style.overflow='hidden';
}

async function wfEditOpen(){
  if(!_curWf)return;
  _wfEditMode='edit';_wfEditId=_curWf.workflow_id;
  $('wfEditTitle').textContent='Edit — '+_curWf.name;
  $('wfEditName').value=_curWf.name||'';
  $('wfEditDesc').value=_curWf.description||'';
  _wfEditSteps=(_curWf.steps||[]).map(function(s){
    return {step_num:s.step_num,label:s.label,color:s.color||'#888',
            compute:s.compute||'cpu',job_types:(s.job_types||[]).slice(),
            parameters:Object.assign({},s.parameters||{}),
            wait_for_exit_zero:s.wait_for_exit_zero!==false};
  });
  await _wfLoadCfg();
  _wfRenderEditSteps();
  $('wfDetailOverlay').style.display='none';
  $('wfEditOverlay').style.display='flex';
  document.body.style.overflow='hidden';
}

function wfEditClose(){
  $('wfEditOverlay').style.display='none';
  document.body.style.overflow='';
}

// Working copy of steps being edited
var _wfEditSteps=[];

async function _wfLoadCfg(){
  window._wfProjCfg={};
  if(!curProj)return;
  try{
    const pc=await api('/api/projects/'+curProj+'/config');
    if(pc.tomo_dims&&pc.tomo_dims.length>=3){
      pc.tomo_x=pc.tomo_dims[0];pc.tomo_y=pc.tomo_dims[1];pc.tomo_z=pc.tomo_dims[2];
    }
    if(pc.warptools_dir){
      pc.warptools_tiltseries_dir=pc.warptools_dir.replace(/\/+$/,'')+'/warp_tiltseries';
    }
    window._wfProjCfg=pc;
  }catch(e){}
}

function _wfRenderEditSteps(){
  var container=$('wfEditSteps');
  container.innerHTML='';
  // Prefill from project config
  var _wfCfg=window._wfProjCfg||{};
  _wfEditSteps.forEach(function(step,idx){
    var card=document.createElement('div');
    card.style.cssText='background:var(--bg);border:1px solid var(--bd);border-radius:6px;overflow:hidden';
    // Step header — no color picker, dot is fixed by step color
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;gap:.4rem;padding:.35rem .5rem;border-bottom:1px solid var(--bd);background:var(--sf2)';
    hdr.innerHTML=
      '<div style="width:.55rem;height:.55rem;border-radius:50%;background:'+step.color+';flex-shrink:0"></div>'+
      '<input value="'+step.label+'" data-idx="'+idx+'" data-field="label" '+
        'style="background:transparent;border:none;outline:none;font-size:.78rem;font-weight:700;color:var(--tx);flex:1;min-width:0" '+
        'onchange="_wfStepFieldChange('+idx+',\'label\',this.value)">'+
      '<select data-idx="'+idx+'" data-field="compute" '+
        'style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx);font-size:.65rem;border-radius:3px;padding:.1rem .2rem" '+
        'onchange="_wfStepFieldChange('+idx+',\'compute\',this.value)">'+
        '<option value="cpu"'+(step.compute==='cpu'?' selected':'')+'>CPU</option>'+
        '<option value="gpu"'+(step.compute==='gpu'?' selected':'')+'>GPU</option>'+
      '</select>'+
      (idx>0?'<button onclick="_wfMoveStep('+idx+',-1)" style="all:unset;cursor:pointer;color:var(--dm);font-size:.75rem;padding:.1rem .2rem" title="Move up">↑</button>':'')+
      (idx<_wfEditSteps.length-1?'<button onclick="_wfMoveStep('+idx+',1)" style="all:unset;cursor:pointer;color:var(--dm);font-size:.75rem;padding:.1rem .2rem" title="Move down">↓</button>':'')+
      '<button onclick="_wfRemoveStep('+idx+')" style="all:unset;cursor:pointer;color:var(--rd);font-size:.75rem;padding:.1rem .25rem" title="Remove step">✕</button>';
    card.appendChild(hdr);
    // Job types
    var body=document.createElement('div');
    body.style.cssText='padding:.4rem .5rem;display:flex;flex-direction:column;gap:.3rem';
    // Job type pills
    var pills=document.createElement('div');
    pills.style.cssText='display:flex;flex-wrap:wrap;gap:.25rem;margin-bottom:.2rem';
    step.job_types.forEach(function(jt,ji){
      var tplMatch=(window._allTemplates||[]).find(function(t){return t.id===jt;});
      var displayName=tplMatch?tplMatch.name:jt;
      var pill=document.createElement('span');
      pill.style.cssText='display:inline-flex;align-items:center;gap:.2rem;background:var(--sf2);border:1px solid var(--bd);border-radius:4px;padding:.12rem .38rem;font-size:.68rem;color:var(--tx)';
      pill.title=jt;
      pill.innerHTML='<span>'+displayName+'</span>'+
        '<button onclick="_wfRemoveJobType('+idx+','+ji+')" style="all:unset;cursor:pointer;color:var(--dm);font-size:.65rem;line-height:1;margin-left:.15rem" title="Remove '+jt+'">✕</button>';
      pills.appendChild(pill);
    });
    // Add job type dropdown
    var addRow=document.createElement('div');
    addRow.style.cssText='display:flex;gap:.25rem;align-items:center';
    var sel=document.createElement('select');
    sel.style.cssText='flex:1;background:var(--bg);border:1px solid var(--bd);color:var(--dm);font-size:.68rem;border-radius:4px;padding:.15rem .3rem';
    sel.innerHTML='<option value="">+ Add job type...</option>'+
      (window._allTemplates||[]).map(function(t){
        return '<option value="'+t.id+'">'+t.name+'</option>';
      }).join('');
    var addBtn=document.createElement('button');
    addBtn.className='bsm';
    addBtn.textContent='Add';
    addBtn.style.fontSize='.68rem';
    addBtn.onclick=function(){if(sel.value)_wfAddJobType(idx,sel.value);sel.value='';};
    addRow.appendChild(sel);addRow.appendChild(addBtn);
    body.appendChild(pills);
    body.appendChild(addRow);
    // Parameters
    if(step.job_types.length>0){
      var paramSec=document.createElement('div');
      paramSec.style.cssText='margin-top:.3rem;padding-top:.3rem;border-top:1px solid var(--bd)';
      var paramLabel=document.createElement('div');
      paramLabel.style.cssText='font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--dm);margin-bottom:.25rem';
      paramLabel.textContent='Pre-filled parameters (optional — leave blank to set at run time)';
      paramSec.appendChild(paramLabel);
      // Collect all unique params from all job_types in this step
      var allParams={};
      (window._allTemplates||[]).forEach(function(t){
        if(step.job_types.includes(t.id)){
          (t.parameters||[]).forEach(function(p){
            if(!allParams[p.key])allParams[p.key]={key:p.key,label:p.label,type:p.type,help:p.help||''};
          });
        }
      });
      Object.values(allParams).forEach(function(p){
        var row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem';
        var lbl=document.createElement('label');
        lbl.style.cssText='font-size:.68rem;color:var(--dm);min-width:120px;flex-shrink:0';
        lbl.textContent=p.label||p.key;
        lbl.title=p.help;
        var inp=document.createElement('input');
        inp.type='text';
        inp.placeholder=p.help?p.help.slice(0,40):'';
        // Prefill: 1) from saved step params, 2) from project config via TPL_AUTOFILL
        var savedVal=(step.parameters&&step.parameters[p.key])||'';
        var autoKey=TPL_AUTOFILL[p.key];
        var autoVal=autoKey&&_wfCfg[autoKey]!==undefined&&_wfCfg[autoKey]!==''&&_wfCfg[autoKey]!==0?String(_wfCfg[autoKey]):'';
        inp.value=savedVal||autoVal;
        if(!savedVal&&autoVal){inp.style.borderColor='rgba(63,185,80,.4)';inp.style.background='rgba(63,185,80,.03)';}
        inp.style.cssText='flex:1;font-size:.68rem;font-family:monospace;padding:.18rem .3rem;background:var(--bg);border:1px solid var(--bd);border-radius:4px;color:var(--tx);outline:none';
        inp.onfocus=function(){this.style.borderColor='var(--ac)';};
        inp.onblur=function(){this.style.borderColor='var(--bd)';};
        inp.dataset.idx=idx;inp.dataset.param=p.key;
        inp.onchange=function(){_wfParamChange(idx,p.key,this.value);};
        row.appendChild(lbl);row.appendChild(inp);
        paramSec.appendChild(row);
      });
      body.appendChild(paramSec);
    }
    card.appendChild(body);
    container.appendChild(card);
  });
}

function _wfStepFieldChange(idx,field,val){
  if(_wfEditSteps[idx])_wfEditSteps[idx][field]=val;
}
function _wfParamChange(idx,key,val){
  if(!_wfEditSteps[idx])return;
  if(!_wfEditSteps[idx].parameters)_wfEditSteps[idx].parameters={};
  _wfEditSteps[idx].parameters[key]=val;
}
function _wfRemoveStep(idx){
  _wfEditSteps.splice(idx,1);
  _wfEditSteps.forEach(function(s,i){s.step_num=i+1;});
  _wfRenderEditSteps();
}
function _wfMoveStep(idx,dir){
  var target=idx+dir;
  if(target<0||target>=_wfEditSteps.length)return;
  var tmp=_wfEditSteps[idx];_wfEditSteps[idx]=_wfEditSteps[target];_wfEditSteps[target]=tmp;
  _wfEditSteps.forEach(function(s,i){s.step_num=i+1;});
  _wfRenderEditSteps();
}
function _wfAddJobType(idx,jobType){
  if(!_wfEditSteps[idx])return;
  if(!_wfEditSteps[idx].job_types.includes(jobType))_wfEditSteps[idx].job_types.push(jobType);
  _wfRenderEditSteps();
}
function _wfRemoveJobType(idx,ji){
  if(!_wfEditSteps[idx])return;
  _wfEditSteps[idx].job_types.splice(ji,1);
  _wfRenderEditSteps();
}

function wfEditAddStep(){
  var num=_wfEditSteps.length+1;
  _wfEditSteps.push({step_num:num,label:'Step '+num,color:'#888780',compute:'cpu',job_types:[],parameters:{},wait_for_exit_zero:true});
  _wfRenderEditSteps();
}

async function wfEditSave(){
  var name=$('wfEditName').value.trim();
  if(!name){alert('Please enter a workflow name.');return;}
  // Collect current step labels/params from DOM before saving
  document.querySelectorAll('#wfEditSteps input[data-idx][data-field="label"]').forEach(function(inp){
    var i=parseInt(inp.dataset.idx);if(_wfEditSteps[i])_wfEditSteps[i].label=inp.value;
  });
  document.querySelectorAll('#wfEditSteps input[data-idx][data-param]').forEach(function(inp){
    var i=parseInt(inp.dataset.idx);var k=inp.dataset.param;
    if(_wfEditSteps[i]){if(!_wfEditSteps[i].parameters)_wfEditSteps[i].parameters={};
      if(inp.value)_wfEditSteps[i].parameters[k]=inp.value;}
  });
  var desc=$('wfEditDesc').value.trim();
  var steps=_wfEditSteps.map(function(s,i){
    return {step_num:i+1,label:s.label,color:s.color,compute:s.compute,
            job_types:s.job_types,parameters:s.parameters||{},wait_for_exit_zero:s.wait_for_exit_zero!==false};
  });
  try{
    var savedWf;
    if(_wfEditMode==='new'){
      savedWf=await post('/api/projects/'+curProj+'/workflows',{name:name,description:desc,steps:steps});
    }else{
      await fetch('/api/projects/'+curProj+'/workflows/'+_wfEditId,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:name,description:desc,steps:steps})
      });
      savedWf={workflow_id:_wfEditId};
    }
    wfEditClose();
    await loadWorkflows();
    // Auto-open the saved workflow in the builder panel
    if(savedWf&&savedWf.workflow_id)wfBuilderSelect(savedWf.workflow_id);
  }catch(e){alert('Error saving workflow: '+(e.message||e));}
}

function jdpOverlayClick(e){
  if(e.target===$('jobDetailOverlay'))jdpClose();
}

function jdpRenderTags(tags){
  var el=document.getElementById('jdpTagList');
  if(!el)return;
  el.innerHTML='';
  var jobType=jdpCurrentJob?jdpCurrentJob.job_type:'';
  (tags||[]).forEach(function(t){
    var chip=document.createElement('span');
    chip.className='tag '+tagClass(t,jobType);
    chip.textContent=t+' ';
    var rm=document.createElement('span');
    rm.className='tag remove-btn';rm.title='Remove';rm.textContent='✕';
    (function(tag){rm.onclick=function(){jdpRemoveTag(tag);};})(t);
    chip.appendChild(rm);
    el.appendChild(chip);
  });
}

function jdpRenderParents(parents){
  var el=document.getElementById('jdpParents');
  if(!el)return;
  el.innerHTML='';
  if(!parents||!parents.length){
    var empty=document.createElement('span');
    empty.style.cssText='font-size:.74rem;color:var(--dm)';
    empty.textContent='No parent jobs linked';
    el.appendChild(empty);return;
  }
  parents.forEach(function(p){
    var chip=document.createElement('div');
    chip.className='parent-chip';
    chip.innerHTML='<span style="font-size:.8rem">&#8593;</span> '+p;
    (function(pid){chip.onclick=function(){jdpOpen(pid);};})(p);
    el.appendChild(chip);
  });
}

function jdpAddTag(){
  const inp=$('jdpTagInput');if(!inp||!inp.value.trim())return;
  const tag=inp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-');
  if(!jdpCurrentJob)return;
  if(!jdpCurrentJob.tags)jdpCurrentJob.tags=[];
  if(!jdpCurrentJob.tags.includes(tag)){jdpCurrentJob.tags.push(tag);}
  jdpRenderTags(jdpCurrentJob.tags);
  if(tag==='final')_updateFinalBtn(true);
  jdpShowTagSuggestions('');
  inp.value='';
}

function jdpRemoveTag(tag){
  if(!jdpCurrentJob||!jdpCurrentJob.tags)return;
  jdpCurrentJob.tags=jdpCurrentJob.tags.filter(function(t){return t!==tag;});
  jdpRenderTags(jdpCurrentJob.tags);
  _updateFinalBtn((jdpCurrentJob.tags||[]).includes('final'));
  jdpShowTagSuggestions('');
}

function jdpAddParent(){
  const sel=$('jdpParentSelect');if(!sel||!sel.value)return;
  if(!jdpCurrentJob)return;
  if(!jdpCurrentJob.parent_jobs)jdpCurrentJob.parent_jobs=[];
  if(!jdpCurrentJob.parent_jobs.includes(sel.value)){
    jdpCurrentJob.parent_jobs.push(sel.value);
  }
  jdpRenderParents(jdpCurrentJob.parent_jobs);
  sel.value='';
}

function jdpCopyCurrentParams(){
  if(!jdpCurrentJob) return;
  jobCopyParams(jdpCurrentJob.job_id).then(function(d){
    var btn = document.getElementById('jdpCopyParamsBtn');
    if(btn){ btn.textContent='✓ Copied'; btn.style.color='var(--gn)';
      setTimeout(function(){ btn.textContent='Copy params'; btn.style.color=''; },1800); }
    updatePasteBtn();
  });
}

function jdpTitleChange(){
  if(jdpCurrentJob)jdpCurrentJob.custom_title=$('jdpTitle').value;
}

async function jdpSave(){
  if(!jdpCurrentJob||!curProj)return;
  try{
    await fetch('/api/projects/'+curProj+'/jobs/'+jdpCurrentJob.job_id,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        custom_title:$('jdpTitle').value,
        tags:jdpCurrentJob.tags||[],
        notes:$('jdpNotes').value,
        parent_jobs:jdpCurrentJob.parent_jobs||[],
      })
    });
    // Log save to notebook
    await post('/api/notes',{project:curProj,
      text:'Job '+jdpCurrentJob.job_id+' updated'+(($('jdpTitle').value)?': "'+$('jdpTitle').value+'"':'')});
    loadNotes();nbMarkPending();
    loadJobs();
    jdpClose();
  }catch(e){alert('Save failed: '+e.message);}
}

async function jdpLoadLog(){
  if(!jdpCurrentJob||!curProj)return;
  const logEl=$('jdpLog');
  if(!logEl)return;
  logEl.textContent='Loading...';
  try{
    const d=await api('/api/projects/'+curProj+'/jobs/'+jdpCurrentJob.job_id+'/log');
    const lines=d.lines||[];
    if(!lines.length){logEl.textContent='No log yet.';return;}
    logEl.innerHTML='';
    lines.forEach(function(l){
      var span=document.createElement('span');
      // Classify exactly like the terminal right panel
      var cls='';
      
      // === GPU LOG DETECTION (PRIORITY) ===
      if(l.startsWith('[GPU PRE-CHECK]')||l.startsWith('[GPU POST-CHECK]'))cls='log-gpu-header';
      else if(l.startsWith('⚠ SEGMENTATION FAULT')||l.includes('SEGMENTATION FAULT DETECTED'))cls='log-gpu-crash';
      else if((l.includes('GPU')||l.includes('VRAM')||l.includes('Utilization'))&&(l.includes('MB')||l.includes('%')||l.includes('free')))cls='log-gpu-info';
      else if(l.includes('CUDA')||l.includes('Driver')||l.includes('CUDA_VISIBLE_DEVICES'))cls='log-gpu-env';
      else if(l.startsWith('⚠')&&(l.includes('GPU')||l.includes('memory')||l.includes('VRAM')))cls='log-gpu-warn';
      
      // === EXISTING LOG CLASSIFICATION ===
      else if(l.startsWith('ERR:')||l.startsWith('[stderr]')||l.toLowerCase().startsWith('error'))cls='log-err';
      else if(l.startsWith('$')||l.startsWith('pytom_')||l.startsWith('WarpTools')||l.startsWith('python'))cls='log-cmd';
      else if(l.includes('Done.')||l.includes('completed')||l.startsWith('✔')||l.startsWith('Written:')||l.includes('Saved Fig'))cls='log-ok';
      else if(l.startsWith('[started]')||l.includes('...')||l.startsWith('  Progress')||l.startsWith('  GPU'))cls='log-info';
      else if(l.startsWith('⚠')||l.toLowerCase().includes('warning'))cls='log-warn';
      
      if(cls)span.className=cls;
      span.textContent=l;
      logEl.appendChild(span);
      logEl.appendChild(document.createTextNode('\n'));
    });
        logEl.scrollTop=logEl.scrollHeight;

    // Auto-refresh log if job is still running
    if(jdpCurrentJob && jdpCurrentJob.status === 'running'){
      if(!window._jdpLogRefreshTimer){
        window._jdpLogRefreshTimer = setInterval(function(){
          if(jdpCurrentJob && jdpCurrentJob.status === 'running'){
            jdpLoadLog();
          } else {
            clearInterval(window._jdpLogRefreshTimer);
            window._jdpLogRefreshTimer = null;
          }
        }, 5000);
      }
    } else {
      if(window._jdpLogRefreshTimer){
        clearInterval(window._jdpLogRefreshTimer);
        window._jdpLogRefreshTimer = null;
      }
    }
  }catch(e){logEl.textContent='No log available.';}
}

function jdpCopyLog(){
  const logEl=$('jdpLog');if(!logEl)return;
  navigator.clipboard.writeText(logEl.textContent);
}

async function jdpSendLogToNotebook(){
  if(!jdpCurrentJob||!curProj)return;
  try{
    const d=await api('/api/projects/'+curProj+'/jobs/'+jdpCurrentJob.job_id+'/log');
    const lines=(d.lines||[]).slice(-30);
    const header='Job log for '+jdpCurrentJob.job_id+' ('+jdpCurrentJob.job_type+'):';
    const text=header+'\n```\n'+lines.join('\n')+'\n```';
    await post('/api/notes',{project:curProj,text:text});
    loadNotes();nbMarkPending();
    var s=$('jdpStatus');
    if(s){s.textContent='Log sent to notebook';setTimeout(function(){s.textContent=jdpCurrentJob.status;},2000);}
  }catch(e){}
}


async function jdpDeleteJob(){
  if(!jdpCurrentJob||!curProj)return;
  if(!confirm('Delete job '+jdpCurrentJob.job_id+'? This cannot be undone.'))return;
  // Mark as cancelled/deleted via patch
  try{
    await fetch('/api/projects/'+curProj+'/jobs/'+jdpCurrentJob.job_id,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({custom_title:'[DELETED] '+jdpCurrentJob.job_id,tags:['deleted']})
    });
    loadJobs();jdpClose();
  }catch(e){alert('Delete failed: '+e.message);}
}

// Cache all templates for compute type lookup
api('/api/templates').then(function(d){window._allTemplates=d.templates||[];}).catch(function(){});

// ══════════════════════════════════════════════════════════
// RELION CALCULATORS