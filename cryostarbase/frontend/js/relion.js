/* CryoSTAR-Base — relion.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ── RELION Classification Analysis ──────────────────────────────────────────
function toggleRelionAnalysis(){
  var body=$('relionAnalysisBody'), chev=$('relionAnalysisChev');
  if(!body)return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'';
  if(chev)chev.style.transform=open?'rotate(-90deg)':'';
}

// ── Inline STAR file browser for Classification Analysis ────────────────────
var _raBrowserOpen = false;
var _raBrowserCurPath = '.';

function raToggleBrowser(){
  _raBrowserOpen = !_raBrowserOpen;
  var pane=$('raBrowserPane');
  var btn=$('raBrowseBtn');
  if(pane) pane.style.display = _raBrowserOpen ? '' : 'none';
  if(btn) btn.textContent = _raBrowserOpen ? 'Browse ▴' : 'Browse ▾';
  if(_raBrowserOpen){
    // Start in project's relion_sta dir — workspace-relative path
    var startPath = curProj ? curProj+'/relion_sta' : (curProj||'.');
    raBrowserGo(startPath);
  }
}

function raCloseBrowser(){
  _raBrowserOpen = false;
  var pane=$('raBrowserPane'); if(pane) pane.style.display='none';
  var btn=$('raBrowseBtn'); if(btn) btn.textContent='Browse ▾';
}

async function raBrowserGo(path){
  _raBrowserCurPath = path;
  var pathTxt=$('raBrowserPathTxt');
  if(pathTxt) pathTxt.textContent = path;
  var list=$('raBrowserList');
  if(!list) return;
  list.innerHTML='<div style="padding:.3rem .5rem;color:var(--dm);font-size:.72rem">Loading…</div>';
  try{
    // Try workspace-relative browse first, fall back to browse_free for absolute paths
    var isAbs = path.startsWith('/');
    var endpoint = isAbs ? '/api/files/browse_free?path=' : '/api/files/browse?path=';
    const d = await api(endpoint+encodeURIComponent(path));
    if(!d.items||!d.items.length){
      list.innerHTML='<div style="padding:.3rem .5rem;color:var(--dm);font-size:.72rem">Empty — no .star files found here</div>';
      return;
    }
    // Filter: show dirs + .star files only
    var items=d.items.filter(function(i){return i.is_dir||(i.name&&i.name.endsWith('.star'));});
    if(!items.length){
      list.innerHTML='<div style="padding:.3rem .5rem;color:var(--dm);font-size:.72rem">No .star files in this directory — try a subdirectory</div>';
      return;
    }
    list.innerHTML = items.map(function(item){
      var isStar = item.name.endsWith('.star');
      var isDir = item.is_dir;
      var icon = isDir ? '📁' : '⭐';
      var col = isStar ? 'var(--gn)' : 'var(--ac)';
      var itemPath = item.path || (path.replace(/\/+$/,'') + '/' + item.name);
      var onclick = isDir
        ? 'raBrowserGo(\''+itemPath+'\')'
        : 'raBrowserSelect(\''+itemPath+'\')';
      var bg = isStar ? 'rgba(63,185,80,.06)' : 'transparent';
      var hover = isStar
        ? 'onmouseover="this.style.background=\'rgba(63,185,80,.14)\'" onmouseout="this.style.background=\'rgba(63,185,80,.06)\'"'
        : 'onmouseover="this.style.background=\'rgba(88,166,255,.08)\'" onmouseout="this.style.background=\'transparent\'"';
      return '<div onclick="'+onclick+'" '+hover+' style="display:flex;align-items:center;gap:.35rem;'+
        'padding:.22rem .45rem;cursor:pointer;background:'+bg+';'+
        'border-bottom:0.5px solid var(--bd)">'+
        '<span style="font-size:.75rem">'+icon+'</span>'+
        '<span style="font-size:.73rem;color:'+col+';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+item.name+'</span>'+
        (isStar?'<span style="font-size:.62rem;color:var(--gn);flex-shrink:0">select ✓</span>':
                '<span style="font-size:.62rem;color:var(--dm);flex-shrink:0">→</span>')+
      '</div>';
    }).join('');
  }catch(e){
    // If path doesn't exist, show project root instead
    if(e.message&&(e.message.includes('404')||e.message.includes('Not a dir'))){
      if(path!=='.'&&path!==curProj){
        raBrowserGo(curProj||'.');
      }else{
        list.innerHTML='<div style="padding:.3rem .5rem;color:var(--dm);font-size:.72rem">Select a project first, then browse.</div>';
      }
    }else{
      list.innerHTML='<div style="padding:.3rem .5rem;color:var(--rd);font-size:.72rem">'+e.message+'</div>';
    }
  }
}

function raBrowserUp(){
  var parts = _raBrowserCurPath.replace(/\/+$/,'').split('/').filter(Boolean);
  if(parts.length <= 1){ raBrowserGo('.'); return; }
  parts.pop();
  raBrowserGo(parts.join('/'));
}

async function raBrowserSelect(wsRelPath){
  var inp=$('raClasStar');
  if(!inp)return;
  // Get absolute path via browse on the PARENT directory, then find the file
  var absPath=wsRelPath;
  try{
    var parentPath=wsRelPath.split('/').slice(0,-1).join('/')||'.';
    var d=await api('/api/files/browse?path='+encodeURIComponent(parentPath));
    if(d&&d.abs){
      // d.abs is absolute path of parent dir
      var fname=wsRelPath.split('/').pop();
      absPath=d.abs.replace(/\/+$/,'')+'/'+fname;
    }
  }catch(e){
    // fallback: use workspace-relative path as-is
  }
  inp.value=absPath;
  inp.dispatchEvent(new Event('input'));
  inp.style.borderColor='var(--gn)';
  setTimeout(function(){if(inp)inp.style.borderColor='';},1500);
  raCloseBrowser();
  raUpdateCmd();
}

function raToggleInsights(){
  var body=$('raInsightsBody'), chev=$('raInsightsChev');
  if(!body)return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'';
  if(chev)chev.style.transform=open?'rotate(-90deg)':'';
}

function raUpdateCmd(){
  var star=($('raClasStar')||{}).value||'';
  var kg=($('raKnownGood')||{}).value||'';
  var px=($('raPixelSize')||{}).value||'';
  var hz=($('raHalfZ')||{}).value||'';
  var lcc=($('raLccCutoff')||{}).value||'';

  if(!star){var c=$('raCmd');if(c)c.textContent='Select a STAR file above.';return;}

  // Use sys.executable path from server (ensures same venv as server)
  var scriptsDir=window._raScriptsDir||'';
  var scriptPath=scriptsDir?scriptsDir+'/analyze_relion_classes.py':'analyze_relion_classes.py';
  var pyExe=window._raPythonExe||'python3';
  var cmd=pyExe+' '+scriptPath+' \\\n';
  cmd+='  --input '+star;
  if(kg) cmd+=' \\\n  --known-good '+kg;
  if(px) cmd+=' \\\n  --pixel-size '+px;
  if(hz) cmd+=' \\\n  --tomo-half-z '+hz;
  if(lcc) cmd+=' \\\n  --lcc-cutoff '+lcc;

  var c=$('raCmd');if(c)c.textContent=cmd;
}

var _raLastOutput='';

async function raRun(){
  var star=($('raClasStar')||{}).value||'';
  if(!star){$('raStatus').textContent='Please select a STAR file.';return;}
  if(!curProj){$('raStatus').textContent='No project selected.';return;}

  var stat=$('raStatus');
  stat.textContent='Running…'; stat.style.color='var(--dm)';

  var cmd=$('raCmd')?$('raCmd').textContent:'';
  if(!cmd){raUpdateCmd();cmd=$('raCmd').textContent;}
  // textContent from <pre> has real newlines — collapse them into spaces for the shell
  // (the \ line-continuation display chars also come through as literal \)
  cmd = cmd.replace(/\\\s*\n\s*/g,' ').replace(/\n+/g,' ').trim();

  // Use project dir as working_dir so relative paths in the command work
  var workDir='.';
  try{
    var cfg=await api('/api/projects/'+curProj+'/config');
    if(cfg.project_dir)workDir=cfg.project_dir;
  }catch(e2){}

  try{
    const r=await post('/api/scripts/run',{command:cmd,working_dir:workDir,project:curProj||''});
    var ok=r.exit_code===0;
    if(ok){
      stat.textContent='✓ Done';stat.style.color='var(--gn)';
    }else{
      var errSnip=(r.output||'').split('\n').filter(l=>l.includes('ERROR')||l.includes('Traceback')||l.includes('error')).slice(0,2).join(' ');
      stat.textContent='✖ '+(errSnip||'Error — check command');
      stat.style.color='var(--rd)';
    }

    // Try to load the markdown insights
    var mdPath=star.replace('.star','_class_analysis.md');
    try{
      const md=await api('/api/files/read?path='+encodeURIComponent(mdPath));
      if(md&&md.content){
        raShowInsights(md.content);
        // Save output path for "Open plot"
        _raLastOutput=star.replace('.star','_class_analysis.pdf');
      }
    }catch(e2){
      // Try with output from command
      if(r.output){
        var m=r.output.match(/Plot saved → (.+\.pdf)/);
        if(m){_raLastOutput=m[1].trim();}
        var mdM=r.output.match(/Insights saved → (.+\.md)/);
        if(mdM){
          try{
            const md2=await api('/api/files/read?path='+encodeURIComponent(mdM[1].trim()));
            if(md2&&md2.content)raShowInsights(md2.content);
          }catch(e3){}
        }
      }
    }

    // Log to notebook
    await post('/api/notes',{project:curProj,
      text:'[RELION Class Analysis]\n  Input: '+star+'\n  '+stat.textContent});
    loadNotes();nbMarkPending();

  }catch(e){
    stat.textContent='Error: '+(e.message||e);
    stat.style.color='var(--rd)';
  }
}

function raShowInsights(mdText){
  var wrap=$('raInsightsWrap'), body=$('raInsightsBody');
  if(!wrap||!body)return;
  wrap.style.display='';
  body.style.display='';
  var chev=$('raInsightsChev');if(chev)chev.style.transform='';
  // Convert markdown to simple HTML
  var html=mdText
    .replace(/^### (.+)$/gm,'<strong style="color:var(--ac)">$1</strong>')
    .replace(/^## (.+)$/gm,'<div style="font-weight:700;margin:.5rem 0 .2rem;color:var(--tx)">$1</div>')
    .replace(/^# (.+)$/gm,'<div style="font-weight:700;font-size:.88rem;margin:.3rem 0;color:var(--tx)">$1</div>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`(.+?)`/g,'<code style="font-size:.72rem;background:var(--sf2);padding:.05rem .2rem;border-radius:3px">$1</code>')
    .replace(/^- (⚠.+)$/gm,'<div style="padding:.2rem .35rem;margin:.15rem 0;border-left:3px solid var(--yl);background:rgba(210,153,34,.06);border-radius:0 4px 4px 0">$1</div>')
    .replace(/^- (✓.+)$/gm,'<div style="padding:.2rem .35rem;margin:.15rem 0;border-left:3px solid var(--gn);background:rgba(63,185,80,.05);border-radius:0 4px 4px 0">$1</div>')
    .replace(/^- (ℹ.+)$/gm,'<div style="padding:.2rem .35rem;margin:.15rem 0;border-left:3px solid var(--ac);background:rgba(88,166,255,.05);border-radius:0 4px 4px 0">$1</div>')
    .replace(/^- (.+)$/gm,'<div style="padding:.1rem 0 .1rem .6rem">• $1</div>')
    .replace(/\|(.+)\|/g, function(m){
      if(/^\|[\s\-:|]+\|$/.test(m)) return '';
      var cells=m.split('|').filter(Boolean).map(function(c){
        return '<td style="padding:.15rem .4rem;border:0.5px solid var(--bd)">'+c.trim()+'</td>';
      });
      return '<tr>'+cells.join('')+'</tr>';
    })
    .replace(/(<tr>.+<\/tr>\n?)+/g, function(m){return '<table style="border-collapse:collapse;font-size:.73rem;margin:.3rem 0">'+m+'</table>';});
  body.innerHTML=html;
  body.style.display='';
  var chev=$('raInsightsChev');
  if(chev)chev.style.transform='';
}

function raOpenOutput(){
  if(!_raLastOutput){$('raStatus').textContent='Run analysis first.';return;}
  window.open('/api/files/image?path='+encodeURIComponent(_raLastOutput),'_blank');
}

// Auto-fill pixel size and half-Z from project config when RELION tab opens
async function relionAnalysisAutoFill(){
  if(!curProj)return;
  try{
    // Get scripts dir from health endpoint
    if(!window._raScriptsDir){
      try{
        var h=await api('/api/health');
        if(h.scripts_dir)window._raScriptsDir=h.scripts_dir;
        if(h.python_executable)window._raPythonExe=h.python_executable;
      }catch(e){}
    }
    var c=await api('/api/projects/'+curProj+'/config');
    var pxEl=$('raPixelSize');
    if(pxEl&&!pxEl.value&&c.pixel_size)pxEl.value=c.pixel_size;
    if(c.tomo_dims&&c.tomo_dims.length>=3){
      var hzEl=$('raHalfZ');
      if(hzEl&&!hzEl.value)hzEl.value=Math.round(c.tomo_dims[2]/2);
    }
    raUpdateCmd();
  }catch(e){}
}

// ── RELION Class3D smart analysis — called when input_star field changes in Job Builder ──
async function relionClass3dAnalyzeStar(starPath){
  if(!starPath||starPath.length<4)return;
  try{
    const d=await api('/api/relion/analyze_star?path='+encodeURIComponent(starPath));
    if(d.error){console.warn('STAR analysis:',d.error);return;}
    // Fill K field
    var kEl=document.getElementById('tp_K');
    if(kEl&&(!kEl.value||kEl.dataset.autoFilled)){
      kEl.value=d.K_suggested;kEl.dataset.autoFilled='1';
      kEl.style.borderColor='rgba(63,185,80,.4)';kEl.style.background='rgba(63,185,80,.03)';
    }
    // Show info badge
    var info=document.getElementById('relionClass3dInfo');
    if(info){
      var typeColor=d.is_3d_sta?'#06b6d4':'#bc8cff';
      info.innerHTML='<span style="color:'+typeColor+';font-weight:700">'+d.type+'</span>'
        +' · N=<b style="color:var(--tx)">'+d.n_particles.toLocaleString()+'</b>'
        +' · K=<b style="color:#3fb950">'+d.K_suggested+'</b> (√N/200)'
        +(d.relion_version?' · RELION <b style="color:var(--tx)">'+d.relion_version+'</b>':'');
      info.style.display='';
    }
    // Trigger Crowther recalc with current project values
    await relionClass3dCalcCrowther();
    updPrev();
  }catch(e){console.error('relionClass3dAnalyzeStar',e);}
}

async function relionClass3dCalcCrowther(){
  // Read pixel_size from project config, diameter from param field
  try{
    var pxEl=document.getElementById('tp_healpix_order');
    if(!pxEl)return;
    // Get project config pixel_size and particle_diameter
    if(!curProj)return;
    const cfg=await api('/api/projects/'+curProj+'/config');
    var px=cfg.pixel_size||0;
    var diam=cfg.particle_diameter||0;
    if(!px||!diam)return;
    const d=await api('/api/relion/crowther?pixel_size='+px+'&diameter='+diam);
    if(d.order){
      if(!pxEl.dataset.userEdited){
        pxEl.value=d.order;
        pxEl.style.borderColor='rgba(63,185,80,.4)';pxEl.style.background='rgba(63,185,80,.03)';
      }
      var info=document.getElementById('relionClass3dCrowtherInfo');
      if(info){
        info.textContent='Crowther → Order '+d.order+' = '+d.angle_deg+'° sampling (min required: '+d.crowther_deg+'°) · Nyquist '+d.nyquist+' Å  [HEALPix = sphere grid, not helical]';
        info.style.display='';
      }
      updPrev();
    }
  }catch(e){}
}

// Wire up relion_class3d specific behaviour when template is selected
function _relionClass3dSetup(){
  // Add change listener to input_star field
  setTimeout(function(){
    var inp=document.getElementById('tp_input_star');
    if(inp&&!inp._relionWired){
      inp._relionWired=true;
      inp.addEventListener('change',function(){relionClass3dAnalyzeStar(this.value);});
      inp.addEventListener('blur',function(){relionClass3dAnalyzeStar(this.value);});
    }
    var hpEl=document.getElementById('tp_healpix_order');
    if(hpEl)hpEl.addEventListener('input',function(){this.dataset.userEdited='1';});
    var kEl=document.getElementById('tp_K');
    if(kEl)kEl.addEventListener('input',function(){delete this.dataset.autoFilled;});
    // Auto-run Crowther calc
    relionClass3dCalcCrowther();
    // Add info divs if not present
    _relionClass3dInjectInfoDivs();
  },200);
}

function _relionClass3dInjectInfoDivs(){
  var parF=document.getElementById('parF');
  if(!parF)return;
  // Info box after input_star
  if(!document.getElementById('relionClass3dInfo')){
    var div=document.createElement('div');
    div.id='relionClass3dInfo';
    div.style.cssText='display:none;margin:-.2rem 0 .4rem;padding:.25rem .45rem;background:rgba(6,182,212,.07);border:0.5px solid rgba(6,182,212,.25);border-radius:5px;font-size:.72rem;color:var(--dm)';
    parF.insertBefore(div,parF.children[1]||null);
  }
  // Crowther info after healpix_order
  if(!document.getElementById('relionClass3dCrowtherInfo')){
    var div2=document.createElement('div');
    div2.id='relionClass3dCrowtherInfo';
    div2.style.cssText='display:none;margin:-.3rem 0 .3rem .3rem;font-size:.68rem;color:#3fb950';
    var hpLabel=parF.querySelector('label[for="tp_healpix_order"]');
    if(hpLabel&&hpLabel.closest('.fi'))hpLabel.closest('.fi').after(div2);
    else parF.appendChild(div2);
  }
}

// ── WarpTools Job Selector ──
async function relionPopulateWarpJobs(){
  if(!curProj)return;
  var sel=document.getElementById('relionWarpJob');
  if(!sel)return;
  try{
    var d=await api('/api/projects/'+curProj+'/jobs');
    var exportJobs=(d.jobs||[]).filter(function(j){
      return (j.job_type==='warp_export_particles'||j.job_type==='warp_export_slurm')
        &&j.status==='completed';
    });
    sel.innerHTML='<option value="">— select a completed export job —</option>';
    if(!exportJobs.length){
      document.getElementById('relionWarpEmpty').style.display='';
      document.getElementById('relionWarpInfo').style.display='none';
    }else{
      document.getElementById('relionWarpEmpty').style.display='none';
      exportJobs.forEach(function(j){
        var opt=document.createElement('option');
        opt.value=j.job_id;
        var t=j.custom_title||j.title||j.job_type;
        // Extract mode from command if possible
        var mode2d=j.command&&j.command.includes('--2d');
        opt.textContent=j.job_id+' — '+t+(mode2d?' [2D]':' [3D]');
        opt.dataset.job=JSON.stringify(j);
        sel.appendChild(opt);
      });
      // Auto-select latest
      if(exportJobs.length>0){sel.value=exportJobs[exportJobs.length-1].job_id;relionSelectWarpJob();}
    }
  }catch(e){console.error('relionPopulateWarpJobs',e);}
}

function relionCopyField(id){
  var el=document.getElementById(id);
  if(!el)return;
  navigator.clipboard.writeText(el.textContent||el.innerText||'');
  var orig=el.style.color;
  el.style.color='var(--yl)';
  setTimeout(function(){el.style.color=orig;},600);
}

function relionSelectWarpJob(){
  var sel=document.getElementById('relionWarpJob');
  if(!sel||!sel.value)return;
  var opt=sel.options[sel.selectedIndex];
  var j;
  try{j=JSON.parse(opt.dataset.job||'null');}catch(e){return;}
  if(!j)return;

  // Parse parameters from command string
  var cmd=j.command||'';
  function getParam(flag){
    var m=cmd.match(new RegExp(flag+'\\s+([^\\s]+)'));
    return m?m[1]:'';
  }

  var outputStar=getParam('--output_star')||
    (j.output_files&&j.output_files.find(function(f){return f.endsWith('.star');})||'');
  var outputProc=getParam('--output_processing')||'';
  var outputAngpix=getParam('--output_angpix')||
    (j.parameters&&j.parameters.output_angpix)||'';
  var box=getParam('--box')||(j.parameters&&j.parameters.box)||'';
  var is2d=cmd.includes('--2d');
  var is3d=cmd.includes('--3d');

  // Derive STAR file names from output_star or output_processing
  var baseStar=outputStar||'matching.star';
  var baseNoExt=baseStar.replace(/\.star$/,'');
  var optSet=baseNoExt+'_optimisation_set.star';
  var tomosStar=baseNoExt+'_tomograms.star';

  // RELION version recommendation
  var relionVer=is2d?'RELION 5 (--tomo, 2D stacks)':'RELION 4 (3D sub-volumes)';
  var modeLabel=is2d?'2D image series':'3D sub-volumes';

  // Launch command
  var launchCmd=is2d?
    'module load relion/5.0.1\nrelion --tomo &':
    'module load relion/4.0\nrelion --tomo &';

  // Update UI
  function rSt(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  rSt('rwMode',modeLabel);
  rSt('rwRelionVer',relionVer);
  rSt('rwAngpix',outputAngpix?(outputAngpix+' Å/px'):'— (from job params)');
  rSt('rwBox',box?(box+' px'):'— (from job params)');
  rSt('rwOptSet',optSet);
  rSt('rwParticlesStar',baseStar);
  rSt('rwTomosStar',tomosStar);
  rSt('rwProcDir',outputProc||'— (from job params)');
  rSt('rwLaunchCmd',launchCmd);

  // Mode advisory
  var adv=document.getElementById('rwModeAdvisory');
  if(adv){
    if(is2d){
      adv.style.borderColor='var(--ac)';
      adv.style.background='rgba(88,166,255,.04)';
      adv.innerHTML='<strong style="color:var(--ac)">2D stacks → use RELION 5 --tomo</strong><br>'+
        'Input: <code>'+optSet+'</code><br>'+
        'If you see <em>"relion-4 definition of projection matrices"</em> warnings — these can be ignored.<br>'+
        'Start with <strong>3D Auto-refine (K=1)</strong> to align, then <strong>3D Classification</strong> to sort.';
    }else{
      adv.style.borderColor='var(--pr)';
      adv.style.background='rgba(188,140,255,.04)';
      adv.innerHTML='<strong style="color:var(--pr)">3D volumes → use RELION 4 or 3</strong><br>'+
        'Input: <code>'+baseStar+'</code><br>'+
        'Note: 3D volumes are easier to handle. For local refinement (RELION 3), 3D volumes are required.';
    }
  }

  // Update Dataset Parameters with job values
  if(outputAngpix){
    // Reverse-engineer raw + binning from output angpix if possible
    var ap=parseFloat(outputAngpix);
    if(ap>0){
      // Try to find binning: raw_pix = ap / bin
      var pix=document.getElementById('staPixelSize');
      var raw=pix&&pix.value?parseFloat(pix.value):0;
      if(raw>0){
        var inferBin=Math.round(ap/raw);
        if(inferBin>=1&&inferBin<=16){
          var bs=document.getElementById('staBinning');
          if(bs)bs.value=String([8,4,2,1].reduce(function(a,x){
            return Math.abs(x-inferBin)<Math.abs(a-inferBin)?x:a;}));
        }
      }
    }
  }
  if(box){var bi=document.getElementById('relionBoxSize');if(bi)bi.textContent=box+' px';
    var bi2=document.getElementById('relionBoxSize2');if(bi2)bi2.textContent=box;}

  document.getElementById('relionWarpInfo').style.display='';
  document.getElementById('relionSaveCard').style.display='';
  relionAll();
}

// ── Save calculations to Notebook ──
async function relionSaveToNotebook(){
  if(!curProj)return;
  var label=document.getElementById('relionSaveLabel').value.trim()||'RELION calculator results';
  var d=relionGetInputs();
  var t=_calcT(d.dEff);
  var localRange=Math.max(5,Math.min(15,Math.round(0.12*d.dEff)));
  var lp=d.lp>0?d.lp+'Å':'Nyquist ('+d.nyquist.toFixed(1)+'Å)';

  // Crowther
  var crGlobal=document.getElementById('crGlobal')?document.getElementById('crGlobal').textContent:'—';
  var crLocal=document.getElementById('crLocal')?document.getElementById('crLocal').textContent:'—';

  // K
  var kVal=document.getElementById('kHeroK')?document.getElementById('kHeroK').textContent:'—';
  var kRange=document.getElementById('kHeroRange')?document.getElementById('kHeroRange').textContent:'—';

  // WarpTools job info
  var optSet=document.getElementById('rwOptSet')?document.getElementById('rwOptSet').textContent:'—';
  var relionVer=document.getElementById('rwRelionVer')?document.getElementById('rwRelionVer').textContent:'—';
  var mode=document.getElementById('rwMode')?document.getElementById('rwMode').textContent:'—';

  var note=[
    '## RELION Parameters — '+label,
    '',
    '**Dataset:** Raw '+d.raw+' Å × Bin '+d.bin+' = '+d.effPix.toFixed(3)+' Å/px effective  |  Diameter: '+d.diam+' Å  |  Symmetry: '+d.sym,
    '',
    '**RELION Setup**',
    '- Version: '+relionVer+' ('+mode+')',
    '- Input: `'+optSet+'`',
    '',
    '**② T · Offset · Angular**  (LP = '+lp+')',
    '- T value: **'+t.prac.toFixed(1)+'** (range '+t.lo.toFixed(1)+'–'+t.hi.toFixed(1)+')',
    '- Offset: **'+d.off+' px** (±'+(d.off*d.effPix).toFixed(1)+' Å)',
    '- Local angular search: **'+localRange+'°**',
    '',
    '**③ Number of Classes K**',
    '- Recommended K: **'+kVal+'** (safe range: '+kRange+')',
    '',
    '**④ Crowther Criterion**',
    '- Global search: '+crGlobal,
    '- Local search: '+crLocal,
    '',
    '**Pipeline reminder:** LP '+lp+' → T='+t.prac.toFixed(1)+'. Lower LP → higher T in next round.',
  ].join('\n');

  try{
    await post('/api/notes',{project:curProj,text:note});
    loadNotes();nbMarkPending();
    var res=document.getElementById('relionSaveRes');
    if(res){
      res.innerHTML='<span style="color:var(--gn);font-size:.75rem">✓ Saved to Notebook</span>';
      setTimeout(function(){res.innerHTML='';},3000);
    }
  }catch(e){
    var res=document.getElementById('relionSaveRes');
    if(res)res.innerHTML='<span style="color:var(--rd);font-size:.75rem">Error: '+e.message+'</span>';
  }
}

function relionSt(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}

async function relionAutoFill(){
  if(!curProj)return;
  try{
    var c=await api('/api/projects/'+curProj+'/config');
    var raw=c.raw_pixel_size||0, bin=c.binning_factor||8;
    var diam=c.particle_diameter||0, box=c.box_size||0;
    var pix=document.getElementById('staPixelSize');
    if(pix&&raw&&!pix.value)pix.value=raw;
    var bs=document.getElementById('staBinning');
    if(bs){var b=String([8,4,2,1].reduce(function(a,x){return Math.abs(x-bin)<Math.abs(a-bin)?x:a;}));bs.value=b;}
    if(diam){var d=document.getElementById('staDiameter');if(d&&!d.value)d.value=diam;
      relionSt('relionMaskDiam',diam+' Å');relionSt('relionMaskDiam2',diam+' Å');}
    if(box){relionSt('relionBoxSize',box+' px');relionSt('relionBoxSize2',box);}
    relionAll();
    relionPopulateWarpJobs();
  }catch(e){console.error('relionAutoFill',e);}
}

function relionGetInputs(){
  var raw=parseFloat(document.getElementById('staPixelSize').value)||0;
  var bin=parseFloat(document.getElementById('staBinning').value)||8;
  var diam=parseFloat(document.getElementById('staDiameter').value)||0;
  var sym=(document.getElementById('crSym').value||'C1').trim().toUpperCase();
  var lp=parseFloat(document.getElementById('staLowpass').value)||0;
  var off=parseInt(document.getElementById('staOffset').value)||2;
  var effPix=raw*bin, nyquist=effPix*2;
  var dEff=lp>0?Math.max(lp,nyquist):nyquist;
  return {raw,bin,diam,sym,lp,off,effPix,nyquist,dEff};
}

function _calcT(dEff){
  var r=5.0-0.9*Math.log(Math.max(1,dEff));
  var c=Math.max(0.5,Math.min(4.0,r));
  return {prac:Math.round(c*2)/2,lo:Math.max(0.5,Math.round(c*0.7*2)/2),hi:Math.min(4.0,Math.round(c*1.5*2)/2)};
}

function relionBuildWorkflow(){
  var d=relionGetInputs();
  if(!d.raw){return;}
  var stages=[
    {name:'Initial cleaning',     bin:8, lp:150, goal:'Remove beads, carbon, ice, junk'},
    {name:'Align + clean',        bin:8, lp:80,  goal:'First alignment, refine particle set'},
    {name:'Fine sort',            bin:4, lp:40,  goal:'Structural states, junk removal'},
    {name:'High-res class.',      bin:2, lp:20,  goal:'Subtle conformational differences'},
  ];
  var tbody=document.getElementById('staWfBody');
  if(!tbody)return;
  tbody.innerHTML='';
  stages.forEach(function(s){
    var sEp=d.raw*s.bin, sNy=sEp*2, sDeff=Math.max(s.lp,sNy);
    var sT=_calcT(sDeff).prac;
    var sOff=Math.max(1,Math.min(5,Math.ceil(20/sEp)));
    var sLocal=Math.max(5,Math.min(15,Math.round(0.12*sDeff)));
    var tCol=sT<=0.5?'var(--yl)':sT<=1?'var(--ac)':sT<=2?'var(--gn)':'var(--pr)';
    var tr=document.createElement('tr');
    tr.style.cursor='pointer';
    tr.title='Click to apply LP='+s.lp+', offset='+sOff;
    tr.addEventListener('mouseover',function(){this.style.background='var(--sf2)';});
    tr.addEventListener('mouseout',function(){this.style.background='';});
    (function(b,l,o){tr.addEventListener('click',function(){relionApplyStage(b,l,o);});})(s.bin,s.lp,sOff);
    tr.innerHTML='<td style="padding:.22rem .4rem;color:var(--tx)">'+s.name+'</td>'+
      '<td style="text-align:center;padding:.22rem .3rem;color:var(--dm)">×'+s.bin+'</td>'+
      '<td style="text-align:center;padding:.22rem .3rem;color:var(--dm)">'+s.lp+'</td>'+
      '<td style="text-align:center;padding:.22rem .3rem;font-weight:700;color:'+tCol+'">'+sT.toFixed(1)+'</td>'+
      '<td style="text-align:center;padding:.22rem .3rem;color:var(--dm)">'+sOff+' px</td>'+
      '<td style="text-align:center;padding:.22rem .3rem;color:var(--dm)">'+sLocal+'°</td>'+
      '<td style="padding:.22rem .4rem;font-size:.7rem;color:var(--dm)">'+s.goal+'</td>';
    tbody.appendChild(tr);
  });
}

function relionApplyStage(bin,lp,off){
  var bs=document.getElementById('staBinning');if(bs)bs.value=String(bin);
  var lEl=document.getElementById('staLowpass');if(lEl)lEl.value=lp;
  var oEl=document.getElementById('staOffset');if(oEl)oEl.value=off;
  relionCalcT();relionCalcCrowther();
  var res=document.getElementById('staResults');
  if(res){res.style.opacity='.4';setTimeout(function(){res.style.opacity='1';},150);}
}

function staSetAlignMode(mode){
  var onStyle='all:unset;cursor:pointer;font-size:.67rem;padding:.18rem .55rem;border-radius:4px;background:var(--sf);border:0.5px solid var(--bd);color:var(--tx);white-space:nowrap';
  var offStyle='all:unset;cursor:pointer;font-size:.67rem;padding:.18rem .55rem;border-radius:4px;background:transparent;color:var(--dm);white-space:nowrap';
  var bW=document.getElementById('staTogWith');
  var bWo=document.getElementById('staTogWithout');
  if(bW)  bW.style.cssText  = mode==='with'?onStyle:offStyle;
  if(bWo) bWo.style.cssText = mode==='without'?onStyle:offStyle;
  // Show/hide offset field
  var offFld=document.getElementById('staOffsetField');
  if(offFld) offFld.style.display = mode==='without'?'none':'';
  // Update mode note in warnings area
  var warns=document.getElementById('staTWarnings');
  if(warns){
    var note=document.getElementById('staNoAlignNote');
    if(mode==='without'){
      if(!note){
        note=document.createElement('div');note.id='staNoAlignNote';
        note.style.cssText='padding:.22rem .4rem;border-left:3px solid var(--ac);'
          +'background:rgba(88,166,255,.06);border-radius:0 4px 4px 0;font-size:.71rem;color:var(--dm);margin-bottom:.2rem';
        note.innerHTML='<strong style="color:var(--tx)">No alignment mode:</strong> T=4 recommended. '
          +'Offset and local angular search not applicable. '
          +'Typical use: False Positive removal after M-refinement (Appel et al. 2026).';
        warns.prepend(note);
      }
    } else {
      if(note) note.remove();
    }
  }
  relionCalcT();
}

function relionCalcT(){
  var d=relionGetInputs();
  if(!d.raw)return;
  relionSt('rdEffPix',d.effPix.toFixed(3)+' Å');
  relionSt('rdNyquist',d.nyquist.toFixed(1)+' Å');
  relionSt('relionEffPix2',d.effPix.toFixed(3)+' Å');
  relionSt('relionOffAng2',(d.off*d.effPix).toFixed(1)+' Å');
  var t=_calcT(d.dEff);
  relionSt('staHeroT',t.prac.toFixed(1));
  relionSt('staHeroTRange',t.lo.toFixed(1)+' – '+t.hi.toFixed(1));
  relionSt('staHeroOff',String(d.off));
  relionSt('staHeroOffA','±'+(d.off*d.effPix).toFixed(1)+' Å');
  relionSt('staHeroLocalRange',Math.max(5,Math.min(15,Math.round(0.12*d.dEff)))+'°');
  var warns='';
  if(d.lp>0&&d.lp<d.nyquist)
    warns+='<div style="padding:.22rem .4rem;border-left:3px solid var(--yl);background:rgba(210,153,34,.06);border-radius:0 4px 4px 0;font-size:.71rem;color:var(--yl)">⚠ LP '+d.lp+' Å is finer than Nyquist — no effect.</div>';
  if(!d.lp&&d.bin>=4)
    warns+='<div style="padding:.22rem .4rem;border-left:3px solid var(--yl);background:rgba(210,153,34,.06);border-radius:0 4px 4px 0;font-size:.71rem;color:var(--yl)">⚠ No LP at bin'+d.bin+'. Recommend 60–150 Å for initial STA cleaning.</div>';
  var we=document.getElementById('staTWarnings');if(we)we.innerHTML=warns;
  document.getElementById('staResults').style.display='';
}

function relionCalcK(){
  // ── v3 algorithm from RELION guide (Scheres 2012a,b) ──
  var N=parseInt(document.getElementById('kN').value)||0;
  var Nm=parseInt(document.getElementById('kNmin').value)||0;
  var nt=parseInt(document.getElementById('kTomos').value)||1;
  var T=parseFloat(document.getElementById('kT').value)||0.5;
  var d=relionGetInputs();
  var ep=d.effPix||d.raw*d.bin;
  if(!N||!Nm||!ep)return;

  var f=Nm/N;
  var ny=ep*2;
  // T_ref: reference T for this effective pixel size (from RELION guide formula)
  var Tr=Math.max(0.5,Math.min(4.0,4.0*Math.pow(1.5/ep,0.667)));
  var Trat=T/Tr;

  // Step 1 — base K from log10(N)
  var Kb=Math.round(1.5*Math.log10(N))+1;

  // Step 2 — fraction adjustment
  var Kf;
  if(f>.20)Kf=-2;else if(f>.10)Kf=-1;else if(f>.05)Kf=0;
  else if(f>.02)Kf=1;else if(f>.01)Kf=2;else Kf=3;

  // Step 3 — T-ratio adjustment
  var Kt;
  if(Trat>1.5)Kt=2;else if(Trat>.8)Kt=1;else if(Trat>.4)Kt=0;else Kt=-1;

  // Step 4 — hard caps
  var mv;
  if(ep>=15)mv=50;else if(ep>=10)mv=100;else if(ep>=5)mv=200;
  else if(ep>=3)mv=300;else mv=500;
  var KmP=Math.floor(N/mv), KmT=Math.floor(nt*0.6);
  var Km=Math.min(KmP,KmT,20);

  var raw=Kb+Kf+Kt;
  var clamps=[];
  if(raw>KmP)clamps.push('≤'+KmP+' ('+mv+' ptcl/class at '+ep.toFixed(0)+'Å)');
  if(raw>KmT)clamps.push('≤'+KmT+' (<60% of '+nt+' tomos)');
  if(raw>20)clamps.push('≤20 practical max');
  if(raw<3)clamps.push('≥3 minimum');
  var K=Math.max(3,Math.min(raw,Km));
  var Kl=Math.max(3,K-2), Kh=Math.min(K+2,Km);
  var avg=Math.round(N/K);
  var tpk=nt/K;

  // Update derived bar
  var kd=document.getElementById('kDerived');
  if(kd){
    kd.style.display='flex';
    kd.innerHTML='<span>eff_pix: <strong>'+ep.toFixed(1)+' Å</strong></span>'+
      '<span>Nyquist: <strong>'+ny.toFixed(1)+' Å</strong></span>'+
      '<span>f: <strong>'+(f*100).toFixed(1)+'%</strong></span>'+
      '<span>T_ref: <strong>'+Tr.toFixed(2)+'</strong></span>'+
      '<span>T_ratio: <strong style="color:'+(Trat>1.5?'var(--gn)':Trat>.4?'var(--ac)':'var(--yl)')+'">'+Trat.toFixed(2)+'</strong></span>';
  }

  // Hero
  relionSt('kHeroK',String(K));
  relionSt('kHeroRange',Kl+' – '+Kh);
  relionSt('kAvgPpc',avg.toLocaleString());
  relionSt('kMinViable',String(mv));
  relionSt('kTomosPerClass',tpk.toFixed(1));
  var tRatLabel=Trat>1.5?'very soft':Trat>.8?'soft':Trat>.4?'standard':'sharp';
  relionSt('kTRatio',Trat.toFixed(2)+' ('+tRatLabel+')');

  // Breakdown table
  var r='<tr><td><span style="font-size:.65rem;padding:.05rem .22rem;border-radius:3px;background:rgba(88,166,255,.15);color:var(--ac);font-weight:700">BASE</span></td>'+
    '<td style="padding:.15rem .35rem;color:var(--dm)">log₁₀('+N.toLocaleString()+') = '+Math.log10(N).toFixed(2)+'</td>'+
    '<td style="padding:.15rem .35rem;color:var(--dm)">round(1.5 × '+Math.log10(N).toFixed(2)+') + 1 = '+Kb+'</td>'+
    '<td style="text-align:center;font-weight:700;padding:.15rem .35rem">'+Kb+'</td></tr>';
  r+='<tr><td><span style="font-size:.65rem;padding:.05rem .22rem;border-radius:3px;background:rgba(63,185,80,.12);color:var(--gn);font-weight:700">FRAC</span></td>'+
    '<td style="padding:.15rem .35rem;color:var(--dm)">f = '+(f*100).toFixed(1)+'%</td>'+
    '<td style="padding:.15rem .35rem;color:var(--dm)">'+(f>.1?'Large — fewer junk bins':f>.05?'Moderate':f>.02?'Small — extra junk bins needed':'Very small — many junk bins')+' → '+(Kf>=0?'+':'')+Kf+'</td>'+
    '<td style="text-align:center;font-weight:700;padding:.15rem .35rem">'+(Kb+Kf)+'</td></tr>';
  r+='<tr><td><span style="font-size:.65rem;padding:.05rem .22rem;border-radius:3px;background:rgba(188,140,255,.12);color:var(--pr);font-weight:700">T-ADJ</span></td>'+
    '<td style="padding:.15rem .35rem;color:var(--dm)">T='+T+', T_ref='+Tr.toFixed(2)+', ratio='+Trat.toFixed(2)+'</td>'+
    '<td style="padding:.15rem .35rem;color:var(--dm)">'+(Trat>1.5?'Very soft → classes self-empty → +2':Trat>.8?'Slightly soft → safe to add one → +1':Trat>.4?'Standard → no change → 0':'Sharp for this resolution → −1')+'</td>'+
    '<td style="text-align:center;font-weight:700;padding:.15rem .35rem">'+(Kb+Kf+Kt)+'</td></tr>';
  if(clamps.length){
    r+='<tr><td><span style="font-size:.65rem;padding:.05rem .22rem;border-radius:3px;background:rgba(210,153,34,.12);color:var(--yl);font-weight:700">CLAMP</span></td>'+
      '<td colspan="2" style="padding:.15rem .35rem;color:var(--dm)">'+clamps.join(' · ')+'</td>'+
      '<td style="text-align:center;font-weight:700;padding:.15rem .35rem">'+K+'</td></tr>';
  }
  r+='<tr style="border-top:1px solid var(--bd)"><td colspan="3" style="padding:.15rem .35rem;font-weight:700;color:var(--tx)">RECOMMENDED K</td>'+
    '<td style="text-align:center;font-weight:800;color:var(--ac);font-size:.9rem;padding:.15rem .35rem">'+K+'</td></tr>';
  var kb=document.getElementById('kBreakdown');if(kb)kb.innerHTML=r;

  // Warnings
  var w='';
  // Missing wedge
  var wStyle='padding:.22rem .45rem;border-radius:0 4px 4px 0;font-size:.71rem;line-height:1.45';
  w+='<div style="'+wStyle+';border-left:3px solid var(--yl);background:rgba(210,153,34,.05);">'+
    '<strong style="color:var(--yl)">⚠ Missing wedge — always check after classification</strong><br>'+
    'K='+K+' with '+nt+' tomos → ~'+tpk.toFixed(1)+' tomos/class. '+
    (tpk<2?'<strong>Very few tomos/class — high missing-wedge risk.</strong>':tpk<4?'Borderline — inspect carefully.':'Reasonable ratio.')+'</div>';
  // T-ratio
  if(Trat<=0.4){
    w+='<div style="'+wStyle+';border-left:3px solid var(--rd);background:rgba(248,81,73,.05);">'+
      '<strong style="color:var(--rd)">⚠ T is sharp for '+ep.toFixed(0)+' Å</strong><br>'+
      'T_ratio='+Trat.toFixed(2)+'. Excess classes risk filling with noise. Consider T ≈ '+Tr.toFixed(1)+' or reduce K.</div>';
  }else if(Trat>1.5){
    w+='<div style="'+wStyle+';border-left:3px solid var(--gn);background:rgba(63,185,80,.04);">'+
      '<strong style="color:var(--gn)">✓ T is very soft for this resolution</strong><br>'+
      'T_ratio='+Trat.toFixed(2)+'. Excess classes self-empty reliably. Safe to add 2–3 extra classes.</div>';
  }
  // Target class size
  if(Nm<mv){
    w+='<div style="'+wStyle+';border-left:3px solid var(--rd);background:rgba(248,81,73,.05);">'+
      '<strong style="color:var(--rd)">✖ Target class too small</strong><br>'+
      Nm+' particles < '+mv+' minimum at '+ep.toFixed(0)+' Å. Consider focused classification or more data.</div>';
  }else if(Nm<mv*3){
    w+='<div style="'+wStyle+';border-left:3px solid var(--yl);background:rgba(210,153,34,.05);">'+
      '<strong style="color:var(--yl)">⚠ Target class is small</strong><br>'+
      Nm+' particles — above '+mv+' minimum but limited SNR. Run with different seeds.</div>';
  }else{
    w+='<div style="'+wStyle+';border-left:3px solid var(--gn);background:rgba(63,185,80,.04);">'+
      '<strong style="color:var(--gn)">✓ Target class size is healthy</strong><br>'+
      Nm.toLocaleString()+' particles — well above '+mv+'-particle minimum for '+ep.toFixed(0)+' Å.</div>';
  }
  // K vs tomos
  if(K>=nt){
    w+='<div style="'+wStyle+';border-left:3px solid var(--rd);background:rgba(248,81,73,.05);">'+
      '<strong style="color:var(--rd)">✖ K ≥ number of tomograms</strong><br>Reduce K or add tomograms.</div>';
  }
  // Literature note
  w+='<div style="'+wStyle+';border-left:3px solid var(--bd);background:var(--sf2);color:var(--dm)">'+
    'Literature: Scheres (2012b) recommends K = 3–8. No published formula for K exists — always validate empirically. '+
    'This calculator recommends K = '+K+' (range '+Kl+'–'+Kh+'). Align first with K=1, then classify.</div>';
  var wEl=document.getElementById('kWarnings');if(wEl)wEl.innerHTML=w;

  document.getElementById('kResults').style.display='';
}

function relionCalcCrowther(){
  var d=relionGetInputs();
  if(!d.effPix||!d.diam)return;
  var nyq=d.effPix*2;
  var limitDeg=Math.atan(nyq/d.diam)*(180/Math.PI);
  var isC1=(d.sym===''||d.sym==='C1');
  var target=isC1?limitDeg*0.75:limitDeg;
  var li=HEALPIX.findIndex(function(h){return h.angle<=target;});
  if(li===-1)li=HEALPIX.length-1;
  var gi=Math.max(0,li-1);
  relionSt('crNyq',nyq.toFixed(2)+' Å');
  relionSt('crAngle',limitDeg.toFixed(2)+'°');
  relionSt('crGlobal',HEALPIX[gi].label);
  relionSt('crLocal',HEALPIX[li].label);
  var note=document.getElementById('crNote');
  if(note)note.textContent=(isC1?'C1: 0.75× correction → '+target.toFixed(2)+'°. ':'')+'Global for 3D refinement. Local for angular searches with TM priors.';
  document.getElementById('crResults').style.display='';
}

// Collapsible job list
var _jobListOpen=true;
function toggleJobList(){
  _jobListOpen=!_jobListOpen;
  var list=document.getElementById('jobList');
  var chev=document.getElementById('jobListChev');
  if(list)list.style.display=_jobListOpen?'':'none';
  if(chev)chev.style.transform=_jobListOpen?'':'rotate(-90deg)';
}