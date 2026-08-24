/* CryoSTAR-Base — filepicker.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */


// ── TM Analysis ──
const TMA_FIGURES = [
  {key:'1_score_landscape', label:'Fig 1 — Score Landscape', caption:'LCCmax + SNR distributions, quality tier composition, cumulative extraction curve, score rank plot. Use to decide extraction cutoff.'},
  {key:'2_per_tomogram',    label:'Fig 2 — Per Tomogram',    caption:'Best and worst tomograms ranked by mean SNR, particle count distribution. Identify outliers.'},
  {key:'3_spatial',         label:'Fig 3 — Spatial',         caption:'XY/XZ/YZ projections colored by SNR, Z-depth profile, edge-effect check, and particle density map.'},
  {key:'4_orientations',    label:'Fig 4 — Orientations',    caption:'Mollweide projection, Euler angle histograms per tier, orientation uniformity gauge. Check for missing-wedge bias.'},
  {key:'5_neighbors',       label:'Fig 5 — Neighbours',      caption:'Nearest-neighbour distance distribution, crowding vs SNR, duplicate fraction. Detect overcrowded picks.'},
  {key:'6_geometry',        label:'Fig 6 — Geometry Bias',   caption:'LCCmax/SNR vs tilt angle, 2D Euler heatmap, azimuthal polar plot. Identify missing-wedge and geometry biases.'},
  {key:'7_extraction_guide',label:'Fig 7 — Extraction Guide',caption:'Yield vs threshold curves, per-tomo yield, actionable RELION recommendations, dataset summary.'},
  {key:'8_tomo_heatmap',    label:'Fig 8 — Tomo Heatmap',    caption:'Per-tomogram SNR profile heatmap — visualize dataset heterogeneity at a glance (inspired by scorify).'},
];
let tmaCurrentPrefix='tm_analysis';
let tmaCurrentFig=0;

// ── TMA drag & drop ──
function tmaDragOver(e){
  e.preventDefault();
  var z=document.getElementById('tmaDragZone');
  if(z){z.style.borderColor='var(--gn)';z.style.background='rgba(63,185,80,.06)';}
}
function tmaDragLeave(e){
  var z=document.getElementById('tmaDragZone');
  if(z){z.style.borderColor='var(--bd)';z.style.background='';}
}
function tmaDrop(e){
  e.preventDefault();
  tmaDragLeave(e);
  var files=e.dataTransfer.files;
  if(!files||!files.length)return;
  var f=files[0];
  if(!f.name.endsWith('.star')){
    var s=$('tmaStatus');
    if(s){s.textContent='Please drop a .star file';s.style.color='var(--rd)';}
    return;
  }
  // Upload file to server so we have an absolute server-side path
  tmaUploadDroppedFile(f);
}

async function tmaUploadDroppedFile(file){
  if(!curProj){$('tmaStatus').textContent='Open a project first';return;}
  $('tmaStatus').textContent='Uploading '+file.name+'...';
  $('tmaStatus').style.color='var(--dm)';
  // Auto-set analysis name if empty
  var nameInput=document.getElementById('tmaAnalysisName');
  if(nameInput&&!nameInput.value){
    nameInput.value=file.name.replace('.star','');
  }
  try{
    const h=await api('/api/health');
    const ws=h.workspace||'.';
    const projDir=ws.replace(/\/$/,'')+'/'+curProj;
    const analysisName=(nameInput?nameInput.value.trim():'')||'analysis';
    const sanitized=analysisName.replace(/[^a-zA-Z0-9_-]/g,'_');
    const outDir=projDir+'/'+sanitized+'_tm_analysis';
    // Upload via FormData
    const form=new FormData();
    form.append('file',file);
    form.append('dest_dir',outDir);
    const resp=await fetch('/api/files/upload',{method:'POST',body:form});
    if(!resp.ok){const e=await resp.json();throw new Error(e.detail||'Upload failed');}
    const result=await resp.json();
    const destPath=result.path;
    $('tmaStarPath').value=destPath;
    tmaValidateStar(destPath);
    $('tmaStatus').textContent='File uploaded to '+destPath.split('/').pop()+' in analysis folder';
    $('tmaStatus').style.color='var(--gn)';
  }catch(err){
    // Fallback: show filename with warning
    $('tmaStarPath').value=file.name;
    $('tmaStatus').textContent='Upload failed ('+err.message+') — enter full path manually';
    $('tmaStatus').style.color='var(--yl)';
  }
}

// ── TMA history (previous analyses) ──
async function tmaLoadHistory(){
  if(!curProj)return;
  const el=document.getElementById('tmaHistoryList');
  if(!el)return;
  try{
    const h=await api('/api/health');
    const ws=h.workspace||'.';
    const projDir=ws.replace(/\/$/,'')+'/'+curProj;
    // List directories ending in _tm_analysis
    const d=await api('/api/files/browse_free?path='+encodeURIComponent(projDir));
    const analyses=(d.items||[]).filter(i=>i.is_dir&&i.name.endsWith('_tm_analysis'));
    if(!analyses.length){
      el.innerHTML='<div class="dim" style="font-size:.76rem">No analyses yet.</div>';
      return;
    }
    el.innerHTML=analyses.map(a=>
      '<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem .2rem;border-bottom:1px solid var(--bd)">' +
      '<span style="font-size:.77rem;font-family:monospace;color:var(--gn);flex:1">'+a.name+'</span>' +
      '<button class="bsm" onclick="tmaOpenHistory(this.dataset.p)" data-p="'+a.path+'" style="padding:.15rem .45rem;font-size:.7rem">View</button>' +
      '</div>'
    ).join('');
  }catch(e){
    el.innerHTML='<div class="dim" style="font-size:.74rem">'+e.message+'</div>';
  }
}

async function tmaOpenHistory(dirPath){
  // Find the prefix from directory — extract first file prefix
  try{
    const d=await api('/api/files/browse_free?path='+encodeURIComponent(dirPath));
    const pngs=(d.items||[]).filter(i=>i.name.endsWith('.png'));
    if(!pngs.length){$('tmaStatus').textContent='No figures found in '+dirPath;return;}
    // Extract prefix from first png name
    const fname=pngs[0].name;
    // prefix is the full absolute path WITHOUT figure number/key
    const absPrefix=dirPath.replace(/\/$/,'')+'/'+fname.replace(/_[0-9]+_.*\.png$/,'');
    tmaCurrentPrefix=absPrefix;  // store full absolute prefix
    tmaCurrentProjDir=dirPath;
    // Set title
    const title=document.getElementById('tmaFigTitle');
    if(title)title.textContent=dirPath.split('/').pop();
    await tmaLoadFigures(absPrefix,dirPath);
    $('tmaFigCard').style.display='';
    // Scroll to viewer
    $('tmaFigCard').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){$('tmaStatus').textContent='Error: '+e.message;}
}

// ── Figure info panel ──
const TMA_FIG_INFOS = {
  '1_score_landscape': 'Look for a bimodal SNR distribution — one peak for true particles, one for noise. If unimodal, TM quality may be poor or target is rare. Use the cumulative curve (D) to pick a cutoff: extract top 50–75% for initial RELION run. The score rank plot (E) should show a clear knee.',
  '2_per_tomogram': 'Tomograms with mean SNR < 7σ are candidates for exclusion. Wide spread indicates dataset heterogeneity. Test extraction on top 5 tomograms first before processing all.',
  '3_spatial': 'Particle clustering at edges suggests boundary effects — check slab mask. SNR vs Z should be flat; a drop at high Z indicates missing wedge or lamella curvature. Use the density map (F) to spot void regions.',
  '4_orientations': 'Gaps in the Mollweide projection indicate orientations blocked by the missing wedge (expected for ±70° tilt). Efficiency > 0.5 is good. Low efficiency + biased angles suggests preferred orientation or missing wedge artefacts.',
  '5_neighbors': 'Very short NN distances (< particle radius) = duplicate picks. If > 10% within exclusion radius, apply --distance-threshold in pytom_extract_candidates.py. Crowding vs SNR (B) shows if high-density regions have weaker scores.',
  '6_geometry': 'LCCmax dip near θ=90° is expected missing wedge effect. The Euler heatmap should be filled — gaps = blind orientations. Azimuthal asymmetry in polar plot may indicate preferred orientation in the sample.',
  '7_extraction_guide': 'Panel A: trade-off between particle yield and score threshold. For initial RELION processing use generous cutoff (keep ~75%) — classification will remove false positives. Re-run with tighter cutoff after 2D/3D classification.',
  '8_tomo_heatmap': 'Bright colors at low SNR = noisy tomograms. Sort by mean SNR (right panel) to identify best/worst datasets. Use for QC decisions about which tomograms to include.',
};

function tmaToggleFigInfo(){
  const el=document.getElementById('tmaFigInfo');
  const btn=document.getElementById('tmaFigInfoBtn');
  if(!el||!btn)return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  btn.textContent=(open?'▸':'▾')+' '+(open?'Show':'Hide')+' interpretation guide';
}

function tmaZoomFig(){
  const img=$('tmaFigImg');
  if(!img||!img.src)return;
  window.open(img.src,'_blank');
}

let tmaViewMode='static';

function tmaSetViewMode(mode){
  tmaViewMode=mode;
  const s=document.getElementById('tmaFigStatic');
  const i=document.getElementById('tmaFigInteract');
  const bs=document.getElementById('tmaViewStatic');
  const bi=document.getElementById('tmaViewInteract');
  if(mode==='static'){
    if(s)s.style.display='';if(i)i.style.display='none';
    if(bs){bs.style.borderColor='var(--gn)';bs.style.background='rgba(63,185,80,.1)';bs.style.color='var(--gn)';bs.style.fontWeight='600';}
    if(bi){bi.style.borderColor='var(--bd)';bi.style.background='transparent';bi.style.color='var(--dm)';bi.style.fontWeight='600';}
  }else{
    if(s)s.style.display='none';if(i)i.style.display='';
    if(bi){bi.style.borderColor='var(--ac)';bi.style.background='rgba(88,166,255,.12)';bi.style.color='var(--ac)';bi.style.fontWeight='600';}
    if(bs){bs.style.borderColor='var(--bd)';bs.style.background='transparent';bs.style.color='var(--dm)';bs.style.fontWeight='600';}
    // Load interactive figure for the currently selected fig
    if(typeof tmaCurrentFig!=='undefined')tmaLoadInteractiveFig(tmaCurrentFig);
  }
}

async function tmaLoadInteractiveFig(idx){
  const f=TMA_FIGURES[idx];
  const prefix=tmaCurrentPrefix;
  const plotDiv=document.getElementById('tmaPlotlyDiv');
  if(!plotDiv)return;
  // Try to load the interactive JSON data
  const jsonPath=prefix+'_'+f.key+'_interactive.json';
  const apiPath='/api/files/read?path='+encodeURIComponent(jsonPath);
  plotDiv.innerHTML='<div style="padding:2rem;text-align:center;color:var(--dm);font-size:.82rem">'+
    'Loading interactive data...<br><span style="font-size:.72rem">If this is your first run, re-run the analysis to generate interactive data.</span></div>';
  try{
    const resp=await fetch(apiPath);
    if(!resp.ok)throw new Error('JSON data not found — re-run analysis');
    const data=await resp.json();
    // Render with Plotly
    plotDiv.innerHTML='';
    if(typeof Plotly==='undefined'){
      plotDiv.innerHTML='<div style="padding:1rem;color:var(--rd)">Plotly not loaded — check internet connection</div>';
      return;
    }
    const layout=Object.assign({
      paper_bgcolor:'rgba(0,0,0,0)',
      plot_bgcolor:'#161b22',
      font:{color:'#e6edf3',size:11},
      margin:{l:50,r:20,t:40,b:50},
    },data.layout||{});
    Plotly.newPlot(plotDiv,data.traces||[],layout,{
      responsive:true,
      displayModeBar:true,
      modeBarButtonsToRemove:['toImage'],
      displaylogo:false
    });
  }catch(e){
    plotDiv.innerHTML='<div style="padding:1.5rem;text-align:center">'+
      '<div style="color:var(--yl);font-size:.82rem;margin-bottom:.5rem">Interactive data not available yet</div>'+
      '<div style="color:var(--dm);font-size:.74rem">Re-run the analysis to generate <code>*_interactive.json</code> files alongside the PNGs.<br>'+
      'Error: '+e.message+'</div></div>';
  }
}

// Override tmaShowFig to also update info panel
const _tmaShowFig_orig = typeof tmaShowFig!=='undefined'?tmaShowFig:null;
