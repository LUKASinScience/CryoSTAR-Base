/* CryoSTAR-Base — misc.js
   Part of CryoSTAR-Base frontend
   Lukas W. Bauer und Claude — 2026 */

function renderBoxGrid(cid,cur){
  const el=$(cid);if(!el)return;
  el.innerHTML=GOOD_BOXES.map(b=>`<span class="box-tag ${b===cur?'hl':''}" onclick="pickBoxSize(${b})">${b}</span>`).join('');
}
function pickBoxSize(b){$('pBox').value=b;renderBoxGrid('boxGrid',b);updateBoxSuggestions();}

// ── Box Size Suggestion Calculator ──
function calculateBoxSuggestions(diameter, raw_pixel_size) {
  if (!diameter || diameter <= 0) return null;
  if (!raw_pixel_size || raw_pixel_size <= 0) return null;
  
  const binnings = [1, 2, 4, 8];
  const suggestions = {};
  
  binnings.forEach(bin => {
    const binned_px = raw_pixel_size * bin;
    const diam_px = diameter / binned_px;
    
    // Calculate both 1.5× and 2× factors
    const box_1_5x = diam_px * 1.5;
    const box_2x = diam_px * 2;
    
    // Find next good sizes
    const min_box = GOOD_BOXES.find(s => s >= box_1_5x) || Math.ceil(box_1_5x);
    const rec_box = GOOD_BOXES.find(s => s >= box_2x) || Math.ceil(box_2x);
    
    suggestions[bin] = { min: min_box, recommended: rec_box };
  });
  
  return suggestions;
}

function updateBoxSuggestions() {
  const infoBox = $('boxSuggestionInfo');
  if (!infoBox) return;
  
  // Get config from window._lastConfig (set by selProj)
  const cfg = window._lastConfig || {};
  
  const diameter = parseFloat($('pDiam').value) || 0;
  if (diameter <= 0 || !cfg.raw_pixel_size) {
    infoBox.style.display = 'none';
    return;
  }
  
  const suggestions = calculateBoxSuggestions(diameter, cfg.raw_pixel_size);
  if (!suggestions) {
    infoBox.style.display = 'none';
    return;
  }
  
  infoBox.style.display = 'block';
  // Use selected binning from dropdown if available, fallback to config
  var _binSel = document.getElementById('pBoxBinning');
  const selectedBinning = _binSel ? parseInt(_binSel.value)||8 : (cfg.binning_factor || 4);
  
  let html = '<strong>💡 Box Size Suggestions (by binning):</strong><br>';
  [1, 2, 4, 8].forEach(bin => {
    const s = suggestions[bin];
    const binned_px = (cfg.raw_pixel_size * bin).toFixed(1);
    const isCurrent = bin === selectedBinning;
    html += `• At ${bin}× binning (${binned_px} Å/px): <strong>${s.min} px</strong> (min) or <strong>${s.recommended} px</strong> (recommended)${isCurrent ? ' ✓' : ''}<br>`;
  });
  
  infoBox.innerHTML = html;
}

// ── Template & Mask checklist ──
const TM_CHECKLIST = [
  {
    id:'pixelsize',
    what:'Template pixel size matches tomogram pixel size',
    how:'Check with relion_image_handler or 3dmod header. Rescale if needed.',
    sw:'RELION',
    cmd:'# Check template pixel size:\nrelion_image_handler --i template.mrc --angpix_out\n\n# Rescale to match tomogram (e.g. bin8 = 11.056 Å/px):\nrelion_image_handler --i template_in.mrc --o template_out.mrc --angpix 5.528 --rescale_angpix 11.056 --new_box 32\n\n# Also check box size is appropriate (~2–3× particle diameter / pixel size)',
    note:'Wrong pixel size → no matches or false positives. Box: ~2–3× longest particle dim / pixel size.'
  },
  {
    id:'inv',
    what:'Template contrast is correct — protein must be BLACK (dark density)',
    how:'Open in 3dmod and visually confirm protein is dark. Maps from CryoSPARC/RELION/EMDB have white protein and must be inverted.',
    sw:'3dmod + pytom_create_template.py',
    cmd:'# Open in 3dmod to verify:\n3dmod template.mrc\n# Protein must appear DARK. If white, use --invert flag:\npytom_create_template.py -i input.mrc -o template.mrc --output-voxel-size-angstrom 11.056 -b 32 --invert --center\n\n# Or invert in ChimeraX:\nvolume scale #1 factor -1',
    note:'--invert changes contrast ONLY, NOT handedness. Required for CryoSPARC/RELION/EMDB maps.'
  },
  {
    id:'center',
    what:'Template is centered in the box — center of mass near box center',
    how:'Check center of mass with relion_image_handler. Off-center templates reduce TM accuracy.',
    sw:'RELION',
    cmd:'relion_image_handler --i template.mrc --com\n# Center of mass should be near (box/2, box/2, box/2)\n# If not centered, use --center in pytom_create_template.py',
    note:'pytom_create_template.py --center  |  off-center = asymmetric search weights → bad TM'
  },
  {
    id:'box3dmod',
    what:'Template visually correct in 3dmod — dark particle, correct size, no clipping',
    how:'Open template in 3dmod, check particle is dark, fully inside box with padding, and symmetry looks right.',
    sw:'3dmod',
    cmd:'3dmod template.mrc\n# Check: protein dark, fills ~⅓–½ of box diameter\n# No clipping at box edges\n# Soft density falloff visible at edges',
    note:'Too-small box → clipped density → systematically bad TM. Too large → slow computation.'
  },
  {
    id:'mask',
    what:'Mask fully encloses template — no template density outside mask at threshold 0.5',
    how:'Open both template and mask in ChimeraX, use fitmap to superimpose, set mask threshold to 0.5.',
    sw:'ChimeraX',
    cmd:'# In ChimeraX:\nopen template.mrc\nopen mask.mrc\nfitmap #2 inMap #1\n# Set mask threshold to 0.5\n# Template must be fully inside mask — no sticking out\n\n# Regenerate mask if needed:\npytom_create_mask.py -b {box} -r {radius} -s 1 --voxel-size {angpix} -o mask.mrc',
    note:'pytom_create_mask.py -r {radius} where radius ≈ particle_radius_px + 2–3 px'
  },
  {
    id:'pdb',
    what:'PDB molmap overlaps template density (for PDB-derived templates only)',
    how:'Generate molmap from PDB in ChimeraX at target resolution, then fitmap against your template.',
    sw:'ChimeraX',
    cmd:'# In ChimeraX:\nopen 4V6X  # replace with your PDB ID\nmolmap #1 8.0  # use your target resolution in Å\nopen template.mrc\nfitmap #2 inMap #3\n# Check: densities overlap correctly\n# Note: your template may be inverted (black) vs molmap (white) — this is expected',
    note:'Only for PDB-derived templates. Skip if using data-derived map.'
  },
  {
    id:'hand',
    what:'Physical handedness verified — tomogram is not a mirror image',
    how:'Run TM with normal AND flipped template on 3–4 tomos. The template with more sharp peaks = correct hand. Or process a few particles in RELION and compare reconstruction with PDB.',
    sw:'ChimeraX + RELION',
    cmd:'# Flip template for handedness test:\nvop flip #volume  # in ChimeraX\n# OR:\npytom_create_template.py -i input.mrc -o template_flip.mrc --output-voxel-size-angstrom 11.056 -b 32 --invert --center -m  # -m = mirror\n\n# Compare reconstruction vs PDB in ChimeraX:\nopen reconstruction.mrc\nopen reference.pdb\nfitmap #1 inMap #2',
    note:'Wrong handedness → mirror-image RELION output. Check TomoGuide section 6 for full protocol.'
  },
];

// Load saved check state from project config
let tmCheckState = {};

function renderTmChecklist(){
  const el=document.getElementById('tmChecklist');
  if(!el)return;
  const total=TM_CHECKLIST.length;
  const done=TM_CHECKLIST.filter(c=>tmCheckState[c.id]).length;
  const prog=document.getElementById('checkProgress');
  if(prog) prog.textContent=done+' / '+total+' checks done';
  el.innerHTML=TM_CHECKLIST.map(function(c){
    var checked=tmCheckState[c.id]||false;
    var brd=checked?'rgba(63,185,80,.35)':'var(--bd)';
    var bg=checked?'rgba(63,185,80,.04)':'var(--bg)';
    var cBg=checked?'var(--gn)':'transparent';
    var cBrd=checked?'var(--gn)':'var(--bd)';
    var sh=checked?'0 0 0 2.5px rgba(63,185,80,.2)':'none';
    var chk=checked?'<span style="color:#fff;font-size:.6rem;font-weight:900;line-height:1">&#10003;</span>':'';
    var sw=c.sw?'<span style="font-size:.63rem;padding:.04rem .28rem;background:rgba(88,166,255,.12);border:1px solid rgba(88,166,255,.25);border-radius:3px;color:var(--ac);margin-left:.35rem;white-space:nowrap">'+c.sw+'</span>':'';
    var how=c.how?'<div style="font-size:.73rem;color:var(--dm);margin-top:.12rem;line-height:1.5">'+c.how+'</div>':'';
    var note=c.note?'<div style="font-size:.67rem;color:var(--dm);margin-top:.08rem;font-style:italic">'+c.note+'</div>':'';
    var cmd=c.cmd?'<div style="padding:.3rem .55rem .4rem 2.2rem"><pre style="background:var(--bg);border:1px solid var(--bd);border-radius:3px;padding:.3rem .45rem;font-size:.7rem;color:var(--gn);white-space:pre-wrap;margin:0;line-height:1.5">'+c.cmd+'</pre></div>':'';
    return '<div style="border:1px solid '+brd+';border-radius:6px;background:'+bg+';overflow:hidden;transition:all .15s;margin-bottom:.2rem">'+
      '<div style="display:flex;align-items:flex-start;gap:.55rem;padding:.42rem .55rem;cursor:pointer" onclick="toggleCheck(\'' +c.id+ '\')">'+
        '<div style="width:16px;height:16px;border-radius:50%;border:2px solid '+cBrd+';background:'+cBg+';flex-shrink:0;margin-top:.12rem;display:flex;align-items:center;justify-content:center;transition:all .15s;box-shadow:'+sh+'">'+chk+'</div>'+
        '<div style="flex:1">'+
          '<div style="font-size:.79rem;font-weight:600;color:'+(checked?'var(--gn)':'var(--tx)')+'">'+c.what+sw+'</div>'+
          how+
          note+
        '</div>'+
      '</div>'+
      cmd+
    '</div>';
  }).join('')
}

function toggleCheck(id){
  tmCheckState[id]=!tmCheckState[id];
  renderTmChecklist();
  // Auto-save to notebook if all done
  const done=TM_CHECKLIST.filter(c=>tmCheckState[c.id]).length;
  if(done===TM_CHECKLIST.length&&curProj){
    post('/api/notes',{project:curProj,text:'Template & Mask Checks: all '+done+' checks completed ✓'})
      .then(()=>{loadNotes();nbMarkPending()}).catch(()=>{});
  }
  // Recompute particles tab status after checklist change
  updateTabStatus('particles');
}

// ── Save WarpTools preprocessing settings ──
async function saveWarpSettings(){
  if(!curProj)return;
  const ver=document.getElementById('tWarpVer')?document.getElementById('tWarpVer').value||''  :'';
  const settings=document.getElementById('tWarpSettings')?document.getElementById('tWarpSettings').value||'':'';
  const suffix=document.getElementById('tSuffix')?document.getElementById('tSuffix').value||''  :'';
  const noflip=document.getElementById('tNoFlip')?document.getElementById('tNoFlip').value==='true':false;
  try{
    await post('/api/projects/'+curProj+'/config',{
      warptools_version:ver,
      warptools_settings:settings,
      tomo_suffix:suffix,
      use_no_flip:noflip,
    });
    const fields=[];
    if(ver)fields.push('WarpTools version: '+ver);
    if(settings)fields.push('Settings file: '+settings);
    if(suffix)fields.push('Tomo suffix: '+suffix);
    fields.push('No-flip angles: '+(noflip?'yes (--no_flip)':'no'));
    await post('/api/notes',{project:curProj,text:'[WarpTools settings saved]\n'+fields.map(f=>'  • '+f).join('\n')});
    loadNotes();
    await updateTabStatus('warptools');
    const r=document.getElementById('warpSettingsRes');
    r.innerHTML='<div class="res ok">'+icon('success')+' Saved</div>';
    nbMarkPending();
    setTimeout(()=>{if(r)r.innerHTML=''},2000);
  }catch(e){
    const r=document.getElementById('warpSettingsRes');
    if(r)r.innerHTML='<div class="res error">'+icon('warning')+' '+e.message+'</div>';
  }
}

// ── WarpTools export calculator ──
function calcExport(){
  const apx=parseFloat(document.getElementById('expCoordsApx').value);
  const factor=parseInt(document.getElementById('expUnbin').value)||1;
  const boxIn=parseInt(document.getElementById('expBoxIn').value)||0;
  const calc=document.getElementById('expCalc');
  if(!apx||apx<=0){calc.style.display='none';return;}
  const outApx=(apx/factor).toFixed(4);
  const outBox=boxIn>0?boxIn*factor:null;
  calc.style.display='block';
  document.getElementById('expOutBox').textContent=outBox?(outBox+(factor===1?' px (unchanged)':'  px')):'set box above';
  // Box size warning: min box = 1.5 × diameter / output_angpix
  var diam=parseFloat((document.getElementById('expDiam')||{}).value)||0;
  var warn2=document.getElementById('expBoxWarn');
  if(warn2&&diam>0&&outBox>0){
    var minBox=Math.ceil(1.5*diam/parseFloat(outApx));
    warn2.style.display=outBox<minBox?'block':'none';
    if(outBox<minBox) warn2.textContent='⚠ Box too small: need ≥'+minBox+' px for ⌀'+diam+' Å at '+outApx+' Å/px';
  } else if(warn2){ warn2.style.display='none'; }

  document.getElementById('expCmdApx').textContent=apx;
  document.getElementById('expCmdOutApx').textContent=outApx;
  const warn=document.getElementById('expUnbinWarn');
  warn.classList.toggle('on', factor>1);
}

// ── Preprocessing tool warning ──
function checkPreproTool(){
  const t=document.getElementById('tPreproTool');
  const w=document.getElementById('preproWarn');
  if(!t||!w)return;
  w.classList.toggle('on', t.value!=='warptools');
}

// ── Show/hide picking tutorials based on selected tool ──
function showPickTutorial(){
  const tool=document.getElementById('refPickTool');
  if(!tool)return;
  const v=tool.value;
  const imod=document.getElementById('imodTutorial');
  const copick=document.getElementById('copickTutorial');
  const artiax=document.getElementById('artiaxTutorial');
  if(imod)imod.style.display=(v==='IMOD')?'block':'none';
  if(copick)copick.style.display=(v==='Copick')?'block':'none';
  if(artiax)artiax.style.display=(v==='ArtiaX')?'block':'none';
}

// ── Toggle collapsible tutorial ──
function toggleTutorial(id){
  const toggle=document.getElementById(id+'Toggle');
  const body=document.getElementById(id+'Body');
  if(!toggle||!body)return;
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  toggle.classList.toggle('open',!isOpen);
}

// ── Reference section ──
function selectRef(type){
  curRefMethod=type;
  ['refOptPDB','refOptManual'].forEach(id=>$(id).classList.remove('on'));
  ['refPanelPDB','refPanelManual'].forEach(id=>$(id).classList.remove('on'));
  if(type==='pdb'){$('refOptPDB').classList.add('on');$('refPanelPDB').classList.add('on')}
  else if(type==='manual'){$('refOptManual').classList.add('on');$('refPanelManual').classList.add('on')}
}
function updateChimeraCmd(){
  const pdb=$('refPdbId').value||'[PDB_ID]';
  const res=$('refPdbRes').value||'[RESOLUTION]';
  $('refChimeraCmd').textContent=`open ${pdb}; molmap #1 ${res}; save template.mrc #2`;
}
$('refPdbId')&&$('refPdbId').addEventListener('input',updateChimeraCmd);
$('refPdbRes')&&$('refPdbRes').addEventListener('input',updateChimeraCmd);

function checkHandedness(){
  const v=$('refHandedness').value;
  $('handednessWarn').classList.toggle('on',!v);
  const wi=document.getElementById('handednessInvertedWarn');
  if(wi)wi.style.display=v==='inverted'?'block':'none';
  if(curProj)updateTabStatus('particles');
}
async function saveCheckNotes(){
  if(!curProj)return;
  try{
    // Persist check state to project config
    await post('/api/projects/'+curProj+'/config',{tm_check_state:tmCheckState});
    // Save notes to notebook if provided
    const notes=$('refCheckNotes').value.trim();
    if(notes){
      await post('/api/notes',{project:curProj,text:'Template & Mask Check: '+notes});
      loadNotes();
    }
    res('checkNotesRes',true,'Saved');
    nbMarkPending();
    setTimeout(()=>$('checkNotesRes').innerHTML='',2500);
  }catch(e){res('checkNotesRes', false, e.message || e.detail || JSON.stringify(e))}
}

async function saveReference(){
  if(!curProj)return;
  const isPDB=$('refOptPDB').classList.contains('on');
  const isManual=$('refOptManual').classList.contains('on');
  const upd={
    reference_method: isPDB?'pdb_molmap':isManual?'manual_picking':'',
    reference_pdb_id: $('refPdbId').value||'',
    reference_molmap_resolution: parseFloat($('refPdbRes').value)||0,
    reference_picking_tool: $('refPickTool').value||'',
    reference_picking_resolution: parseFloat($('refPickRes').value)||0,
    reference_handedness: $('refHandedness').value||'',
    reference_notes: isPDB?$('refPdbNotes').value:$('refPickNotes').value||'',
  };
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('[saveReference] START - curProj:', curProj);
  console.log('[saveReference] Method:', {isPDB, isManual});
  console.log('[saveReference] Fields:', upd);
  console.log('[saveReference] Sending POST:', upd);
  
  try{
    await post(`/api/projects/${curProj}/config`,upd);
    console.log('[saveReference] ✓ POST successful');
    
    res('refRes',true,'Saved');nbMarkPending();
    // Auto-update notebook
    const hand=upd.reference_handedness;
    const noteText=isPDB
      ? `Initial reference: PDB ${upd.reference_pdb_id} via ChimeraX molmap at ${upd.reference_molmap_resolution}Å\n${upd.reference_notes||''}`
      : `Initial reference: Manual picking with ${upd.reference_picking_tool||'?'}, RELION resolution ${upd.reference_picking_resolution}Å, handedness: ${hand||'NOT SET'}\n${upd.reference_notes||''}`;
    await post('/api/notes',{project:curProj,text:noteText.trim()});
    loadNotes();
    console.log('[saveReference] ✓ COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
  }catch(e){
    console.error('[saveReference] ✗ ERROR:', e);
    console.log('═══════════════════════════════════════════════════════');
    res('refRes', false, e.message || e.detail || JSON.stringify(e))
  }
}

// ── Computing ──
function selectCompute(type){
  ['ctWS','ctCL','ctCL2'].forEach(id=>{const e=$(id);if(e)e.classList.remove('on');});
  const map={'workstation':'ctWS','cluster':'ctCL','cloud':'ctCL2'};
  const el=$(map[type]);if(el)el.classList.add('on');
  // Store in hidden input so TAB_REQUIRED check works
  let hid=document.getElementById('compInfra');
  if(!hid){hid=document.createElement('input');hid.type='hidden';hid.id='compInfra';document.body.appendChild(hid);}
  hid.value=type||'';
}

async function saveComputing(){
  if(!curProj)return;
  const infra=document.getElementById('compInfra')?document.getElementById('compInfra').value:'';
  const host=$('compFriendlyName')?$('compFriendlyName').value:'';
  const gpu=$('compGPUs')?$('compGPUs').value:'';
  const sched=$('compScheduler')?$('compScheduler').value:'';
  const notes=$('compNotes')?$('compNotes').value:'';
  const inv=getAssignedInv('computeInvAssign');
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('[saveComputing] START - curProj:', curProj);
  console.log('[saveComputing] Fields:', {infra, host, gpu, sched, notes, inv});
  
  try{
    var _sEnvEl=document.getElementById('slabifyEnvName');
    var _sCmdEl=document.getElementById('slabifyCmdPreview');
    await post('/api/projects/'+curProj+'/config',{
      compute_type:infra,compute_host:host,
      compute_gpus:gpu,compute_scheduler:sched,compute_notes:notes,
      slabify_env:_sEnvEl?_sEnvEl.value.trim():'',
      slabify_cmd:_sCmdEl&&_sCmdEl.textContent!=='—'?_sCmdEl.textContent:'',
      compute_investigators:inv,
    });
    const fields=[];
    if(infra)fields.push('Infrastructure: '+infra);
    if(host)fields.push('Host/cluster: '+host);
    if(gpu)fields.push('GPU(s): '+gpu);
    if(sched)fields.push('Scheduler: '+sched);
    if(notes)fields.push('Notes: '+notes);
    if(inv.length)fields.push('Investigators (computing): '+inv.join(', '));
    if(fields.length){
      await post('/api/notes',{project:curProj,text:'[Computing saved]\n'+fields.map(f=>'  • '+f).join('\n')});
      loadNotes();
    }
    await updateTabStatus('computing');
    res('computeRes',true,'Saved');nbMarkPending();
    console.log('[saveComputing] ✓ COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
  }catch(e){
    console.error('[saveComputing] ✗ ERROR:', e);
    console.log('═══════════════════════════════════════════════════════');
    res('computeRes', false, e.message || e.detail || JSON.stringify(e))
  }
}

// ── Connect tab ──
function renderConnections(list){
  const el=$('connList');
  if(!list||!list.length){
    el.innerHTML='<div class="conn-empty">No connections yet — link a project below to create a provenance trail</div>';return;
  }
  el.innerHTML=list.map(p=>`
    <div class="conn-proj-card">
      <button class="conn-remove" onclick="removeConnection('${p.folder}')">✕</button>
      <div class="conn-folder">${p.folder}</div>
      <div class="conn-meta">
        ${p.reason?`<strong>${p.reason}</strong><br>`:''}
        ${p.particle_count?`${p.particle_count} particles · `:''}
        ${p.date?`${p.date} · `:''}
        ${p.description||''}
      </div>
    </div>`).join('');
}
async function addConnection(){
  const folder=$('connFolder').value.trim();
  if(!folder||!curProj)return res('connRes',false,'Source project folder required');
  try{
    const d=await post(`/api/projects/${curProj}/connect`,{
      folder,particle_count:$('connCount').value,date:$('connDate').value,
      reason:$('connReason').value,description:$('connDesc').value,
    });
    renderConnections(d.connected_projects);
    ['connFolder','connCount','connDesc'].forEach(id=>$(id).value='');
    $('connDate').value='';$('connReason').value='';
    res('connRes',true,`Connected: ${folder}`);
    nbMarkPending();
    await post('/api/notes',{project:curProj,text:`Connected project: ${folder} — ${$('connReason').value||''}. ${$('connDesc').value||''}`.trim()});
    loadNotes();
  }catch(e){res('connRes', false, e.message || e.detail || JSON.stringify(e))}
}
async function removeConnection(folder){
  if(!curProj)return;
  try{
    const d=await del(`/api/projects/${curProj}/connect/${folder}`);
    renderConnections(d.connected_projects);
  }catch(e){}
}

// ── Wizard ──
function showCreate(){
  $('vWelcome').style.display='none';
  $('vProj').style.display='none';
  $('vCreate').style.display='';
  $('cStep1').style.display='';
  $('cStep2').style.display='none';
  var s3=$('cStep3');if(s3)s3.style.display='none';
  // Clear name/tomo fields — fresh for each project
  var e;
  if((e=$('cName')))e.value='';
  if((e=$('cTomo')))e.value='';
  if((e=document.getElementById('cRes1')))e.innerHTML='';
  // Pre-fill processing dir from workspace path (only if empty)
  var pd=document.getElementById('cProcDir');
  var wsEl=document.getElementById('wsP');
  if(pd){pd.value=wsEl?wsEl.textContent.trim():'';cUpdatePreview();}
  // Pre-fill WarpTools dir from current project config if open
  var warp=document.getElementById('cWarp');
  if(warp)warp.value='';
  if(warp&&curProj){
    api('/api/projects/'+curProj+'/config').then(function(c){
      if(c&&c.warptools_dir)warp.value=c.warptools_dir;
    }).catch(function(){});
  }
  // Reset investigators
  wizardInvestigators=[];
  if(typeof renderWizardInvestigators==='function')renderWizardInvestigators();
  else if(typeof renderInvTags==='function')renderInvTags();
  // Reset step indicator
  var w1=$('wi1'),w2=$('wi2'),w3=$('wi3'),l1=$('wl1'),l2=$('wl2'),l3=$('wl3');
  if(w1){w1.className='ws active';w1.textContent='1';}
  if(w2){w2.className='ws';w2.textContent='2';}
  if(w3){w3.className='ws';w3.textContent='3';}
  if(l1){l1.classList.add('active');}
  if(l2){l2.classList.remove('active');l2.style.display='none';}
  if(l3){l3.classList.remove('active');l3.style.display='none';}
}

function hideCreate(){$('vCreate').style.display='none';curProj?$('vProj').style.display='':$('vWelcome').style.display=''}
function addInvTag(){const v=$('invInput').value.trim();if(!v)return;if(!wizardInvestigators.includes(v))wizardInvestigators.push(v);$('invInput').value='';renderInvTags()}
function removeInvTag(n){wizardInvestigators=wizardInvestigators.filter(x=>x!==n);renderInvTags()}
function renderInvTags(){$('invTags').innerHTML=wizardInvestigators.map(n=>`<span class="inv-tag">${n}<button onclick="removeInvTag('${n}')">✕</button></span>`).join('')}
async function doStep1(){
  const n=$('cName').value.trim();if(!n)return res('cRes1',false,'Target name is required');
  const pd=$('cProcDir').value.trim();if(!pd)return res('cRes1',false,'Processing directory is required');
  // Store tomo_name for Step 3 preprocessing folder name
  window._wizardTomoName = ($('cTomo')||{value:''}).value.trim();
  try{
    var modeEl=document.querySelector('input[name="cWarpMode"]:checked');
    var mode=modeEl?modeEl.value:'existing';
    const warpVal  = mode==='existing' ? ($('cWarp')||{value:''}).value.trim() : '';
    const preprocName = mode==='create' ? ($('cPreprocessingName')||{value:''}).value.trim() : '';
    const preprocPath = mode==='create' ? ($('cPreprocessingPath')||{value:''}).value.trim() : '';
    const d=await post('/api/projects/create',{
      target_name:n,
      warptools_dir:warpVal,
      tomo_name:($('cTomo')||{value:''}).value||'',
      investigators:wizardInvestigators,
      processing_dir:pd,
      preprocessing_name:preprocName,
      preprocessing_path:preprocPath,
    });
    createFolder=d.folder;
    // Write project folder path to notebook immediately on creation
    try{
      const fullPath=d.dir||d.folder;
      await post('/api/notes',{project:d.folder,
        text:'Project created\n  • Project folder: '+d.folder+'\n  • Full path: '+fullPath+'\n  • WarpTools dir: '+($('cWarp').value||'(not set)')+'\n  • Investigators: '+(wizardInvestigators.join(', ')||'(none yet)')});
    }catch(e){}
    $('cStep1').style.display='none';$('cStep2').style.display='';$('s2name').textContent=d.folder;
    $('wi1').className='ws done';$('wi1').textContent='✓';$('wi2').className='ws active';
    $('wl1').className='ws-label';$('wl2').style.display='inline';$('wl2').className='ws-label active';
    loadProj();
  }catch(e){res('cRes1', false, e.message || e.detail || JSON.stringify(e))}
}
// ── Create wizard helpers ──
function cUpdatePreview(){
  var dir=$('cProcDir').value.trim();
  var name=($('cName').value.trim()||'').replace(/ /g,'_');
  var prev=document.getElementById('cProcDirPreview');
  if(!prev)return;
  if(dir&&name){
    prev.textContent='→ '+dir.replace(/\/$/,'')+'/'+name+'_base/';
    prev.style.color='var(--gn)';
  }else if(dir){
    prev.textContent='→ '+dir.replace(/\/$/,'')+'/'+'_base/';
    prev.style.color='var(--dm)';
  }else{
    prev.textContent='';
  }
}

// ══════════════════════════════════════════════════════════════
//  WIZARD — 3-step: Identity → Data Collection → Preprocessing
// ══════════════════════════════════════════════════════════════

// ── Wizard step navigation ──
function _wizStep(from, to, toLabel){
  document.getElementById('cStep'+from).style.display = 'none';
  document.getElementById('cStep'+to).style.display = '';
  // Update step badges
  var badges = [1,2,3];
  badges.forEach(function(n){
    var el = document.getElementById('wi'+n);
    if(!el) return;
    if(n < to){ el.className='ws done'; el.textContent='✓'; }
    else if(n === to){ el.className='ws active'; el.textContent=String(n); }
    else{ el.className='ws'; el.textContent=String(n); }
  });
  // Labels
  ['wl1','wl2','wl3'].forEach(function(id, i){
    var el = document.getElementById(id);
    if(!el) return;
    el.style.display = (i+1 <= to) ? '' : 'none';
    el.classList.toggle('active', i+1 === to);
  });
}

// ── Auto-generate preprocessing folder name from dataset + date ──
function cUpdatePreprocName(){
  // Used in wizard step 3
  var dataset = (document.getElementById('cPreprocDataset')||{value:''}).value.trim().replace(/ /g,'_');
  var date    = (document.getElementById('cPreprocDate')||{value:''}).value.trim();
  // Also sync date from step 2 collection date
  var collDate = (document.getElementById('cCollDate')||{value:''}).value.trim();
  var dateEl = document.getElementById('cPreprocDate');
  if(dateEl && collDate && !dateEl.value) dateEl.value = collDate;
  var usedDate = date || collDate;
  var nameEl = document.getElementById('cPreprocessingName');
  if(!nameEl) return;
  if(dataset || usedDate){
    var parts = [];
    if(dataset) parts.push(dataset);
    if(usedDate) parts.push(usedDate);
    parts.push('preprocessing');
    nameEl.value = parts.join('_');
  }
  cWarpCreatePreview();
}

function cWarpCreatePreview(){
  var name = (document.getElementById('cPreprocessingName')||{value:''}).value.trim();
  var path = (document.getElementById('cPreprocessingPath')||{value:''}).value.trim();
  var el   = document.getElementById('cWarpCreatePreview');
  if(!el) return;
  if(name){
    var base = path ? path.replace(/\/$/, '') + '/' : '{project_parent}/';
    el.style.color = 'var(--gn)';
    el.textContent = '→ ' + base + name + '/warptools/  +  ' + base + name + '/aretomo3/';
  } else {
    el.style.color = 'var(--dm)';
    el.textContent = '→ Will create: {name}_YYYY-MM-DD_preprocessing/warptools/ + aretomo3/';
  }
}

async function cDoCreatePreproc(){
  var name = (document.getElementById('cPreprocessingName')||{value:''}).value.trim();
  var path = (document.getElementById('cPreprocessingPath')||{value:''}).value.trim();
  var res  = document.getElementById('cPreprocCreateRes');
  if(!name){ if(res) res.innerHTML = '<span style="color:var(--rd)">Enter a folder name</span>'; return; }
  if(!createFolder){ if(res) res.innerHTML = '<span style="color:var(--rd)">Create project first (step 1)</span>'; return; }
  try{
    var d = await post('/api/projects/'+createFolder+'/create_preprocessing',{
      preprocessing_name: name,
      preprocessing_path: path,
    });
    if(res) res.innerHTML = '<span style="color:var(--gn)">✓ Created: ' + (d.warptools_dir||name) + '</span>';
    // Fill warptools dir field
    var warpEl = document.getElementById('cWarp');
    if(warpEl && d.warptools_dir){ warpEl.value = d.warptools_dir; }
  }catch(e){
    if(res) res.innerHTML = '<span style="color:var(--rd)">✖ ' + e.message + '</span>';
  }
}

// ── doStep2: save data collection + advance to step 3 ──
async function doStep2(){
  var x   = parseInt((document.getElementById('cX')||{value:''}).value)||0;
  var y   = parseInt((document.getElementById('cY')||{value:''}).value)||0;
  var z   = parseInt((document.getElementById('cZ')||{value:''}).value)||0;
  var raw = parseFloat((document.getElementById('cRawPx')||{value:''}).value)||0;
  var bin = parseFloat((document.getElementById('cBin')||{value:''}).value)||0;
  var volt = parseInt((document.getElementById('cVoltage')||{value:''}).value)||0;
  var date = (document.getElementById('cCollDate')||{value:''}).value||'';
  // Only X, Y and raw pixel size required — binning is optional (user sets later)
  if(!x||!y||!raw) return res('cRes2', false, 'Image X, Y and raw pixel size are required');
  try{
    var px = (raw&&bin) ? parseFloat((raw*bin).toFixed(4)) : 0;
    // Save all fields to wizard project
    await post('/api/projects/'+createFolder+'/config',{
      x_dim:x, y_dim:y, z_dim:z||0,
      raw_pixel_size:raw,
      binning_factor:bin||1,
      bin_pixel_size:px,
      tomo_dims:[x,y],  // Z not from MDOC
      voltage:volt,
      collection_date:date,
    });
    // Also mirror into tomo tab fields in background (for current project if open)
    if(curProj && curProj!==createFolder){
      // MDOC → existing project: never send tomo_dims (Z is user-set only)
      post('/api/projects/'+curProj+'/config',{
        raw_pixel_size:raw, binning_factor:bin||1, bin_pixel_size:px,
        voltage:volt, collection_date:date,
      }).catch(function(){});
    }
    _advanceToStep3(date);
  }catch(e){ res('cRes2', false, e.message || e.detail || String(e)); }
}

function skipStep2(){
  _advanceToStep3('');
}

function _advanceToStep3(date){
  // Use tomo_name from config (set in step 2), fallback to project name
  // The tomo_name is the actual sample/dataset name (e.g. "biofilm")
  var tomoName = (window._wizardTomoName || '').trim().replace(/ /g,'_');
  var dataset = tomoName || (createFolder||'').replace('_base','');
  var dsEl = document.getElementById('cPreprocDataset');
  if(dsEl){ dsEl.value = dataset; }
  // Sync date → readonly date field in step 3
  var preprocDate = document.getElementById('cPreprocDate');
  if(preprocDate && date){ preprocDate.value = date; }
  // Update s3name display
  var s3name = document.getElementById('s3name');
  if(s3name) s3name.textContent = dataset;
  // Auto-generate folder name now that both fields are set
  cUpdatePreprocName();
  // Switch "Create new" pill active by default in step 3
  cWarpModeChange('create');
  _wizStep(2, 3, 'Preprocessing');
}

// ── doStep3: finalize — save warptools_dir if set, open project ──
async function doStep3(){
  var warpVal = (document.getElementById('cWarp')||{value:''}).value.trim();
  try{
    if(warpVal && createFolder){
      await post('/api/projects/'+createFolder+'/config', {warptools_dir: warpVal});
    }
    hideCreate();
    if(createFolder) setTimeout(function(){ selProj(createFolder); }, 300);
  }catch(e){ res('cRes3', false, e.message || e.detail || JSON.stringify(e)); }
}

function skipStep3(){
  hideCreate();
  if(createFolder) setTimeout(function(){ selProj(createFolder); }, 300);
}

// ── Preprocessing tab mode/location change ──
// ── Preproc tab mode toggle: Use existing / Create new (exclusive) ──
function preprocModeChange(mode){
  var bE = document.getElementById('preprocBtnExist');
  var bC = document.getElementById('preprocBtnCreate');
  var pE = document.getElementById('preprocPanelExist');
  var pC = document.getElementById('preprocPanelCreate');
  if(bE){ bE.className = 'exc-btn' + (mode==='existing'?' on':''); }
  if(bC){ bC.className = 'exc-btn' + (mode==='create'?' on':''); }
  if(pE){ pE.style.display = mode==='existing' ? '' : 'none'; }
  if(pC){ pC.style.display = mode==='create'   ? '' : 'none'; }
}

// ── Preproc tab location toggle (binary) ──
function preprocLocChange(mode){
  var tN  = document.getElementById('preprocTrkNext');
  var kN  = document.getElementById('preprocKnbNext');
  var tC  = document.getElementById('preprocTrkCustom');
  var kC  = document.getElementById('preprocKnbCustom');
  var row = document.getElementById('preprocCustomPathRow');
  if(tN){ tN.className = 'tog-track' + (mode==='next'  ?' on':''); }
  if(kN){ kN.className = 'tog-knob'  + (mode==='next'  ?' on':''); }
  if(tC){ tC.className = 'tog-track' + (mode==='custom'?' on':''); }
  if(kC){ kC.className = 'tog-knob'  + (mode==='custom'?' on':''); }
  if(row){ row.style.display = mode==='custom' ? 'flex' : 'none'; }
  preprocNewPreview();
}

function preprocAutoFolderName(){
  var dataset = (document.getElementById('preprocNewDataset')||{value:''}).value.trim().replace(/ /g,'_');
  var date    = (document.getElementById('preprocNewDate')||{value:''}).value.trim();
  var nameEl  = document.getElementById('preprocNewName');
  if(!nameEl) return;
  var parts = [];
  if(dataset) parts.push(dataset);
  if(date)    parts.push(date);
  parts.push('preprocessing');
  // Only auto-generate if more than just "preprocessing"
  if(parts.length > 1) nameEl.value = parts.join('_');
  preprocNewPreview();
}

// Called when preproc tab opens — pre-fill sample name from project config
async function preprocFillSampleName(){
  if(!curProj) return;
  var dsEl = document.getElementById('preprocNewDataset');
  if(!dsEl || dsEl.value) return; // don't overwrite user input
  try{
    var c = await api('/api/projects/'+curProj+'/config');
    // Use project_name (which is the sample/target name without _base suffix)
    if(c.project_name) dsEl.value = c.project_name;
    // Sync collection date if set
    var dateEl = document.getElementById('preprocNewDate');
    if(dateEl && c.collection_date) dateEl.value = c.collection_date;
    preprocAutoFolderName();
  }catch(e){}
}

function preprocNewPreview(){
  var name = (document.getElementById('preprocNewName')||{value:''}).value.trim();
  var path = (document.getElementById('preprocNewPath')||{value:''}).value.trim();
  var el   = document.getElementById('preprocNewPreviewBox');
  if(!el) return;
  if(name){
    var base = path ? path.replace(/\/$/, '') + '/' : '{next to project}/';
    el.style.color = 'var(--gn)';
    el.textContent = '→ ' + base + name + '/warptools/  +  ' + base + name + '/aretomo3/';
  } else {
    el.style.color = 'var(--dm)';
    el.textContent = '→ Will create: {name}_YYYY-MM-DD_preprocessing/warptools/ + aretomo3/';
  }
}

// Pre-fill processing dir from workspace path on open


function calcTotalDose(){
  var per=parseFloat(($('tDosePerTilt')||{}).value)||0;
  var n=parseInt(($('tNTilts')||{}).value)||0;
  if(per>0&&n>0){var el=$('tTotalDose');if(el&&!el.value)el.value=(per*n).toFixed(1);}
}
function calcMGrid(){
  var n=parseInt(($('tFramesPerTilt')||{}).value)||0;
  var el=$('tMGridCalc');if(el)el.value=n>0?'1x1x'+n:'';
  // Also sync to preproc tab m_grid
  var mp=$('wp3_n_frames');if(mp&&!mp.value&&n>0){mp.value=n;warpBuildMGrid&&warpBuildMGrid();}
}
function checkCollSoftware(){}


function calcPx(pfx){
  const raw=parseFloat(pfx==='c'?$('cRawPx').value:$('tRaw').value);
  const bin=parseFloat(pfx==='c'?$('cBin').value:$('tBin').value);
  const out=pfx==='c'?$('cActual'):$('tActual');
  out.value=(!isNaN(raw)&&!isNaN(bin)&&raw>0&&bin>0)?(raw*bin).toFixed(4)+' Å/px':'';
}
// doStep2 and skipStep2 defined above in wizard section

// ── Tomo save ──
async function saveTomo(){
  if(!curProj)return;
  const x=parseInt($('tX').value),y=parseInt($('tY').value),z=parseInt($('tZ').value);
  const raw=parseFloat($('tRaw').value),bin=parseFloat($('tBin').value);
  const voltage=parseInt($('tVoltage').value)||0;
  const cs=parseFloat($('tCs').value)||0;
  const ampCon=parseFloat($('tAmpCon').value)||0;
  const date=$('tDate').value||'';
  const tool=document.getElementById('tPreproTool')?document.getElementById('tPreproTool').value:'warptools';
  const prepro_ver=document.getElementById('tPreproVer')?document.getElementById('tPreproVer').value||'':'';
  
  // === COMPREHENSIVE LOGGING - All input field values ===
  console.log('═══════════════════════════════════════════════════════');
  console.log('[saveTomo] START - curProj:', curProj);
  console.log('[saveTomo] Dimensions:', {x, y, z});
  console.log('[saveTomo] Pixel sizes:', {raw, bin, calculated_bin: raw && bin ? raw*bin : 0});
  console.log('[saveTomo] Optics:', {voltage, cs, ampCon});
  console.log('[saveTomo] Metadata:', {date, tool, prepro_ver});
  
  // Check if core fields are complete (for status calculation)
  const coreComplete = x && y && raw && bin;
  const px = (raw && bin) ? parseFloat((raw*bin).toFixed(4)) : 0;
  
  // VALIDATION
  const defocusMin = parseFloat(($('tDefocusMin')||{}).value);
  const defocusMax = parseFloat(($('tDefocusMax')||{}).value);
  const tiltMin = parseFloat(($('tTiltMin')||{}).value);
  const tiltMax = parseFloat(($('tTiltMax')||{}).value);
  
  // Validate defocus range
  if (defocusMin && defocusMax && defocusMin > defocusMax) {
    res('tomoRes', false, 'Error: Defocus min must be ≤ max');
    return;
  }
  
  // Validate tilt range
  if (tiltMin && tiltMax && tiltMin >= tiltMax) {
    res('tomoRes', false, 'Error: Tilt min must be < max');
    return;
  }
  
  try{
    // Save setup data ONLY if we have minimum required fields (X, Y, raw, bin)
    // Backend expects these and will reject incomplete data
    if(x && y && raw && bin){
      console.log('[saveTomo] Saving setup data:', {x, y, z, raw, bin});
      await post('/api/projects/'+curProj+'/setup',{
        x_dim:x,
        y_dim:y,
        z_dim:z||0,  // Backend expects int, not null or NaN
        raw_pixel_size:raw,
        binning_factor:bin
      });
      console.log('[saveTomo] Setup data saved successfully');
    } else {
      console.log('[saveTomo] Skipping setup (incomplete):', {x, y, z, raw, bin});
    }
    
    // Single POST — all fields always saved regardless of completeness
    const nTilts=_nTilts()||0;
    const totalDose=parseFloat(($('tTotalDose')||{}).value)||0;
    const framesPerTilt=parseInt(($('tFramesPerTilt')||{}).value)||0;
    // dose_per_tilt: from input field if manually set, else compute from total/n
    const dosePerTilt = (totalDose&&nTilts) ? parseFloat((totalDose/nTilts).toFixed(4))
                      : parseFloat((document.getElementById('tDosePerTilt')||{value:'0'}).value)||0;
    const mGrid = framesPerTilt>0 ? '1x1x'+framesPerTilt
                : ((window._lastConfig&&window._lastConfig.warp_m_grid)||'1x1x8');
    const warpDir=((document.getElementById('tWarpDir')||{}).value||'').trim();
    
    // === LOG ALL MICROSCOPE/HARDWARE FIELDS ===
    const microscope = ($('tMicroscope')||{}).value||'';
    const camera = ($('tCamera')||{}).value||'';
    const magnification = parseInt(($('tMagnification')||{}).value)||0;
    const slitWidth = parseFloat(($('tSlitWidth')||{}).value)||0;
    const c2aperture = parseFloat(($('tC2aperture')||{}).value)||0;
    console.log('[saveTomo] Hardware:', {microscope, camera, magnification, slitWidth, c2aperture});
    
    // === LOG ALL TILT PARAMETERS ===
    const tiltScheme = ($('tTiltScheme')||{}).value||'';
    const tiltMin = parseFloat(($('tTiltMin')||{}).value)||0;
    const tiltMax = parseFloat(($('tTiltMax')||{}).value)||0;
    const tiltStep = parseFloat(($('tTiltStep')||{}).value)||0;
    const startAngle = parseFloat(($('tStartAngle')||{}).value)||0;
    const preTilt = parseFloat(($('tPreTilt')||{}).value)||0;
    console.log('[saveTomo] Tilt params:', {tiltScheme, tiltMin, tiltMax, tiltStep, startAngle, preTilt, nTilts});
    
    // === LOG ALL DOSE/EXPOSURE FIELDS ===
    const flux = parseFloat(($('tFlux')||{}).value)||0;
    const cdsMode = ($('tCDSMode')||{}).value||'';
    console.log('[saveTomo] Dose/Exposure:', {totalDose, dosePerTilt, framesPerTilt, mGrid, flux, cdsMode});
    
    // === LOG ALL SAMPLE/DEFOCUS FIELDS ===
    const defocusMin = parseFloat(($('tDefocusMin')||{}).value)||0;
    const defocusMax = parseFloat(($('tDefocusMax')||{}).value)||0;
    const collSoftware = ($('tCollSoftware')||{}).value||'';
    const collSoftVer = ($('tCollSoftVer')||{}).value||'';
    const sampleType = ($('tSampleType')||{}).value||'';
    const lamellaThick = parseFloat(($('tLamellaThick')||{}).value)||0;
    console.log('[saveTomo] Collection/Sample:', {defocusMin, defocusMax, collSoftware, collSoftVer, sampleType, lamellaThick});
    console.log('[saveTomo] WarpTools:', {warpDir, mGrid, warp_tilt_exposure: dosePerTilt});
    
    // === BUILD CONFIG OBJECT ===
    const configData = {
      collection_date:date,
      preprocessing_tool:tool,
      warptools_version:prepro_ver,
      voltage:voltage,
      spherical_aberration:cs||2.7,
      amplitude_contrast:ampCon||0.07,
      // Pixel sizes — both stored separately
      raw_pixel_size:raw||0,           // for WarpTools create_settings --angpix
      binning_factor:bin||1,
      bin_pixel_size:px,               // raw*bin — for WarpTools ts_reconstruct/ts_etomo --angpix
      // Dimensions — all independent, no gate
      // Only send tomo_dims when z is valid (user-set) — never overwrite z with 0
      ...(z > 0 ? {tomo_dims:[x||0, y||0, z]} : (x>0&&y>0 ? {tomo_dims:[x||0, y||0]} : {})),
      collection_investigators:getAssignedInv('tomoInvAssign'),
      warptools_dir:warpDir,
      microscope:microscope,
      camera:camera,
      magnification:magnification,
      energy_filter_slit:slitWidth,
      c2_aperture:c2aperture,
      defocus_min:defocusMin,
      defocus_max:defocusMax,
      collection_software:collSoftware,
      collection_software_version:collSoftVer,
      tilt_scheme:tiltScheme,
      tilt_min:tiltMin,
      tilt_max:tiltMax,
      tilt_step:tiltStep,
      start_angle:startAngle,
      pre_tilt:preTilt,
      n_tilts:nTilts,
      total_dose:totalDose,
      dose_per_tilt:dosePerTilt,
      warp_tilt_exposure:dosePerTilt,  // alias — for WarpTools ts_import --tilt_exposure
      flux:flux,
      frames_per_tilt:framesPerTilt,
      warp_m_grid:mGrid,               // 1x1xN — for fs_motion_and_ctf --m_grid
      cds_mode:cdsMode,
      sample_type:sampleType,
      lamella_thickness:lamellaThick,
      ...(window._mdocTiltAxis?{warp_initial_axis:window._mdocTiltAxis}:{}),
    };
    
    console.log('[saveTomo] === SENDING CONFIG POST ===');
    console.log('[saveTomo] URL:', '/api/projects/'+curProj+'/config');
    console.log('[saveTomo] Data payload:', configData);
    
    await post('/api/projects/'+curProj+'/config', configData);
    console.log('[saveTomo] ✓ Config POST successful');
    
    if(px>0){var a=$('tActual');if(a) a.value=px+' Å/px';}
    await updateTabStatus('tomo');
    nbMarkPending();
    if(x&&y&&raw&&bin){
      res('tomoRes',true,'Saved — '+px+' Å/px (binned) | '+mGrid+' | '+dosePerTilt.toFixed(3)+' e/Å²/tilt');
    } else {
      var miss=[];
      if(!x) miss.push('img X'); if(!y) miss.push('img Y');
      if(!raw) miss.push('raw px'); if(!bin) miss.push('binning');
      res('tomoRes',true,'Saved'+(miss.length?' — still needed: '+miss.join(', '):''));
    }
    console.log('[saveTomo] ✓ COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
  }catch(e){
    console.error('[saveTomo] ✗ ERROR:', e);
    console.error('[saveTomo] Error detail:', e.message, e.detail, e.stack);
    console.log('═══════════════════════════════════════════════════════');
    res('tomoRes',false,'Save failed: '+(e.message||e.detail||String(e)));
  }
}

// ── Sample save ──
async function saveSample(){
  if(!curProj)return;
  const date=$('sDate').value||'';
  const desc=$('sDesc').value||'';
  const proto=$('sProto').value||'';
  const inv=getAssignedInv('sampleInvAssign');
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('[saveSample] START - curProj:', curProj);
  console.log('[saveSample] Fields:', {date, desc, proto, investigators: inv});
  
  try{
    const configData = {
      sample_prep_date:date,
      sample_description:desc,
      sample_protocols:proto,
      sample_investigators:inv,
    };
    console.log('[saveSample] Sending POST:', configData);
    
    await post('/api/projects/'+curProj+'/config', configData);
    console.log('[saveSample] ✓ POST successful');
    const fields=[];
    if(date)fields.push('Prep date: '+date);
    if(desc)fields.push('Description: '+desc);
    if(proto)fields.push('Protocols: '+proto);
    if(inv.length)fields.push('Investigators (sample): '+inv.join(', '));
    if(fields.length){
      await post('/api/notes',{project:curProj,text:'[Sample saved]\n'+fields.map(f=>'  • '+f).join('\n')});
      loadNotes();
    }
    await updateTabStatus('sample');
    res('sampleRes',true,'Saved');nbMarkPending();
    console.log('[saveSample] ✓ COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
  }catch(e){
    console.error('[saveSample] ✗ ERROR:', e);
    console.log('═══════════════════════════════════════════════════════');
    res('sampleRes', false, e.message || e.detail || JSON.stringify(e))
  }
}

// ── Particles save ──
async function saveParticles(){
  if(!curProj)return;
  const d=parseFloat($('pDiam').value)||0;
  const b=parseInt($('pBox').value)||0;
  const s=parseInt($('pSym').value)||0;
  const m=parseFloat($('pMask').value)||0;
  const inv=getAssignedInv('particleInvAssign');
  
  // Get config from window._lastConfig
  const cfg = window._lastConfig || {};
  
  // VALIDATION — uses selected binning from dropdown
  var _binSelEl = document.getElementById('pBoxBinning');
  const selectedBinning = _binSelEl ? (parseInt(_binSelEl.value)||8) : (cfg.binning_factor||1);
  if (d > 0 && b > 0 && cfg.raw_pixel_size) {
    const binned_px = cfg.raw_pixel_size * selectedBinning;
    const diam_px = d / binned_px;
    if (b <= diam_px * 1.2) {
      res('particlesRes', false, `Error: Box size (${b}px) must be > particle diameter (${diam_px.toFixed(1)}px at ${binned_px.toFixed(1)}Å/px at ${selectedBinning}× binning). Suggested: ${Math.ceil(diam_px * 1.5)}px or more.`);
      return;
    }
  }
  
  if (m > 0 && b > 0 && m > b/2) {
    res('particlesRes', false, 'Error: Mask radius must be ≤ box size/2');
    return;
  }
  
  if (s < 1 && s !== 0) {
    res('particlesRes', false, 'Error: Symmetry must be ≥ 1 or 0 for asymmetric');
    return;
  }
  
  // Calculate box size suggestions for all binnings
  const box_sizes_by_binning = {};
  if (d > 0 && cfg.raw_pixel_size) {
    const suggestions = calculateBoxSuggestions(d, cfg.raw_pixel_size);
    if (suggestions) {
      // Store recommended (2×) values for each binning
      Object.keys(suggestions).forEach(bin => {
        box_sizes_by_binning[bin] = suggestions[bin].recommended;
      });
    }
  }
  
  const upd={particle_investigators:inv};
  if(d>0)upd.particle_diameter=d;
  if(b>0)upd.box_size=b;  // Keep legacy single value
  // Also store under selected binning in box_sizes_by_binning
  if(b>0) box_sizes_by_binning[String(selectedBinning)] = b;
  if(Object.keys(box_sizes_by_binning).length > 0) upd.box_sizes_by_binning = box_sizes_by_binning;
  if(s>0)upd.symmetry=s;
  if(m>0)upd.mask_radius=m;
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('[saveParticles] START - curProj:', curProj);
  console.log('[saveParticles] Fields:', {d, b, s, m, box_sizes_by_binning, inv});
  console.log('[saveParticles] Sending POST:', upd);
  
  try{
    await post('/api/projects/'+curProj+'/config',upd);
    console.log('[saveParticles] ✓ POST successful');
    const fields=[];
    if(d>0)fields.push('Particle diameter: '+d+' Å');
    if(b>0)fields.push('Box size: '+b+' px');
    if(Object.keys(box_sizes_by_binning).length > 0){
      const binSizes = Object.entries(box_sizes_by_binning).map(([bin,sz])=>`${bin}×:${sz}px`).join(', ');
      fields.push('Box sizes by binning: '+binSizes);
    }
    if(s>0)fields.push('Symmetry: C'+s);
    if(m>0)fields.push('Mask radius: '+m+' px');
    if(inv.length)fields.push('Investigators (particles): '+inv.join(', '));
    if(fields.length){
      await post('/api/notes',{project:curProj,text:'[Particles saved]\n'+fields.map(f=>'  • '+f).join('\n')});
      loadNotes();
    }
    await updateTabStatus('particles');
    res('particlesRes',true,'Saved');nbMarkPending();
    console.log('[saveParticles] ✓ COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
  }catch(e){
    console.error('[saveParticles] ✗ ERROR:', e);
    console.log('═══════════════════════════════════════════════════════');
    res('particlesRes', false, e.message || e.detail || JSON.stringify(e))
  }
}
// ══════════════════════════════════════════════════════════════
//  PREPROCESSING TAB — Setup panel + pill toggles
// ══════════════════════════════════════════════════════════════

var _preprocOpenSections = {at3: true, wt: true};

function preprocToggle(key){
  _preprocOpenSections[key] = !_preprocOpenSections[key];
  _preprocApply(key);
}

function _preprocApply(key){
  var secMap  = {at3: 'preprocSecAT3', wt: 'preprocSecWT'};
  var pillMap = {at3: 'preprocPillAT3', wt: 'preprocPillWT'};
  var open = _preprocOpenSections[key];
  var sec  = document.getElementById(secMap[key]);
  var pill = document.getElementById(pillMap[key]);
  if(sec) sec.style.display = open ? '' : 'none';
  if(pill){
    pill.style.opacity = open ? '1' : '0.55';
    // Use data-label attribute instead of fragile textNode manipulation
    var label = pill.dataset.label || (key==='at3' ? 'AreTomo3' : 'WarpTools');
    var arrowEl = pill.querySelector('.preproc-pill-arrow');
    if(arrowEl) arrowEl.textContent = open ? '▼' : '▸';
  }
}

function preprocInitPills(){
  // Set initial state of both pills
  ['at3','wt'].forEach(function(key){
    var pillMap = {at3: 'preprocPillAT3', wt: 'preprocPillWT'};
    var pill = document.getElementById(pillMap[key]);
    if(pill && !pill.dataset.label){
      // First init: inject arrow span if not present
      pill.dataset.label = key==='at3' ? 'AreTomo3' : 'WarpTools';
    }
    _preprocApply(key);
  });
}

// Sync the preproc dir input from project config when entering the tab
async function preprocLoadWarpDir(){
  if(!curProj) return;
  try{
    var c = await api('/api/projects/'+curProj+'/config');
    var el = document.getElementById('preprocWarpDir');
    if(el && c.warptools_dir) el.value = c.warptools_dir;
    preprocUpdateStatus(c.warptools_dir);
    // Sync collection date from project config to create-new section
    var dateEl = document.getElementById('preprocNewDate');
    if(dateEl && c.collection_date) dateEl.value = c.collection_date;
    // Show warning if no warptools_dir set
    var warn = document.getElementById('preprocNoPathWarn');
    if(warn) warn.style.display = (c.warptools_dir && c.warptools_dir.trim()) ? 'none' : '';
    // Auto-fill dataset name from project name
    var dsEl = document.getElementById('preprocNewDataset');
    if(dsEl && !dsEl.value && c.project_name) dsEl.value = c.project_name;
    preprocAutoFolderName();
  }catch(e){}
}

function preprocSyncWarpDir(){
  var el = document.getElementById('preprocWarpDir');
  if(el) preprocUpdateStatus(el.value);
}

function preprocUpdateStatus(warpDir){
  var el = document.getElementById('preprocDirStatus');
  if(!el) return;
  if(warpDir && warpDir.trim()){
    el.innerHTML = '<span style="color:var(--gn)">✓</span> ' + warpDir.trim();
  } else {
    el.innerHTML = '<span style="color:var(--yl)">⚠</span> No WarpTools directory set';
  }
}

async function preprocSaveWarpDir(){
  if(!curProj) return;
  var el = document.getElementById('preprocWarpDir');
  var dir = el ? el.value.trim() : '';
  try{
    await post('/api/projects/'+curProj+'/config', {warptools_dir: dir});
    // Update status inline — do NOT call selProj() which would jump to Notebook tab
    preprocUpdateStatus(dir);
    // Update project header warp info without tab switch
    var warpSpan = document.querySelector('#pInfo div:last-child span');
    if(warpSpan && dir) warpSpan.textContent = dir.length > 28 ? dir.slice(0,25)+'...' : dir;
    // Flash Save button
    var btn = document.getElementById('preprocSaveBtn');
    if(btn){ btn.textContent = '✓ Saved'; btn.style.color = 'var(--gn)';
      setTimeout(function(){ btn.textContent = 'Save'; btn.style.color = ''; }, 1800); }
    // Hide warning if dir is now set
    var warn = document.getElementById('preprocNoPathWarn');
    if(warn) warn.style.display = dir ? 'none' : '';
  }catch(e){
    var statusEl = document.getElementById('preprocDirStatus');
    if(statusEl) statusEl.innerHTML = '<span style="color:var(--rd)">✖ ' + e.message + '</span>';
  }
}

async function preprocCreateFolder(){
  if(!curProj) return;
  var nameEl = document.getElementById('preprocNewName');
  var pathEl = document.getElementById('preprocNewPath');
  var resEl  = document.getElementById('preprocCreateRes');
  var name = nameEl ? nameEl.value.trim() : '';
  var path = pathEl ? pathEl.value.trim() : '';
  if(!name){ if(resEl) resEl.innerHTML = '<span style="color:var(--rd)">Enter a folder name</span>'; return; }
  try{
    console.log('[DEBUG] preprocCreateFolder - curProj:', curProj);
    var d = await post('/api/projects/'+curProj+'/create_preprocessing', {
      preprocessing_name: name,
      preprocessing_path: path,
    });
    if(resEl) resEl.innerHTML = '<span style="color:var(--gn)">✓ Created: ' + (d.warptools_dir||name) + '</span>';
    // Auto-fill the warptools_dir field
    var el = document.getElementById('preprocWarpDir');
    if(el && d.warptools_dir){ el.value = d.warptools_dir; preprocUpdateStatus(d.warptools_dir); }
    if(nameEl) nameEl.value = '';
    if(pathEl) pathEl.value = '';
  }catch(e){
    if(resEl) resEl.innerHTML = '<span style="color:var(--rd)">✖ ' + e.message + '</span>';
  }
}

async function preprocScanAndFill(){
  if(!curProj) return;
  var statusEl = document.getElementById('preprocDirStatus');
  if(statusEl) statusEl.innerHTML = '<span style="color:var(--dm)">Scanning…</span>';
  try{
    var d = await api('/api/projects/'+curProj+'/scan_preprocessing');
    if(!d.has_warptools_dir){
      if(statusEl) statusEl.innerHTML = '<span style="color:var(--yl)">⚠ No WarpTools directory set — save one first</span>';
      return;
    }
    var parts = [];
    if(d.frames && (d.frames.tif || d.frames.eer))
      parts.push((d.frames.tif||d.frames.eer) + ' ' + d.frames.preferred.toUpperCase() + ' frames');
    if(d.mdocs && d.mdocs.count) parts.push(d.mdocs.count + ' MDOCs');
    if(d.reconstructions && d.reconstructions.count) parts.push(d.reconstructions.count + ' tomos');
    if(d.xmls && d.xmls.count) parts.push(d.xmls.count + ' XMLs');
    var msg = parts.length ? parts.join(' · ') : 'No data found yet';

    // Auto-fill tomo tab if possible
    var p = (d.mdocs && d.mdocs.parsed) || {};
    var dims = (d.reconstructions && d.reconstructions.dims) || [];
    var voxel = d.reconstructions && d.reconstructions.voxel_size;
    var filled = [];
    if(p.voltage && $('tVoltage') && !$('tVoltage').value){ $('tVoltage').value = p.voltage; filled.push('voltage'); }
    if(p.pixel_size && $('tRaw') && !$('tRaw').value){ $('tRaw').value = p.pixel_size; filled.push('pixel size'); }
    if(dims.length === 3){
      if($('tX') && !$('tX').value){ $('tX').value = dims[0]; }
      if($('tY') && !$('tY').value){ $('tY').value = dims[1]; }
      if($('tZ') && !$('tZ').value){ $('tZ').value = dims[2]; filled.push('dimensions'); }
    }
    var fillMsg = filled.length ? ' · Auto-filled: ' + filled.join(', ') : '';
    if(statusEl) statusEl.innerHTML =
      '<span style="color:var(--gn)">✓ ' + msg + fillMsg + '</span>';
  }catch(e){
    if(statusEl) statusEl.innerHTML = '<span style="color:var(--rd)">✖ ' + e.message + '</span>';
  }
}

// Called when entering preproc tab
function preprocOnTabOpen(){
  preprocInitPills();
  preprocModeChange('existing'); // default: show "Use existing" panel
  preprocLocChange('next');      // default: next to project
  preprocLoadWarpDir();
  preprocFillSampleName();       // pre-fill sample name + date from project config
  if(typeof at3AutoFill==='function') at3AutoFill(); // auto-fill AreTomo3 dirs
}

// ══════════════════════════════════════════════════════════════
//  FILES TAB — Project / Preprocessing toggle
// ══════════════════════════════════════════════════════════════

var _filesDirMode = 'project'; // 'project' | 'preproc'

// Directory-toggle targets that just jump straight to a configured project field
// (as opposed to 'project' and 'server', which have their own distinct logic).
var FILES_DIR_FIELD_MODES = {
  warptools: {btnId: 'fileDirToggleWarp',    field: 'warptools_dir', color: '#38bdf8', bg: 'rgba(56,189,248,.1)',  name: 'WarpTools dir'},
  at3work:   {btnId: 'fileDirToggleAt3Work', field: 'at3_work_dir',  color: '#f59e0b', bg: 'rgba(245,158,11,.1)', name: 'AreTomo3 work dir'},
  at3input:  {btnId: 'fileDirToggleAt3Input',field: 'at3_input_dir', color: '#f59e0b', bg: 'rgba(245,158,11,.1)', name: 'AreTomo3 input dir'},
};

async function filesSetDir(mode){
  _filesDirMode = mode;
  var btnProj    = document.getElementById('fileDirToggleProj');
  var btnPreproc = document.getElementById('fileDirTogglePreproc');
  var btnServer  = document.getElementById('fileDirToggleServer');
  var label      = document.getElementById('fileDirLabel');
  var serverSetup = document.getElementById('fileBrowseSettings'); // unified panel - don't auto-show
  var absEl = document.getElementById('fileAbsPath');
  var scEl  = document.getElementById('fileShortcuts');

  // Reset all button styles
  var allBtns = [btnProj, btnPreproc, btnServer].concat(
    Object.keys(FILES_DIR_FIELD_MODES).map(function(k){ return document.getElementById(FILES_DIR_FIELD_MODES[k].btnId); })
  );
  allBtns.forEach(function(b){ if(!b) return;
    b.style.borderColor = 'var(--bd)'; b.style.background = 'transparent'; b.style.color = 'var(--dm)';
  });
  if(absEl) absEl.style.display = 'none';
  if(scEl){ scEl.style.display = 'none'; scEl.innerHTML = ''; }
  // Settings panel stays as-is — toggled only by ⚙ Browse settings button

  if(mode === 'project'){
    if(btnProj){ btnProj.style.borderColor='var(--ac)'; btnProj.style.background='rgba(88,166,255,.12)'; btnProj.style.color='var(--ac)'; }
    if(label) label.textContent = '';
    // Use configured local start dir if set, else project dir
    var localStart = localStorage.getItem('localBrowseStartDir') || '';
    var startDir = localStart || curProj || '.';
    // Populate the start dir input if present
    var lsd = document.getElementById('fileLocalStartDir');
    if(lsd && !lsd.value && localStart) lsd.value = localStart;
    fGo(startDir);

  } else if(mode === 'preproc'){
    if(btnPreproc){ btnPreproc.style.borderColor='#38bdf8'; btnPreproc.style.background='rgba(56,189,248,.1)'; btnPreproc.style.color='#38bdf8'; }
    var warpDir = '';
    if(curProj){
      try{ var c = await api('/api/projects/'+curProj+'/config'); warpDir = c.warptools_dir || ''; }catch(e){}
    }
    if(warpDir){
      var preprocRoot = warpDir.replace(/\/warptools\/?$/, '').replace(/\/warptools$/, '') || warpDir;
      if(label) label.textContent = preprocRoot.split('/').pop();
      if(absEl){ absEl.textContent = preprocRoot; absEl.style.display = ''; }
      fGo(preprocRoot);
    } else {
      if(label) label.textContent = 'No preprocessing dir set';
      fGo('.');
    }

  } else if(FILES_DIR_FIELD_MODES[mode]){
    var fm = FILES_DIR_FIELD_MODES[mode];
    var fmBtn = document.getElementById(fm.btnId);
    if(fmBtn){ fmBtn.style.borderColor=fm.color; fmBtn.style.background=fm.bg; fmBtn.style.color=fm.color; }
    var dirVal = '';
    if(curProj){
      try{ var cfg = await api('/api/projects/'+curProj+'/config'); dirVal = cfg[fm.field] || ''; }catch(e){}
    }
    if(dirVal){
      if(label) label.textContent = dirVal.split('/').pop();
      if(absEl){ absEl.textContent = dirVal; absEl.style.display = ''; }
      fGo(dirVal);
    } else {
      if(label) label.textContent = fm.name + ' not set';
      fGo('.');
    }

  } else if(mode === 'server'){
    if(btnServer){ btnServer.style.borderColor='var(--gn)'; btnServer.style.background='rgba(63,185,80,.1)'; btnServer.style.color='var(--gn)'; }
    // Load current server config
    try{
      var ds = await api('/api/data_server');
      var inp = document.getElementById('fileServerUrl');
      if(inp && !inp.value && ds.url) inp.value = ds.url;
      if(ds.url){
        if(serverSetup) serverSetup.style.display = '';
        if(ds.mounted){
          if(label) label.textContent = ds.url.replace('smb://', '');
          fGoServer(ds.gvfs_path);
        } else {
          if(label) label.textContent = 'Not mounted';
          if(serverSetup) serverSetup.style.display = '';
          var statusEl = document.getElementById('fileServerStatus');
          if(statusEl) statusEl.innerHTML = '<span style="color:var(--rd)">✗ Not mounted</span> — run: <code>gio mount ' + ds.url + '</code>';
          $('fL').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.78rem">Server not mounted. Mount it first then click Refresh.</div>';
        }
      } else {
        // No URL configured yet — show setup
        if(serverSetup) serverSetup.style.display = '';
        if(label) label.textContent = 'not configured';
        $('fL').innerHTML = '<div class="dim" style="padding:.5rem;font-size:.78rem">Enter a server URL above and click Save.</div>';
      }
    }catch(e){ if(label) label.textContent = 'error'; }
  }
}

async function fileSaveServerUrl(){
  var inp = document.getElementById('fileServerUrl');
  var url = inp ? inp.value.trim() : '';
  if(!url){ alert('Enter a URL like smb://server/share'); return; }
  var statusEl = document.getElementById('fileServerStatus');
  try{
    var r = await post('/api/data_server', {url: url});
    if(r.mounted){
      if(statusEl) statusEl.innerHTML = '<span style="color:var(--gn)">✓ Connected</span>';
      var label = document.getElementById('fileDirLabel');
      if(label) label.textContent = url.replace('smb://','');
      // Also save any start dir entered
      var startInp = document.getElementById('fileServerStartDir');
      if(startInp && startInp.value.trim()) fileSaveStartDir('server');
      fGoServer(r.gvfs_path);
    } else {
      if(statusEl) statusEl.innerHTML = '<span style="color:var(--yl)">⚠ Saved — not mounted yet.</span> Run: <code>gio mount ' + url + '</code>';
    }
  }catch(e){ if(statusEl) statusEl.textContent = 'Error: ' + e.message; }
}

function filesToggledSettings(){
  var panel = document.getElementById('fileBrowseSettings');
  if(!panel) return;
  var isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : '';
  if(!isOpen){
    // Populate inputs from localStorage when opening
    var lsd = document.getElementById('fileLocalStartDir');
    var ssd = document.getElementById('fileServerStartDir');
    if(lsd && !lsd.value) lsd.value = localStorage.getItem('localBrowseStartDir') || '';
    if(ssd && !ssd.value) ssd.value = localStorage.getItem('serverBrowseStartDir') || '';
    // Fetch and show server URL
    api('/api/data_server').then(function(ds){
      var urlInp = document.getElementById('fileServerUrl');
      if(urlInp && !urlInp.value && ds.url) urlInp.value = ds.url;
      var statusEl = document.getElementById('fileServerStatus');
      if(statusEl){
        statusEl.innerHTML = ds.mounted
          ? '<span style="color:var(--gn)">● Connected: ' + (ds.gvfs_path||'') + '</span>'
          : ds.url ? '<span style="color:var(--yl)">○ Not mounted — run: <code>gio mount ' + ds.url + '</code></span>'
                   : '<span style="color:var(--dm)">No server configured</span>';
      }
    }).catch(function(){});
  }
}

function fileSaveStartDir(mode){
  if(mode === 'server'){
    var inp = document.getElementById('fileServerStartDir');
    var val = inp ? inp.value.trim() : '';
    localStorage.setItem('serverBrowseStartDir', val);
    if(val) window._serverGvfsPath = val;
    var statusEl = document.getElementById('fileServerStatus');
    if(statusEl) { statusEl.innerHTML = '<span style="color:var(--gn)">✓ Server start dir saved</span>';
      setTimeout(function(){ statusEl.innerHTML=''; }, 2000); }
  } else {
    var inp = document.getElementById('fileLocalStartDir');
    var val = inp ? inp.value.trim() : '';
    localStorage.setItem('localBrowseStartDir', val);
    if(val) fGo(val);
  }
}


// ── Wizard mode toggle: Use existing / Create new (exclusive) ──
function cWarpModeChange(mode){
  var bE = document.getElementById('cBtnExist');
  var bC = document.getElementById('cBtnCreate');
  var pE = document.getElementById('cWarpExisting');
  var pC = document.getElementById('cWarpCreate');
  if(bE){ bE.className = 'exc-btn' + (mode==='existing'?' on':''); }
  if(bC){ bC.className = 'exc-btn' + (mode==='create'?' on':''); }
  if(pE){ pE.style.display = mode==='existing' ? '' : 'none'; }
  if(pC){ pC.style.display = mode==='create'   ? '' : 'none'; }
}

// ── Wizard location toggle: next to project / custom (binary) ──
function cLocModeChange(mode){
  var tN = document.getElementById('cTrkNext');
  var kN = document.getElementById('cKnbNext');
  var tC = document.getElementById('cTrkCustom');
  var kC = document.getElementById('cKnbCustom');
  var row = document.getElementById('cCustomPathRow');
  if(tN){ tN.className = 'tog-track' + (mode==='next'  ?' on':''); }
  if(kN){ kN.className = 'tog-knob'  + (mode==='next'  ?' on':''); }
  if(tC){ tC.className = 'tog-track' + (mode==='custom'?' on':''); }
  if(kC){ kC.className = 'tog-knob'  + (mode==='custom'?' on':''); }
  if(row){ row.style.display = mode==='custom' ? 'flex' : 'none'; }
  cWarpCreatePreview();
}
// ═══════════════════════════════════════════════════════════════
//  PEOPLE TAB - INVESTIGATORS
// ═══════════════════════════════════════════════════════════════

async function addInvestigator(){
  if(!curProj) return;
  var input = document.getElementById('invNew');
  var name = input ? input.value.trim() : '';
  if(!name) return;
  
  try{
    // Get current config
    var cfg = await api('/api/projects/'+curProj+'/config');
    var invs = cfg.investigators || [];
    
    // Add if not duplicate
    if(!invs.includes(name)){
      invs.push(name);
      await post('/api/projects/'+curProj+'/config', {investigators: invs});
      input.value = '';
      loadInvestigators(); // Refresh list
      res('invRes', true, icon('success')+' Added: '+name);
      setTimeout(()=>{ var el=$('invRes'); if(el) el.innerHTML=''; }, 2000);
    } else {
      res('invRes', false, 'Already in list');
    }
  } catch(e){
    res('invRes', false, e.message || String(e));
  }
}

async function removeInvestigator(name){
  if(!curProj) return;
  try{
    var cfg = await api('/api/projects/'+curProj+'/config');
    var invs = (cfg.investigators || []).filter(n => n !== name);
    await post('/api/projects/'+curProj+'/config', {investigators: invs});
    loadInvestigators();
  } catch(e){
    console.error('Remove investigator error:', e);
  }
}

// ── _nTilts: get n_tilts from manual field or compute from range ──
function _nTilts(){
  var manual=parseInt(($('tNTilts')||{}).value)||0;
  if(manual>0) return manual;
  var mn=parseFloat(($('tTiltMin')||{}).value)||0;
  var mx=parseFloat(($('tTiltMax')||{}).value)||0;
  var st=parseFloat(($('tTiltStep')||{}).value)||0;
  if(st>0) return Math.round(Math.abs(mx-mn)/st)+1;
  return 0;
}

// Live-calculate dose_per_tilt from total_dose / n_tilts
function calcDosePerTilt(){
  var n=_nTilts();
  var total=parseFloat(($('tTotalDose')||{}).value)||0;
  // Write to the editable input field tDosePerTilt
  var dptEl=document.getElementById('tDosePerTilt');
  if(total>0&&n>0&&dptEl) dptEl.value=(total/n).toFixed(3);
  // Update tNTilts input field (now a readonly input, not span)
  var ntEl=document.getElementById('tNTilts');
  if(ntEl) ntEl.value=n>0?String(n):'';
}

// Keep updateTiltCalculations as alias for backward compat (called from HTML oninput)
function updateTiltCalculations(){
  calcDosePerTilt();
}

// ── MDOC Import ──────────────────────────────────────────────
async function importFromMdoc(){
  // Works from both Tomo tab and Wizard
  var input=document.createElement('input');
  input.type='file';input.accept='.mdoc';input.style.display='none';
  document.body.appendChild(input);
  input.onchange=async function(){
    var file=input.files[0];
    document.body.removeChild(input);
    if(!file) return;
    var text=await file.text();
    _parseMdocAndFill(text, file.name);
  };
  input.click();
}

function _parseMdocAndFill(text, mdocFilename){
  // Normalize line endings
  var lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  var header={},inHeader=true,firstZ={},inFirstZ=false,tilts=[];
  // Collect per-section values for dose averaging
  var allDoseRates=[],allExposureDoses=[],allFrameDoses=[],curSection=null;
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(line==='[ZValue = 0]'){inHeader=false;inFirstZ=true;curSection={};continue;}
    if(/^\[ZValue = [^0]/.test(line)){inFirstZ=false;curSection={};continue;}
    if(inHeader){
      var m=line.match(/^(\w+)\s*=\s*(.+)$/);
      if(m) header[m[1]]=m[2].trim();
      if(line.indexOf('[T = ')===0){
        var sm=line.match(/T = (?:SerialEM: )?([^,\]]+)/);
        if(sm&&!header['_scope']) header['_scope']=sm[1].trim();
        var vm=line.match(/SerialEM(?:\s+Version)?\s+([\d.]+)/i);
        if(vm) header['_semver']=vm[1];
        var tam=line.match(/Tilt axis angle\s*=\s*([\d.]+)/);
        if(tam) header['_tiltaxis']=tam[1];
      }
    }
    if(inFirstZ){var mz=line.match(/^(\w+)\s*=\s*(.+)$/);if(mz) firstZ[mz[1]]=mz[2].trim();}
    // Collect DoseRate and ExposureDose from ALL sections
    if(curSection !== null){
      var ms=line.match(/^(\w+)\s*=\s*(.+)$/);
      if(ms){
        if(ms[1]==='DoseRate'){var dr=parseFloat(ms[2]);if(dr>0) allDoseRates.push(dr);}
        if(ms[1]==='ExposureDose'){var ed=parseFloat(ms[2]);if(ed>0) allExposureDoses.push(ed);}
        if(ms[1]==='FrameDosesAndNumber'||ms[1]==='FrameDosesAndNumbers'){
          var fd=parseFloat(ms[2].trim().split(/\s+/)[0]);if(fd>0) allFrameDoses.push(fd);
        }
      }
    }
    var tm=line.match(/^TiltAngle\s*=\s*([-\d.]+)/);
    if(tm) tilts.push(parseFloat(tm[1]));
  }
  var px=parseFloat(header['PixelSpacing'])||0;
  var v=parseInt(header['Voltage'])||0;
  var imsz=(header['ImageSize']||'').split(/\s+/);
  var ix=parseInt(imsz[0])||0,iy=parseInt(imsz[1])||0;
  var magnif=parseInt(firstZ['Magnification']||header['Magnification'])||0;
  var nf=parseInt(firstZ['NumSubFrames'])||0;
  var slit=parseFloat((firstZ['FilterSlitAndLoss']||'').split(/\s+/)[0])||0;
  var cds=firstZ['UsingCDS']||'';
  var taxis=parseFloat(header['_tiltaxis'])||0;
  var scope=header['_scope']||'';
  var sver=header['_semver']||'';
  // New fields
  var targetDefocus=parseFloat(firstZ['TargetDefocus'])||0;
  var spotSize=parseInt(firstZ['SpotSize'])||0;
  var countsPerElectron=parseFloat(firstZ['CountsPerElectron'])||0;

  // ── Dose calculation — 3-source fallback chain ────────────────────────────
  // Source 1: ExposureDose (e⁻/Å² — official field, direct)
  var dosePerTilt=0;
  var doseSource='';
  if(allExposureDoses.length>0){
    dosePerTilt=parseFloat((allExposureDoses.reduce(function(a,b){return a+b;},0)/allExposureDoses.length).toFixed(4));
    doseSource='ExposureDose';
  }
  // Source 2: FrameDosesAndNumbers (e⁻/Å²/frame × NumSubFrames)
  if(!dosePerTilt && allFrameDoses.length>0 && nf>0){
    var avgFrameDose=allFrameDoses.reduce(function(a,b){return a+b;},0)/allFrameDoses.length;
    dosePerTilt=parseFloat((avgFrameDose*nf).toFixed(4));
    doseSource='FrameDosesAndNumbers';
  }
  // Source 3: DoseRate [e⁻/px²/s] × ExposureTime [s] / PixelSpacing² [Å²/px²]
  var exposureTime=parseFloat(firstZ['ExposureTime'])||0;
  if(!dosePerTilt && allDoseRates.length>0 && exposureTime>0 && px>0){
    var avgDoseRate=allDoseRates.reduce(function(a,b){return a+b;},0)/allDoseRates.length;
    dosePerTilt=parseFloat((avgDoseRate*exposureTime/(px*px)).toFixed(4));
    doseSource='DoseRate';
  }
  
  // Tilt angles — round to integers
  var tmin=0,tmax=0,tstep=0,ntilts=0;
  if(tilts.length>1){
    var rounded=tilts.map(function(a){return Math.round(a);});
    ntilts=rounded.length;
    tmin=Math.min.apply(null,rounded);
    tmax=Math.max.apply(null,rounded);
    var uniq=rounded.filter(function(vv,i,a){return a.indexOf(vv)===i;}).sort(function(a,b){return a-b;});
    var dd={};
    for(var j=1;j<uniq.length;j++){var d=uniq[j]-uniq[j-1];dd[d]=(dd[d]||0)+1;}
    var best=3,bc=0;
    Object.keys(dd).forEach(function(k){if(dd[k]>bc){bc=dd[k];best=parseInt(k);}});
    tstep=best;
  }
  // Date from first ZValue
  var collDate='';
  var dt=firstZ['DateTime']||'';
  if(dt){var dm=dt.match(/(\d{2})-(\w{3})-(\d{4})/);
    if(dm){var mo={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
      collDate=dm[3]+'-'+(mo[dm[2]]||'01')+'-'+dm[1];}}
  if(scope.indexOf('Krios G4')>=0) scope='Titan Krios G4';
  else if(scope.indexOf('Krios')>=0) scope='Titan Krios';
  else if(scope.indexOf('Talos')>=0) scope='Talos Arctica';
  function fill(id,val){
    if(val===undefined||val===null||val==='') return;
    var el=document.getElementById(id)||(typeof $==='function'?$(id):null);
    if(el) el.value=val;
  }
  // Fill tomo tab — tBin and tZ NEVER auto-filled (user decision)
  if(px)    fill('tRaw',px);
  if(v)     fill('tVoltage',v);
  if(ix)    fill('tX',ix);
  if(iy)    fill('tY',iy);
  if(magnif) fill('tMagnification',magnif);
  if(nf)    fill('tFramesPerTilt',nf);
  if(slit)  fill('tSlitWidth',slit);
  if(cds)   fill('tCDSMode',cds==='1'?'CDS':'standard');
  fill('tTiltMin',tmin);
  fill('tTiltMax',tmax);
  if(tstep) fill('tTiltStep',tstep);
  if(ntilts) fill('tNTilts',ntilts);
  if(scope) fill('tMicroscope',scope);
  if(sver)  fill('tCollSoftVer',sver);
  if(collDate) fill('tDate',collDate);
  // New fields from MDOC
  if(targetDefocus) fill('tTargetDefocus', targetDefocus);
  if(spotSize)      fill('tSpotSize', spotSize);
  if(countsPerElectron) fill('tCountsPerElectron', countsPerElectron);
  
  // NEW: Fill dose_per_tilt from MDOC calculation
  if(dosePerTilt>0) fill('tDosePerTilt',dosePerTilt);

  // Auto-calculate total_dose = dose_per_tilt × n_tilts
  if(dosePerTilt>0 && ntilts>0){
    var totalDoseCalc = parseFloat((dosePerTilt * ntilts).toFixed(1));
    fill('tTotalDose', totalDoseCalc);
  }
  
  // NEW: Fill tilt axis input field
  if(taxis) fill('tTiltAxis',taxis);
  
  var semEl=document.getElementById('tCollSoftware');
  if(semEl&&!semEl.value) semEl.value='SerialEM';
  if(taxis) window._mdocTiltAxis=taxis;
  // Trigger calculations
  if(typeof calcPx==='function') calcPx('t');
  if(typeof calcMGrid==='function') calcMGrid();
  calcDosePerTilt();
  // Fill wizard fields too (background, no popup)
  _fillWizardFromMdoc(px,v,ix,iy,collDate);
  
  // Store COMPLETE MDOC data for wizard (if not in a project yet)
  if(!curProj){
    window._wizardMdocData = {
      raw_pixel_size: px||0,
      voltage: v||0,
      tomo_dims: [ix||0, iy||0],  // Z never set from MDOC — user must set manually
      magnification: magnif||0,
      frames_per_tilt: nf||0,
      energy_filter_slit: slit||0,
      cds_mode: cds==='1'?'CDS':'standard',
      tilt_min: tmin||0,
      tilt_max: tmax||0,
      tilt_step: tstep||0,
      n_tilts: ntilts||0,
      microscope: scope||'',
      collection_software: 'SerialEM',
      collection_software_version: sver||'',
      collection_date: collDate||'',
      warp_initial_axis: taxis||0,
      dose_per_tilt: dosePerTilt||0,           // From MDOC calculation
      dose_source: doseSource||'',             // Which field was used
      warp_tilt_exposure: dosePerTilt||0,      // Alias for WarpTools
      target_defocus: targetDefocus||0,
      spot_size: spotSize||0,
    };
    console.log('[Wizard MDOC] Stored COMPLETE data:', window._wizardMdocData);
  }
  
  // Show message in tomo tab if it exists
  var doseInfo = dosePerTilt>0 ? (' | dose: '+dosePerTilt.toFixed(3)+' e⁻/Å²/tilt ('+doseSource+')') : '';
  var mdocMsg = mdocFilename
    ? 'MDOC imported from ' + mdocFilename + doseInfo + ' — check Binning'
    : 'MDOC imported -- set Binning manually';
  if(typeof res==='function') res('tomoRes',true, mdocMsg);
  // Update mdoc_source label
  var srcEl = document.getElementById('tMdocSource');
  if(srcEl && mdocFilename) srcEl.textContent = 'Filled from: ' + mdocFilename;
  
  // AUTO-SAVE: Only send fields that MDOC actually provided.
  // Never call saveTomo() here — it reads ALL UI fields which may be
  // empty/wrong before selProj has populated them (race condition).
  if(curProj){
    var _mdocPayload = {};
    if(px)          _mdocPayload.raw_pixel_size = px;
    if(v)           _mdocPayload.voltage = v;
    if(collDate)    _mdocPayload.collection_date = collDate;
    if(tmin||tmax)  { _mdocPayload.tilt_min = tmin; _mdocPayload.tilt_max = tmax; }
    if(tstep)       _mdocPayload.tilt_step = tstep;
    if(ntilts)      _mdocPayload.n_tilts = ntilts;
    if(dosePerTilt) { _mdocPayload.dose_per_tilt = dosePerTilt; _mdocPayload.warp_tilt_exposure = dosePerTilt; }
    if(dosePerTilt>0 && ntilts>0) _mdocPayload.total_dose = parseFloat((dosePerTilt * ntilts).toFixed(1));
    if(mdocFilename)  _mdocPayload.mdoc_source = mdocFilename;
    if(nf)          _mdocPayload.frames_per_tilt = nf;
    if(targetDefocus) _mdocPayload.target_defocus = targetDefocus;
    if(spotSize)      _mdocPayload.spot_size = spotSize;
    if(magnif)      _mdocPayload.magnification = magnif;
    if(slit)        _mdocPayload.energy_filter_slit = slit;
    if(scope)       _mdocPayload.microscope = scope;
    if(sver)        _mdocPayload.collection_software_version = sver;
    if(ix&&iy)      _mdocPayload.tomo_dims = [ix, iy]; // Z intentionally omitted
    if(Object.keys(_mdocPayload).length > 0){
      console.log('[MDOC Import] Saving MDOC fields only:', Object.keys(_mdocPayload));
      post('/api/projects/'+curProj+'/config', _mdocPayload).catch(function(e){
        console.error('[MDOC Import] Save failed:', e.message);
      });
    }
  }
}

function _fillWizardFromMdoc(px,v,ix,iy,collDate){
  function wf(id,val){
    if(!val&&val!==0) return;
    var el=document.getElementById(id);
    if(el&&!el.value) el.value=val;
  }
  wf('cRawPx',px);
  wf('cVoltage',v);
  wf('cX',ix);
  wf('cY',iy);
  wf('cCollDate',collDate);
  if(typeof calcPx==='function') calcPx('c');
  
  // Store MDOC data globally for wizard project creation
  _wizardMdocData = {px, v, ix, iy, collDate};
  console.log('[Wizard MDOC] Stored data for project creation:', _wizardMdocData);
}

// SVG Icon Helper
function icon(type) {
  const icons = {
    success: '<svg class="icon icon-success" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warning: '<svg class="icon icon-warning" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L15 14H1L8 1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="6" x2="8" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="12" r="0.5" fill="currentColor"/></svg>',
    error: '<svg class="icon icon-error" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    sun: '<svg class="icon icon-theme" width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="1" x2="10" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="10" y1="17" x2="10" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="10" x2="3" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="17" y1="10" x2="19" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3.5" y1="3.5" x2="5" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="15" y1="15" x2="16.5" y2="16.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3.5" y1="16.5" x2="5" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="15" y1="5" x2="16.5" y2="3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    moon: '<svg class="icon icon-theme" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 12.79C20.19 13.54 19.18 14.08 18.06 14.32C15.6 14.87 13.14 13.64 12.15 11.45C11.16 9.26 11.82 6.67 13.84 5.28C14.63 4.75 15.54 4.39 16.5 4.23C13.32 2.88 9.44 3.71 7.17 6.54C4.17 10.29 4.85 15.76 8.6 18.76C12.35 21.76 17.82 21.08 20.82 17.33C21.94 15.89 22.5 14.16 22.5 12.42C22.11 12.58 21.56 12.71 21 12.79Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tree: '<svg class="icon icon-tree" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="4" r="2" fill="currentColor"/><line x1="12" y1="6" x2="12" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="9" x2="7" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="9" x2="17" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="14" x2="5" y2="17" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="14" x2="9" y2="17" stroke="currentColor" stroke-width="1.5"/><line x1="17" y1="14" x2="15" y2="17" stroke="currentColor" stroke-width="1.5"/><line x1="17" y1="14" x2="19" y2="17" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/><circle cx="17" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/><circle cx="9" cy="19" r="1.5" fill="currentColor"/><circle cx="15" cy="19" r="1.5" fill="currentColor"/><circle cx="19" cy="19" r="1.5" fill="currentColor"/></svg>'
  };
  return icons[type] || '';
}

// Update Job Tree button with SVG icon after DOM loads
document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('jobTreeBtn');
  if(btn) {
    btn.innerHTML = icon('tree') + ' Job Tree';
  }
});

// Re-apply theme after icon() function is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Update theme toggle icon with SVG
  if (typeof applyTheme === 'function') {
    applyTheme();
  }
  
  // Update Job Tree button with SVG icon
  var btn = document.getElementById('jobTreeBtn');
  if (btn && typeof icon === 'function') {
    btn.innerHTML = icon('tree') + ' Job Tree';
  }
});

// ── getProjDir — returns absolute project dir for job working_dir ──
// For WarpTools jobs this is overridden in templates.js (uses jbWarpDirInput).
// This fallback is used for all non-WarpTools jobs.
async function getProjDir(){
  if(!curProj) return '.';
  try{
    var c = await api('/api/projects/'+curProj+'/config');
    // Prefer explicit project_dir, fallback to workspace_dir/project
    if(c.project_dir && c.project_dir !== '') return c.project_dir;
  }catch(e){}
  // Fallback: workspace relative path
  return curProj;
}

// ══════════════════════════════════════════════════════════════
//  MISS ALIGNMENT WORKFLOW TAB
// ══════════════════════════════════════════════════════════════

var _maWfMode = 'aretomo'; // 'aretomo' | 'import'

function maWfSetMode(mode){
  _maWfMode = mode;
  // Update pills
  var pa = document.getElementById('maWf-pill-aretomo');
  var pi = document.getElementById('maWf-pill-import');
  if(pa) pa.className = 'pill-toggle-btn' + (mode==='aretomo'?' on':'');
  if(pi) pi.className = 'pill-toggle-btn' + (mode==='import'?' on':'');

  // Update step 6 content
  var title = document.getElementById('maWf-s6-title');
  var cmd   = document.getElementById('maWf-s6-cmd');
  var desc  = document.getElementById('maWf-s6-desc');
  var note  = document.getElementById('maWf-mode-note');
  var btns  = document.getElementById('maWf-s6-btns');

  if(mode === 'aretomo'){
    if(title) title.textContent = 'Coarse Alignment (AreTomo3 / eTomo)';
    if(cmd)   cmd.textContent   = 'ts_etomo';
    if(desc)  desc.innerHTML    = 'Coarse tilt series alignment using AreTomo3 or eTomo. '
      + 'Produces <code>.xf</code>/<code>.tlt</code> alignment files.';
    if(note)  note.textContent  = 'Coarse alignment will be performed by AreTomo3 or eTomo via WarpTools.';
    if(btns)  btns.innerHTML    =
      '<button class="bsm" onclick="openRightPanel();selTpl(\'warp_ts_etomo\')" '
      + 'style="color:#a78bfa;border-color:rgba(167,139,250,.35)">Open in Job Builder →</button>';
  } else {
    if(title) title.textContent = 'Import Alignments';
    if(cmd)   cmd.textContent   = 'ts_import_alignments';
    if(desc)  desc.innerHTML    = 'Import existing <code>.xf</code>/<code>.tlt</code> alignment files '
      + 'from AreTomo3, IMOD, or other tools. Place files in <code>import_alignments/</code> first.';
    if(note)  note.textContent  = 'Existing alignments will be imported — no coarse alignment step needed.';
    if(btns)  btns.innerHTML    =
      '<button class="bsm" onclick="openRightPanel();selTpl(\'warp_ts_import_alignments\')" '
      + 'style="color:#a78bfa;border-color:rgba(167,139,250,.35)">Open in Job Builder →</button>';
  }
}

function maWfOpenRereconstruct(){
  // Open ts_reconstruct in job builder with output_processing pre-filled
  openRightPanel();
  selTpl('warp_ts_reconstruct').then(function(){
    // Pre-fill output_processing_dir and enable the toggle
    var toggleEl = document.getElementById('tp_use_output_processing');
    var dirEl    = document.getElementById('tp_output_processing_dir');
    if(toggleEl && !toggleEl.checked){
      toggleEl.checked = true;
      toggleEl.dispatchEvent(new Event('change'));
    }
    if(dirEl){
      dirEl.value = 'warp_tiltseries/reconstruction_postmissalign';
      dirEl.dispatchEvent(new Event('input'));
    }
    updPrev();
  }).catch(function(){});
}

// ── SSH connection test ─────────────────────────────────────────────────────────
async function compSSHTest(){
  var res = document.getElementById('compSSHTestRes');
  if(res) res.textContent = '⟳ Testing...';
  var host = ($('compSSHHost')||{}).value||'';
  var user = ($('compSSHUser')||{}).value||'';
  var port = ($('compSSHPort')||{}).value||'22';
  var key  = ($('compSSHKey')||{}).value||'';
  if(!host||!user){
    if(res) res.textContent = '✖ Host and user required';
    return;
  }
  try {
    var r = await post('/api/computing/ssh_test', {host:host, user:user, port:port, key:key});
    if(res) res.textContent = r.ok ? '✓ Connected: '+r.info : '✖ '+r.error;
    if(res) res.style.color = r.ok ? 'var(--gn)' : 'var(--rd)';
  } catch(e) {
    if(res){ res.textContent='✖ '+e.message; res.style.color='var(--rd)'; }
  }
}