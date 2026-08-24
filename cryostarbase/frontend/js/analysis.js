/* CryoSTAR-Base — analysis.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ── Resolved at startup from /api/health
let _pythonExe='python3';
let _scriptsDir='';

async function tmaEnsureEnv(){
  if(_scriptsDir)return;
  try{
    const h=await api('/api/health');
    _pythonExe=h.python_executable||'python3';
    _scriptsDir=h.scripts_dir||'';
  }catch(e){}
}

async function tmaRun(){
  if(!curProj)return;
  const star=$('tmaStarPath').value.trim();
  // prefix now derived from analysisName below
  if(!star){$('tmaStatus').textContent='Select a STAR file first';return;}
  if(!star.endsWith('.star')){
    $('tmaStatus').textContent='Error: path must point to a .star file, not a folder';
    $('tmaStatus').style.color='var(--rd)';
    return;
  }
  $('tmaStatus').style.color='var(--dm)';
  // If star is a relative path, make it absolute using projDir
  const projDirTmp=await tmaGetProjDir();
  if(!star.startsWith('/')){star=projDirTmp.replace(/\/$/,'')+'/'+star;}
  // Get analysis name → create output folder
  const analysisName=(document.getElementById('tmaAnalysisName')?document.getElementById('tmaAnalysisName').value.trim():'') || 'analysis';
  const sanitized=analysisName.replace(/[^a-zA-Z0-9_-]/g,'_');
  const folderName=sanitized+'_tm_analysis';
  await tmaEnsureEnv();
  const projDir=await tmaGetProjDir();
  const outDir=projDir.replace(/\/$/,'')+'/'+folderName;
  tmaCurrentPrefix=outDir+'/'+sanitized;
  tmaCurrentProjDir=outDir;
  $('tmaLog').style.display='block';
  $('tmaLog').textContent='Output folder: '+outDir+'\n';
  $('tmaRunBtn').disabled=true;
  $('tmaStatus').textContent='Running...';

  const scriptFile=_scriptsDir?_scriptsDir+'/tm_analysis_beta.py':'tm_analysis_beta.py';
  // mkdir and run
  // Use absolute star path; pass outDir as working_dir so relative outputs land there
  const mkdirCmd='mkdir -p "'+outDir+'" && "'+_pythonExe+'" "'+scriptFile+'" "'+star+'" "'+tmaCurrentPrefix+'"';
  const cmd=mkdirCmd;

  try{
    const wsProto=location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(wsProto+'//'+location.host+'/api/scripts/ws/run');
    ws.onopen=()=>{
      // working_dir = outDir so the script runs from the output folder context
      ws.send(JSON.stringify({command:cmd,working_dir:outDir,project:curProj}));
    };
    ws.onmessage=e=>{
      const d=JSON.parse(e.data);
      if(d.line!==undefined){
        const isErr=d.line.startsWith('[stderr]');
        const line=d.line.replace('[stderr] ','');
        $('tmaLog').textContent+=(isErr?'ERR: ':'')+line+'\n';
        $('tmaLog').scrollTop=$('tmaLog').scrollHeight;
      }
      if(d.status==='completed'){
        $('tmaStatus').textContent='Done — loading figures...';
        $('tmaRunBtn').disabled=false;
        setTimeout(()=>tmaLoadFigures(tmaCurrentPrefix,tmaCurrentProjDir),1200);
        ws.close();
      }else if(d.status==='failed'){
        $('tmaStatus').style.color='var(--rd)';
        $('tmaStatus').textContent='Failed — check log above';
        $('tmaRunBtn').disabled=false;
        ws.close();
      }
    };
    ws.onerror=()=>{$('tmaStatus').textContent='WebSocket error';$('tmaRunBtn').disabled=false;};
  }catch(e){$('tmaStatus').textContent=e.message;$('tmaRunBtn').disabled=false;}
}

async function tmaGetProjDir(){
  // Returns absolute path of current project folder
  try{
    const h=await api('/api/health');
    const ws=h.workspace||'.';
    return ws.replace(/\/$/,'')+'/'+curProj;
  }catch(e){return curProj||'.';}
}

let tmaCurrentProjDir='';

async function tmaLoadFigures(prefix,projDir){
  prefix=prefix||tmaCurrentPrefix;
  projDir=projDir||tmaCurrentProjDir;
  tmaCurrentProjDir=projDir;
  const tabsEl=$('tmaFigTabs');
  if(!tabsEl)return;
  tabsEl.innerHTML=TMA_FIGURES.map((f,i)=>
    '<button onclick="tmaShowFig('+i+')" id="tmaFigBtn'+i+'" '+
    'style="padding:.25rem .55rem;font-size:.7rem;border-radius:4px;cursor:pointer;'+
    'border:1px solid var(--bd);background:var(--sf2);color:var(--dm);transition:.12s;white-space:nowrap">'+
    f.label+'</button>'
  ).join('');
  $('tmaFigCard').style.display='';
  $('tmaFigCount').textContent=TMA_FIGURES.length+' figures';
  // Load quick stats if summary JSON exists
  const statsPath=prefix+'_summary.json';
  try{
    const sr=await fetch('/api/files/read?path='+encodeURIComponent(statsPath));
    if(sr.ok){
      const stats=await sr.json();
      const qs=$('tmaQuickStats');
      if(qs){
        qs.style.display='flex';
        const fmt=function(k,v,col){return '<div style="display:flex;flex-direction:column;align-items:center;min-width:60px">'+
          '<span style="font-size:.65rem;color:var(--dm)">'+k+'</span>'+
          '<span style="font-size:.88rem;font-weight:700;color:'+(col||'var(--tx)')+'">'+v+'</span></div>';};
        qs.innerHTML=
          fmt('Particles',(stats.n_particles||0).toLocaleString(),'var(--tx)')+
          fmt('Tomograms',(stats.n_tomos||0).toString(),'var(--tx)')+
          fmt('Median SNR',(stats.median_snr||0).toFixed(1)+'σ',
              (stats.median_snr||0)>=10?'var(--gn)':(stats.median_snr||0)>=7?'var(--yl)':'var(--rd)')+
          fmt('≥10σ',(stats.pct_good||0).toFixed(0)+'%',
              (stats.pct_good||0)>=50?'var(--gn)':(stats.pct_good||0)>=25?'var(--yl)':'var(--rd)')+
          fmt('Suggest cut',(stats.suggested_cutoff||0).toFixed(1)+'σ','var(--ac)');
      }
    }
  }catch(e){}
  tmaShowFig(0);
}

function tmaShowFig(idx){
  tmaCurrentFig=idx;
  const f=TMA_FIGURES[idx];
  const prefix=tmaCurrentPrefix;
  const projDir=tmaCurrentProjDir;
  // Highlight selected tab
  TMA_FIGURES.forEach((_,i)=>{
    const btn=$('tmaFigBtn'+i);
    if(btn){
      btn.style.color=i===idx?'var(--gn)':'var(--dm)';
      btn.style.borderColor=i===idx?'var(--gn)':'var(--bd)';
      btn.style.background=i===idx?'rgba(63,185,80,.08)':'var(--sf2)';
    }
  });
  // prefix is already the full absolute path (e.g. /path/to/test_tm_analysis/test)
  // projDir is stored separately for history browsing
  const absPrefix=prefix.startsWith('/')?prefix:(projDir?projDir.replace(/\/$/,'')+'/'+prefix:prefix);
  const pngPath='/api/files/image?path='+encodeURIComponent(absPrefix+'_'+f.key+'.png');
  const pdfAbs=absPrefix+'_'+f.key+'.pdf';
  const img=$('tmaFigImg');
  if(img){
    img.style.opacity='.5';
    img.src=pngPath+'&t='+Date.now(); // cache-bust
    img.onload=()=>{img.style.opacity='1';};
    img.onerror=()=>{img.style.opacity='1';img.alt='Figure not yet available';};
  }
  const cap=$('tmaFigCaption');if(cap)cap.textContent=f.caption;
  const dlPng=$('tmaDlPng');
  if(dlPng){dlPng.href=pngPath;dlPng.download=prefix+'_'+f.key+'.png';}
  const dlPdf=$('tmaDlPdf');
  if(dlPdf){dlPdf.href='/api/files/image?path='+encodeURIComponent(pdfAbs);dlPdf.download=prefix+'_'+f.key+'.pdf';}
  // Update info panel
  const infoEl=document.getElementById('tmaFigInfo');
  const infoText=TMA_FIG_INFOS[f.key]||'';
  if(infoEl)infoEl.textContent=infoText;
}

