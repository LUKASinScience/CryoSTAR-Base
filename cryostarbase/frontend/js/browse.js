/* CryoSTAR-Base — browse.js
   Part of CryoSTAR-Base frontend
   Lukas W. Bauer und Claude — 2026 */

// ── Finder-style Browse ──
const FILE_ICONS={'.star':'★','.mrc':'◈','.rec':'◈','.json':'{}','.py':'py','.sh':'sh','.txt':'≡','.log':'≡','.md':'≡','.xml':'<>','.tlt':'~'};

function brGoInput(){
  var p=document.getElementById('brPathInput').value.trim();
  if(p)brGo(p.startsWith('/')||p==='.'?p:'.'+'/'+p);
}
function brGoHome(){brGo('.');}
function brGoRoot(){brGo('/');}

async function brGo(p){
  brCurPath=p;
  // Sync path input
  var pi=document.getElementById('brPathInput');
  if(pi)pi.value=p;
  const bc=document.getElementById('brBreadcrumb');
  if(bc){
    const parts=p.split('/').filter(Boolean);
    if(!parts.length||p==='.')bc.textContent='/ workspace';
    else bc.innerHTML=parts.map((part,i)=>{
      const path=parts.slice(0,i+1).join('/');
      return '<span onclick="brGo(\''+path+'\')" style="cursor:pointer;color:var(--ac)">'+part+'</span>';
    }).join('<span style="color:var(--dm);margin:0 .15rem">/</span>');
  }
  // Use free browse for absolute paths, restricted browse for relative (workspace)
  const isAbs=p.startsWith('/')||p==='..';
  const endpoint=isAbs?'/api/files/browse_free?path=':'/api/files/browse?path=';
  try{
    const d=await api(endpoint+encodeURIComponent(p));
    const allItems=d.items||[];
    const items=allItems.filter(i=>i.is_dir||['.mrc','.star','.json','.tlt','.txt','.md','.log','.py','.sh','.xml'].includes(i.ext)).slice(0,60);
    if(!items.length){
      document.getElementById('brList').innerHTML='<div class="dim" style="font-size:.7rem;padding:.35rem .5rem">Empty</div>';
      return;
    }
    document.getElementById('brList').innerHTML=items.map(i=>{
      const isProj=i.is_dir&&i.name.endsWith('_base');
      const icon=i.is_dir?(isProj?'⚛':'▸'):(FILE_ICONS[i.ext]||'·');
      const sizeStr=i.size&&i.size>0?sz(i.size):'';
      const absPath=isAbs?i.path:i.path; // path field is always the navigable path
      if(i.is_dir){
        var openBtn=isProj?
          '<button onclick="event.stopPropagation();brOpenProject(\''+absPath+'\')" '+
          'style="margin-left:auto;background:rgba(88,166,255,.15);border:1px solid rgba(88,166,255,.35);'+
          'color:var(--ac);border-radius:3px;padding:.05rem .25rem;font-size:.6rem;cursor:pointer;white-space:nowrap;flex-shrink:0">open</button>':
          '';
        return '<div class="finder-row '+(isProj?'finder-proj':'')+'" onclick="brGo(\''+absPath+'\')">'+
          '<span class="finder-icon">'+icon+'</span>'+
          '<span class="finder-name">'+i.name+(i.is_link?' →':'')+'</span>'+
          openBtn+
          '</div>';
      }else{
        return '<div class="finder-row" onclick="brFill(\''+absPath+'\')">'+
          '<span class="finder-icon" style="color:var(--dm)">'+icon+'</span>'+
          '<span class="finder-name">'+i.name+'</span>'+
          '<span class="finder-size">'+sizeStr+'</span>'+
          '</div>';
      }
    }).join('');
  }catch(e){
    document.getElementById('brList').innerHTML=
      '<div class="dim" style="font-size:.7rem;padding:.35rem">'+
      (e.message.includes('403')?'Permission denied':e.message)+'</div>';
  }
}
function brUp(){
  if(brCurPath==='/'){return;}
  if(brCurPath==='.'||brCurPath===''){brGo('/');return;}
  const p=brCurPath.replace(/\/$/,'').split('/').filter(Boolean);
  p.pop();
  const parent=p.length===0?'/':p.join('/');
  brGo(parent.startsWith('/')?parent:'.'+'/'+parent.replace(/^\./,''));
}


function brFill(path){
  // Fill next empty input in the job builder param form
  // BUT skip archive paths (marked with data-archive="true" on browse button)
  const inputs=document.querySelectorAll('#parF input[type="text"]');let target=null;
  inputs.forEach(inp=>{
    if(!inp.value&&!target){
      // Check if this input's browse button is marked as archive path
      var browseBtn = document.querySelector('[data-fp="'+inp.id+'"]');
      if(browseBtn && browseBtn.dataset.archive === 'true'){
        return; // skip archive paths — user must enter manually
      }
      target=inp;
    }
  });
  if(!target&&inputs.length)target=inputs[inputs.length-1];
  if(target){target.value=path;target.focus();updPrev();}
}