/* CryoSTAR-Base — warp.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════
const HEALPIX=[
  {angle:15.0,label:'Order 3 (15°)'},{angle:7.5,label:'Order 4 (7.5°)'},
  {angle:3.7,label:'Order 5 (3.7°)'},{angle:1.8,label:'Order 6 (1.8°)'},
  {angle:0.9,label:'Order 7 (0.9°)'},{angle:0.5,label:'Order 8 (0.5°)'},
  {angle:0.2,label:'Order 9 (0.2°)'}
];

// ── M / MTools ────────────────────────────────────────────────────────────────

function mtGet(id, fallback){ var el=document.getElementById(id); return (el&&el.value.trim())||fallback||''; }

function mtSetRound(n){
  var grids=['','1x1','2x2','4x4'];
  var hints=[
    '',
    'Round 1 — start conservative: <code>1x1</code> + <code>--refine_particles</code> + <code>--ctf_defocus</code>. Repeat until improvement is &lt;0.2Å, then consider increasing the grid.',
    'Round 2 — increase if initial convergence reached and particles cover the field of view. Still use <code>--refine_particles</code>.',
    'Round 3 / Final — <code>4x4</code> used by Pyle et al. 2025 for final V-ATPase refinement. Only when particles are well distributed across the tomogram.',
  ];
  var btns=['mt4_rnd1','mt4_rnd2','mt4_rnd3','mt4_rnd_custom'];
  btns.forEach(function(id,i){
    var el=document.getElementById(id);
    if(!el)return;
    var active=(i===n-1)||(n===0&&i===3);
    el.style.background=active?'rgba(167,139,250,.15)':'';
    el.style.color=active?'#a78bfa':'';
    el.style.borderColor=active?'rgba(167,139,250,.4)':'';
  });
  var gridEl=document.getElementById('mt4_grid');
  if(gridEl&&n>0){gridEl.value=grids[n];}
  var hint=document.getElementById('mt4_round_hint');
  if(hint&&n>0)hint.innerHTML='<strong style="color:#a78bfa">'+hints[n]+'</strong>';
  mtBuildCmd(4);
}

function mInfoSwitch(idx){
  for(var i=0;i<3;i++){
    var tab=document.getElementById('mInfoTab'+i);
    var panel=document.getElementById('mInfoPanel'+i);
    var active=(i===idx);
    if(tab){
      tab.style.color=active?'#a78bfa':'var(--dm)';
      tab.style.fontWeight=active?'600':'500';
      tab.style.borderBottom=active?'2px solid #a78bfa':'2px solid transparent';
      tab.style.background=active?'var(--sf)':'var(--sf2)';
    }
    if(panel)panel.style.display=active?'':'none';
  }
}

function mtBuildCmd(step){
  var cmd='';
  if(step===1){
    var d=mtGet('mt1_dir','m_population/'); var n=mtGet('mt1_name','');
    cmd='MTools create_population \\\n  -d '+d+(n?' \\\n  -n '+n:'');
  }else if(step===2){
    var p=mtGet('mt2_pop',''); var s=mtGet('mt2_settings','warp_tiltseries.settings'); var n=mtGet('mt2_name','tiltseries');
    cmd='MTools create_source \\\n  -p '+p+' \\\n  -s '+s+' \\\n  -n '+n;
  }else if(step===3){
    var p=mtGet('mt3_pop',''); var n=mtGet('mt3_name',''); var d=mtGet('mt3_diam','');
    var h1=mtGet('mt3_half1',''); var h2=mtGet('mt3_half2','');
    var m=mtGet('mt3_mask',''); var st=mtGet('mt3_star','');
    cmd='MTools create_species \\\n  -p '+p+(n?' \\\n  -n '+n:'')
      +(d?' \\\n  -d '+d:'')+(h1?' \\\n  --half1 '+h1:'')+(h2?' \\\n  --half2 '+h2:'')
      +(m?' \\\n  -m '+m:'')+(st?' \\\n  --particles_relion '+st:'');
  }else if(step===4){
    var p=mtGet('mt4_pop',''); var g=mtGet('mt4_grid','1x1'); var i=mtGet('mt4_iter','3');
    cmd='MCore \\\n  --population '+p+' \\\n  --refine_imagewarp '+g+' \\\n  --refine_particles \\\n  --iter '+i;
  }else if(step===5){
    var p=mtGet('mt5_pop',''); var i=mtGet('mt5_iter','3');
    cmd='MCore \\\n  --population '+p+' \\\n  --ctf_defocus \\\n  --iter '+i;
  }else if(step===6){
    var apx=mtGet('mt6_angpix','');
    cmd='WarpTools ts_reconstruct \\\n  --settings warp_tiltseries.settings \\\n'
      +(apx?'  --angpix '+apx+' \\\n':'')
      +'  --halfmap_frames';
  }
  var el=document.getElementById('mt'+step+'_cmd'); if(el)el.textContent=cmd;
}

async function mtRun(step){
  if(!curProj){alert('No project selected.');return;}
  var cmdEl=document.getElementById('mt'+step+'_cmd');
  var statEl=document.getElementById('mt'+step+'_status');
  if(!cmdEl||!cmdEl.textContent.trim()){if(statEl)statEl.textContent='Fill required fields first.';return;}
  var cmd=cmdEl.textContent.replace(/\\\s*\n\s*/g,' ').replace(/\n+/g,' ').trim();
  if(statEl){statEl.textContent='Running…';statEl.style.color='var(--dm)';}
  try{
    var cfg=await api('/api/projects/'+curProj+'/config');
    var workDir=(cfg&&cfg.warptools_dir)||cfg.project_dir||'.';
    var r=await post('/api/scripts/run',{command:cmd,working_dir:workDir,project:curProj});
    var ok=r.exit_code===0;
    if(statEl){statEl.textContent=ok?'✓ Done':'✖ Error (exit '+r.exit_code+')';statEl.style.color=ok?'var(--gn)':'var(--rd)';}
  }catch(e){if(statEl){statEl.textContent='Error: '+e.message;statEl.style.color='var(--rd)';}}
}

function mtAutoFill(){
  if(!curProj)return;
  api('/api/projects/'+curProj+'/config').then(function(c){
    // Pre-fill warp settings
    var ws=document.getElementById('mt2_settings');
    if(ws&&!ws.value&&c.warptools_dir)ws.value=c.warptools_dir.replace(/\/+$/,'')+'/warp_tiltseries.settings';
    // Pre-fill population path if set
    [2,3,4,5].forEach(function(s){
      var el=document.getElementById('mt'+s+'_pop');
      if(el&&!el.value&&c.m_population_path)el.value=c.m_population_path;
    });
    // Pre-fill pixel size for re-reconstruct
    var apx6=document.getElementById('mt6_angpix');
    if(apx6&&!apx6.value&&c.bin_pixel_size)apx6.value=c.bin_pixel_size;
    for(var i=1;i<=6;i++) mtBuildCmd(i);
  }).catch(function(){});
}

var _warp6Mode = 'etomo';

function warpBuildMGrid(){
  var n=parseInt(($('wp3_n_frames')||{}).value)||0;
  var el=$('wp3_m_grid');
  if(el){
    el.value = n>0 ? '1x1x'+n : '';
    el.style.color = n>0 ? 'var(--gn)' : 'var(--dm)';
  }
  warpBuildCmd(3);
}

async function warpLoadHistograms(){
  if(!curProj)return;
  var grid=$('wp4_plot_grid'), wrap=$('wp4_plots'), none=$('wp4_no_plots');
  if(!wrap)return;
  wrap.style.display='';
  try{
    var cfg=await api('/api/projects/'+curProj+'/config');
    var warpDir=(cfg&&cfg.warptools_dir)||cfg.project_dir||'.';
    // Look in warp_frameseries/ for PNG files
    var browseDir=warpDir.replace(/\/+$/,'')+'/warp_frameseries';
    var d=await api('/api/files/browse_free?path='+encodeURIComponent(browseDir));
    var pngs=(d.items||[]).filter(function(i){return !i.is_dir&&i.name.endsWith('.png');});
    if(!pngs.length&&none){none.style.display='';if(grid)grid.innerHTML='';return;}
    if(none)none.style.display='none';
    if(!grid)return;
    grid.innerHTML=pngs.map(function(p){
      var imgUrl='/api/files/image?path='+encodeURIComponent(p.path||browseDir+'/'+p.name);
      return '<div style="border:0.5px solid var(--bd);border-radius:5px;overflow:hidden;background:var(--sf2)">'
        +'<div style="font-size:.65rem;color:var(--dm);padding:.2rem .3rem;background:var(--sf);border-bottom:0.5px solid var(--bd)">'+p.name+'</div>'
        +'<img src="'+imgUrl+'" style="width:100%;display:block;cursor:pointer" '
        +'onclick="window.open(\''+imgUrl+'\',\'_blank\')" title="Click to open full size">'
        +'</div>';
    }).join('');
  }catch(e){
    if(grid)grid.innerHTML='<span style="font-size:.73rem;color:var(--rd)">Error loading plots: '+e.message+'</span>';
  }
}

function warpToggleTroubleshoot(){
  var body=$('warpTroubleBody'), chev=$('warpTroubleChev');
  if(!body)return;
  var open=body.style.display==='none';
  body.style.display=open?'':'none';
  if(chev)chev.style.transform=open?'rotate(0deg)':'rotate(-90deg)';
}

// ── Universal collapsible info card toggle ────────────────────────────────────
function icToggle(header){
  var isOpen=header.classList.toggle('open');
  var body=header.nextElementSibling;
  if(body&&body.classList.contains('ic-body'))
    body.style.display=isOpen?'block':'none';
}
function icInitAll(){
  document.querySelectorAll('.ic-h').forEach(function(h){
    var body=h.nextElementSibling;
    if(!body||!body.classList.contains('ic-body'))return;
    if(h.classList.contains('open')){
      body.style.display='block';
    } else {
      body.style.display='none';
    }
  });
}

function warpScrollTo(id){
  var el=document.getElementById(id);
  if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
}

function warp6Mode(mode){
  _warp6Mode=mode;
  document.getElementById('warp6_etomo').style.display   = mode==='etomo'   ? '' : 'none';
  document.getElementById('warp6_aretomo').style.display = mode==='aretomo' ? '' : 'none';
  var be=$('warp6_btn_etomo'), ba=$('warp6_btn_aretomo');
  if(be){be.style.background=mode==='etomo'?'rgba(56,189,248,.15)':'';
         be.style.color=mode==='etomo'?'#38bdf8':'';
         be.style.borderColor=mode==='etomo'?'rgba(56,189,248,.4)':'';}
  if(ba){ba.style.background=mode==='aretomo'?'rgba(56,189,248,.15)':'';
         ba.style.color=mode==='aretomo'?'#38bdf8':'';
         ba.style.borderColor=mode==='aretomo'?'rgba(56,189,248,.4)':'';}
  // Toggle JB link buttons for step 6
  var jbE=$('wp6_jb_etomo'), jbI=$('wp6_jb_import');
  if(jbE) jbE.style.display = mode==='etomo'   ? '' : 'none';
  if(jbI) jbI.style.display = mode==='aretomo' ? '' : 'none';
  warpBuildCmd(6);
}

function warpGet(id, fallback){
  var el=document.getElementById(id);
  return (el&&el.value.trim())||fallback||'';
}
function warpChecked(id){
  var el=document.getElementById(id); return el&&el.checked;
}

function warpBuildCmd(step){
  var wt = warpGet('warpCmd','WarpTools');
  // Extract just the WarpTools executable part
  var warpExe = wt || 'WarpTools';
  var cmd='';
  var fs_settings = 'warp_frameseries.settings';
  var ts_settings = 'warp_tiltseries.settings';

  if(step===1){
    var frames=warpGet('wp1_frames_dir','frames');
    var ext=warpGet('wp1_extension','*.tif');
    var apx=warpGet('wp1_angpix','');
    var exp=warpGet('wp1_exposure','');
    var gain=warpGet('wp1_gain_path','');
    var flipY=warpChecked('wp1_gain_flip_y');
    var flipX=warpChecked('wp1_gain_flip_x');
    var transpose=warpChecked('wp1_gain_transpose');
    var defects=warpGet('wp1_gain_defects','');
    cmd=warpExe+' create_settings \\\n'
      +'  --folder_data '+frames+' \\\n'
      +'  --folder_processing warp_frameseries \\\n'
      +'  --output '+fs_settings+' \\\n'
      +'  --extension "'+ext+'" \\\n'
      +(apx?'  --angpix '+apx+' \\\n':'')
      +(exp?'  --exposure '+exp+' \\\n':'')
      +(flipY?'  --gain_flip_y \\\n':'')
      +(flipX?'  --gain_flip_x \\\n':'')
      +(transpose?'  --gain_transpose \\\n':'')
      +(gain?'  --gain_path '+gain+(defects?' \\\n':''):'');
    if(defects) cmd+='  --gain_defects '+defects;
  }else if(step===2){
    var apx=warpGet('wp2_angpix','');
    var exp=warpGet('wp2_exposure','');
    var dims=warpGet('wp2_tomo_dims','');
    var gain=warpGet('wp2_gain_path','');
    var flipY=warpChecked('wp2_gain_flip_y');
    var flipX=warpChecked('wp2_gain_flip_x');
    var transpose=warpChecked('wp2_gain_transpose');
    var defects=warpGet('wp2_gain_defects','');
    cmd=warpExe+' create_settings \\\n'
      +'  --output '+ts_settings+' \\\n'
      +'  --folder_processing warp_tiltseries \\\n'
      +'  --folder_data tomostar \\\n'
      +'  --extension "*.tomostar" \\\n'
      +(apx?'  --angpix '+apx+' \\\n':'')
      +(exp?'  --exposure '+exp+' \\\n':'')
      +(flipY?'  --gain_flip_y \\\n':'')
      +(flipX?'  --gain_flip_x \\\n':'')
      +(transpose?'  --gain_transpose \\\n':'')
      +(gain?'  --gain_path '+gain+' \\\n':'')
      +(dims?'  --tomo_dimensions '+dims+(defects?' \\\n':''):'');
    if(defects) cmd+='  --gain_defects '+defects;
  }else if(step===3){
    var mg=warpGet('wp3_m_grid','1x1x8');
    var cg=warpGet('wp3_c_grid','2x2x1');
    var cr=warpGet('wp3_c_range_max','7');
    var dm=warpGet('wp3_c_defocus_max','8');
    cmd=warpExe+' fs_motion_and_ctf \\\n'
      +'  --settings '+fs_settings+' \\\n'
      +'  --m_grid '+mg+' \\\n'
      +'  --c_grid '+cg+' \\\n'
      +'  --c_range_max '+cr+' \\\n'
      +'  --c_defocus_max '+dm+' \\\n'
      +'  --c_use_sum \\\n'
      +'  --out_averages \\\n'
      +'  --out_average_halves';
  }else if(step===4){
    cmd=warpExe+' filter_quality --settings '+fs_settings+' --histograms';
    var el=$('wp4_cmd'); if(el)el.textContent=cmd; return;
  }else if(step===5){
    var md=warpGet('wp5_mdocs_dir','mdocs');
    var te=warpGet('wp5_tilt_exposure','');
    var mi=warpGet('wp5_min_intensity','0.3');
    cmd=warpExe+' ts_import \\\n'
      +'  --mdocs '+md+' \\\n'
      +'  --frameseries warp_frameseries \\\n'
      +(te?'  --tilt_exposure '+te+' \\\n':'')
      +'  --min_intensity '+mi+' \\\n'
      +'  --dont_invert \\\n'
      +'  --output tomostar';
  }else if(step===6){
    if(_warp6Mode==='etomo'){
      var apx=warpGet('wp6e_angpix','');
      var ps=warpGet('wp6e_patch_size','2000');
      var ia=warpGet('wp6e_initial_axis','85');
      cmd=warpExe+' ts_etomo_patches \\\n'
        +'  --settings '+ts_settings+' \\\n'
        +(apx?'  --angpix '+apx+' \\\n':'')
        +'  --patch_size '+ps+' \\\n'
        +'  --initial_axis '+ia;
    }else{
      var ad=warpGet('wp6a_alignments_dir','');
      var aa=warpGet('wp6a_alignment_angpix','');
      var mf=warpGet('wp6a_min_fov','0');
      cmd=warpExe+' ts_import_alignments \\\n'
        +'  --settings '+ts_settings+' \\\n'
        +(ad?'  --alignments '+ad+' \\\n':'')
        +(aa?'  --alignment_angpix '+aa+' \\\n':'')
        +'  --min_fov '+mf;
    }
  }else if(step===7){
    cmd=warpExe+' ts_defocus_hand --settings '+ts_settings+' --set_auto';
    var el=$('wp7_cmd'); if(el)el.textContent=cmd; return;
  }else if(step===8){
    var rh=warpGet('wp8_range_high','7');
    var dm=warpGet('wp8_defocus_max','8');
    cmd=warpExe+' ts_ctf \\\n'
      +'  --settings '+ts_settings+' \\\n'
      +'  --range_high '+rh+' \\\n'
      +'  --defocus_max '+dm;
  }else if(step===9){
    var apx=warpGet('wp9_angpix','');
    var halfmap=warpChecked('wp9_halfmap_frames');
    cmd=warpExe+' ts_reconstruct \\\n'
      +'  --settings '+ts_settings+' \\\n'
      +(apx?'  --angpix '+apx+' \\\n':'')
      +(halfmap?'  --halfmap_frames':'').trimEnd();
  }
  var el=$('wp'+step+'_cmd'); if(el)el.textContent=cmd;
}

function warpRebuildAll(){
  for(var i=1;i<=9;i++) warpBuildCmd(i);
  // Fix static steps 4 and 7
  var wt=warpGet('warpCmd','WarpTools');
  var el4=$('wp4_cmd');
  if(el4)el4.textContent=wt+' filter_quality --settings warp_frameseries.settings --histograms';
  var el7=$('wp7_cmd');
  if(el7)el7.textContent=wt+' ts_defocus_hand --settings warp_tiltseries.settings --set_auto';
}

function warpSaveEnv(){
  // Persist env to project config
  if(!curProj)return;
  var warpCmd=warpGet('warpCmd','');
  var workDir=warpGet('warpWorkDir','');
  post('/api/projects/'+curProj+'/config',{prog_cmd_warptools:warpCmd,warptools_dir:workDir}).catch(()=>{});
  warpRebuildAll();
}

async function warpCheckEnv(){
  var note=$('warpEnvNote'); var badge=$('warpEnvBadge');
  if(note)note.textContent='Checking…';
  var wt=warpGet('warpCmd','WarpTools');
  try{
    var r=await post('/api/scripts/run',{
      command:wt+' --version',
      working_dir:warpGet('warpWorkDir','.'),
      project:curProj||''
    });
    var ok=r.exit_code===0;
    var verLine=((r.output||r.stdout_text||'').split('\n')[0]||'').trim();
    if(note)note.textContent=ok?'✓ Found: '+verLine:'✖ Not found — check module load command';
    if(note)note.style.color=ok?'var(--gn)':'var(--rd)';
    if(badge){badge.textContent=ok?'✓':'✖';badge.className='badge '+(ok?'ok':'err');}
    // Check for dev37+ breaking changes
    var warn=$('warpVersionWarning');
    if(warn&&ok){
      var devMatch=verLine.match(/dev(\d+)/i);
      var devNum=devMatch?parseInt(devMatch[1]):0;
      var isNew=devNum>=37;
      warn.style.display=isNew?'':'none';
    }
  }catch(e){
    if(note){note.textContent='Error: '+e.message;note.style.color='var(--rd)';}
  }
}

async function warpRun(step){
  if(!curProj){alert('No project selected.');return;}
  var cmdEl=$('wp'+step+'_cmd');
  var statEl=$('wp'+step+'_status');
  if(!cmdEl||!cmdEl.textContent.trim()){
    if(statEl)statEl.textContent='Fill required fields first.'; return;
  }
  var cmd=cmdEl.textContent.replace(/\\\s*\n\s*/g,' ').replace(/\n+/g,' ').trim();
  if(statEl){statEl.textContent='Running…';statEl.style.color='var(--dm)';}

  // Set pipeline step badge to running
  var stepBadge=$('wps-'+step);
  if(stepBadge){stepBadge.classList.add('running');stepBadge.classList.remove('done');}

  try{
    var cfg=await api('/api/projects/'+curProj+'/config');
    var workDir=(cfg&&cfg.warptools_dir)||cfg.project_dir||'.';
    var env={WARP_FORCE_MRC_FLOAT32:'1',WARP_DEBUG:'1'};
    var r=await post('/api/scripts/run',{command:cmd,working_dir:workDir,project:curProj,env:env});
    var ok=r.exit_code===0;
    if(statEl){
      statEl.textContent=ok?'✓ Done':'✖ Error (exit '+r.exit_code+')';
      statEl.style.color=ok?'var(--gn)':'var(--rd)';
    }
    if(stepBadge){stepBadge.classList.remove('running');if(ok)stepBadge.classList.add('done');}
    // Auto-load histograms after step 4
    if(step===4&&ok)setTimeout(warpLoadHistograms,800);
    // Refresh status badges
    setTimeout(warpRefreshStatus,500);
  }catch(e){
    if(statEl){statEl.textContent='Error: '+e.message;statEl.style.color='var(--rd)';}
    if(stepBadge)stepBadge.classList.remove('running');
  }
}

async function warpRefreshStatus(){
  if(!curProj)return;
  try{
    var s=await api('/api/projects/'+curProj+'/warp/status');
    var map={
      1:s.create_settings_fs, 2:s.create_settings_ts,
      3:s.fs_motion_ctf,      4:s.filter_quality,
      5:s.ts_import,          6:s.ts_align,
      7:s.ts_defocus_hand,    8:s.ts_ctf,
      9:s.ts_reconstruct
    };
    for(var i=1;i<=9;i++){
      var pb=$('wps-'+i), sb=$('wss-'+i);
      var done=map[i];
      if(pb){pb.classList.toggle('done',!!done);pb.classList.remove('running');}
      if(sb){
        sb.textContent=done?'✓ Done':'';
        sb.className='badge '+(done?'ok':'');
      }
    }
    // Tomo count info
    if(s.tomostar_count>0){
      var el=$('wss-5');
      if(el)el.textContent='✓ '+s.tomostar_count+' tomostar';
    }
    if(s.recon_count>0){
      var el=$('wss-9');
      if(el)el.textContent='✓ '+s.recon_count+' tomos';
    }
  }catch(e){}
}

async function warpAutoFill(){
  if(!curProj)return;
  try{
    var c=await api('/api/projects/'+curProj+'/config');
    // Fill warptools command from setup
    var wc=$('warpCmd');
    if(wc&&!wc.value&&c.prog_cmd_warptools)wc.value=c.prog_cmd_warptools;
    // Fill working dir from warptools_dir config
    var wd=$('warpWorkDir');
    if(wd&&!wd.value){
      if(c.warptools_dir) wd.value=c.warptools_dir;
    }
    // Update settings path display (derived from warptools_dir)
    if(c.warptools_dir){
      var _wd = c.warptools_dir.replace(/\/+$/, '');
      var fsEl = document.getElementById('tWarpFsSettings');
      var tsEl = document.getElementById('tWarpTsSettings');
      if(fsEl) fsEl.textContent = _wd + '/warp_frameseries.settings';
      if(tsEl) tsEl.textContent = _wd + '/warp_tiltseries.settings';
    }

    // ── RAW pixel size → create_settings steps (fs + ts) ──
    // WarpTools create_settings --angpix = raw detector pixel size
    var rawApx = c.raw_pixel_size || '';
    ['wp1_angpix','wp2_angpix'].forEach(function(id){
      var el=document.getElementById(id); if(el&&!el.value&&rawApx)el.value=rawApx;
    });

    // ── BINNED pixel size → alignment/reconstruction steps ──
    // ts_etomo, ts_reconstruct, ts_import_alignments --angpix = raw × binning
    var binnedApx = c.bin_pixel_size ||
      (c.raw_pixel_size && c.binning_factor ?
        parseFloat((c.raw_pixel_size * c.binning_factor).toFixed(4)) : 0) || '';
    ['wp6e_angpix','wp6a_alignment_angpix','wp9_angpix'].forEach(function(id){
      var el=document.getElementById(id); if(el&&!el.value&&binnedApx)el.value=binnedApx;
    });

    // ── Tilt exposure (dose per tilt e⁻/Å²) ──
    // warp_tilt_exposure = dose_per_tilt from Tomo tab
    console.log('[DEBUG warpFillParams] c.warp_tilt_exposure=', c.warp_tilt_exposure);
    console.log('[DEBUG warpFillParams] c.dose_per_tilt=', c.dose_per_tilt);
    console.log('[DEBUG warpFillParams] c.total_dose=', c.total_dose, 'c.n_tilts=', c.n_tilts);
    var tiltExp = c.warp_tilt_exposure || c.dose_per_tilt ||
      (c.total_dose && c.n_tilts ? parseFloat((c.total_dose/c.n_tilts).toFixed(4)) : 0) || '';
    console.log('[DEBUG warpFillParams] tiltExp calculated=', tiltExp);
    if(tiltExp){
      ['wp1_exposure','wp2_exposure','wp5_tilt_exposure'].forEach(function(id){
        var el=document.getElementById(id);
        console.log('[DEBUG warpFillParams] Filling', id, 'el=', el, 'current value=', el?el.value:'N/A');
        if(el&&!el.value)el.value=tiltExp;
      });
    }

    // ── Motion grid (m_grid = 1x1xN where N = frames_per_tilt) ──
    // warp_m_grid is always "1x1x{frames_per_tilt}" — set from Tomo tab
    var mGrid = c.warp_m_grid ||
      (c.frames_per_tilt > 0 ? '1x1x'+c.frames_per_tilt : '');
    if(mGrid){
      var mgEl = document.getElementById('wp3_m_grid');
      if(mgEl && !mgEl.value) mgEl.value = mGrid;
      // Also fill n_frames field so warpBuildMGrid() computes correctly
      var nFrames = mGrid.split('x').pop();
      var nfEl = document.getElementById('wp3_n_frames');
      if(nfEl && !nfEl.value && nFrames) nfEl.value = nFrames;
    }

    // ── CTF grid ──
    if(c.warp_c_grid){
      var cgEl = document.getElementById('wp3_c_grid');
      if(cgEl && !cgEl.value) cgEl.value = c.warp_c_grid;
    }

    // ── Patch size, initial axis ──
    if(c.warp_patch_size){
      var psEl = document.getElementById('wp3_patch_size');
      if(psEl && !psEl.value) psEl.value = c.warp_patch_size;
    }
    if(c.warp_initial_axis){
      var iaEl = document.getElementById('wp6e_initial_axis');
      if(iaEl && !iaEl.value) iaEl.value = c.warp_initial_axis;
    }

    // ── Gain path ──
    if(c.warp_gain_path){
      ['wp1_gain_path','wp2_gain_path'].forEach(function(id){
        var el=document.getElementById(id); if(el&&!el.value)el.value=c.warp_gain_path;
      });
    }

    // ── Tomo dims for create_settings ts ──
    console.log('[DEBUG warpFillParams] c.warp_tomo_dimensions=', c.warp_tomo_dimensions);
    console.log('[DEBUG warpFillParams] c.tomo_dims=', c.tomo_dims);
    if(c.warp_tomo_dimensions){
      var td=$('wp2_tomo_dims');
      console.log('[DEBUG warpFillParams] Using warp_tomo_dimensions, td=', td);
      if(td&&!td.value)td.value=c.warp_tomo_dimensions;
    }else if(c.tomo_dims&&c.tomo_dims.length>=2&&c.tomo_dims[0]>0){
      var td=$('wp2_tomo_dims');
      // Keep all dimensions including Z=0 (user must set manually)
      var dimsStr = c.tomo_dims.join('x');
      console.log('[DEBUG warpFillParams] Building from tomo_dims, result=', dimsStr, 'td=', td);
      if(td&&!td.value) td.value=dimsStr;
    }

    warpRebuildAll();
    warpRefreshStatus();
  }catch(e){}
}

function relionAll(){relionBuildWorkflow();relionCalcT();relionCalcCrowther();relionCalcK();}

// ── Pill toggle label sync — exclusive (radio-group behaviour) ──
function warpPillUpdate(step, axis){
  var all={y:['gain_flip_y','flipy_lbl'], x:['gain_flip_x','flipx_lbl'], t:['gain_transpose','transp_lbl']};
  var pair=all[axis]; if(!pair) return;
  var cb=document.getElementById('wp'+step+'_'+pair[0]);
  if(!cb) return;
  // If turning ON: turn all others off (exclusive)
  if(cb.checked){
    Object.keys(all).forEach(function(a){
      if(a===axis) return;
      var other=document.getElementById('wp'+step+'_'+all[a][0]);
      var otherLbl=document.getElementById('wp'+step+'_'+all[a][1]);
      if(other){ other.checked=false; }
      if(otherLbl){ otherLbl.className='pill-name'; }
    });
  }
  // Update label for toggled axis
  var lbl=document.getElementById('wp'+step+'_'+pair[1]);
  if(lbl) lbl.className='pill-name'+(cb.checked?' on':'');
  warpBuildCmd(step);
}

// ── File picker for gain/defect path inputs ──
var _wfpTarget=null;
async function warpFilePicker(inputId, step){
  _wfpTarget=inputId;
  var inp=document.getElementById(inputId);
  var cur=(inp&&inp.value)?inp.value.replace(/[^/]*$/,''):'.';
  try{ var h=await api('/api/health'); if(h.workspace) cur=h.workspace; }catch(e){}
  warpFilePickerRender(cur, inputId);
}

async function warpFilePickerRender(dirPath, inputId){
  var old=document.getElementById('wfpOverlay'); if(old) old.remove();
  var inp=document.getElementById(inputId); if(!inp) return;

  var overlay=document.createElement('div');
  overlay.id='wfpOverlay';
  var _inp2=document.getElementById(inputId);
  var _rect=_inp2?_inp2.getBoundingClientRect():{left:100,bottom:100};
  overlay.style.cssText='position:fixed;z-index:3000;background:var(--sf);'
    +'border:0.5px solid var(--bd);border-radius:7px;min-width:280px;max-width:360px;'
    +'overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.18);'
    +'left:'+Math.min(_rect.left, window.innerWidth-300)+'px;'
    +'top:'+(_rect.bottom+4)+'px';

  var hdr=document.createElement('div');
  hdr.style.cssText='display:flex;align-items:center;gap:.4rem;padding:.35rem .5rem;'
    +'border-bottom:0.5px solid var(--bd);background:var(--bg)';
  var closeX='\u00d7';
  hdr.innerHTML='<span style="font-size:.7rem;color:var(--dm);font-family:monospace;flex:1;overflow:hidden;'
    +'text-overflow:ellipsis;white-space:nowrap" id="wfpPathLbl">'+dirPath+'</span>'
    +'<button id="wfpCloseBtn" style="all:unset;cursor:pointer;color:var(--dm);font-size:.85rem;padding:0 .2rem">'+closeX+'</button>';
  overlay.appendChild(hdr);

  var list=document.createElement('div');
  list.id='wfpList';
  list.style.cssText='max-height:220px;overflow-y:auto';
  list.innerHTML='<div style="padding:.5rem;font-size:.75rem;color:var(--dm)">Loading\u2026</div>';
  overlay.appendChild(list);

  document.body.appendChild(overlay);

  hdr.querySelector('#wfpCloseBtn').onclick=function(){overlay.remove();};

  try{
    var d=await api('/api/files/browse_free?path='+encodeURIComponent(dirPath));
    var items=(d.items||[]).sort(function(a,b){
      if(a.is_dir&&!b.is_dir)return -1; if(!a.is_dir&&b.is_dir)return 1;
      return a.name.localeCompare(b.name);
    }).filter(function(i){
      return i.is_dir||/\.(mrc|txt|dm4|tif|tiff|eer)$/i.test(i.name);
    });

    list.innerHTML='';
    if(dirPath!=='/'&&dirPath.length>1){
      var upEl=_wfpRow('\u2191 ..', true);
      var par=dirPath.replace(/\/?[^/]+\/?$/,'/')||'/';
      upEl.onclick=function(){warpFilePickerRender(par, _wfpTarget);};
      list.appendChild(upEl);
    }
    items.forEach(function(item){
      var row=_wfpRow(item.name, item.is_dir);
      if(item.is_dir){
        var sub=dirPath.replace(/\/$/,'')+'/'+item.name+'/';
        row.onclick=function(){warpFilePickerRender(sub, _wfpTarget);};
      } else {
        var full=dirPath.replace(/\/$/,'')+'/'+item.name;
        row.onclick=function(){
          var ti=document.getElementById(_wfpTarget);
          if(ti){ti.value=full;}
          overlay.remove();
          try{warpBuildCmd(parseInt((_wfpTarget||'1').replace(/[^0-9]/g,''))||1);}catch(e){}
        };
      }
      list.appendChild(row);
    });
    if(!items.length) list.innerHTML='<div style="padding:.5rem;font-size:.75rem;color:var(--dm)">No files here</div>';
  }catch(e){
    list.innerHTML='<div style="padding:.5rem;font-size:.75rem;color:var(--rd)">'+e.message+'</div>';
  }
}

function _wfpRow(name, isDir){
  var row=document.createElement('div');
  row.style.cssText='display:flex;align-items:center;gap:.45rem;padding:.3rem .5rem;font-size:.76rem;'
    +'cursor:pointer;border-bottom:0.5px solid rgba(0,0,0,.04)';
  row.onmouseover=function(){this.style.background='var(--sf2)';};
  row.onmouseout=function(){this.style.background='';};
  var icon=isDir
    ?'<span style="color:var(--yl);font-size:.8rem">\u25b6</span>'
    :'<span style="color:var(--ac);font-size:.8rem">\u25cf</span>';
  row.innerHTML=icon+'<span>'+name+'</span>';
  return row;
}

document.addEventListener('click',function(e){
  var ov=document.getElementById('wfpOverlay');
  if(ov&&!ov.contains(e.target)&&!e.target.classList.contains('file-browse-btn'))ov.remove();
},true);