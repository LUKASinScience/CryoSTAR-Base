/* CryoSTAR-Base — core.js
   Part of CryoSTAR-Base frontend
   Depends on: core.js (api, post, $, curProj, etc.) */

/* CryoSTAR-Base — Lukas W. Bauer und Claude — 2026 */
const CAT_ORDER=['import','aretomo3','warp_preproc','pytom','warp_export','relion','mtools','convert','other'];
const GOOD_BOXES=[24,32,36,40,44,48,52,56,60,64,72,84,96,100,104,112,120,128,132,140,168,180,192,196,208,216,220,224,240,256,260,288,300,320,352,360,384,416,440,448,480,512];
const $=id=>document.getElementById(id);
let curProj=null,curP='.',curTpl=null,curRun=null,ws=null,brCurPath='.';
let curRefMethod='';
let createFolder=null,wizardInvestigators=[];
let nbPending=false; // notebook has unsaved changes from other tabs
let _wizardMdocData=null; // Store MDOC data from wizard for initial project config

// ── Theme toggle ──────────────────────────────────────────────────────────────
var _isLight=true; // Default: Light Mode
function toggleTheme(){
  _isLight=!_isLight;
  applyTheme();
  try{localStorage.setItem('p2r_theme',_isLight?'light':'dark');}catch(e){}
}
function applyTheme(){
  document.body.classList.toggle('light',_isLight);
  var iconEl=$('themeIcon'),label=$('themeLabel');
  // Use icon() if available (after misc.js loads), otherwise Unicode
  if(iconEl){
    if(typeof icon === 'function'){
      iconEl.innerHTML=_isLight?icon('moon'):icon('sun');
    } else {
      iconEl.textContent=_isLight?'🌙':'☀';
    }
  }
  if(label)label.textContent=_isLight?'Dark':'Light';
}
(function(){
  try{var t=localStorage.getItem('p2r_theme');if(t==='dark'){_isLight=false;}else{_isLight=true;}}catch(e){}
  applyTheme();
})();

async function api(p,opts){const r=await fetch(p,opts);if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||r.statusText)}return r.json()}
async function post(p,b){const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||r.statusText)}return r.json()}
async function del(p){const r=await fetch(p,{method:'DELETE'});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||r.statusText)}return r.json()}
function tl(el,t,c){const d=document.createElement('div');d.className='tl '+(c||'');d.textContent=t;el.appendChild(d)}
function res(id,ok,m){
  const iconHtml = typeof icon === 'function' 
    ? (ok ? icon('success') : icon('warning'))
    : `<span>${ok?'✓':'⚠'}</span>`;
  $(id).innerHTML=`<div class="res ${ok?'ok':'error'}">${iconHtml}<span>${m}</span></div>`;
}
function chks(id,c){
  const getIcon = (status) => {
    if(typeof icon !== 'function') {
      return status==='ok'?'✓':status==='warning'?'⚠':'⚠';
    }
    return status==='ok' ? icon('success') : icon('warning');
  };
  $(id).innerHTML=c.map(x=>`<div class="chk ${x.status}"><span class="ci">${getIcon(x.status)}</span><span class="cn">${x.name}</span><span class="cm">${x.msg||''}</span></div>`).join('');
}
function sz(b){if(b<1024)return b+' B';if(b<1e6)return(b/1024).toFixed(1)+' KB';if(b<1e9)return(b/1e6).toFixed(1)+' MB';return(b/1e9).toFixed(1)+' GB'}
function tr(s,n){return s.length>n?s.slice(0,n)+'…':s}
function si(s){
  if(typeof icon !== 'function') {
    return{completed:'✓',running:'●',failed:'✖',cancelled:'○',queued:'◌'}[s]||'?';
  }
  // Use SVG for completed/failed, Unicode for running states
  if(s==='completed') return icon('success');
  if(s==='failed') return icon('error');
  return{running:'●',cancelled:'○',queued:'◌'}[s]||'?';
}
function sc(s){return{completed:'var(--gn)',running:'var(--ac)',failed:'var(--rd)',cancelled:'var(--yl)',queued:'var(--dm)'}[s]||'var(--dm)'}

// Mark notebook as having pending updates
function nbMarkPending(){
  nbPending=true;
  const badge=$('nbBadge');if(badge)badge.classList.add('show');
}

// ── Help Modal ──
function helpOpen(){document.getElementById('helpOverlay').style.display='';}
function helpClose(){document.getElementById('helpOverlay').style.display='none';}
function helpTab(i){
  document.querySelectorAll('.help-tab').forEach(function(b){b.classList.toggle('on',parseInt(b.dataset.hi)===i);});
  document.querySelectorAll('.help-panel').forEach(function(p){p.classList.toggle('on',p.id==='hp-'+i);});
}
// Close on Escape
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&document.getElementById('helpOverlay').style.display!=='none'){helpClose();}
});

// ── Right panel collapse ──
let _rightOpen=false;
function toggleRightPanel(){
  _rightOpen=!_rightOpen;
  var a=document.getElementById('right');
  if(a)a.classList.toggle('right-panel-collapsed',!_rightOpen);
  // Update toolbar button visual state
  var tb=document.getElementById('jobBuilderToolbarBtn');
  if(tb){
    tb.style.background=_rightOpen?'rgba(88,166,255,.18)':'rgba(88,166,255,.08)';
    tb.style.borderColor=_rightOpen?'var(--ac)':'rgba(88,166,255,.5)';
  }
}
function openRightPanel(){if(!_rightOpen)toggleRightPanel();}
function closeJobParams(){
  var parP=document.getElementById('parP');
  if(parP)parP.style.display='none';
  var ph=document.getElementById('jobPlaceholder');
  if(ph)ph.style.display='block';
  curTpl=null;
}

// ── Pipeline row toggle ──
let _workflowOpen=false;
function toggleWorkflowRow(){
  _workflowOpen=!_workflowOpen;
  // Always make the row container visible first
  var row=document.getElementById('workflowTabsRow');
  if(row)row.style.display='';
  var bar=document.getElementById('wfBar');
  if(bar)bar.style.display='none';
  uNavShow();
  phase2OnProjectOpen();
  phase5OnProjectOpen();
  var inner=document.getElementById('workflowTabsInner');
  if(inner)inner.style.display=_workflowOpen?'':'none';
  // Update pill visual state
  var pill=document.getElementById('workflowPillBtn');
  if(pill){
    pill.style.borderColor=_workflowOpen?'var(--ac)':'rgba(139,148,158,.35)';
    pill.style.color=_workflowOpen?'var(--ac)':'var(--dm)';
    pill.style.background=_workflowOpen?'rgba(88,166,255,.06)':'transparent';
  }
}
function relionPillHoverOut(){
  var pill=document.getElementById('workflowPillBtn');
  if(!pill)return;
  pill.style.borderColor=_workflowOpen?'var(--ac)':'rgba(139,148,158,.35)';
  pill.style.color=_workflowOpen?'var(--ac)':'var(--dm)';
}
function showWorkflowRow(){
  var bar=document.getElementById('wfBar');
  if(bar)bar.style.display='flex';
  var row=document.getElementById('workflowTabsRow');
  if(row)row.style.display='';
  // Auto-open tabs if they haven't been opened yet
  if(!_workflowOpen)toggleWorkflowRow();
}

// ── Cryo-ET row toggle ──
let _cryoetOpen=false;
function toggleCryoetRow(){
  _cryoetOpen=!_cryoetOpen;
  var row=document.getElementById('cryoetTabsRow');
  if(row)row.style.display='';
  var inner=document.getElementById('cryoetTabsInner');
  if(inner)inner.style.display=_cryoetOpen?'':'none';
  var pill=document.getElementById('cryoetPillBtn');
  if(pill){
    pill.style.borderColor=_cryoetOpen?'#0891b2':'rgba(139,148,158,.4)';
    pill.style.color=_cryoetOpen?'#0891b2':'var(--dm)';
    pill.style.background=_cryoetOpen?'rgba(8,145,178,.06)':'transparent';
  }
}
function cryoetPillHoverOut(){
  var pill=document.getElementById('cryoetPillBtn');
  if(!pill)return;
  pill.style.borderColor=_cryoetOpen?'#0891b2':'rgba(139,148,158,.4)';
  pill.style.color=_cryoetOpen?'#0891b2':'var(--dm)';
}
function isonetLaunch(){
  var loadCmd=document.getElementById('prog-cmd-isonet');
  var cmd=(loadCmd&&loadCmd.value.trim()?loadCmd.value.trim()+' && ':'')+'isonet.py gui';
  document.getElementById('isonetLaunchCmd').textContent=cmd;
  navigator.clipboard.writeText(cmd).catch(function(){});
  var res=document.getElementById('isonetSaveRes');
  if(res){res.textContent='Command copied — paste in terminal';setTimeout(function(){res.textContent='';},3000);}
}
function aisLaunch(){
  var loadCmd=document.getElementById('prog-cmd-ais');
  var cmd=(loadCmd&&loadCmd.value.trim()?loadCmd.value.trim()+' && ':'')+'ais';
  document.getElementById('aisLaunchCmd').textContent=cmd;
  navigator.clipboard.writeText(cmd).catch(function(){});
  var res=document.getElementById('aisSaveRes');
  if(res){res.textContent='Command copied — paste in terminal';setTimeout(function(){res.textContent='';},3000);}
}
async function isonetSaveToNotebook(){
  if(!curProj)return;
  var vals={
    tomo:document.getElementById('isonetTomoDir').value.trim(),
    out:document.getElementById('isonetOutDir').value.trim(),
    pix:document.getElementById('isonetPixSize').value.trim(),
    arch:document.getElementById('isonetArch').value,
    mode:document.getElementById('isonetMode').value,
    epochs:document.getElementById('isonetEpochs').value,
    notes:document.getElementById('isonetNotes').value.trim(),
  };
    var lines=['## IsoNet2 Session',''];
  if(vals.tomo)lines.push('**Input:** '+vals.tomo);
  if(vals.out)lines.push('**Output:** '+vals.out);
  lines.push('**Pixel size:** '+(vals.pix||'—')+' | **Arch:** '+vals.arch+' | **Mode:** '+vals.mode+' | **Epochs:** '+vals.epochs);
  if(vals.notes)lines.push('','**Notes:**',vals.notes);
  var text=lines.join('\n');
    try{
    await post('/api/notes',{project:curProj,text:text});
    loadNotes();nbMarkPending();
    var r=document.getElementById('isonetSaveRes');
    if(r){r.textContent='✓ Saved';setTimeout(function(){r.textContent='';},3000);}
  }catch(e){var r=document.getElementById('isonetSaveRes');if(r)r.textContent='Error: '+e.message;}
}
async function aisSaveToNotebook(){
  if(!curProj)return;
  var vals={
    tomo:document.getElementById('aisTomoInput').value.trim(),
    feat:document.getElementById('aisFeatures').value.trim(),
    model:document.getElementById('aisModel').value.trim(),
    out:document.getElementById('aisOutput').value.trim(),
    notes:document.getElementById('aisNotes').value.trim(),
  };
    var lines=['## Ais Segmentation Session',''];
  if(vals.tomo)lines.push('**Tomograms:** '+vals.tomo);
  if(vals.feat)lines.push('**Features:** '+vals.feat);
  if(vals.model)lines.push('**Model:** '+vals.model);
  if(vals.out)lines.push('**Output:** '+vals.out);
  if(vals.notes)lines.push('','**Notes:**',vals.notes);
  var text=lines.join('\n');
    try{
    await post('/api/notes',{project:curProj,text:text});
    loadNotes();nbMarkPending();
    var r=document.getElementById('aisSaveRes');
    if(r){r.textContent='✓ Saved';setTimeout(function(){r.textContent='';},3000);}
  }catch(e){var r=document.getElementById('aisSaveRes');if(r)r.textContent='Error: '+e.message;}
}
async function cryoetProgSaveAll(){
  if(!curProj)return;
  var data={};
  ['imod2','isonet','ais'].forEach(function(n){
    data['prog_cmd_'+n]=document.getElementById('prog-cmd-'+n).value.trim();
    data['prog_ver_'+n]=document.getElementById('prog-ver-'+n).value.trim();
  });
  try{
    await post('/api/projects/'+curProj+'/config',data);
    var r=document.getElementById('cryoetProgSaveRes');
    if(r){r.textContent='✓ Saved';setTimeout(function(){r.textContent='';},2500);}
  }catch(e){var r=document.getElementById('cryoetProgSaveRes');if(r)r.textContent='Error: '+e.message;}
}

// ── Slabify environment helper ──
function slabifyUpdateCmd(){
  var nameEl=document.getElementById('slabifyEnvName');
  var typeEl=document.getElementById('slabifyEnvType');
  var prevEl=document.getElementById('slabifyCmdPreview');
  if(!prevEl)return;
  var name=nameEl?nameEl.value.trim():'';
  var type=typeEl?typeEl.value:'conda';
  if(!name){prevEl.textContent='—';prevEl.style.color='var(--dm)';return;}
  var cmd='';
  if(type==='conda'){
    cmd='conda run -n '+name+' ';
  }else{
    // venv path
    var p=name.startsWith('~')||name.startsWith('/')?name:'~/'+name;
    cmd='source '+p+'/bin/activate && ';
  }
  prevEl.textContent=cmd;
  prevEl.style.color='var(--gn)';
}

async function progCheckSlabify(){
  var nameEl=document.getElementById('slabifyEnvName');
  var typeEl=document.getElementById('slabifyEnvType');
  var statEl=document.getElementById('prog-status-slabify');
  var name=nameEl?nameEl.value.trim():'';
  var type=typeEl?typeEl.value:'conda';
  if(!name){if(statEl)statEl.textContent='⚠';return;}
  if(statEl)statEl.textContent='…';
  // Build test command
  var prefix='';
  if(type==='conda')prefix='conda run -n '+name+' ';
  else{
    var p=name.startsWith('~')||name.startsWith('/')?name:'~/'+name;
    prefix='source '+p+'/bin/activate && ';
  }
  var testCmd=prefix+'cryostarbase-slabify-all --help';
  try{
    var r=await post('/api/scripts/run',{command:testCmd,working_dir:'.'});
    var ok=(r.exit_code===0)||(r.output&&r.output.indexOf('usage')>=0);
    if(statEl){statEl.textContent=ok?'✓':'✖';statEl.style.color=ok?'var(--gn)':'var(--rd)';}
  }catch(e){if(statEl){statEl.textContent='✖';statEl.style.color='var(--rd)';}}
}

async function progCheckPy2rely(){
  var cmdEl=document.getElementById('prog-cmd-py2rely');
  var statEl=document.getElementById('prog-status-py2rely');
  var noteEl=document.getElementById('prog-note-py2rely');
  var cmd=(cmdEl?cmdEl.value.trim():'')||'py2rely ui';
  // Extract base command without 'ui' for --version check
  var baseCmd=cmd.replace(/\s+ui\s*.*$/,'').trim();
  if(statEl)statEl.textContent='…';
  try{
    var r=await post('/api/scripts/run',{command:baseCmd+' --version',working_dir:'.'});
    var ok=r.exit_code===0;
    if(statEl){statEl.textContent=ok?'✓':'✖';statEl.style.color=ok?'var(--gn)':'var(--rd)';}
    if(noteEl)noteEl.textContent=ok?(r.output||'').trim().split('\n')[0]:'Not found — install with: pip install "py2rely[dashboard]"';
  }catch(e){
    if(statEl){statEl.textContent='✖';statEl.style.color='var(--rd)';}
    if(noteEl)noteEl.textContent='Check failed: '+e.message;
  }
}

// ── py2rely Dashboard Tab ──
var _py2relySelected='';
var _py2relyPollTimer=null;

async function py2relyRefreshDirs(){
  if(!curProj)return;
  try{
    const d=await api('/api/projects/'+curProj+'/relion_sta_dirs');
    var list=$('py2relyDirList');
    var empty=$('py2relyDirEmpty');
    if(!d.dirs||!d.dirs.length){
      if(list)list.innerHTML='';
      if(empty)empty.style.display='';
      return;
    }
    if(empty)empty.style.display='none';
    list.innerHTML=d.dirs.map(function(dir){
      var active=dir===_py2relySelected;
      return '<div onclick="py2relySelectDir(\''+dir+'\')" style="display:flex;align-items:center;gap:.4rem;'+
        'padding:.28rem .45rem;border-radius:5px;cursor:pointer;font-size:.75rem;'+
        'background:'+(active?'rgba(6,182,212,.12)':'var(--bg)')+';'+
        'border:0.5px solid '+(active?'rgba(6,182,212,.4)':'var(--bd)')+';'+
        'color:'+(active?'#06b6d4':'var(--tx)')+'">'+
        '<span style="font-family:monospace">'+dir+'</span>'+
        (active?'<span style="margin-left:auto;font-size:.65rem;color:#06b6d4">selected</span>':'')+
      '</div>';
    }).join('');
  }catch(e){console.error('py2relyRefreshDirs',e);}
}

function py2relySelectDir(dir){
  _py2relySelected=dir;
  var selRow=$('py2relySelectedRow');
  var selDir=$('py2relySelectedDir');
  if(selDir)selDir.textContent='relion_sta/'+dir;
  if(selRow)selRow.style.display='';
  py2relyRefreshDirs();
  py2relyUpdateCmdPreview();
}

function py2relyClearSelection(){
  _py2relySelected='';
  var selRow=$('py2relySelectedRow');
  if(selRow)selRow.style.display='none';
  py2relyRefreshDirs();
  py2relyUpdateCmdPreview();
}

function py2relyUpdateCmdPreview(){
  var cmdEl=$('prog-cmd-py2rely');
  var portEl=$('py2relyPort');
  var preview=$('py2relyCmdPreview');
  var cmd=(cmdEl?cmdEl.value.trim():'')||'py2rely ui';
  var port=(portEl?portEl.value:'3000')||'3000';
  var dir=_py2relySelected?'relion_sta/'+_py2relySelected:'{select a dir above}';
  if(preview)preview.textContent='cd '+dir+' && '+cmd+' --no-browser --port '+port;
}

async function py2relyLaunch(){
  if(!_py2relySelected){
    $('py2relyMsg').textContent='Please select a RELION working directory first.';
    $('py2relyMsg').style.color='var(--rd)';
    return;
  }
  if(!curProj){$('py2relyMsg').textContent='No project selected.';return;}
  var cmdEl=$('prog-cmd-py2rely');
  var portEl=$('py2relyPort');
  var cmd=(cmdEl?cmdEl.value.trim():'')||'py2rely ui';
  var port=parseInt((portEl?portEl.value:'3000')||'3000');
  // Get absolute relion_sta dir path from project
  try{
    const cfg=await api('/api/projects/'+curProj+'/config');
    var projDir=cfg.project_dir||'';
    // relion_dir = absolute path to relion_sta subdir
    var relionDir=(projDir?projDir+'/':'')+'relion_sta/'+_py2relySelected;
    $('py2relyMsg').textContent='Starting py2rely dashboard…';
    $('py2relyMsg').style.color='var(--dm)';
    const r=await post('/api/dashboard/start',{relion_dir:relionDir,py2rely_cmd:cmd,port:port});
    if(r.error){
      $('py2relyMsg').textContent='Error: '+r.error;
      $('py2relyMsg').style.color='var(--rd)';
      return;
    }
    $('py2relyMsg').textContent='Launched — waiting for dashboard to start…';
    // Poll status then open tab
    setTimeout(function(){py2relyOpen(port);},2500);
    py2relyStartPoll();
  }catch(e){
    $('py2relyMsg').textContent='Error: '+(e.message||e);
    $('py2relyMsg').style.color='var(--rd)';
  }
}

function py2relyOpen(port){
  var portEl=$('py2relyPort');
  var p=port||parseInt((portEl?portEl.value:'3000')||'3000');
  window.open('http://localhost:'+p,'_blank');
}

async function py2relyStop(){
  try{
    await post('/api/dashboard/stop',{});
    $('py2relyMsg').textContent='Dashboard stopped.';
    $('py2relyMsg').style.color='var(--dm)';
    py2relyUpdateStatus({running:false});
    py2relyStopPoll();
  }catch(e){}
}

function py2relyUpdateStatus(s){
  var badge=$('py2relyStatusBadge');
  var openBtn=$('py2relyOpenBtn');
  var stopBtn=$('py2relyStopBtn');
  if(s.running){
    if(badge){badge.textContent='● Running';badge.className='badge running';}
    if(openBtn)openBtn.style.display='';
    if(stopBtn)stopBtn.style.display='';
  }else{
    if(badge){badge.textContent='○ Stopped';badge.className='badge';}
    if(openBtn)openBtn.style.display='none';
    if(stopBtn)stopBtn.style.display='none';
  }
}

function py2relyStartPoll(){
  py2relyStopPoll();
  _py2relyPollTimer=setInterval(async function(){
    try{const s=await api('/api/dashboard/status');py2relyUpdateStatus(s);}catch(e){}
  },4000);
}

function py2relyStopPoll(){
  if(_py2relyPollTimer){clearInterval(_py2relyPollTimer);_py2relyPollTimer=null;}
}

// ── Computing Tab ──
var _compType = '';

function compSelectType(type){
  _compType = type;
  var wsEl=$('compTypeWS'), hpcEl=$('compTypeHPC');
  var hpcFields=$('compHPCFields');
  var accentBg='rgba(88,166,255,.1)', accentBd='rgba(88,166,255,.4)';
  if(wsEl)wsEl.style.cssText='flex:1;padding:.5rem;border:1px solid '+(type==='workstation'?accentBd:'var(--bd)')+';border-radius:7px;cursor:pointer;text-align:center;background:'+(type==='workstation'?accentBg:'transparent');
  if(hpcEl)hpcEl.style.cssText='flex:1;padding:.5rem;border:1px solid '+(type==='cluster'?accentBd:'var(--bd)')+';border-radius:7px;cursor:pointer;text-align:center;background:'+(type==='cluster'?accentBg:'transparent');
  if(hpcFields)hpcFields.style.display=type==='cluster'?'':'none';
}

function compConnChange(){
  var ssh=document.getElementById('compConnSSH');
  var sshRow=$('compSSHRow');
  if(sshRow)sshRow.style.display=(ssh&&ssh.checked)?'':'none';
}

async function compAutoDetect(){
  var msg=$('compDetectMsg');
  if(msg){msg.textContent='Detecting…';msg.style.color='var(--dm)';}
  try{
    const d=await api('/api/computing/detect');
    // Fill fields
    var fn=$('compFriendlyName');
    var hn=$('compHostname');
    var gpu=$('compGPUs');
    var cpu=$('compCPUCores');
    var ram=$('compRAMGB');
    var os=$('compOS');
    if(hn&&!hn.value)hn.value=d.hostname||'';
    if(fn&&!fn.value)fn.value=d.hostname||'';
    if(gpu&&!gpu.value)gpu.value=d.gpus||'';
    if(cpu&&!cpu.value)cpu.value=d.cpu_cores||'';
    if(ram&&!ram.value)ram.value=d.ram_gb||'';
    if(os&&!os.value)os.value=(d.os||'').split('-')[0].trim();
    if(msg){
      msg.textContent='✓ Detected: '+(d.hostname||'?')+(d.gpus?' · '+d.gpus:'')+(d.ram_gb?' · '+d.ram_gb+'GB RAM':'');
      msg.style.color='var(--gn)';
    }
  }catch(e){
    if(msg){msg.textContent='Detection failed: '+(e.message||e);msg.style.color='var(--rd)';}
  }
}

async function compSave(){
  if(!curProj)return;
  var conn=document.querySelector('input[name="compConn"]:checked');
  var slurm=$('compSLURMTracking');
  var data={
    compute_type: _compType,
    compute_friendly_name: ($('compFriendlyName')||{}).value||'',
    compute_host: ($('compFriendlyName')||{}).value||'',
    compute_hostname: ($('compHostname')||{}).value||'',
    compute_gpus: ($('compGPUs')||{}).value||'',
    compute_cpu_cores: parseInt(($('compCPUCores')||{}).value)||0,
    compute_ram_gb: parseInt(($('compRAMGB')||{}).value)||0,
    compute_os: ($('compOS')||{}).value||'',
    compute_connection: conn?conn.value:'local',
    compute_ssh_host: ($('compSSHHost')||{}).value||'',
    compute_ssh_user: ($('compSSHUser')||{}).value||'',
    compute_ssh_port: ($('compSSHPort')||{}).value||'22',
    compute_ssh_key: ($('compSSHKey')||{}).value||'',
    compute_ssh_remote_dir: ($('compSSHRemoteDir')||{}).value||'',
    compute_ssh_from: ($('compSSHFrom')||{}).value||'',
    compute_scheduler: ($('compScheduler')||{}).value||'',
    compute_slurm_partition: ($('compPartition')||{}).value||'',
    compute_slurm_tracking: slurm?slurm.checked:true,
    compute_notes: ($('compNotes')||{}).value||'',
    // Execution mode — saved together so one Save covers everything
    compute_execution_mode: _execMode||'',
    compute_slurm_reservation: ($('execSlurmReservation')||{}).value||'',
    compute_slurm_time:        ($('execSlurmTime')||{}).value||'24:00:00',
    compute_slurm_mem:         ($('execSlurmMem')||{}).value||'64G',
  };
  try{
    await post('/api/projects/'+curProj+'/config', data);
    var res=$('compSaveRes');
    if(res){res.textContent='✓ Saved';setTimeout(function(){res.textContent='';},2500);}
    compUpdateTabStatus();
    // Log to notebook
    var machineStr=(data.compute_host||data.compute_hostname||'unknown')+
      (data.compute_gpus?' · GPU: '+data.compute_gpus:'')+
      (data.compute_connection==='ssh'?' · via SSH from '+data.compute_ssh_from:'');
    await post('/api/notes',{project:curProj,
      text:'[Computing environment saved]\n  Type: '+(data.compute_type||'—')+'\n  Machine: '+machineStr+
           (data.compute_scheduler?'\n  Scheduler: '+data.compute_scheduler:'')});
    loadNotes();nbMarkPending();
  }catch(e){
    var res=$('compSaveRes');
    if(res)res.textContent='Error: '+e.message;
  }
}

function compUpdateTabStatus(){
  var ts=$('ts-computing');
  if(!ts)return;
  var hasMode=!!_execMode;
  if(_compType&&hasMode){ts.textContent=' ✓';ts.className='tab-status complete';}
  else if(_compType||hasMode){ts.textContent=' ⚠';ts.className='tab-status partial';}
  else{ts.textContent=' ⚠';ts.className='tab-status empty';}
}

async function compLoad(){
  if(!curProj)return;
  try{
    var c=await api('/api/projects/'+curProj+'/config');
    if(c.compute_type)compSelectType(c.compute_type);
    var fn=$('compFriendlyName'); if(fn)fn.value=c.compute_host||'';
    var hn=$('compHostname'); if(hn)hn.value=c.compute_hostname||'';
    var gpu=$('compGPUs'); if(gpu)gpu.value=c.compute_gpus||'';
    var cpu=$('compCPUCores'); if(cpu)cpu.value=c.compute_cpu_cores||'';
    var ram=$('compRAMGB'); if(ram)ram.value=c.compute_ram_gb||'';
    var os=$('compOS'); if(os)os.value=c.compute_os||'';
    var notes=$('compNotes'); if(notes)notes.value=c.compute_notes||'';
    var sched=$('compScheduler'); if(sched&&c.compute_scheduler)sched.value=c.compute_scheduler;
    var part=$('compPartition'); if(part)part.value=c.compute_slurm_partition||'';
    var slurm=$('compSLURMTracking'); if(slurm)slurm.checked=c.compute_slurm_tracking!==false;
    // Connection
    var conn=c.compute_connection||'local';
    var radio=document.getElementById('compConn'+(conn==='ssh'?'SSH':'Local'));
    if(radio){radio.checked=true;compConnChange();}
    var sshFrom=$('compSSHFrom'); if(sshFrom)sshFrom.value=c.compute_ssh_from||'';
    var sshHost=$('compSSHHost'); if(sshHost)sshHost.value=c.compute_ssh_host||'';
    var sshUser=$('compSSHUser'); if(sshUser)sshUser.value=c.compute_ssh_user||'';
    var sshPort=$('compSSHPort'); if(sshPort)sshPort.value=c.compute_ssh_port||'22';
    var sshKey=$('compSSHKey'); if(sshKey)sshKey.value=c.compute_ssh_key||'';
    var sshRemDir=$('compSSHRemoteDir'); if(sshRemDir)sshRemDir.value=c.compute_ssh_remote_dir||'';
    // Execution mode — load from same config, no second API call needed
    var execMode = c.compute_execution_mode || '';
    if(execMode) execModeSelect(execMode);
    else execModeUpdateWarnings('');
    var ep = document.getElementById('execSlurmPartition');
    var er = document.getElementById('execSlurmReservation');
    var et = document.getElementById('execSlurmTime');
    var em = document.getElementById('execSlurmMem');
    if(ep && c.compute_slurm_partition)   ep.value = c.compute_slurm_partition;
    if(er && c.compute_slurm_reservation) er.value = c.compute_slurm_reservation;
    if(et && c.compute_slurm_time)        et.value = c.compute_slurm_time;
    if(em && c.compute_slurm_mem)         em.value = c.compute_slurm_mem;
    // Known machines
    compRenderKnown(c.compute_known_machines||[]);
    compUpdateTabStatus();
  }catch(e){console.error('compLoad',e);}
}

function compRenderKnown(machines){
  var card=$('compKnownCard');
  var list=$('compKnownList');
  var worksCard=$('compWorksOnCard');
  var worksList=$('compWorksOnList');
  if(!machines||!machines.length){
    if(card)card.style.display='none';
    if(worksCard)worksCard.style.display='none';
    return;
  }
  if(card)card.style.display='';
  if(worksCard)worksCard.style.display='';
  if(list){
    list.innerHTML=machines.map(function(m){
      var ok=m.jobs_ok||0, fail=m.jobs_failed||0;
      var lastDate=m.last_used?m.last_used.slice(0,10):'never';
      var statusColor=fail>0?(ok>0?'var(--yl)':'var(--rd)'):'var(--gn)';
      return '<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem .4rem;'+
        'background:var(--bg);border:1px solid var(--bd);border-radius:5px;font-size:.76rem">'+
        '<div style="width:.5rem;height:.5rem;border-radius:50%;background:'+statusColor+';flex-shrink:0"></div>'+
        '<div style="flex:1">'+
          '<div style="font-weight:700;color:var(--tx)">'+m.name+'</div>'+
          '<div style="color:var(--dm);font-size:.68rem">'+(m.gpu||'GPU unknown')+' · '+(m.type||'?')+'</div>'+
        '</div>'+
        '<div style="text-align:right;font-size:.68rem">'+
          '<div style="color:var(--gn)">✓ '+ok+' jobs</div>'+
          (fail?'<div style="color:var(--rd)">✖ '+fail+' failed</div>':'')+
          '<div style="color:var(--dm)">'+lastDate+'</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  if(worksList){
    worksList.innerHTML=machines.map(function(m){
      var ok=m.jobs_ok||0, fail=m.jobs_failed||0;
      var icon=fail>0?(ok>0?'⚠':'✖'):'✓';
      var color=fail>0?(ok>0?'var(--yl)':'var(--rd)'):'var(--gn)';
      var label=fail>0?(ok>0?'Partial — some failures':'Failed — check logs'):'Works';
      return '<div style="display:flex;align-items:center;gap:.4rem;font-size:.75rem;'+
        'padding:.22rem .4rem;border-radius:4px;background:var(--bg)">'+
        '<span style="color:'+color+';font-weight:700">'+icon+'</span>'+
        '<span style="color:var(--tx);font-weight:600">'+m.name+'</span>'+
        '<span style="color:var(--dm)">'+(m.gpu?'· '+m.gpu:'')+'</span>'+
        '<span style="margin-left:auto;color:'+color+'">'+label+'</span>'+
      '</div>';
    }).join('');
  }
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.key==='Escape'){
    var ov=document.getElementById('jobDetailOverlay');
    if(ov&&ov.style.display!=='none'){jdpClose();return;}
    if(_rightOpen){toggleRightPanel();return;}
    if(_workflowOpen){toggleWorkflowRow();return;}
  }
  if(e.key==='n'){cTab('notes');}
  if(e.key==='b'){var bi=document.getElementById('brPathInput');if(bi){e.preventDefault();bi.focus();bi.select();}}
  if(e.key==='+'||e.key==='='){openRightPanel();}
});

// ── Execution Mode ────────────────────────────────────────────────────────────
var _execMode = '';

function execModeSelect(mode){
  _execMode = mode;
  var direct = document.getElementById('execModeDirect');
  var slurm  = document.getElementById('execModeSlurm');
  var fields = document.getElementById('execSlurmFields');
  var badge  = document.getElementById('execModeBadge');
  if(direct){
    direct.style.borderColor = mode==='direct' ? 'var(--ac)' : 'var(--bd)';
    direct.style.background  = mode==='direct' ? 'rgba(88,166,255,.06)' : '';
  }
  if(slurm){
    slurm.style.borderColor = mode==='slurm' ? 'var(--ac)' : 'var(--bd)';
    slurm.style.background  = mode==='slurm' ? 'rgba(88,166,255,.06)' : '';
  }
  if(fields) fields.style.display = mode==='slurm' ? '' : 'none';
  if(badge){
    badge.textContent = mode==='direct' ? 'Direct' : mode==='slurm' ? 'SLURM' : 'not configured';
    badge.style.background   = mode ? 'rgba(63,185,80,.12)' : 'rgba(248,81,73,.12)';
    badge.style.color        = mode ? 'var(--gn)'           : 'var(--rd)';
    badge.style.borderColor  = mode ? 'rgba(63,185,80,.3)'  : 'rgba(248,81,73,.3)';
  }
  execModeUpdateWarnings(mode);
}

function execModeUpdateWarnings(mode){
  // Setup tab warning
  var sw = document.getElementById('setupExecModeWarn');
  if(sw) sw.style.display = mode ? 'none' : 'flex';
  // PreProcessing tab warning
  var pw = document.getElementById('preprocExecWarn');
  if(pw) pw.style.display = mode ? 'none' : 'flex';
}

function execModeDirty(){ /* triggers auto-save on next Save click */ }

async function execModeSave(){
  if(!curProj) return;
  var data = {
    compute_execution_mode: _execMode,
    compute_slurm_partition:   ($('execSlurmPartition')  ||{}).value||'',
    compute_slurm_reservation: ($('execSlurmReservation')||{}).value||'',
    compute_slurm_time:        ($('execSlurmTime')       ||{}).value||'24:00:00',
    compute_slurm_mem:         ($('execSlurmMem')        ||{}).value||'64G',
  };
  try{
    await post('/api/projects/'+curProj+'/config', data);
    var res = document.getElementById('execModeSaveRes');
    if(res){ res.textContent='✓ Saved'; setTimeout(()=>res.textContent='', 2500); }
    execModeUpdateWarnings(_execMode);
  } catch(e){
    var res = document.getElementById('execModeSaveRes');
    if(res) res.textContent = 'Error: '+e.message;
  }
}

async function execModeLoad(){
  if(!curProj) return;
  try{
    var c = await api('/api/projects/'+curProj+'/config');
    var mode = c.compute_execution_mode || '';
    if(mode) execModeSelect(mode);
    else     execModeUpdateWarnings('');
    var p = document.getElementById('execSlurmPartition');
    var r = document.getElementById('execSlurmReservation');
    var t = document.getElementById('execSlurmTime');
    var m = document.getElementById('execSlurmMem');
    if(p && c.compute_slurm_partition)   p.value = c.compute_slurm_partition;
    if(r && c.compute_slurm_reservation) r.value = c.compute_slurm_reservation;
    if(t && c.compute_slurm_time)        t.value = c.compute_slurm_time;
    if(m && c.compute_slurm_mem)         m.value = c.compute_slurm_mem;
  } catch(e){ execModeUpdateWarnings(''); }
}

// ── AreTomo3 check ────────────────────────────────────────────────────────────
async function progCheckAreTomo3(){
  var cmdEl = document.getElementById('prog-cmd-aretomo3');
  var statusEl = document.getElementById('prog-status-aretomo3');
  var noteEl = document.getElementById('prog-note-aretomo3');
  if(!statusEl) return;
  statusEl.textContent = '...';
  statusEl.className = 'prog-status checking';
  // Use whatever the user typed, or fall back to bare 'AreTomo3'
  var cmd = (cmdEl && cmdEl.value.trim()) ? cmdEl.value.trim() : 'AreTomo3';
  var testCmd = cmd + ' --version 2>&1 || ' + cmd + ' --help 2>&1 | head -3';
  try{
    var d = await post('/api/scripts/check', {command: testCmd});
    var ok = d.exit_code === 0;
    statusEl.textContent = ok ? 'ok' : 'err';
    statusEl.className   = 'prog-status ' + (ok ? 'ok' : 'err');
    if(noteEl){var txt=d.output?d.output.trim().slice(0,120):'';noteEl.textContent=txt;noteEl.style.display=txt?'':'none';}
  } catch(e){
    statusEl.textContent = 'err';
    statusEl.className   = 'prog-status err';
    if(noteEl){noteEl.textContent=e.message;noteEl.style.display=e.message?'':'none';}
  }
}

// ── Unified Nav ──────────────────────────────────────────────────────────────
function uNavShow(){
  var nav = document.getElementById('unifiedNav');
  if(nav) nav.style.display = '';
}

function uNavSwitch(t){
  cTab(t);
  document.querySelectorAll('.u-pill').forEach(function(p){
    p.classList.toggle('on', p.id === 'uPill-'+t);
  });
}

// Patch cTab to keep pills in sync when navigating other ways
var _uOrigCTab = null;
function _uPatchCTab(){
  if(_uOrigCTab) return;
  _uOrigCTab = window.cTab;
  window.cTab = function(t){
    _uOrigCTab(t);
    document.querySelectorAll('.u-pill').forEach(function(p){
      p.classList.toggle('on', p.id === 'uPill-'+t);
    });
  };
}

function uNavSyncStatus(){
  ['tools','particles','warptools'].forEach(function(t){
    var src = document.getElementById('ts-'+t);
    // Status is already rendered inline in the pill buttons
    // (ts-tools etc. are now inside the pill row directly)
  });
}