/* CryoSTAR-Base — search.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════════
//  PHASE 3 — Job Builder Search + Parameter Search
// ══════════════════════════════════════════════════════════════

var _tplCache = null;

function tplSearchFilter(){
  var q=(document.getElementById('tplSearch')?.value||'').trim().toLowerCase();
  var clearBtn=document.getElementById('tplSearchClear');
  var countEl=document.getElementById('tplSearchCount');
  var shortcut=document.getElementById('tplSearchShortcut');
  if(clearBtn) clearBtn.style.display=q?'':'none';
  if(shortcut) shortcut.style.display=q?'none':'';
  if(!_tplCache){if(countEl)countEl.style.display='none';return;}
  var {sorted}=_getSortedCats();
  if(!q){if(countEl)countEl.style.display='none';_renderTplList(sorted,'');return;}
  var totalHits=0;
  var filteredCats=sorted.map(function(cat){
    var matchedItems=cat.items.filter(function(t){
      var hay=[t.name||'',t.id||'',t.description||'',cat.name||''].join(' ').toLowerCase();
      return q.split(/\s+/).every(function(w){return hay.includes(w);});
    });
    totalHits+=matchedItems.length;
    return Object.assign({},cat,{items:matchedItems});
  }).filter(function(c){return c.items.length>0;});
  if(countEl){countEl.textContent=totalHits+(totalHits===1?' result':' results');countEl.style.display='';}
  _renderTplList(filteredCats,q);
}

function tplSearchClear(){
  var inp=document.getElementById('tplSearch');
  if(inp){inp.value='';inp.focus();}
  tplSearchFilter();
}

function tplSearchKey(e){
  if(e.key==='Escape'){tplSearchClear();return;}
  if(e.key==='Enter'){var first=document.querySelector('#tplList .ti');if(first)first.click();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    var items=Array.from(document.querySelectorAll('#tplList .ti'));
    if(!items.length)return;
    var idx=items.indexOf(document.activeElement);
    idx=e.key==='ArrowDown'?Math.min(idx+1,items.length-1):Math.max(idx-1,0);
    items[idx<0?0:idx].focus();e.preventDefault();
  }
}

document.addEventListener('keydown',function(e){
  if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){
    var active=document.activeElement;
    if(active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA'||active.tagName==='SELECT'))return;
    var search=document.getElementById('tplSearch');
    var right=document.getElementById('right');
    if(search&&right&&!right.classList.contains('right-panel-collapsed')){
      search.focus();search.select();e.preventDefault();
    }
  }
});

function _getSortedCats(){
  if(!_tplCache)return{sorted:[]};
  var catMap={};
  (_tplCache.categories||[]).forEach(function(c){catMap[c.id]=Object.assign({},c,{items:[]});});
  (_tplCache.templates||[]).forEach(function(t){
    var cid=t.category||'other';
    if(!catMap[cid])catMap[cid]={id:cid,name:cid,color:'#888',order:99,items:[]};
    catMap[cid].items.push(t);
  });
  var sorted=Object.values(catMap).filter(function(c){return c.items.length;}).sort(function(a,b){
    var ia=CAT_ORDER.indexOf(a.id),ib=CAT_ORDER.indexOf(b.id);
    if(ia!==-1&&ib!==-1)return ia-ib;if(ia!==-1)return -1;if(ib!==-1)return 1;
    return Number(a.order||99)-Number(b.order||99);
  });
  return{sorted};
}

function _highlight(text,q){
  if(!q||!text)return text||'';
  var word=q.split(/\s+/)[0];if(!word)return text;
  try{
    var re=new RegExp('('+word.replace(/[.*+?^${}()|[\]\\]/g,'\$&')+')','gi');
    return text.replace(re,'<mark style="background:rgba(210,153,34,.35);color:var(--tx);border-radius:2px;padding:0 1px">$1</mark>');
  }catch(ex){return text;}
}

function _renderTplList(cats,q){
  var el=document.getElementById('tplList');if(!el)return;
  if(!cats.length){
    el.innerHTML='<div style="padding:1.2rem .5rem;text-align:center">'
      +'<div style="font-size:1.8rem;opacity:.25;margin-bottom:.35rem">⊘</div>'
      +'<div style="font-size:.77rem;font-weight:600;color:var(--dm)">No results</div>'
      +'<div style="font-size:.72rem;color:var(--dm);margin-top:.15rem">for <em>"'+q+'"</em></div>'
      +'<button onclick="tplSearchClear()" style="all:unset;cursor:pointer;margin-top:.55rem;font-size:.72rem;color:var(--ac);text-decoration:underline">Clear search</button>'
      +'</div>';
    return;
  }
  var compact=!!q;
  el.innerHTML=cats.map(function(cat){
    var col=cat.color||'#888';
    var catHeaderStyle=compact?'padding:.2rem .4rem .1rem;':'';
    // Render items, inserting group sub-headers when group changes
    var _lastGroup=null;
    var items=cat.items.map(function(t){
      var nameHtml=_highlight(t.name||'',q);
      var tid=t.id;
      var isOn=curTpl&&curTpl.id===tid;
      var desc=(t.description||'').replace(/"/g,'&quot;');
      var groupHeader='';
      if(t.group&&!compact&&t.group!==_lastGroup){
        var isFirst=(_lastGroup===null);
        _lastGroup=t.group;
        groupHeader='<div style="display:flex;align-items:center;gap:.35rem;'
          +'padding:'+(isFirst?'.12rem':'.35rem')+' .45rem .08rem;'
          +'font-size:.59rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;'
          +'color:'+col+';opacity:.65;">'
          +'<div style="flex:1;height:0.5px;background:'+col+';opacity:.2;"></div>'
          +t.group
          +'<div style="flex:1;height:0.5px;background:'+col+';opacity:.2;"></div>'
          +'</div>';
      }
      var onclk="selTpl('"+tid+"')";
      var onkyd="if(event.key==='Enter')selTpl('"+tid+"')";
      var tiHtml='<div class="ti'+(isOn?' on':'')+'" onclick="'+onclk+'" tabindex="0"'
        +' onkeydown="'+onkyd+'" title="'+desc+'">'
        +'<div class="ti-bar" style="background:'+col+'"></div>'
        +'<div class="ti-body" style="display:flex;align-items:center;gap:.25rem;flex-wrap:wrap">'
        +'<span class="tin">'+nameHtml+'</span>'
        +(t.compute==='gpu'?'<span style="font-size:.58rem;padding:.02rem .22rem;border-radius:3px;background:rgba(248,81,73,.12);border:1px solid rgba(248,81,73,.3);color:#f85149;flex-shrink:0">GPU</span>':'')
        +(t.compute==='cpu'?'<span style="font-size:.58rem;padding:.02rem .22rem;border-radius:3px;background:rgba(88,166,255,.1);border:1px solid rgba(88,166,255,.25);color:var(--ac);flex-shrink:0">CPU</span>':'')
        +'</div></div>';
      return groupHeader+tiHtml;
    }).join('');
    return '<div class="tpl-section">'
      +'<div class="tpl-cat-header" style="'+catHeaderStyle+'">'
      +'<div class="tpl-cat-stripe" style="background:'+col+'"></div>'
      +'<div class="tpl-cat-label" style="color:'+col+'">'+cat.name+'</div></div>'
      +'<div class="tpl-items">'+items+'</div></div>';
  }).join('');
}

function paramSearchFilter(){
  var q=(document.getElementById('paramSearch')?.value||'').trim().toLowerCase();
  var clearBtn=document.getElementById('paramSearchClear');
  if(clearBtn)clearBtn.style.display=q?'':'none';
  var parF=document.getElementById('parF');if(!parF)return;
  var fields=parF.querySelectorAll('.fi');
  var visible=0;
  fields.forEach(function(f){
    var label=(f.querySelector('label')?.textContent||'').toLowerCase();
    var help=(f.querySelector('.help')?.textContent||'').toLowerCase();
    var inp=f.querySelector('input,select,textarea');
    var key=inp?(inp.id||'').replace('tp_','').toLowerCase():'';
    var match=!q||label.includes(q)||help.includes(q)||key.includes(q);
    f.style.display=match?'':'none';
    if(match)visible++;
  });
  var noRes=document.getElementById('paramSearchNoRes');
  if(q&&visible===0){
    if(!noRes){noRes=document.createElement('div');noRes.id='paramSearchNoRes';
      noRes.style.cssText='font-size:.73rem;color:var(--dm);padding:.3rem 0';
      noRes.textContent='No parameters match "'+q+'"';parF.appendChild(noRes);}
  }else if(noRes)noRes.remove();
}
function paramSearchClear(){
  var inp=document.getElementById('paramSearch');if(inp)inp.value='';
  paramSearchFilter();
}