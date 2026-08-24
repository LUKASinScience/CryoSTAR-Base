/* CryoSTAR-Base — templates.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ── Templates ──
async function loadTpl(){
  try{
    const d=await api('/api/templates');
    _tplCache=d;
    const catMap={};
    (d.categories||[]).forEach(c=>{catMap[c.id]={...c,items:[]}});
    (d.templates||[]).forEach(t=>{const cid=t.category||'other';if(!catMap[cid])catMap[cid]={id:cid,name:cid,color:'#888',order:99,items:[]};catMap[cid].items.push(t)});
    const sorted=Object.values(catMap).filter(c=>c.items.length).sort((a,b)=>{
      const ia=CAT_ORDER.indexOf(a.id),ib=CAT_ORDER.indexOf(b.id);
      if(ia!==-1&&ib!==-1)return ia-ib;if(ia!==-1)return -1;if(ib!==-1)return 1;
      return Number(a.order||99)-Number(b.order||99);
    });
    _renderTplList(sorted,'');
  }catch(e){$('tplList').innerHTML=`<div class="dim" style="padding:.4rem">${e.message}</div>`}
}
// Project config auto-fill map: template parameter key → config field
const TPL_AUTOFILL = {
  voxel_size: 'pytom_voxel_size', // PyTom voxel_size = bin_pixel_size rounded to 2dp (matches WarpTools MRC header)
  pixel_size: 'pytom_voxel_size', // ang_to_pix --pixel_size same 2dp value
  box_size: 'box_size', diameter: 'particle_diameter', radius: 'mask_radius',
  symmetry: 'symmetry', voltage: 'voltage', cs: 'spherical_aberration',
  amp: 'amplitude_contrast', amplitude_contrast: 'amplitude_contrast',
  x: 'tomo_x', y: 'tomo_y', z: 'tomo_z', suffix: 'tomo_suffix',
  tomo_dimensions: 'tomo_dims_str',   // combined XxYxZ for --tomo_dimensions
  // WarpTools directory — pre-fills source dir for copy_xmls and similar
  source: 'warptools_tiltseries_dir',
  // Alignment + bad tilt removal prefills
  mdocs_dir:     'mdocs_pretilt_dir',      // ts_import: prefer pretilt-corrected MDOCs if set
  alignments_dir:'warptools_tiltstack_dir', // ts_import_alignments: tiltstack/ from ts_etomo_patches
  tiltstack_dir: 'warptools_tiltstack_dir', // warp_remove_skipped: where taSolution.log lives
  xml_dir:       'warptools_tiltseries_dir',// warp_remove_skipped + extract_xml: warp_tiltseries/
  warptools_dir: 'warptools_dir',
  settings: 'warptools_settings',
  tomo_name: 'tomo_name',
  // Backup Warp XMLs — prefill: source_dir = warptools_dir/warp_tiltseries, dest = warptools_dir
  source_dir: 'warptools_tiltseries_dir',
  dest_dir: 'warptools_tiltseries_dir',
  // RELION module — prefill from project Setup
  relion_module: 'relion_module',
  // RELION Class3D — auto-fill from project
  sym: 'symmetry',
  T: 'relion_T_default',
  K: 'relion_K_suggested',
  healpix_order: 'relion_healpix_order',
  offset_range: 'relion_offset_range',
  relion_dir: 'relion_dir_suggested',
  input_star: 'relion_input_star',
  // Particle diameter → prefills WarpTools export + all RELION mask_diameter fields
  mask_diameter: 'particle_diameter',
  // AreTomo3 jobs
  aretomo3_cmd:      'aretomo3_binary',    // programs.aretomo3.binary
  pixel_size:        'raw_pixel_size',     // raw pixel size (AreTomo3 uses raw)
  atbin:             'binning_factor',     // reconstruction binning
  kv:                'voltage',
  raw_data_dir:      'aretomo3_raw_dir',   // preprocessing_root/aretomo3/raw_data_frames

  // WarpTools jobs — derived fields from Tomo tab
  // CRITICAL: separate raw vs binned pixel size
  angpix_raw:        'raw_pixel_size',     // RAW px — for create_settings --angpix
  angpix:            'bin_pixel_size',     // BINNED px — for ts_etomo, ts_reconstruct, ts_import_alignments --angpix
  alignment_angpix:  'bin_pixel_size',     // same as angpix
  tilt_exposure:     'dose_per_tilt',      // dose_per_tilt → ts_import --tilt_exposure
  exposure:          'dose_per_tilt',      // dose_per_tilt → create_settings --exposure
  m_grid:            'warp_m_grid',        // 1x1xN → fs_motion_and_ctf --m_grid
  c_grid:            'warp_c_grid',        // CTF grid
  patch_size:        'warp_patch_size',    // ts_etomo --patch_size
  initial_axis:      'warp_initial_axis',  // ts_etomo --initial_axis
  c_range_max:       'warp_c_range_max',
  c_defocus_max:     'warp_c_defocus_max',
  min_intensity:     'warp_min_intensity',
  range_high:        'warp_c_range_max',   // ts_ctf --range_high

  // Miss Alignment — shapes from tomo dims
  stack_x:           'tomo_x',             // tomo X dimension
  stack_y:           'tomo_y',
  vol_x:             'tomo_x',
  vol_y:             'tomo_y',
  vol_z:             'tomo_z',

  // Inspect Data — selection file from saved selection
  selection_file:    'selection_file',     // path to selected_stacks.txt
  // Preliminary Processing (IMOD + Hamid Rahmani)
  imod_dir:          'imod_dir',
  mdocs_pretilt_dir: 'mdocs_pretilt_dir',
  pretilt_angle:     'pretilt_angle',
  pretilt_angle_neg: 'pretilt_angle_neg', // negated: user enters 9 → script gets -9
  // PyTom — derived paths from warptools_dir
  pytom_tomo_dir:    'pytom_tomo_dir',     // warptools_dir/warp_tiltseries/reconstruction
  input_dir:         'pytom_tomo_dir',     // slabify: reconstruction dir
  output_dir:        'pytom_slabified_dir',// slabify: mask output dir
  pytom_xml_dir:       'pytom_xml_dir',        // project_dir/_pytom/xml
  bad_tilts_json:      'bad_tilts_json_path',  // project_dir/inspect_bad_tilts.json
  pytom_results_dir:   'pytom_results_dir',    // project_dir/_pytom/results
  pytom_slabified_dir: 'pytom_slabified_dir',  // project_dir/_pytom/slabified
  // PyTom job parameter keys (job uses these keys, not the pytom_* prefixed keys above)
  tomo_dir:          'pytom_tomo_dir',     // tm_batch/tm_single --tomo-dir
  xml_dir:           'pytom_xml_dir',      // tm_batch/extract_warp_xml --xml-dir
  results_dir:       'pytom_results_dir',  // tm_batch/extract_batch --results-dir
  tomo_mask_dir:     'pytom_slabified_dir',// tm_batch/extract_batch --tomo-mask-dir
  // PyTom — physics from project (symmetry, voltage, cs, amp already in lines above)
  bin_pixel_size:       'bin_pixel_size',
  particle_diameter:    'particle_diameter',
  tomo_suffix:          'tomo_suffix',
  spherical_aberration: 'spherical_aberration',
  amplitude_contrast:   'amplitude_contrast',
  // Computing — SLURM
  compute_gpus:            'compute_gpus',
  device_list:             'compute_gpus',   // WarpTools GPU jobs → from Computing tab
  compute_slurm_partition: 'compute_slurm_partition',
  compute_slurm_time:      'compute_slurm_time',
  compute_slurm_mem:       'compute_slurm_mem',
};

async function selTpl(id){
  if(id===null){
    var tl=document.getElementById('tplList');
    if(tl)tl.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  try{
    const d=await api('/api/templates');
    curTpl=(d.templates||[]).find(function(t){return t.id===id;});
    if(!curTpl)return;
    $('parP').style.display='';
    $('parT').children[0]&&($('parT').children[0].textContent=curTpl.name);if(!$('parT').children[0])$('parT').textContent=curTpl.name;
    // Reset title field when selecting new job type
    var _jbT=document.getElementById('jbCustomTitle');if(_jbT)_jbT.value='';jbTitlePreview('');
    const _ph=$('jobPlaceholder');if(_ph)_ph.style.display='none';
    // Show next job ID preview
    if(curProj){
      api('/api/projects/'+curProj+'/next_job_id').then(function(r){
        var el=document.getElementById('jbNextJobId');
        if(el) el.textContent=r.next_job_id||'';
      }).catch(function(){});
    }

    // Fetch project config for prefill
    var cfg={};
    if(curProj){
      try{
        const pc=await api('/api/projects/'+curProj+'/config');
        cfg=pc;
        if(cfg.tomo_dims&&cfg.tomo_dims.length>=2){
          cfg.tomo_x=cfg.tomo_dims[0];cfg.tomo_y=cfg.tomo_dims[1];
          if(cfg.tomo_dims.length>=3) cfg.tomo_z=cfg.tomo_dims[2];
        }
        if(cfg.tomo_x&&cfg.tomo_y){
          cfg.tomo_dims_str=cfg.tomo_x+'x'+cfg.tomo_y+(cfg.tomo_z?'x'+cfg.tomo_z:'');
        }
        // Compute warp_tiltseries subdir for auto-fill
        if(cfg.warptools_dir){
          var _wd = cfg.warptools_dir.replace(/\/+$/, '');
          cfg.warptools_tiltseries_dir = _wd + '/warp_tiltseries';
          cfg.warptools_tiltstack_dir  = _wd + '/warp_tiltseries/tiltstack';
          // Settings filenames only — no full path needed because cd runs in warptools_dir
          cfg.warptools_fs_settings = 'warp_frameseries.settings';
          cfg.warptools_ts_settings = 'warp_tiltseries.settings';
        }
        // Store for WarpTools header box
        window._jbWarpToolsDir = cfg.warptools_dir || '';
        // Override warptools_settings per job type so all jobs get the correct settings file
        var _fsJobs = ['warp_fs_motion_ctf', 'warp_filter_quality', 'warp_create_settings_fs'];
        var _tsJobs = ['warp_ts_etomo', 'warp_ts_etomo_patches', 'warp_ts_import_alignments',
                       'warp_ts_defocus_hand', 'warp_ts_ctf', 'warp_ts_reconstruct',
                       'warp_create_settings_ts', 'warp_ts_export_particles'];
        if(curTpl && curTpl.id && _fsJobs.indexOf(curTpl.id) >= 0){
          cfg.warptools_settings = cfg.warptools_fs_settings || 'warp_frameseries.settings';
        } else if(curTpl && curTpl.id && _tsJobs.indexOf(curTpl.id) >= 0){
          cfg.warptools_settings = cfg.warptools_ts_settings || 'warp_tiltseries.settings';
        }
        // RELION smart defaults from project config
        cfg.relion_T_default='0.5';
        cfg.relion_offset_range='2';
        // K and healpix will be overridden by STAR analysis if triggered

        // pixel_size (binned) = raw_pixel_size × binning_factor — used by WarpTools jobs
        if(cfg.raw_pixel_size && cfg.binning_factor){
          cfg.bin_pixel_size = parseFloat((cfg.raw_pixel_size * cfg.binning_factor).toFixed(4));
        }

        // tomo_x/y/z from tomo_dims array
        if(cfg.tomo_dims && cfg.tomo_dims.length >= 2){
          cfg.tomo_x = cfg.tomo_dims[0];
          cfg.tomo_y = cfg.tomo_dims[1];
          if(cfg.tomo_dims.length >= 3) cfg.tomo_z = cfg.tomo_dims[2];
        }
        // Combined XxYxZ string for --tomo_dimensions parameter
        if(cfg.tomo_x && cfg.tomo_y){
          cfg.tomo_dims_str = cfg.tomo_x + 'x' + cfg.tomo_y + (cfg.tomo_z ? 'x' + cfg.tomo_z : '');
        }

        // AreTomo3 binary — from programs.aretomo3.binary (new field) or source_script fallback
        if(cfg.programs && cfg.programs.aretomo3){
          var _at3 = cfg.programs.aretomo3;
          cfg.aretomo3_binary = (_at3.binary||'').trim()
            || (_at3.source_script||'').trim()
            || (_at3.extra && _at3.extra.binary ? _at3.extra.binary.trim() : '')
            || '';
        }

        // AreTomo3 raw data dir — preprocessing_root/aretomo3/raw_data_frames
        if(cfg.warptools_dir){
          var _preprocRoot = cfg.warptools_dir.replace(/\/warptools\/?$/, '').replace(/\/+$/, '');
          cfg.aretomo3_raw_dir = _preprocRoot + '/aretomo3/raw_data_frames';
          // PyTom derived dirs
          cfg.pytom_tomo_dir = cfg.warptools_dir.replace(/\/+$/,'') + '/warp_tiltseries/reconstruction';
        }
        // pytom dirs derived from project_dir
        if(cfg.project_dir){
          var _pd = cfg.project_dir.replace(/\/+$/,'');
          cfg.pytom_xml_dir       = _pd + '/_pytom/xml';
          cfg.pytom_results_dir   = _pd + '/_pytom/results';
          cfg.pytom_slabified_dir = _pd + '/_pytom/slabified';
          cfg.bad_tilts_json_path = _pd + '/inspect_bad_tilts.json';
        }
        // pretilt_angle_neg: negated value for pretilt_mdocs script
        // User enters 9 (for 9° lamella) → script receives -9 → TiltAngle - (-9) = TiltAngle + 9
        // User enters -11 → script receives 11 → TiltAngle - 11 (correct for negative pretilt)
        if(cfg.pretilt_angle !== undefined && cfg.pretilt_angle !== 0){
          cfg.pretilt_angle_neg = -(cfg.pretilt_angle);
        }
        // tomo_suffix always derived from bin_pixel_size (WarpTools: 2 decimal places)
        // pytom_voxel_size: 2dp to match WarpTools MRC header (avoids voxel size mismatch warning)
        if(cfg.bin_pixel_size){
          cfg.tomo_suffix      = '_' + parseFloat(cfg.bin_pixel_size).toFixed(2) + 'Apx';
          cfg.pytom_voxel_size = parseFloat(parseFloat(cfg.bin_pixel_size).toFixed(2));
        }
      }catch(e){}
    }

    // Fetch completed jobs for "from previous job" selectors
    var jobsByType={};
    if(curProj){
      try{
        const jd=await api('/api/projects/'+curProj+'/jobs');
        (jd.jobs||[]).forEach(function(j){
          if(!jobsByType[j.job_type])jobsByType[j.job_type]=[];
          jobsByType[j.job_type].push(j);
        });
      }catch(e){}
    }

    // Build form HTML (inputs only, buttons injected via DOM after)
    window._tplJobBtns={};
    var formHtml='';

    // ── WarpTools / Import directory header box ──
    var isWarpJob = curTpl && curTpl.category && curTpl.category.startsWith('warp_');
    var _isImportJob = curTpl && curTpl.category === 'import';
    var _preprocRootDisp = (window._jbWarpToolsDir||'').replace(/\/warptools\/?$/, '').replace(/\/+$/, '');
    // Override default mode for import jobs based on active browse root
    // Server mode → hardlink preferred; local mode → symlink preferred
    if(_isImportJob && curTpl && curTpl.parameters){
      var _serverMode = window._activeBrowseRoot === 'server';
      curTpl.parameters.forEach(function(p){
        if(p.key === 'mode' && p.type === 'pill_toggle'){
          if(_serverMode && p.options && p.options.indexOf('hardlink') >= 0){
            p.default = 'hardlink';
          } else if(!_serverMode && p.options && p.options.indexOf('symlink') >= 0){
            p.default = 'symlink';
          }
        }
      });
    }

    // Show preprocessing root for import jobs
    if(_isImportJob && _preprocRootDisp){
      formHtml += '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem;'
        +'padding:.35rem .55rem;border-radius:7px;background:rgba(245,158,11,.06);'
        +'border:1px solid rgba(245,158,11,.25)">'
        +'<span style="font-size:.82rem;flex-shrink:0">📁</span>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;'
        +'color:var(--yl,#f8a600);margin-bottom:.1rem">Preprocessing directory</div>'
        +'<div style="font-size:.75rem;font-family:monospace;color:var(--tx);word-break:break-all">'+_preprocRootDisp+'</div>'
        +'<div style="font-size:.65rem;color:var(--dm);margin-top:.1rem">Dest paths are relative to this directory</div>'
        +'</div></div>';
    } else if(_isImportJob){
      formHtml += '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem;'
        +'padding:.35rem .55rem;border-radius:7px;background:rgba(248,166,0,.07);'
        +'border:1px solid rgba(248,166,0,.35)">'
        +'<span style="font-size:.82rem">⚠</span>'
        +'<div style="font-size:.75rem;color:var(--dm)">No WarpTools directory set — '
        +'set it in the <strong>Pre-Processing</strong> tab to resolve import paths correctly.</div>'
        +'</div>';
    }

    if(isWarpJob){
      var warpDir = window._jbWarpToolsDir || '';
      var warpOk  = warpDir && warpDir.trim();
      formHtml += '<div id="jbWarpDirBox" style="display:flex;align-items:center;gap:.5rem;'
        +'margin-bottom:.6rem;padding:.35rem .55rem;border-radius:7px;'
        +'background:'+(warpOk?'rgba(63,185,80,.06)':'rgba(248,166,0,.07)')+';'
        +'border:1px solid '+(warpOk?'rgba(63,185,80,.25)':'rgba(248,166,0,.35)')+'">'
        +'<span style="font-size:.82rem;flex-shrink:0">'+(warpOk?'✓':'⚠')+'</span>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;'
        +'color:'+(warpOk?'var(--gn)':'var(--yl,#f8a600)')+';margin-bottom:.1rem">WarpTools directory</div>'
        +'<input id="jbWarpDirInput" type="text" value="'+(warpDir)+'"'
        +' placeholder="Not set — browse or set in Preprocessing tab"'
        +' oninput="jbWarpDirChanged()"'
        +' style="width:100%;background:transparent;border:none;border-bottom:1px solid var(--bd);'
        +'color:var(--tx);font-size:.77rem;font-family:monospace;padding:.1rem 0;outline:none">'
        +'</div>'
        +'<button class="file-browse-btn" title="Browse for WarpTools directory" tabindex="-1" type="button"'
        +' onclick="openRightPanel();jbFilePicker(this.dataset.target)" data-target="jbWarpDirInput">'
        +'<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"'
        +' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        +'<path d="M2 4.5A1.5 1.5 0 013.5 3h3.086L8 4.414H12.5A1.5 1.5 0 0114 5.914V12'
        +'a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12V4.5z"/></svg>'
        +'</button>'
        +'</div>';
    }
    (curTpl.parameters||[]).forEach(function(p){
      var cfgKey=TPL_AUTOFILL[p.key];
      var cfgVal=cfgKey!==undefined?cfg[cfgKey]:undefined;
      var hasCfgVal=cfgVal!==undefined&&cfgVal!==null&&cfgVal!=='';
      var prefill=hasCfgVal?String(cfgVal):(p.default||'');
      var isFromCfg=hasCfgVal;
      var fromCfgNote=isFromCfg
        ?'<span style="font-size:.63rem;color:var(--gn);margin-left:.3rem">from project</span>':'';
      var inputStyle=isFromCfg?'border-color:rgba(63,185,80,.4);background:rgba(63,185,80,.03)':'';

      // Build input element HTML
      var inp='';
      if(p.type==='pill_toggle'&&p.options){
        // Pill toggle for mode switching (symlink/copy etc.)
        inp='<div class="pill-toggle-group" style="display:flex;gap:0;border:0.5px solid var(--bd);border-radius:6px;overflow:hidden;width:fit-content">';
        (p.options||[]).forEach(function(opt,idx){
          var isActive=(opt===prefill);
          inp+='<button type="button" class="pill-toggle-btn'+(isActive?' on':'')+'" '
            +'data-key="'+p.key+'" data-value="'+opt+'" '
            +'onclick="tplPillToggle(this)" '
            +'style="font-size:.75rem;font-weight:'+(isActive?'600':'500')+';padding:.25rem .7rem;'
            +'background:'+(isActive?'var(--sf2)':'transparent')+';'
            +'color:'+(isActive?'var(--tx)':'var(--dm)')+';cursor:pointer;border:none;'
            +'transition:all .15s;white-space:nowrap;'
            +(idx===0?'border-radius:5px 0 0 5px;':'')
            +(idx===p.options.length-1?'border-radius:0 5px 5px 0;':'')
            +(isActive?'box-shadow:inset 0 0 0 1px var(--ac);':'')
            +'">'+opt+'</button>';
        });
        inp+='</div>';
        // Hidden input to store selected value
        inp+='<input type="hidden" id="tp_'+p.key+'" value="'+prefill+'">';
      }else if(p.type==='select'&&p.options){
        inp='<select id="tp_'+p.key+'" onchange="updPrev()">';
        (p.options||[]).forEach(function(o){
          inp+='<option value="'+o+'"'+(o===prefill?' selected':'')+'>'+(o||'(none)')+'</option>';
        });
        inp+='</select>';
      }else if(p.type==='boolean'){
        // Pill toggle for boolean params (gain_flip_y etc.)
        var isOn=(prefill==='true'||prefill==='1'||prefill===true);
        inp='<div style="display:flex;align-items:center;gap:.5rem;padding:.1rem 0">'
          +'<label class="pill-toggle" style="width:34px;height:20px">'
          +'<input type="checkbox" id="tp_'+p.key+'"'+(isOn?' checked':'')
          +' onchange="updPrev()" style="opacity:0;width:0;height:0;position:absolute">'
          +'<div class="pill-track" style="border-radius:10px"></div>'
          +'<div class="pill-thumb" style="top:2px;left:2px;width:16px;height:16px"></div>'
          +'</label>'
          +'<span id="tp_'+p.key+'_lbl" style="font-size:.75rem;color:var(--dm)">'
          +(isOn?'<span style=\"color:var(--gn)\">On</span>':'Off')+'</span>'
          +'</div>';
      }else if(p.type==='path'){
        // Text input + browse button — build via DOM-safe concatenation
        var pKey=p.key;
        var pPh=p.placeholder||'';
        // Mark archive paths so brFill skips them
        var isArchive = (p.key==='archive_source' && p.label && p.label.toLowerCase().includes('archive'));
        inp='<div class="file-input-row">'
          +'<input id="tp_'+pKey+'" type="text" value="'+prefill
          +'" oninput="updPrev()" style="'+inputStyle+'" placeholder="'+pPh+'">'
          +'<button class="file-browse-btn" title="Browse" tabindex="-1" type="button"'
          +' data-fp="tp_'+pKey+'"'+(isArchive?' data-archive="true"':'')+' onclick="jbFilePicker(this.dataset.fp)">'
          +'<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"'
          +' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
          +'<path d="M2 4.5A1.5 1.5 0 013.5 3h3.086L8 4.414H12.5A1.5 1.5 0 0114 5.914V12'
          +'a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12V4.5z"/></svg>'
          +'</button></div>';
      }else if(p.type==='healpix'){
        // Angular sampling: show degrees, store order number
        var hxOpts=[[30,3],[15,4],[7.5,5],[3.7,6],[1.8,7],[0.9,8]];
        inp='<select id="tp_'+p.key+'" onchange="updPrev()">';
        hxOpts.forEach(function(hx){
          var deg=hx[0], ord=hx[1];
          inp+='<option value="'+ord+'"'+(String(ord)===prefill?' selected':'')+'>'
            +deg+'° (Order '+ord+')</option>';
        });
        inp+='</select>';
      }else{
        inp='<input id="tp_'+p.key+'" type="'+(p.type==='number'?'number':'text')+'"'
          +' value="'+prefill+'" oninput="updPrev()" style="'+inputStyle+'"'
          +' placeholder="'+(p.placeholder||'')+'">';
      }

      // Collect "from previous job" button data (injected via DOM after innerHTML set)
      var fromJobTypes=p.from_job_types||[];
      var prevJobs=[];
      fromJobTypes.forEach(function(jt){
        (jobsByType[jt]||[]).forEach(function(j){
          if(j.status==='completed')prevJobs.push(j);
        });
      });

      var jobSelPlaceholder='';
      if(prevJobs.length>0){
        jobSelPlaceholder='<div id="jobsel_'+p.key+'" style="display:flex;align-items:center;gap:.25rem;margin-top:.2rem;flex-wrap:wrap">'
          +'<span style="font-size:.63rem;color:var(--ac);white-space:nowrap;flex-shrink:0">From job:</span></div>';
        // Store button data for DOM injection
        if(!window._tplJobBtns[p.key])window._tplJobBtns[p.key]=[];
        prevJobs.slice(0,6).forEach(function(j){
          var displayName=j.custom_title||j.title||j.job_type;
          var fillVal='';
          if(p.key==='template'&&j.output_files){
            fillVal=(j.output_files.find(function(f){return f.endsWith('.mrc');})||'template.mrc');
          }else if(p.key==='mask'&&j.output_files){
            fillVal=(j.output_files.find(function(f){return f.includes('mask');})||'mask.mrc');
          }else if((p.key==='input_star'||p.key==='input')&&j.output_files){
            fillVal=(j.output_files.find(function(f){return f.endsWith('.star');})||'');
          }
          fillVal=fillVal||displayName;
          window._tplJobBtns[p.key].push({id:j.job_id,label:displayName,fillVal:fillVal});
        });
      }

      formHtml+='<div class="fi" style="margin-bottom:.45rem">'
        +'<label style="display:flex;align-items:center">'+p.label+(p.required?' *':'')+fromCfgNote+'</label>'
        +inp
        +jobSelPlaceholder
        +(p.help?'<div class="help">'+p.help+'</div>':'')
        +'</div>';
    });

    $('parF').innerHTML=formHtml;

    // ── Read dims from .mrc button — inject for jobs with x/y/z tomo dimension fields ──
    (function(){
      // Detect which key variant this job uses: "x/y/z" or "x_dim/y_dim/z_dim"
      var xEl = document.getElementById('tp_x') || document.getElementById('tp_x_dim');
      var yEl = document.getElementById('tp_y') || document.getElementById('tp_y_dim');
      var zEl = document.getElementById('tp_z') || document.getElementById('tp_z_dim');
      if(!xEl || !yEl || !zEl) return;
      var xId = xEl.id, yId = yEl.id, zId = zEl.id;
      var mrcBtnRow = document.createElement('div');
      mrcBtnRow.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin:.35rem 0 .1rem;flex-wrap:wrap';
      mrcBtnRow.innerHTML = '<button type="button" class="bsm" style="font-size:.65rem;padding:.1rem .45rem" '
        +'onclick="jbReadMrcDims(\''+xId+'\',\''+yId+'\',\''+zId+'\')"'
        +' title="Pick a reconstructed tomogram .mrc to read X/Y/Z dimensions from its header">'
        +'Read from .mrc</button>'
        +'<span id="jbMrcDimsMsg" style="font-size:.72rem;color:var(--dm)"></span>';
      var anchorEl = document.getElementById(zId);
      var zFi = anchorEl ? anchorEl.closest('.fi') : null;
      if(zFi && zFi.parentNode) zFi.parentNode.insertBefore(mrcBtnRow, zFi.nextSibling);
      else $('parF').appendChild(mrcBtnRow);
    })();

    // Wire use_output_processing toggle → show/hide dir field
    (function(){
      var toggleEl = document.getElementById('tp_use_output_processing');
      var dirFi    = toggleEl ? toggleEl.closest('.fi') : null;
      // find the next .fi (output_processing_dir)
      var dirRow   = dirFi ? dirFi.nextElementSibling : null;
      if(toggleEl && dirRow){
        function syncOutDir(){
          dirRow.style.display = toggleEl.checked ? '' : 'none';
          updPrev();
        }
        toggleEl.addEventListener('change', syncOutDir);
        syncOutDir(); // initial state
      }
    })();

    // Inject "from job" buttons via DOM
    Object.keys(window._tplJobBtns).forEach(function(pkey){
      var container=document.getElementById('jobsel_'+pkey);
      if(!container)return;
      (window._tplJobBtns[pkey]||[]).forEach(function(btnData){
        var btn=document.createElement('button');
        btn.className='bsm';
        btn.style.cssText='font-size:.62rem;padding:.08rem .3rem;max-width:130px;overflow:hidden;'
          +'text-overflow:ellipsis;white-space:nowrap;border-color:rgba(88,166,255,.3);color:var(--ac)';
        var shortVal=btnData.fillVal.split('/').pop().replace('.mrc','').replace('.star','');
        btn.title=btnData.id+' — '+btnData.label+' → '+btnData.fillVal;
        btn.textContent=btnData.id+' '+shortVal.slice(0,14);
        (function(k,v){btn.onclick=function(){tplFillFromJob('tp_'+k,v);};})(pkey,btnData.fillVal);
        container.appendChild(btn);
      });
    });

    updPrev();updatePasteBtn();loadTpl();
    // Slabify: prepend stored slabify_cmd to command preview
    if(id==='slabify'){
      var prevEl=document.getElementById('slabifyCmdPreview');
      var envPrefix=prevEl&&prevEl.textContent!=='—'?prevEl.textContent:'';
      // If we don't have it yet, fetch from project
      if(!envPrefix&&curProj){
        api('/api/projects/'+curProj+'/config').then(function(c){
          if(c&&c.slabify_cmd){
            var cmdEl=document.getElementById('cmdP');
            if(cmdEl&&c.slabify_cmd){
              cmdEl.textContent=c.slabify_cmd+cmdEl.textContent;
            }
          }
        }).catch(function(){});
      }else if(envPrefix){
        var cmdEl=document.getElementById('cmdP');
        if(cmdEl)cmdEl.textContent=envPrefix+cmdEl.textContent;
      }
    }
    // RELION Class3D: wire smart analysis (K from STAR, Crowther order)
    if(id==='relion_class3d'){
      _relionClass3dSetup();
    }
    // Inline parameter suggestion for RELION jobs
    var relionInlineJobs=['relion_class3d','relion_class3d_align','relion_class3d_noalign',
                          'relion_refine3d','relion_postprocess'];
    if(relionInlineJobs.includes(id)){
      _jbInlineCalcInsert(id, cfg);
    }
    // Contextual warnings for critical parameters
    _jbContextWarnings(id, cfg);
  }catch(e){console.error('selTpl',e);}
}


function tplFillFromJob(inputId, value){
  var el=document.getElementById(_jbFpTarget);
  if(!el)return;
  el.value=value;
  el.style.borderColor='var(--ac)';
  el.style.boxShadow='0 0 0 2px rgba(88,166,255,.15)';
  setTimeout(function(){el.style.borderColor='';el.style.boxShadow='';},2000);
  updPrev();
}

function jbWarpDirChanged(){
  var el = document.getElementById('jbWarpDirInput');
  var val = el ? el.value.trim() : '';
  window._jbWarpToolsDir = val;
  // Update box styling
  var box = document.getElementById('jbWarpDirBox');
  if(box){
    var ok = val && val.length > 0;
    box.style.background  = ok ? 'rgba(63,185,80,.06)'  : 'rgba(248,166,0,.07)';
    box.style.border      = '1px solid '+(ok ? 'rgba(63,185,80,.25)' : 'rgba(248,166,0,.35)');
    var lbl = box.querySelector('div div:first-child');
    if(lbl) lbl.style.color = ok ? 'var(--gn)' : 'var(--yl,#f8a600)';
    var icon = box.querySelector('span');
    if(icon) icon.textContent = ok ? '✓' : '⚠';
  }
  updPrev();
}

function updPrev(){
  if(!curTpl)return;
  // Bug10: grey SLURM fields when submit_mode = --direct
  var _modeEl = document.getElementById('tp_submit_mode');
  var _isDirect = _modeEl && _modeEl.value === '--direct';
  ['partition','time_limit','memory'].forEach(function(k){
    var _el = document.getElementById('tp_' + k);
    if(_el){ _el.disabled = _isDirect; _el.style.opacity = _isDirect ? '0.35' : '1'; }
  });
  // If template has mode-based commands (e.g. command_symlink, command_copy), select the right one
  var modeEl = document.getElementById('tp_mode');
  var mode = modeEl ? modeEl.value : null;
  var c = curTpl.command;
  if(mode && curTpl['command_' + mode]){
    c = curTpl['command_' + mode]; // Use command_symlink or command_copy
  }
  // submit_mode based command switch (tm_batch: --direct vs --submit)
  var submitModeEl = document.getElementById('tp_submit_mode');
  if(submitModeEl){
    var sm = submitModeEl.value;
    if(sm === '--direct' && curTpl.command_direct) c = curTpl.command_direct;
    else if((sm === '--submit' || sm === '') && curTpl.command_slurm) c = curTpl.command_slurm;
  }
  // Show Queue button only in direct mode
  var _qBtn = document.getElementById("queueAddBtn");
  if(_qBtn) _qBtn.style.display = (typeof _execMode !== "undefined" && _execMode === "direct") ? "" : "none";

  // ── Activation cmd: read from window._programs per template category ──
  // Mapping: template category → programs dict key
  var _CAT_TO_PROG = {
    'warp_preproc': 'warptools', 'warp_export': 'warptools',
    'import':       'warptools',
    'aretomo3':     'aretomo3',
    'pytom':        'pytom',
    'relion':       'relion',
    'mtools':       'warptools',
    'convert':      'imod',
    'slabify':      'slabify',
    'other':        null
  };
  var _toolId = _CAT_TO_PROG[curTpl.category] || null;
  var _prog   = (_toolId && window._programs && window._programs[_toolId]) || {};
  var _actCmd = (_prog.cmd || '').trim();
  // Prepend cd for WarpTools jobs
  var isWarpJob = curTpl.category && curTpl.category.startsWith('warp_');
  var warpDir = (document.getElementById('jbWarpDirInput')||{}).value || window._jbWarpToolsDir || '';
  if(isWarpJob && warpDir){
    // Build: [activation &&] cd warpDir && command
    var _prefix = _actCmd ? (_actCmd + ' && ') : '';
    c = _prefix + 'cd ' + warpDir.replace(/\/+$/, '') + ' && ' + c;
  } else if(_actCmd && _toolId && !isWarpJob) {
    // Non-WarpTools jobs: prepend activation only, no cd
    c = _actCmd + ' && ' + c;
  }
  (curTpl.parameters||[]).forEach(function(p){
    var el=$('tp_'+p.key);
    var v;
    if(p.type==='boolean'){
      // Boolean pill toggle → emit flag or empty string
      var flag=p.flag||('--'+p.key);
      v=el&&el.checked?(flag+' '):'';
      c=c.split('{'+p.key+'}').join(v);
    }else{
      v=el?el.value:(p.default||'');
      // Special: pretilt_angle_neg → negate the user-entered value for the script
      // User enters 9 → command gets -9; user enters -11 → command gets 11
      if(p.key==='pretilt_angle_neg' && v!==''){
        c=c.split('{'+p.key+'}').join(String(-(parseFloat(v)||0)));
      } else if(!p.required || v){
        c=c.split('{'+p.key+'}').join(v);
      }
    }
  });
  // Special: {output_processing} — only inject if boolean toggle is on
  var useOutEl  = document.getElementById('tp_use_output_processing');
  var outDirEl  = document.getElementById('tp_output_processing_dir');
  if(useOutEl && outDirEl){
    var useOut = useOutEl.checked;
    var outDir = outDirEl.value.trim();
    c = c.split('{output_processing}').join(
      (useOut && outDir) ? ' --output_processing ' + outDir : ''
    );
  }
  // CRITICAL FIX: Protect {{}} before removing {placeholders}
  // Step 1: Replace {{}} with placeholder to protect from removal
  c = c.replace(/\{\{([^}]*)\}\}/g, '__DOUBLE_BRACE_$1__');
  
  // Step 2: Remove remaining single {placeholders}
  c = c.replace(/{[^}]+}/g, '');
  
  // Step 3: Restore {{}} as {} (for find -exec and f-strings)
  c = c.replace(/__DOUBLE_BRACE_([^_]*)__/g, '{$1}');
  
  // Step 4: Clean up extra spaces
  $('cmdP').textContent = c.replace(/ +/g, ' ').trim();
}
function cpCmd(){navigator.clipboard.writeText($('cmdP').textContent)}

// ── Job Builder title helpers ──
function jbTitlePreview(val){
  var clr=document.getElementById('jbTitleClear');
  if(clr)clr.style.display=val?'':'none';
  var hdr=document.getElementById('parT');
  if(!hdr)return;
  var firstSpan=hdr.children[0];
  if(!firstSpan)return;
  var base=curTpl?curTpl.name:'Parameters';
  firstSpan.textContent=val?base+' — '+val:base;
  firstSpan.style.color=val?'var(--tx)':'';
}
function jbTitleClear(){
  var el=document.getElementById('jbCustomTitle');
  if(el){el.value='';jbTitlePreview('');}
}
function jbGetTitle(){
  var el=document.getElementById('jbCustomTitle');
  return el?el.value.trim():'';
}

// ── Run ──
async function runJob(){
  const cmd=$('cmdP').textContent;if(!cmd)return;
  $('termP').style.display='';const t=$('term');t.innerHTML='';tl(t,'$ '+cmd,'cmd');tl(t,'');
  $('rCancel').style.display='';$('rBadge').textContent='Running';$('rBadge').className='badge running';
  const proto=location.protocol==='https:'?'wss':'ws';
  // Collect job metadata for JobRecord creation on server
  const jobType=curTpl?curTpl.id:'custom';
  const jobTitle=curTpl?curTpl.name:cmd.slice(0,60);
  const jobCustomTitle=jbGetTitle()||undefined;
  const jobParams={};
  if(curTpl)(curTpl.parameters||[]).forEach(function(p){
    var el=document.getElementById('tp_'+p.key);if(!el)return;
    jobParams[p.key]=(p.type==='boolean')?(el.checked?'true':'false'):el.value;
  });
  // Determine working_dir: warptools jobs run from warptools_dir, others from project dir
  var isWarpJob = curTpl && curTpl.category && curTpl.category.startsWith('warp_');
  var isImportJob  = curTpl && curTpl.category === 'import';
  var isAt3Job     = curTpl && curTpl.category === 'aretomo3';
  var warpDirEl = document.getElementById('jbWarpDirInput');
  var warpDirVal = warpDirEl ? warpDirEl.value.trim() : (window._jbWarpToolsDir||'');
  // Derive preprocessing_root from warptools_dir (parent directory)
  var preprocRoot = warpDirVal ? warpDirVal.replace(/\/warptools\/?$/, '').replace(/\/+$/, '') : '';
  // cwd selection:
  //   warp_*   jobs → warptools_dir
  //   import   jobs → preprocessing_root (so relative paths like warptools/frames resolve)
  //   aretomo3 jobs → preprocessing_root (scripts run from there, use absolute paths for mdocs)
  //   others        → project_dir (base)
  const workDir = (isWarpJob   && warpDirVal)  ? warpDirVal
                : (isImportJob && preprocRoot)  ? preprocRoot
                : await getProjDir();
  // Note: aretomo3 jobs use absolute paths in all params, so cwd=project_dir is fine
  ws=new WebSocket(`${proto}://${location.host}/api/scripts/ws/run`);
  ws.onopen=()=>ws.send(JSON.stringify({
    command:cmd,
    working_dir:workDir,
    project:curProj||'',
    job_id:'',
    job_type:jobType,
    job_title:jobTitle,
    custom_title:jobCustomTitle,
    parameters:jobParams,
    warptools_dir:warpDirVal||undefined,
    job_category:curTpl?curTpl.category:'',
  }));
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.type==='stdout')tl(t,m.line,'out');
    else if(m.type==='stderr')tl(t,m.line,'err');
    else if(m.type==='start'){tl(t,'[started]','info');if(m.job_id)tl(t,'Job: '+m.job_id,'info');_startJobPoll();jbTitleClear();}
    else if(m.type==='done'){
      _stopJobPoll();
      curRun=m.run_id;const ok=m.exit_code===0;tl(t,'');
      tl(t,`${ok?'Completed':'Failed'} (exit ${m.exit_code})${m.duration?' — '+m.duration.toFixed(1)+'s':''}`,ok?'ok':'err');
      $('rBadge').textContent=ok?'Done':'Failed';$('rBadge').className=`badge ${ok?'done':'failed'}`;
      $('rCancel').style.display='none';
      // Refresh all job monitors
      loadRuns();
      if(curProj){loadJobs();}
    }
    t.scrollTop=t.scrollHeight;
  };
  ws.onerror=()=>tl(t,'[connection lost]','err');
}
// ── Queue: collect current job builder state and show modal ──
async function queueAddCurrent(){
  var cmd = document.getElementById("cmdP") ? document.getElementById("cmdP").textContent : ""; if(!cmd) return;
  var jobType   = curTpl ? curTpl.id   : "custom";
  var jobTitle  = curTpl ? curTpl.name : cmd.slice(0,60);
  var jobParams = {};
  if(curTpl)(curTpl.parameters||[]).forEach(function(p){
    var el=document.getElementById("tp_"+p.key); if(!el) return;
    jobParams[p.key] = (p.type==='boolean') ? (el.checked?'true':'false') : el.value;
  });
  var isWarpJob   = curTpl && curTpl.category && curTpl.category.startsWith("warp_");
  var isImportJob = curTpl && curTpl.category === "import";
  var warpDirEl   = document.getElementById("jbWarpDirInput");
  var warpDirVal  = warpDirEl ? warpDirEl.value.trim() : (window._jbWarpToolsDir||"");
  var preprocRoot = warpDirVal ? warpDirVal.replace(/\/warptools\/?$/,"").replace(/\/+$/,"") : "";
  var workDir = (isWarpJob && warpDirVal)  ? warpDirVal
              : (isImportJob && preprocRoot) ? preprocRoot
              : await getProjDir();
  if(typeof queueShowModal === "function"){
    queueShowModal({cmd:cmd, cwd:workDir, project:curProj||"",
      job_type:jobType, job_title:jobTitle, job_params:jobParams});
  }
}

async function cancelR(){
  _stopJobPoll();
  if(ws)ws.close();
  if(curRun)try{await post(`/api/scripts/runs/${curRun}/cancel`,{})}catch(e){}
  $('rBadge').textContent='Cancelled';$('rBadge').className='badge cancelled';$('rCancel').style.display='none';
}
async function loadRuns(){
  try{
    const d=await api('/api/scripts/runs');
    $('rHist').innerHTML=d.runs.length
      ? d.runs.slice().reverse().slice(0,10).map(r=>`<div class="ri">
          <span class="badge ${r.status}" style="min-width:52px;text-align:center;font-size:.6rem">${r.status}</span>
          <span class="rc">${tr(r.command,30)}</span>
          <span class="dim" style="font-size:.6rem">${r.duration?r.duration.toFixed(1)+'s':''}</span></div>`).join('')
      :'<div class="dim" style="font-size:.75rem">No runs yet</div>';
  }catch(e){}
}


// ── Contextual warnings in Job Builder ─────────────────────────────────────
// Minimal — only shown if critical project data is missing
function _jbContextWarnings(jobId, cfg){
  var old=document.getElementById('jbContextWarn');
  if(old)old.remove();

  var relionJobs=['relion_class3d','relion_class3d_align','relion_class3d_noalign','relion_refine3d'];
  if(!relionJobs.includes(jobId)) return;

  var pd = parseFloat(cfg.particle_diameter)||0;
  var rawPx = parseFloat(cfg.raw_pixel_size)||0;
  if(pd>0 && rawPx>0) return;  // all good — no warning needed

  // Only warn if critical data is missing
  var wrap=document.createElement('div');
  wrap.id='jbContextWarn';
  wrap.style.cssText='margin:0 0 .4rem;padding:.3rem .5rem;border-left:3px solid rgba(210,153,34,.8);'
    +'background:rgba(210,153,34,.06);border-radius:0 5px 5px 0;font-size:.7rem;color:var(--dm);line-height:1.5';
  var missing=[];
  if(!rawPx) missing.push('raw pixel size (Tomo tab)');
  if(!pd)    missing.push('particle diameter (Particles tab)');
  wrap.innerHTML='<strong style="color:var(--yl)">Project data missing:</strong> '
    +'Set '+missing.join(' and ')+' to enable parameter suggestions.';
  var parF=document.getElementById('parF');
  if(parF) parF.insertBefore(wrap, parF.firstChild);
}


// ── Inline RELION parameter suggestion in Job Builder ──────────────────────
function _jbInlineCalcClose(){
  var e=document.getElementById('jbInlineCalc');
  if(e)e.remove();
}

function _jbApplyCalcVal(fieldId, val){
  var e=document.getElementById('tp_'+fieldId);
  if(!e)return;
  e.value=String(val);
  e.style.borderColor='var(--ac)';
  e.style.boxShadow='0 0 0 2px rgba(88,166,255,.15)';
  setTimeout(function(){e.style.borderColor='';e.style.boxShadow='';},1500);
  updPrev();
}

function _jbCalcSuggest(rawPx, binVal, diam, jobId, lpVal){
  var effPx   = rawPx * binVal;
  var nyquist = effPx * 2;
  // d_eff = lowpass filter value (from field if set, else per-binning default)
  // Formula: T = 5.0 - 0.9 * ln(d_eff) — calibrated so 150Å→T=0.5, 80Å→T=1.0
  // lpVal passed from suggestion box LP input (or 0 = use nyquist)
  var lpDefault = {8:150,4:150,2:80,1:40}[binVal]||150;
  var lp = (lpVal && lpVal > 0) ? lpVal : lpDefault;
  var dEff = Math.max(lp, nyquist);
  var tRaw    = 5.0 - 0.9 * Math.log(Math.max(1, dEff));
  var tPrac   = Math.round(Math.max(0.5,Math.min(4.0,tRaw))*2)/2;
  var isNoAlign=(jobId==='relion_class3d_noalign');
  var tSuggest = isNoAlign ? 4.0 : tPrac;
  var lpSuggest = lpDefault;
  var offset  = Math.max(1,Math.min(5,Math.ceil(20/effPx)));
  var crDeg   = diam>0 ? Math.atan(nyquist/diam)*180/Math.PI : 0;
  var orders  = [[30,3],[15,4],[7.5,5],[3.7,6],[1.8,7],[0.9,8]];
  var localOrder=5, globalOrder=4;
  for(var i=0;i<orders.length;i++){
    if(orders[i][0]<=crDeg){localOrder=orders[i][1];globalOrder=Math.max(3,orders[i][1]-1);break;}
  }
  var orderDeg = orders.find(function(o){return o[1]===localOrder;})||[3.7,5];
  var globalDeg = orders.find(function(o){return o[1]===globalOrder;})||[15,4];
  return {effPx,nyquist,dEff,tSuggest,lpSuggest,offset,crDeg,localOrder,globalOrder,orderDeg:orderDeg[0],gDeg:globalDeg[0],isNoAlign};
}

function _jbInlineCalcInsert(jobId, cfg){
  var old=document.getElementById('jbInlineCalc');
  if(old)old.remove();

  var rawPx = parseFloat(cfg.raw_pixel_size)||0;
  var diam  = parseFloat(cfg.particle_diameter)||0;
  var cfgBin = parseFloat(cfg.binning_factor)||8;
  if(!rawPx && cfg.bin_pixel_size && cfgBin) rawPx = parseFloat(cfg.bin_pixel_size)/cfgBin;
  if(!rawPx) return;

  var stdBins=[1,2,4,8];
  var initBin = stdBins.reduce(function(a,x){return Math.abs(x-cfgBin)<Math.abs(a-cfgBin)?x:a;});

  // Per-binning LP defaults (user's workflow: LP drives T, not binning)
  var lpDefaults={8:150,4:150,2:80,1:40};
  var initLp = lpDefaults[initBin]||150;

  // Pill toggle collapsed state
  var collapsed = false;

  // Outer wrapper
  var wrap=document.createElement('div');
  wrap.id='jbInlineCalc';
  wrap.style.cssText='margin:0 0 .6rem;border:0.5px solid rgba(59,130,246,.2);border-radius:7px;overflow:hidden;font-size:.71rem';

  // ── Header ──
  // ── Row 1: Title + hide/show pill (always visible, clickable) ──
  var hdr=document.createElement('div');
  hdr.style.cssText='display:flex;align-items:center;gap:.4rem;padding:.28rem .5rem;'
    +'background:rgba(59,130,246,.06);cursor:pointer;user-select:none';
  var lbl=document.createElement('span');
  lbl.style.cssText='font-size:.62rem;font-weight:700;letter-spacing:.04em;color:#185FA5;flex:1';
  lbl.textContent='Suggested parameters';
  hdr.appendChild(lbl);
  var hsPill=document.createElement('label');
  hsPill.className='pill-toggle';
  hsPill.style.cssText='width:30px;height:17px;cursor:pointer;flex-shrink:0';
  hsPill.onclick=function(e){e.stopPropagation();};
  var hsCb=document.createElement('input');hsCb.type='checkbox';hsCb.checked=true;
  hsCb.style.cssText='opacity:0;width:0;height:0;position:absolute';
  var hsTrack=document.createElement('div');hsTrack.className='pill-track';hsTrack.style.borderRadius='9px';
  var hsThumb=document.createElement('div');hsThumb.className='pill-thumb';
  hsThumb.style.cssText='top:2px;left:2px;width:13px;height:13px';
  hsPill.appendChild(hsCb);hsPill.appendChild(hsTrack);hsPill.appendChild(hsThumb);
  hdr.appendChild(hsPill);
  wrap.appendChild(hdr);

  // ── Row 2: Controls (collapsible) ──
  var ctrl=document.createElement('div');
  ctrl.style.cssText='display:flex;align-items:center;gap:.3rem;padding:.25rem .5rem .2rem;'
    +'background:rgba(59,130,246,.04);border-bottom:0.5px solid rgba(59,130,246,.12)';
  var binLbl=document.createElement('span');
  binLbl.style.cssText='font-size:.6rem;color:var(--dm);flex-shrink:0';
  binLbl.textContent='Bin:';
  var binSel=document.createElement('select');
  binSel.id='jbCalcBinSel';
  binSel.style.cssText='font-size:.68rem;padding:.1rem .25rem;border-radius:4px;'
    +'border:0.5px solid var(--bd);background:var(--sf);color:var(--tx);cursor:pointer';
  [[8,'\xd78'],[4,'\xd74'],[2,'\xd72'],[1,'\xd71']].forEach(function(opt){
    var o=document.createElement('option');
    o.value=opt[0];o.textContent=opt[1];
    if(opt[0]===initBin)o.selected=true;
    binSel.appendChild(o);
  });
  ctrl.appendChild(binLbl);ctrl.appendChild(binSel);
  var lpLbl=document.createElement('span');
  lpLbl.style.cssText='font-size:.6rem;color:var(--dm);flex-shrink:0;margin-left:.3rem';
  lpLbl.textContent='LP (\u00c5):';
  var lpInp=document.createElement('input');
  lpInp.type='number';lpInp.min='5';lpInp.max='500';lpInp.step='5';
  lpInp.value=initLp;lpInp.id='jbCalcLpInp';
  lpInp.style.cssText='width:50px;font-size:.68rem;padding:.1rem .25rem;border-radius:4px;'
    +'border:0.5px solid var(--bd);background:var(--sf);color:var(--tx);text-align:center';
  ctrl.appendChild(lpLbl);ctrl.appendChild(lpInp);
  var spc=document.createElement('div');spc.style.flex='1';ctrl.appendChild(spc);
  var aaLbl=document.createElement('span');
  aaLbl.style.cssText='font-size:.6rem;color:var(--dm);flex-shrink:0';
  aaLbl.textContent='Apply all';
  var aaPill=document.createElement('label');
  aaPill.className='pill-toggle';
  aaPill.style.cssText='width:30px;height:17px;cursor:pointer;flex-shrink:0';
  var aaCb=document.createElement('input');aaCb.type='checkbox';
  aaCb.style.cssText='opacity:0;width:0;height:0;position:absolute';
  var aaTrack=document.createElement('div');aaTrack.className='pill-track';aaTrack.style.borderRadius='9px';
  var aaThumb=document.createElement('div');aaThumb.className='pill-thumb';
  aaThumb.style.cssText='top:2px;left:2px;width:13px;height:13px';
  aaPill.appendChild(aaCb);aaPill.appendChild(aaTrack);aaPill.appendChild(aaThumb);
  ctrl.appendChild(aaLbl);ctrl.appendChild(aaPill);

  // ── Cards area (collapsible) ──
  var body=document.createElement('div');
  body.id='jbCalcBody';
  body.appendChild(ctrl);

  var grid=document.createElement('div');
  grid.id='jbCalcGrid';
  grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(95px,1fr));gap:.22rem;margin-bottom:.25rem';
  body.appendChild(grid);

  var foot=document.createElement('div');
  foot.id='jbCalcFoot';
  foot.style.cssText='font-size:.61rem;color:var(--dm);line-height:1.5;border-top:0.5px solid rgba(59,130,246,.12);padding-top:.25rem';
  body.appendChild(foot);
  wrap.appendChild(body);

  // ── renderCards ──
  function rerender(){
    var binVal=parseInt(binSel.value)||8;
    var lpVal=parseFloat(lpInp.value)||lpDefaults[binVal]||150;
    var s=_jbCalcSuggest(rawPx, binVal, diam, jobId, lpVal);
    grid.innerHTML='';

    function mkCard(label, val, note, fillKey, fillValOverride){
      var card=document.createElement('div');
      card.style.cssText='background:var(--sf2);border:0.5px solid var(--bd);border-radius:5px;'
        +'padding:.26rem .35rem;text-align:center;cursor:pointer';
      card.dataset.fillKey=fillKey;card.dataset.fillVal=fillValOverride!==undefined?String(fillValOverride):String(val);
      card.onmouseover=function(){this.style.borderColor='var(--ac)';this.style.background='rgba(88,166,255,.06)';};
      card.onmouseout=function(){this.style.borderColor='var(--bd)';this.style.background='var(--sf2)';};
      (function(k,v){card.onclick=function(){_jbApplyCalcVal(k,v);updPrev();};})(fillKey,val);
      card.innerHTML='<div style="font-size:.56rem;color:var(--dm);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.08rem">'+label+'</div>'
        +'<div style="font-size:1.0rem;font-weight:500;color:var(--tx)">'+val+'</div>'
        +(note?'<div style="font-size:.57rem;color:var(--dm);margin-top:.04rem">'+note+'</div>':'');
      return card;
    }

    // Job-specific card sets — T always shown, driven by LP input
    if(jobId==='relion_class3d'){
      grid.appendChild(mkCard('Regularisation T', s.tSuggest.toFixed(1), 'LP='+lpVal+' \u00c5', 'T'));
      grid.appendChild(mkCard('Lowpass filter (\u00c5)', String(lpVal), 'first round', 'lowpass'));
      if(diam) grid.appendChild(mkCard('Mask diameter (\u00c5)', String(diam), '= WarpTools --dia', 'mask_diameter'));
      grid.appendChild(mkCard('Offset range (pix)', String(s.offset), '\xb1'+Math.round(s.offset*s.effPx)+' \u00c5', 'offset_range'));
      if(diam) grid.appendChild(mkCard('Ang. sampling', s.gDeg+'\u00b0', 'Order '+s.globalOrder+' \xb7 Crowther '+s.crDeg.toFixed(1)+'\u00b0', 'healpix_order', s.globalOrder));
    } else if(jobId==='relion_class3d_align'){
      grid.appendChild(mkCard('Regularisation T', s.tSuggest.toFixed(1), 'LP='+lpVal+' \u00c5', 'T'));
      grid.appendChild(mkCard('ini_high (\u00c5)', String(lpVal), 'above prev. res.', 'ini_high'));
      if(diam) grid.appendChild(mkCard('Mask diameter (\u00c5)', String(diam), '= WarpTools --dia', 'mask_diameter'));
      grid.appendChild(mkCard('Offset range (pix)', String(s.offset), '\xb1'+Math.round(s.offset*s.effPx)+' \u00c5', 'offset_range'));
      if(diam) grid.appendChild(mkCard('Global sampling', s.gDeg+'\u00b0', 'Order '+s.globalOrder+' coarse', 'healpix_order', s.globalOrder));
      if(diam) grid.appendChild(mkCard('Local sampling', s.orderDeg+'\u00b0', 'Order '+s.localOrder+' \xb7 Crowther '+s.crDeg.toFixed(1)+'\u00b0', 'local_order', s.localOrder));
    } else if(jobId==='relion_class3d_noalign'){
      grid.appendChild(mkCard('Regularisation T', '4.0', 'no-align default', 'T'));
      grid.appendChild(mkCard('ini_high (\u00c5)', String(lpVal), 'above prev. res.', 'ini_high'));
      if(diam) grid.appendChild(mkCard('Mask diameter (\u00c5)', String(diam), '= WarpTools --dia', 'mask_diameter'));
    } else if(jobId==='relion_refine3d'){
      grid.appendChild(mkCard('Regularisation T', s.tSuggest.toFixed(1), 'LP='+lpVal+' \u00c5', 'T'));
      grid.appendChild(mkCard('ini_high (\u00c5)', String(lpVal), 'above prev. res.', 'ini_high'));
      if(diam) grid.appendChild(mkCard('Mask diameter (\u00c5)', String(diam), '= WarpTools --dia', 'mask_diameter'));
      grid.appendChild(mkCard('Offset range (pix)', String(s.offset), '\xb1'+Math.round(s.offset*s.effPx)+' \u00c5', 'offset_range'));
      if(diam) grid.appendChild(mkCard('Global sampling', s.gDeg+'\u00b0', 'Order '+s.globalOrder, 'healpix_order', s.globalOrder));
      if(diam) grid.appendChild(mkCard('Local sampling', s.orderDeg+'\u00b0', 'Order '+s.localOrder+' \xb7 Crowther '+s.crDeg.toFixed(1)+'\u00b0', 'local_order', s.localOrder));
    } else if(jobId==='relion_postprocess'){
      if(diam) grid.appendChild(mkCard('Mask diameter (\u00c5)', String(diam), '= WarpTools --diameter', 'mask_diameter'));
    }

    foot.textContent='Click card or toggle \u201cApply all\u201d to fill fields \xb7 Nyquist: '
      +s.nyquist.toFixed(0)+' \u00c5'+(diam?' \xb7 Crowther: '+s.crDeg.toFixed(1)+'\u00b0':'');

    // Auto-apply to still-empty fields
    var autoMap={'mask_diameter':String(diam),'T':s.tSuggest.toFixed(1),'offset_range':String(s.offset)};
    if(jobId==='relion_class3d_align'||jobId==='relion_refine3d'){
      autoMap['healpix_order']=String(s.globalOrder);
      autoMap['local_order']=String(s.localOrder);
    }
    Object.keys(autoMap).forEach(function(k){
      if(!autoMap[k]||autoMap[k]==='0') return;
      var el=document.getElementById('tp_'+k);
      if(el&&el.value===''){el.value=autoMap[k];el.style.borderColor='rgba(59,130,246,.35)';}
    });
    try{updPrev();}catch(e){}
  }

  // ── Apply-all toggle ──
  aaCb.addEventListener('change',function(){
    if(!this.checked) return;
    var cards=grid.querySelectorAll('[data-fill-key]');
    cards.forEach(function(card){
      var el=document.getElementById('tp_'+card.dataset.fillKey);
      if(el){
        el.value=card.dataset.fillVal;
        el.style.borderColor='rgba(59,130,246,.4)';
        if(el.tagName==='SELECT') el.dispatchEvent(new Event('change'));
        else el.dispatchEvent(new Event('input'));
      }
    });
    // Also apply LP to its field
    var lpField=document.getElementById('tp_ini_high')||document.getElementById('tp_lowpass');
    if(lpField) lpField.value=lpInp.value;
    try{updPrev();}catch(e){}
    setTimeout(function(){aaCb.checked=false;},400);
  });

  // ── Hide/Show: pill or click header ──
  function _toggleBody(show){
    body.style.display=show?'':'none';
    hdr.style.borderBottom=show?'':'none';
  }
  hsCb.addEventListener('change',function(){ _toggleBody(this.checked); });
  hdr.addEventListener('click',function(e){
    if(e.target===hsPill||hsPill.contains(e.target)) return;
    hsCb.checked=!hsCb.checked;
    hsCb.dispatchEvent(new Event('change'));
  });

  // ── Wire binning + LP changes ──
  binSel.addEventListener('change',function(){
    var b=parseInt(this.value)||8;
    // Update LP default when binning changes
    if(!lpInp._userEdited) lpInp.value=lpDefaults[b]||150;
    rerender();
  });
  lpInp.addEventListener('input',function(){
    lpInp._userEdited=true;
    rerender();
  });

  // Insert before form params
  var parF=document.getElementById('parF');
  if(parF) parF.insertBefore(wrap, parF.firstChild);

  rerender();
}


// ── Apply-all suggestion toggle ──────────────────────────────────────────────
function jbCalcApplyAllToggle(cb, jobId){
  if(!cb.checked) return;  // turning off does nothing
  // Apply all current card values to empty fields
  var grid=document.getElementById('jbCalcGrid');
  if(!grid) return;
  var cards=grid.querySelectorAll('[data-fill-key]');
  cards.forEach(function(card){
    var k=card.dataset.fillKey;
    var v=card.dataset.fillVal;
    if(!k||!v) return;
    var el=document.getElementById('tp_'+k);
    if(el){
      el.value=v;
      el.style.borderColor='rgba(59,130,246,.4)';
      el.style.background='rgba(59,130,246,.03)';
    }
  });
  try{updPrev();}catch(e){}
  // Turn off after applying (visual feedback)
  setTimeout(function(){cb.checked=false;},400);
}


document.addEventListener('click',function(e){
  var d=document.getElementById('jbFpDrop');
  if(d&&!d.contains(e.target)&&!e.target.classList.contains('file-browse-btn')
     &&!e.target.closest('.file-browse-btn'))d.remove();
},true);
// ── Pill toggle handler for mode switching (symlink/copy etc.) ──
function tplPillToggle(btn){
  var key = btn.dataset.key;
  var value = btn.dataset.value;
  // Update hidden input
  var hiddenInput = document.getElementById('tp_' + key);
  if(hiddenInput) hiddenInput.value = value;
  // Update button states
  var group = btn.parentElement;
  group.querySelectorAll('.pill-toggle-btn').forEach(function(b){
    var isActive = (b.dataset.value === value);
    b.className = 'pill-toggle-btn' + (isActive ? ' on' : '');
    b.style.fontWeight = isActive ? '600' : '500';
    b.style.background = isActive ? 'var(--sf2)' : 'transparent';
    b.style.color = isActive ? 'var(--tx)' : 'var(--dm)';
    b.style.boxShadow = isActive ? 'inset 0 0 0 1px var(--ac)' : '';
  });
  // Update command preview
  updPrev();
}




// ══════════════════════════════════════════════════════════════════════════════
// Job Builder Browse Modal — Smart file/folder picker
// ══════════════════════════════════════════════════════════════════════════════

let _jbBrowseTarget = null;
let _jbBrowsePath = '.';
let _jbBrowseMode = 'folder'; // 'folder' or 'file'
let _jbBrowseSelectedFile = null;

// ── Read tomo dims from MRC header — fills x/y/z + pixel_size in job builder ──────────
function jbReadMrcDims(xId, yId, zId){
  xId = xId || 'tp_x'; yId = yId || 'tp_y'; zId = zId || 'tp_z';
  var msg = document.getElementById('jbMrcDimsMsg');
  if(msg) msg.textContent = 'Pick a .mrc file…';
  var hidden = document.getElementById('_jbMrcDimsPath');
  if(!hidden){
    hidden = document.createElement('input');
    hidden.type = 'hidden'; hidden.id = '_jbMrcDimsPath';
    hidden.dataset.label = 'tomogram .mrc file';
    document.body.appendChild(hidden);
  }
  hidden.value = '';
  jbFilePicker('_jbMrcDimsPath');
  var poll = setInterval(async function(){
    var path = hidden.value;
    if(!path) return;
    clearInterval(poll);
    if(msg) msg.textContent = 'Reading…';
    try{
      var r = await api('/api/mrc/dims?path=' + encodeURIComponent(path));
      if(r.error){ if(msg) msg.textContent = 'Error: ' + r.error; return; }
      var ex=$(xId), ey=$(yId), ez=$(zId);
      if(ex && r.nx) ex.value = r.nx;
      if(ey && r.ny) ey.value = r.ny;
      if(ez && r.nz) ez.value = r.nz;
      // Bug 2 fix: also fill pixel_size field
      var eps = $('tp_pixel_size');
      if(eps && r.voxel_size) eps.value = r.voxel_size;
      updPrev();
      if(msg) msg.textContent = '\u2713 ' + r.nx + ' \xd7 ' + r.ny + ' \xd7 ' + r.nz
                               + ' vox — ' + r.voxel_size + ' \u00c5/px';
    }catch(e){ if(msg) msg.textContent = 'Failed: ' + e; }
  }, 300);
  setTimeout(function(){ clearInterval(poll); }, 120000);
}

// ── Main entry point: open browse modal for a job parameter ──
function jbFilePicker(inputId, forceMode){
  var input = document.getElementById(inputId);
  if(!input){
    console.warn('[jbFilePicker] Input not found:', inputId);
    return;
  }

  if(forceMode === 'file' || forceMode === 'folder'){
    _jbBrowseMode = forceMode;
  } else {
    // Determine mode: file or folder? Check if the input has a label that mentions "file"
    var browseBtn = document.querySelector('[data-fp="'+inputId+'"]');
    var label = '';
    if(browseBtn){
      var fieldContainer = browseBtn.closest('.fi');
      var labelEl = fieldContainer ? fieldContainer.querySelector('label') : null;
      label = labelEl ? labelEl.textContent.toLowerCase() : '';
    }
    // If label contains "file" or "gain" or ".mrc" → file mode
    _jbBrowseMode = (label.includes('file') || label.includes('gain') || label.includes('.mrc') || label.includes('.dm4')) ? 'file' : 'folder';
  }
  
  console.log('[jbFilePicker] Mode:', _jbBrowseMode, 'for', inputId);
  
  // Create modal HTML if it doesn't exist yet
  if(!document.getElementById('jbBrowseModal')){
    createBrowseModal();
  }
  
  // Open modal and navigate to starting path
  openBrowseModal(inputId);
}

// ── Create modal HTML dynamically ──
function createBrowseModal(){
  var modal = document.createElement('div');
  modal.id = 'jbBrowseModal';
  modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;'
    +'background:rgba(0,0,0,0.7);z-index:9999;align-items:center;justify-content:center;';
  
  modal.innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--bd);border-radius:6px;
                width:90%;max-width:700px;max-height:85vh;display:flex;flex-direction:column;
                box-shadow:0 4px 20px rgba(0,0,0,0.5);">
      
      <!-- Header -->
      <div style="padding:0.8rem 1rem;border-bottom:1px solid var(--bd);display:flex;
                  align-items:center;justify-content:space-between;">
        <strong id="jbBrowseModalTitle" style="color:var(--tx);font-size:0.9rem;">Select Path</strong>
        <button onclick="closeBrowseModal()" style="background:none;border:none;color:var(--dm);
                cursor:pointer;font-size:1.5rem;line-height:1;padding:0;width:24px;height:24px;"
                title="Close (Esc)">&times;</button>
      </div>
      
      <!-- Navigation -->
      <div style="padding:0.6rem 1rem;border-bottom:1px solid var(--bd);display:flex;gap:0.5rem;align-items:center;">
        <button onclick="jbBrowseUp()" style="background:var(--sf);border:1px solid var(--bd);
                color:var(--tx);border-radius:3px;padding:0.25rem 0.5rem;cursor:pointer;font-size:0.75rem;"
                title="Go up one directory">↑</button>
        <input id="jbBrowsePathInput" type="text" placeholder="Enter path..."
               style="flex:1;background:var(--sf);border:1px solid var(--bd);color:var(--tx);
               padding:0.3rem 0.5rem;border-radius:3px;font-size:0.75rem;font-family:monospace;"
               onkeypress="if(event.key==='Enter')jbBrowseGo(this.value)">
        <button onclick="jbBrowseGo(document.getElementById('jbBrowsePathInput').value)"
                style="background:var(--ac);border:1px solid var(--ac);color:#fff;
                border-radius:3px;padding:0.25rem 0.7rem;cursor:pointer;font-size:0.75rem;">Go</button>
      </div>
      
      <!-- Breadcrumb -->
      <div id="jbBrowseBreadcrumb" style="padding:0.4rem 1rem;font-size:0.7rem;color:var(--dm);
                                           border-bottom:1px solid var(--bd);min-height:1.5rem;"></div>
      
      <!-- Folder/File List -->
      <div id="jbBrowseList" style="flex:1;overflow-y:auto;padding:0.5rem;min-height:250px;max-height:450px;">
        <div style="color:var(--dm);font-size:0.75rem;padding:1rem;text-align:center;">Loading...</div>
      </div>
      
      <!-- Selected file indicator -->
      <div id="jbBrowseSelectedIndicator" style="display:none;padding:0.5rem 1rem;background:rgba(88,166,255,0.1);
                                                  border-top:1px solid var(--bd);font-size:0.75rem;color:var(--ac);">
        Selected: <span id="jbBrowseSelectedName" style="font-family:monospace;"></span>
      </div>
      
      <!-- Footer -->
      <div style="padding:0.8rem 1rem;border-top:1px solid var(--bd);display:flex;gap:0.5rem;justify-content:flex-end;">
        <button onclick="closeBrowseModal()" style="background:var(--sf);border:1px solid var(--bd);
                color:var(--tx);border-radius:3px;padding:0.4rem 1rem;cursor:pointer;font-size:0.8rem;">Cancel</button>
        <button id="jbBrowseSelectBtn" onclick="jbBrowseSelectCurrent()" 
                style="background:var(--ac);border:1px solid var(--ac);
                color:#fff;border-radius:3px;padding:0.4rem 1rem;cursor:pointer;font-size:0.8rem;">
          Select
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on Esc key
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && modal.style.display === 'flex'){
      closeBrowseModal();
    }
  });
}

// ── Open modal and navigate to starting path ──
function openBrowseModal(inputId){
  _jbBrowseTarget = document.getElementById(inputId);
  _jbBrowseSelectedFile = null;
  
  // Update modal title based on mode
  var titleEl = document.getElementById('jbBrowseModalTitle');
  if(titleEl){
    titleEl.textContent = _jbBrowseMode === 'file' ? 'Select File' : 'Select Directory';
  }
  
  // Update button text
  var btn = document.getElementById('jbBrowseSelectBtn');
  if(btn){
    if(_jbBrowseMode === 'file'){
      btn.textContent = 'Select File';
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.textContent = 'Select Current Path';
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  }
  
  // Hide selected indicator
  var indicator = document.getElementById('jbBrowseSelectedIndicator');
  if(indicator) indicator.style.display = 'none';
  
  // Determine starting path — must be absolute to avoid relative path bugs
  var rawVal = (_jbBrowseTarget && _jbBrowseTarget.value.trim()) || '';
  var _defaultRoot = (window._activeBrowseRoot === 'server' && window._serverGvfsPath)
    ? window._serverGvfsPath : '/';
  var startPath = rawVal.startsWith('/') ? rawVal : _defaultRoot;
  // If input has a file path, navigate to its parent directory
  if(_jbBrowseMode === 'file' && startPath.includes('/')){
    startPath = startPath.substring(0, startPath.lastIndexOf('/')) || '/';
  }
  
  // Show modal
  var modal = document.getElementById('jbBrowseModal');
  modal.style.display = 'flex';
  
  // Navigate to starting path
  jbBrowseGo(startPath);
}

// ── Close modal ──
function closeBrowseModal(){
  var modal = document.getElementById('jbBrowseModal');
  if(modal) modal.style.display = 'none';
  _jbBrowseTarget = null;
  _jbBrowseSelectedFile = null;
}

// ── Navigate to a path ──
async function jbBrowseGo(path){
  if(!path) path = '.';
  _jbBrowsePath = path;
  _jbBrowseSelectedFile = null; // Clear selection when navigating
  
  // Update path input
  var pathInput = document.getElementById('jbBrowsePathInput');
  if(pathInput) pathInput.value = path;
  
  // Update breadcrumb
  updateBreadcrumb(path);
  
  // Hide selection indicator
  var indicator = document.getElementById('jbBrowseSelectedIndicator');
  if(indicator) indicator.style.display = 'none';
  
  // Reset button state in file mode
  if(_jbBrowseMode === 'file'){
    var btn = document.getElementById('jbBrowseSelectBtn');
    if(btn){
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
  }
  
  // Fetch directory contents
  var listEl = document.getElementById('jbBrowseList');
  if(!listEl) return;
  
  listEl.innerHTML = '<div style="color:var(--dm);font-size:0.75rem;padding:1rem;text-align:center;">Loading...</div>';
  
  try {
    // Use free browse for absolute paths, restricted browse for workspace-relative
    var isAbs = path.startsWith('/') || path === '..';
    var endpoint = isAbs ? '/api/files/browse_free?path=' : '/api/files/browse?path=';
    var response = await fetch(endpoint + encodeURIComponent(path));
    var data = await response.json();
    
    var allItems = data.items || [];
    
    // Filter items based on mode
    var items;
    if(_jbBrowseMode === 'file'){
      // Show folders and common file types
      items = allItems.filter(i =>
        i.is_dir ||
        ['.mrc','.dm4','.rec','.star','.tlt','.mdoc','.xml','.json','.txt','.sh','.py',
         '.tif','.tiff','.eer','.xf','.dm3'].includes(i.ext)
      );
    } else {
      // Folder mode: show folders AND files so user can confirm they're in the right directory
      // Limit files shown to avoid overwhelming the list (show first 200)
      var dirs  = allItems.filter(i => i.is_dir);
      var files = allItems.filter(i => !i.is_dir).slice(0, 200);
      items = dirs.concat(files);
    }
    
    if(items.length === 0){
      listEl.innerHTML = '<div style="color:var(--dm);font-size:0.75rem;padding:1rem;text-align:center;">Empty directory</div>';
      return;
    }
    
    // Render list
    listEl.innerHTML = items.map(item => {
      var icon = item.is_dir ? '📁' : '📄';
      var sizeStr = (item.size && item.size > 0) ? formatSize(item.size) : '';
      var isFile = !item.is_dir;
      
      return `<div onclick="jbBrowseSelect('${item.path}', ${isFile})" 
                   style="padding:0.5rem 0.7rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;
                          border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.78rem;color:var(--tx);"
                   onmouseover="this.style.background='var(--sf2)'"
                   onmouseout="this.style.background=''">
                <span style="flex-shrink:0;">${icon}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.name}</span>
                ${sizeStr ? `<span style="font-size:0.7rem;color:var(--dm);font-family:monospace;">${sizeStr}</span>` : ''}
              </div>`;
    }).join('');
    
  } catch(e) {
    listEl.innerHTML = '<div style="color:var(--rd);font-size:0.75rem;padding:1rem;">Error: ' + (e.message || 'Failed to load directory') + '</div>';
  }
}

// ── Format file size ──
function formatSize(bytes){
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if(bytes < 1024*1024*1024) return (bytes/(1024*1024)).toFixed(1) + ' MB';
  return (bytes/(1024*1024*1024)).toFixed(1) + ' GB';
}

// ── Update breadcrumb navigation ──
function updateBreadcrumb(path){
  var breadcrumb = document.getElementById('jbBrowseBreadcrumb');
  if(!breadcrumb) return;
  
  if(path === '.' || path === ''){
    breadcrumb.innerHTML = '📍 workspace';
    return;
  }
  
  if(path === '/'){
    breadcrumb.innerHTML = '📍 <span onclick="jbBrowseGo(\'/\')" style="cursor:pointer;color:var(--ac);">/</span>';
    return;
  }
  
  var parts = path.split('/').filter(Boolean);
  if(parts.length === 0){
    breadcrumb.innerHTML = '📍 /';
    return;
  }
  
  breadcrumb.innerHTML = '📍 ' + parts.map((part, i) => {
    var partPath = '/' + parts.slice(0, i + 1).join('/');
    return `<span onclick="jbBrowseGo('${partPath}')" style="cursor:pointer;color:var(--ac);text-decoration:underline;">${part}</span>`;
  }).join(' <span style="color:var(--dm);">/</span> ');
}

// ── Go up one directory ──
function jbBrowseUp(){
  if(_jbBrowsePath === '/' || _jbBrowsePath === '.') return;
  
  var parts = _jbBrowsePath.split('/').filter(Boolean);
  parts.pop();
  
  var parent = parts.length === 0 ? '/' : '/' + parts.join('/');
  jbBrowseGo(parent);
}

// ── Select a folder/file ──
function jbBrowseSelect(path, isFile){
  if(isFile && _jbBrowseMode === 'file'){
    // File clicked in file mode → select it
    _jbBrowseSelectedFile = path;
    
    // Show selected indicator
    var indicator = document.getElementById('jbBrowseSelectedIndicator');
    var nameEl = document.getElementById('jbBrowseSelectedName');
    if(indicator && nameEl){
      nameEl.textContent = path.split('/').pop();
      indicator.style.display = 'block';
    }
    
    // Enable select button
    var btn = document.getElementById('jbBrowseSelectBtn');
    if(btn){
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  } else {
    // Folder clicked → navigate into it
    jbBrowseGo(path);
  }
}

// ── Select current path or selected file ──
function jbBrowseSelectCurrent(){
  if(!_jbBrowseTarget){
    console.warn('[jbBrowseSelectCurrent] No target input set');
    return;
  }
  
  var selectedPath;
  
  if(_jbBrowseMode === 'file' && _jbBrowseSelectedFile){
    // File mode: use selected file
    selectedPath = _jbBrowseSelectedFile;
  } else {
    // Folder mode: use current path
    selectedPath = _jbBrowsePath;
  }
  
  // Safety check: selectedPath must be absolute
  if(!selectedPath || !selectedPath.startsWith('/')){
    console.error('[jbBrowseSelectCurrent] Path is not absolute:', selectedPath);
    selectedPath = selectedPath || '';
  }

  // Write to input field
  if(_jbBrowseTarget){
    _jbBrowseTarget.value = selectedPath;
    _jbBrowseTarget.dispatchEvent(new Event('input')); // Trigger updPrev()
    // Flash feedback
    _jbBrowseTarget.style.borderColor = 'var(--gn)';
    setTimeout(() => { if(_jbBrowseTarget) _jbBrowseTarget.style.borderColor = ''; }, 1500);
  }

  // Close modal
  closeBrowseModal();

  console.log('[jbBrowseModal] Selected:', selectedPath);
}