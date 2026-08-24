/* CryoSTAR-Base — notion.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════
// NOTION REFERENCE PICKER
// ══════════════════════════════════════════════════════════
function notionPickerToggle(){
  var s=document.getElementById('notionSetup');
  if(!s)return;
  var open=s.style.display!=='none';
  s.style.display=open?'none':'';
  document.getElementById('notionPickerToggleLabel').textContent=open?'Configure':'Hide';
}

async function notionSearch(){
  var token=document.getElementById('notionToken').value.trim();
  var query=document.getElementById('notionQuery').value.trim();
  var statusEl=document.getElementById('notionStatus');
  var resultsEl=document.getElementById('notionResults');
  var listEl=document.getElementById('notionResultList');
  if(!token){statusEl.textContent='Enter your Notion token first';statusEl.style.color='var(--rd)';return;}
  if(!query){statusEl.textContent='Enter a search query';statusEl.style.color='var(--yl)';return;}
  statusEl.textContent='Searching...';statusEl.style.color='var(--dm)';
  resultsEl.style.display='none';
  try{
    // Notion API requires a proxy since browsers block direct calls due to CORS
    // We route through our FastAPI server
    const resp=await fetch('/api/notion/search',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:token,query:query})
    });
    if(!resp.ok){const e=await resp.json();throw new Error(e.detail||'API error');}
    const data=await resp.json();
    const results=data.results||[];
    if(!results.length){statusEl.textContent='No results found';return;}
    listEl.innerHTML=results.map(function(r){
      var title=r.title||'Untitled';
      var url=r.url||'#';
      var type=r.type||'page';
      var typeCol=type==='database'?'var(--yl)':'var(--ac)';
            var div=document.createElement('div');
      div.style.cssText='display:flex;align-items:center;gap:.45rem;padding:.28rem .45rem;border:1px solid var(--bd);border-radius:5px;transition:.1s;cursor:default';
      div.onmouseover=function(){this.style.background='var(--sf2)';};
      div.onmouseout=function(){this.style.background='';};
      div.innerHTML='<span style="font-size:.65rem;padding:.02rem .25rem;border-radius:3px;border:1px solid '+typeCol+';color:'+typeCol+';flex-shrink:0">'+type+'</span>'+
        '<span style="flex:1;font-size:.76rem;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 .3rem">'+title+'</span>'+
        '<a href="'+url+'" target="_blank" style="font-size:.68rem;color:var(--dm);text-decoration:none;flex-shrink:0;margin-right:.2rem">&#8599;</a>';
      var btn=document.createElement('button');
      btn.className='bsm';btn.style.cssText='padding:.1rem .4rem;font-size:.68rem;flex-shrink:0';
      btn.textContent='Add to Notebook';
      (function(t,u){btn.onclick=function(){notionAddToNotebook(t,u);};})(title,url);
      div.appendChild(btn);
      return div.outerHTML;
    }).join('');
    resultsEl.style.display='';
    statusEl.textContent=results.length+' results found';statusEl.style.color='var(--gn)';
  }catch(e){
    statusEl.textContent='Error: '+e.message;statusEl.style.color='var(--rd)';
  }
}

async function notionAddToNotebook(title,url){
  if(!curProj){alert('Open a project first');return;}
  var text='[Notion] ['+title+']('+url+')';
  try{
    await post('/api/notes',{project:curProj,text:text});
    loadNotes();nbMarkPending();
    var s=document.getElementById('notionStatus');
    if(s){s.textContent='Added "'+title+'" to notebook';s.style.color='var(--gn)';}
  }catch(e){
    var s=document.getElementById('notionStatus');
    if(s){s.textContent='Failed: '+e.message;s.style.color='var(--rd)';}
  }
}

// ══════════════════════════════════════════════════════════
// WARPTOOLS CHECKLIST
// ══════════════════════════════════════════════════════════
const WT_CHECKLIST = [
  {
    id:'wt_settings',
    what:'Settings file created — warp_tiltseries.settings exists and is valid',
    how:'Run WarpTools create_settings with correct --angpix, --extension, --tomo_dimensions. Verify the .settings file exists.',
    sw:'WarpTools',
    cmd:'WarpTools create_settings \
  --output warp_tiltseries.settings \
  --folder_processing warp_tiltseries \
  --folder_data tomostar \
  --extension "*.tomostar" \
  --angpix 1.382 \
  --exposure 2.72 \
  --tomo_dimensions 4092x5760x2500',
    note:'tomo_dimensions: X, Y, Z in UNBINNED pixels. Tilt axis is along Y — account for rotation!'
  },
  {
    id:'wt_negate',
    what:'--dont_invert flag used in ts_reconstruct (signal convention)',
    how:'Check your WarpTools ts_reconstruct command. WarpTools uses --dont_invert to preserve contrast for PyTom compatibility.',
    sw:'WarpTools',
    cmd:'WarpTools ts_reconstruct \
  --settings warp_tiltseries.settings \
  --angpix 11.056 \
  --dont_invert \
  --halfmap_frames',
    note:'--dont_invert ensures protein is dark in the tomogram, consistent with PyTom template matching.'
  },
  {
    id:'wt_gainflip',
    what:'Gain flip set correctly — --gain_flip_y for Falcon 4i / K3',
    how:'For Falcon 4i / K3 on Titan Krios: --gain_flip_y is almost always required. The detector sensor is physically oriented so the gain reference must be flipped in Y — camera hardware convention, not an IMOD bug. If omitted, faint grid pattern remains in micrographs. To verify: process one movie without MC and check for gain pattern. Refs: warpem.github.io/warp/user_guide/warp/quick_start_warp_frame_series/ · github.com/warpem/warp/blob/main/scripts/EMPIAR-10491_5TS_e2e.sh',
    sw:'WarpTools',
    cmd:'# Add to create_settings if needed:\n--gain_flip_y \
--gain_path frames/gainref.mrc\n\n# Check if you need it:\n# If reconstructed tomos look mirrored vs expected, toggle --gain_flip_y',
    note:'Ref: EMPIAR-10491 official WarpTools example script uses --gain_flip_y. Warp docs confirm this is camera hardware convention.'
  },
  {
    id:'wt_envvars',
    what:'WarpTools environment variables set for this session',
    how:'Export required env vars before running WarpTools to avoid MRC format issues.',
    sw:'Shell / SLURM',
    cmd:'export WARP_FORCE_MRC_FLOAT32=1\nexport WARP_DEBUG=1\n\n# Add to your SLURM script or .bashrc for persistent use',
    note:'WARP_FORCE_MRC_FLOAT32=1 prevents float16 MRC issues. WARP_DEBUG=1 enables verbose logging.'
  },
  {
    id:'wt_version',
    what:'WarpTools version — use dev38 (CUDA 12.9)',
    how:'Recommended: warptools/2.0.0dev38 — adds CUDA 12.9 support (required for H100/Blackwell GPUs). Known bug: change_selection does not correctly exclude tilt series. Workaround: manually delete the XML from warp_tiltseries/ or use --input_data with an include list. Ref: Warp Google Groups, April 2026.',
    sw:'Shell',
    cmd:'# Load module:\nml warptools/2.0.0dev38\n\n# Or check:\nWarpTools --version\n\n# change_selection bug workaround:\n# Delete XML: rm warp_tiltseries/BadTS_1.xml\n# Or use: --input_data include.txt (one tomostar per line)',
    note:'dev38 confirmed for CUDA 12.9. change_selection bug present in all 2.0.0dev versions as of April 2026.'
  },
  {
    id:'wt_xmls',
    what:'XML files linked/copied — per-tilt CTF metadata available for PSF weighting',
    how:'Copy or symlink WarpTools XML files to your PyTom folder. Required for per-tilt CTF correction in template matching.',
    sw:'Shell',
    cmd:'# In your PyTom project folder:\nmkdir xml\ncd xml\ncp /path/to/warp_tiltseries/*.xml .\n\n# Or use symlinks:\nln -s /path/to/warp_tiltseries/*.xml .',
    note:'XML files contain per-tilt defocus, dose, and tilt angle info. Without them PyTom uses simple CTF estimates.'
  },
  {
    id:'wt_export',
    what:'ts_export_particles run successfully — subtomograms extracted',
    how:'After converting PyTom STAR to pixel coords, run WarpTools ts_export_particles. Check output folder for extracted particles.',
    sw:'WarpTools',
    cmd:'WarpTools ts_export_particles \
  --settings warp_tiltseries.settings \
  --input_star particles_converted.star \
  --output_star particles_warp.star \
  --box 64 \
  --diameter 140',
    note:'Box size should match what you set in Particles tab. Diameter in Å for mask creation during extraction.'
  },
];

let wtCheckState = {};

function renderWtChecklist(){
  var el=document.getElementById('wtChecklistEl');
  if(!el)return;
  var done=WT_CHECKLIST.filter(function(c){return wtCheckState[c.id];}).length;
  var total=WT_CHECKLIST.length;
  var prog=document.getElementById('wtCheckProg');
  if(prog)prog.textContent=done+'/'+total+' done';
  el.innerHTML='';
  WT_CHECKLIST.forEach(function(c){
    var checked=wtCheckState[c.id]||false;
    var wrapper=document.createElement('div');
    wrapper.style.cssText='border:1px solid '+(checked?'rgba(188,140,255,.35)':'var(--bd)')+
      ';border-radius:6px;background:'+(checked?'rgba(188,140,255,.04)':'var(--bg)')+
      ';overflow:hidden;transition:all .15s;margin-bottom:.2rem';
    var header=document.createElement('div');
    header.style.cssText='display:flex;align-items:flex-start;gap:.55rem;padding:.42rem .55rem;cursor:pointer';
    header.dataset.id=c.id;
    header.onclick=function(){wtToggleCheck(this.dataset.id);};
    var circle=document.createElement('div');
    circle.style.cssText='width:16px;height:16px;border-radius:50%;border:2px solid '+
      (checked?'var(--pr)':'var(--bd)')+';background:'+(checked?'var(--pr)':'transparent')+
      ';flex-shrink:0;margin-top:.12rem;display:flex;align-items:center;justify-content:center;transition:all .15s';
    if(checked){var ck=document.createElement('span');ck.style.cssText='color:#fff;font-size:.6rem;font-weight:900;line-height:1';ck.textContent='✓';circle.appendChild(ck);}
    var info=document.createElement('div');info.style.flex='1';
    var sw=c.sw?'<span style="font-size:.63rem;padding:.04rem .28rem;background:rgba(188,140,255,.12);border:1px solid rgba(188,140,255,.25);border-radius:3px;color:var(--pr);margin-left:.35rem">'+c.sw+'</span>':'';
    info.innerHTML='<div style="font-size:.79rem;font-weight:600;color:'+(checked?'var(--pr)':'var(--tx)')+'">'+c.what+sw+'</div>'+
      (c.how?'<div style="font-size:.73rem;color:var(--dm);margin-top:.12rem;line-height:1.5">'+c.how+'</div>':'')+
      (c.note?'<div style="font-size:.67rem;color:var(--dm);margin-top:.08rem;font-style:italic">'+c.note+'</div>':'');
    header.appendChild(circle);header.appendChild(info);
    wrapper.appendChild(header);
    if(c.cmd){
      var cmdDiv=document.createElement('div');
      cmdDiv.style.cssText='padding:.3rem .55rem .4rem 2.2rem';
      var pre=document.createElement('pre');
      pre.style.cssText='background:var(--bg);border:1px solid var(--bd);border-radius:3px;padding:.3rem .45rem;font-size:.7rem;color:var(--pr);white-space:pre-wrap;margin:0;line-height:1.5';
      pre.textContent=c.cmd.replace(/\\n/g,'\n');
      cmdDiv.appendChild(pre);wrapper.appendChild(cmdDiv);
    }
    el.appendChild(wrapper);
  });
}


function wtToggleCheck(id){
  wtCheckState[id]=!wtCheckState[id];
  renderWtChecklist();
}

async function saveWtChecklist(){
  if(!curProj)return;
  try{
    await post('/api/projects/'+curProj+'/config',{wt_check_state:wtCheckState});
    var done=WT_CHECKLIST.filter(function(c){return wtCheckState[c.id];}).length;
    var total=WT_CHECKLIST.length;
    if(done===total){
      await post('/api/notes',{project:curProj,text:'WarpTools Export Checklist: all '+total+' checks completed ✓'});
      loadNotes();nbMarkPending();
    }
  }catch(e){console.error(e);}
}
