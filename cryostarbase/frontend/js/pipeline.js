/* CryoSTAR-Base — pipeline.js
   Part of CryoSTAR-Base frontend
   Lukas W. Bauer und Claude — 2026 */


// ── Jobs ──
// ── Pipeline Strip Log Accordion ──
async function wfStepClick(e, jobTypesCsv, label){
  // Navigate to tab if applicable (find matching step)
  const step=WF_STEPS.find(function(s){return s.label===label;});
  if(step&&step.tab&&!e.ctrlKey&&!e.metaKey){
    // Cmd/ctrl click → just show accordion; plain click → navigate + show
  }
  // Show job log accordion for this category
  if(!curProj)return;
  const acc=document.getElementById('jobLogAccordion');
  const body=document.getElementById('jobLogAccordionBody');
  const title=document.getElementById('jobLogAccordionTitle');
  const count=document.getElementById('jobLogAccordionCount');
  if(!acc||!body)return;
  const jobTypes=new Set(jobTypesCsv.split(','));
  try{
    const d=await api('/api/projects/'+curProj+'/jobs');
    const filtered=(d.jobs||[]).filter(function(j){return jobTypes.has(j.job_type);});
    title.textContent=label+' Jobs';
    var completedN=filtered.filter(function(j){return j.status==='completed';}).length;
    var runningN=filtered.filter(function(j){return j.status==='running';}).length;
    var failedN=filtered.filter(function(j){return j.status==='failed';}).length;
    var countParts=[];
    if(completedN)countParts.push(completedN+' completed');
    if(runningN)countParts.push(runningN+' running');
    if(failedN)countParts.push(failedN+' failed');
    count.textContent=filtered.length+' job'+(filtered.length!==1?'s':'')+
      (countParts.length?' ('+countParts.join(', ')+')':'');
    if(!filtered.length){
      body.innerHTML='<div style="padding:.6rem;font-size:.74rem;color:var(--dm)">No jobs in this category yet.</div>';
    }else{
      // Build accordion items, one per job
      body.innerHTML='';
      filtered.forEach(function(j){
        var item=document.createElement('div');
        item.style.cssText='border-bottom:1px solid var(--bd)';
        var header=document.createElement('div');
        var statusColor={completed:'var(--gn)',failed:'var(--rd)',running:'var(--ac)',queued:'var(--yl)'}[j.status]||'var(--dm)';
        header.style.cssText='display:flex;align-items:center;gap:.4rem;padding:.3rem .6rem;cursor:pointer;transition:background .1s';
        header.onmouseover=function(){this.style.background='var(--sf2)';};
        header.onmouseout=function(){this.style.background='';};
        // Status indicator
        var dot=document.createElement('span');
        dot.style.cssText='display:inline-block;width:7px;height:7px;border-radius:50%;background:'+statusColor+';flex-shrink:0';
        // Job ID + title
        var jidSpan=document.createElement('span');
        jidSpan.style.cssText='font-size:.68rem;font-family:monospace;font-weight:700;color:var(--dm);flex-shrink:0';
        jidSpan.textContent=j.job_id;
        var titleSpan=document.createElement('span');
        titleSpan.style.cssText='font-size:.74rem;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        titleSpan.textContent=j.custom_title||j.title||j.job_type;
        // Status badge
        var statusBadge=document.createElement('span');
        statusBadge.className='badge '+(j.status||'queued');
        statusBadge.style.fontSize='.6rem';
        statusBadge.textContent=j.status;
        // Chevron
        var chev=document.createElement('span');
        chev.style.cssText='font-size:.65rem;color:var(--dm);transition:transform .15s;flex-shrink:0';
        chev.textContent='▸';
        header.appendChild(dot);header.appendChild(jidSpan);header.appendChild(titleSpan);
        header.appendChild(statusBadge);header.appendChild(chev);
        // Log body (hidden by default)
        var logBody=document.createElement('div');
        logBody.style.display='none';
        logBody.style.cssText='display:none;padding:.3rem .6rem .5rem;background:var(--bg)';

        // ── 1. OUTPUT FILES & BROWSE LINKS (top) ──
        // Output files — browse links
        if(j.output_files&&j.output_files.length){
          var outSection=document.createElement('div');
          outSection.style.cssText='margin-top:.35rem;display:flex;flex-direction:column;gap:.2rem';
          var outLabel=document.createElement('div');
          outLabel.style.cssText='font-size:.63rem;color:var(--dm);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.1rem';
          outLabel.textContent='Output files';
          outSection.appendChild(outLabel);
          j.output_files.slice(0,8).forEach(function(f){
            var row=document.createElement('div');
            row.style.cssText='display:flex;align-items:center;gap:.3rem';
            // File icon
            var icon=document.createElement('span');
            var ext=(f.split('.').pop()||'').toLowerCase();
            var iconMap={mrc:'◈',star:'★',log:'≡',json:'{}',txt:'≡',pdf:'∷'};
            icon.style.cssText='font-size:.72rem;flex-shrink:0;width:14px;text-align:center';
            icon.textContent=iconMap[ext]||'·';
            // Filename
            var fname=document.createElement('span');
            fname.style.cssText='font-size:.71rem;font-family:monospace;color:var(--dm);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            var shortName=f.split('/').pop();
            fname.textContent=shortName;
            fname.title=f;
            // Browse button — navigates left panel to the file's directory
            var browseBtn=document.createElement('button');
            browseBtn.className='bsm';
            browseBtn.style.cssText='font-size:.62rem;padding:.05rem .3rem;flex-shrink:0;color:var(--ac);border-color:rgba(88,166,255,.3)';
            browseBtn.textContent='Browse';
            browseBtn.title='Navigate to '+f+' in the file browser';
            (function(filePath,projFolder){
              browseBtn.onclick=function(e){
                e.stopPropagation();
                // Get directory of the file
                var dir=filePath.indexOf('/')>=0
                  ?filePath.substring(0,filePath.lastIndexOf('/'))
                  :'.';
                // If it's a relative path, make absolute via project folder
                if(!filePath.startsWith('/')){
                  // Navigate browse panel to project dir then the subfolder
                  brGo(dir==='.'?'.':'.'+'/'+dir);
                }else{
                  brGo(dir);
                }
                // Highlight in left panel
                var left=document.getElementById('left');
                if(left)left.scrollIntoView({behavior:'smooth',block:'start'});
              };
            })(f, curProj||'');
            row.appendChild(icon);row.appendChild(fname);row.appendChild(browseBtn);
            outSection.appendChild(row);
          });
          if(j.output_files.length>8){
            var more=document.createElement('div');
            more.style.cssText='font-size:.65rem;color:var(--dm);padding:.1rem 0';
            more.textContent='+ '+(j.output_files.length-8)+' more files';
            outSection.appendChild(more);
          }
          logBody.appendChild(outSection);
        }

        // ── 2. LOG ──
        var logPre=document.createElement('div');
        logPre.className='job-log';
        logPre.style.maxHeight='160px';
        logPre.style.marginTop='.35rem';
        logPre.textContent='Click to expand to load log...';
        logBody.appendChild(logPre);

        // ── 3. ACTION ROW ──
        var actionRow=document.createElement('div');
        actionRow.style.cssText='display:flex;gap:.3rem;margin-top:.35rem;flex-wrap:wrap;align-items:center';

        var detailBtn=document.createElement('button');
        detailBtn.className='bsm';
        detailBtn.style.cssText='font-size:.68rem';
        detailBtn.textContent='Open Job Detail →';
        (function(jid){detailBtn.onclick=function(){jdpOpen(jid);};})(j.job_id);
        actionRow.appendChild(detailBtn);

        // Browse working dir button
        if(j.working_dir){
          var wdBtn=document.createElement('button');
          wdBtn.className='bsm';
          wdBtn.style.cssText='font-size:.68rem;color:var(--dm)';
          wdBtn.textContent='Browse folder';
          wdBtn.title='Open '+j.working_dir+' in file browser';
          (function(wd){
            wdBtn.onclick=function(){
              brGo(wd);
              var left=document.getElementById('left');
              if(left)left.scrollIntoView({behavior:'smooth',block:'start'});
            };
          })(j.working_dir);
          actionRow.appendChild(wdBtn);
        }

        logBody.appendChild(actionRow);
        // Toggle
        var open=false;
        (function(jid,logPre,logBody,chev){
          header.onclick=function(){
            open=!open;
            logBody.style.display=open?'block':'none';
            chev.textContent=open?'▾':'▸';
            chev.style.transform=open?'rotate(0)':'';
            if(open&&logPre.textContent==='Click to load log...'){
              wfLoadJobLog(jid,logPre);
            }
          };
        })(j.job_id,logPre,logBody,chev);
        item.appendChild(header);item.appendChild(logBody);
        body.appendChild(item);
      });
    }
    acc.style.display='';
    acc.scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){console.error('wfStepClick',e);}
}

async function wfLoadJobLog(jid,logEl){
  if(!curProj||!logEl)return;
  logEl.innerHTML='';
  try{
    const d=await api('/api/projects/'+curProj+'/jobs/'+jid+'/log');
    var lines=d.lines||[];
    if(!lines.length){
      logEl.textContent='No log yet.';return;
    }
    lines.forEach(function(l){
      var span=document.createElement('span');
      var cls='';
      if(l.startsWith('ERR:')||l.startsWith('[stderr]')||l.toLowerCase().startsWith('error'))cls='log-err';
      else if(l.startsWith('$')||l.startsWith('pytom_')||l.startsWith('WarpTools'))cls='log-cmd';
      else if(l.includes('Done.')||l.includes('Saved')||l.startsWith('✔')||l.startsWith('Written:'))cls='log-ok';
      else if(l.startsWith('[started]')||l.includes('...')||l.startsWith('  GPU'))cls='log-info';
      else if(l.toLowerCase().includes('warning'))cls='log-warn';
      if(cls)span.className=cls;
      span.textContent=l;
      logEl.appendChild(span);
      logEl.appendChild(document.createTextNode('\n'));
    });
    logEl.scrollTop=logEl.scrollHeight;
  }catch(e){logEl.textContent='No log available.';}
}

async function loadJobs(){
  if(!curProj)return;
  try{
    const d=await api('/api/projects/'+curProj+'/jobs');
    // Apply status filter and tag filter
    var filtered = d.jobs.filter(function(j){
      var statusOk = !_jobFilter || _jobFilter==='all' || j.status===_jobFilter;
      var tagOk = !_jobTagFilter || (j.tags&&j.tags.includes(_jobTagFilter));
      return statusOk && tagOk;
    });
    // Collect all unique tags for filter row
    var allTags = {};
    d.jobs.forEach(function(j){ (j.tags||[]).forEach(function(t){ allTags[t]=(allTags[t]||0)+1; }); });
    _updateJobTagFilterRow(allTags);

    $('jobList').innerHTML=filtered.length
      ? filtered.map(function(j){
          const displayTitle=j.custom_title||j.title||j.job_type;
          var catCls=JOB_CAT[j.job_type]||'cat-other';
          var catLabel={'cat-import':'IMPORT','cat-pytom':'PYTOM','cat-warp':'WARP','cat-other':'OTHER','cat-warp-preproc':'PREPROC','cat-aretomo3':'ARETOMO','cat-relion':'RELION','cat-mtools':'M'}[catCls]||(j.job_type||'').toUpperCase().slice(0,7);
          var catBadge='<span class="tag '+catCls+'" style="font-size:.57rem;padding:.02rem .18rem;flex-shrink:0;margin-left:.2rem">'+catLabel+'</span>';
          var isFinal=(j.tags||[]).includes('final');
          var finalStar=isFinal?'<span class="ji-final" title="Marked as final">★</span>':'';
          var extraTags=(j.tags&&j.tags.length)
            ?j.tags.filter(function(t){return t!=='final';}).map(function(t){return '<span class="tag cat-meta" style="font-size:.57rem;padding:.02rem .18rem">'+t+'</span>';}).join('')
            :'';
          var isSelected=_compareSelected.includes(j.job_id);
          var cbHtml=_compareMode
            ?('<input type="checkbox" data-compare-cb="'+j.job_id+'" style="margin-right:.2rem;flex-shrink:0"'+(isSelected?' checked':'')+' />')
            :'';
          // Two-line display: job type name + optional custom title below
          var jobTypeName=j.title||j.job_type;
          var customTitle=j.custom_title&&j.custom_title!==jobTypeName?j.custom_title:'';
          var titleBlock=customTitle
            ?('<div style="display:flex;flex-direction:column;min-width:0;flex:1;overflow:hidden">'
              +'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dm);font-size:.74rem">'+jobTypeName+'</span>'
              +'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx);font-size:.72rem;font-weight:600">'+customTitle+'</span>'
              +'</div>')
            :('<span class="jit" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+jobTypeName+'</span>');
          return '<div class="ji" data-jid="'+j.job_id+'"'
            +' data-sel="'+(isSelected?'1':'0')+'"'
            +' title="'+(isSelected?'Selected for comparison':'Click to view details — '+j.job_id+(customTitle?' · '+customTitle:''))+'"'
            +' style="'+(isSelected?'background:rgba(88,166,255,.08)':'')
            +(customTitle?';padding-top:.18rem;padding-bottom:.18rem':'')+'">'  
            +cbHtml
            +'<span class="jic" style="color:'+sc(j.status)+'">'+si(j.status)+'</span>'
            +finalStar
            +'<span class="jid">'+j.job_id+'</span>'
            +titleBlock
            +catBadge+extraTags
            +'</div>';
        }).join('')
      :(filtered.length===0&&d.jobs.length>0
        ?'<div style="padding:.4rem .5rem;font-size:.72rem;color:var(--dm);text-align:center">No '+(_jobFilter&&_jobFilter!=='all'?_jobFilter:'matching')+' jobs</div>'
        :'<div class="empty-state">'
        +'<div class="empty-state-icon" style="font-family:monospace;font-size:1.6rem;opacity:.3;color:var(--dm)">○</div>'
        +'<div class="empty-state-title">No jobs yet</div>'
        +'<div class="empty-state-sub">Open the Job Builder to create your first job.</div>'
        +'<button class="empty-state-action" onclick="openRightPanel()">&#65291; Open Job Builder</button>'
        +'</div>')
    renderWorkflowStrip(d.jobs);
    if(d.jobs&&d.jobs.length>0)showWorkflowRow();
    progLoadSaved();
    jdpRefreshParentOptions(d.jobs);
    var jl=$('jobList');
    if(jl&&!jl._jdpWired){
      jl._jdpWired=true;
      jl.addEventListener('click',function(e){
        var el=e.target.closest('[data-jid]');
        if(!el) return;
        if(_compareMode) _toggleJobSelect(el.getAttribute('data-jid'));
        else jdpOpen(el.getAttribute('data-jid'));
      });
    }
  pbarUpdateParticles();
  }catch(e){console.error("loadJobs error:",e);}
}

function jdpRefreshParentOptions(jobs){
  const sel=$('jdpParentSelect');
  if(!sel)return;
  const cur=sel.value;
  sel.innerHTML='<option value="">— select a parent job —</option>'+
    (jobs||[]).map(function(j){
      const t=j.custom_title||j.title||j.job_type;
      return '<option value="'+j.job_id+'">'+j.job_id+' — '+t+' ('+j.status+')</option>';
    }).join('');
  if(cur)sel.value=cur;
}

async function loadInvestigators(){
  if(!curProj)return;
  try{
    const c=await api('/api/projects/'+curProj+'/config');
    const il=$('invList');
    if(!il)return;
    const names=c.investigators||[];
    il.innerHTML='';
    if(!names.length){
      il.innerHTML='<div class="dim" style="font-size:.78rem">No investigators added yet</div>';
      return;
    }
    names.forEach(function(n){
      const chip=document.createElement('span');
      chip.className='inv-chip';
      chip.appendChild(document.createTextNode(n));
      const btn=document.createElement('button');
      btn.textContent='✕';
      btn.onclick=function(){removeInvestigator(n)};
      chip.appendChild(btn);
      il.appendChild(chip);
    });
  }catch(e){}
}

function computeParticlesStatus(){
  const d=parseFloat(($('pDiam')||{}).value)||0;
  const b=parseInt(($('pBox')||{}).value)||0;
  if(d>0&&b>0)return 'complete';
  if(d>0||b>0)return 'partial';
  return 'empty';
}

function renderMd(text){
  if(!text)return '<span style="color:var(--dm)">No notes yet.</span>';

  // Strip bot emoji from legacy notes
  text=text.replace(/🤖 /g,'');

  // 1. Extract fenced code blocks (protect from further processing)
  var codeBlocks=[];
  text=text.replace(/```([\s\S]*?)```/g,function(m,code){
    var i=codeBlocks.length;
    codeBlocks.push(code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').trim());
    return 'CODE'+i+'';
  });

  // 2. HTML-escape the rest
  var s=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 3. Restore code blocks as styled <pre>
  s=s.replace(/CODE(\d+)/g,function(m,i){
    return '<pre style="background:var(--bg);border:1px solid var(--bd);border-radius:5px;'
      +'padding:.4rem .6rem;font-family:monospace;font-size:.74rem;color:var(--gn);'
      +'overflow-x:auto;white-space:pre;margin:.25rem 0 .4rem">'+codeBlocks[+i]+'</pre>';
  });

  // 4. Headings
  s=s.replace(/^### (.+)$/gm,'<h3 style="font-size:.82rem;font-weight:700;color:var(--ac);margin:.55rem 0 .1rem">$1</h3>');
  s=s.replace(/^## (.+)$/gm,'<h2 style="font-size:.92rem;font-weight:700;color:var(--tx);margin:.75rem 0 .15rem;border-bottom:1px solid var(--bd);padding-bottom:.12rem">$1</h2>');
  s=s.replace(/^# (.+)$/gm,'<h1 style="font-size:1.05rem;font-weight:800;color:var(--tx);margin:.4rem 0 .2rem">$1</h1>');

  // 5. Horizontal rule
  s=s.replace(/^---$/gm,'<hr style="border:none;border-top:1px solid var(--bd);margin:.5rem 0">');

  // 6. Markdown tables — convert | col | col | rows into HTML table
  s=s.replace(/(?:\|[^\n]+\|[ \t]*(?:\n|$))+/g,function(block){
    var rows=block.trim().split('\n');
    var dataRows=rows.filter(function(r){return !/^\s*\|[-:\s|]+\|/.test(r);});
    if(!dataRows.length)return '';
    var html='<table style="border-collapse:collapse;width:100%;margin:.4rem 0;font-size:.8rem">';
    dataRows.forEach(function(row,ri){
      var cells=row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function(c){return c.trim();});
      var tag=ri===0?'th':'td';
      var bg=ri===0?'background:var(--sf2);font-weight:700;':'';
      html+='<tr>';
      cells.forEach(function(c){
        html+='<'+tag+' style="border:1px solid var(--bd);padding:.25rem .5rem;'+bg+'">'+c+'</'+tag+'>';
      });
      html+='</tr>';
    });
    return html+'</table>';
  });

  // 7. Numbered lists
  s=s.replace(/^(\d+)\.\s+(.+)$/gm,'<div style="display:flex;gap:.4rem;margin:.1rem 0;font-size:.82rem"><span style="color:var(--dm);min-width:1.2rem;flex-shrink:0">$1.</span><span>$2</span></div>');

  // 8. Bullet points (- item)
  s=s.replace(/^[-•]\s+(.+)$/gm,'<div style="display:flex;gap:.4rem;margin:.08rem 0;font-size:.82rem"><span style="color:var(--dm);flex-shrink:0">–</span><span>$1</span></div>');

  // 9. Inline styles
  s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/\*(.+?)\*/g,'<em style="color:var(--dm)">$1</em>');
  s=s.replace(/`([^`]+)`/g,'<code style="background:var(--sf2);padding:.05rem .28rem;border-radius:3px;font-size:.82em;font-family:monospace;color:var(--ac)">$1</code>');

  // 10. Timestamp headers (### 2026-03-29 13:41)
  // already handled by ### above

  // 11. Split remaining text into paragraphs on double newline
  // But don't wrap lines that are already HTML elements
  var parts=s.split(/\n{2,}/);
  return parts.map(function(p){
    p=p.trim();
    if(!p)return '';
    // Don't wrap block elements in <p>
    if(/^<(h[1-6]|hr|table|pre|div)/.test(p))return p;
    // Convert single newlines to <br> within paragraph
    return '<p style="margin:.2rem 0;font-size:.83rem;line-height:1.75">'+p.replace(/\n/g,'<br>')+'</p>';
  }).join('');
}

async function loadNotes(){
  if(!curProj)return;
  try{
    const d=await api(`/api/projects/${curProj}/notes`);
    $('nContent').innerHTML=renderMd(d.content||'');
  }catch(e){$('nContent').textContent=e.message}
}
async function addNote(){
  const t=$('nInput').value.trim();if(!t||!curProj)return;
  try{await post('/api/notes',{project:curProj,text:t});$('nInput').value='';loadNotes()}catch(e){alert(e.message)}
}
async function exportNotes(fmt){
  if(!curProj)return;
  try{
    const d=await api(`/api/projects/${curProj}/notes`);const content=d.content||'';
    if(fmt==='md'){
      const blob=new Blob([content],{type:'text/markdown'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);
      a.download=`${curProj}_notebook.md`;a.click();URL.revokeObjectURL(a.href);
    }else{
      const esc=content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${curProj} Notebook</title>
<style>body{font-family:Georgia,serif;max-width:820px;margin:2.5rem auto;color:#111;line-height:1.75;font-size:15px}
h1,h2,h3{font-family:-apple-system,sans-serif;margin-top:1.8rem;font-weight:600}
hr{border:none;border-top:1px solid #ddd;margin:1.2rem 0}
code{background:#f3f3f3;padding:.1rem .3rem;border-radius:3px;font-size:.88em;font-family:monospace}
table{border-collapse:collapse;width:100%;margin:.6rem 0}td,th{border:1px solid #ddd;padding:.4rem .65rem}
th{background:#f7f7f7;font-weight:600}@media print{body{margin:1rem}@page{margin:2cm}}</style></head>
<body><pre style="white-space:pre-wrap;font-family:Georgia,serif;border:none;background:none;padding:0">${esc}</pre>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))<\/script></body></html>`;
      const blob=new Blob([html],{type:'text/html'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);
      a.download=`${curProj}_notebook_print.html`;a.click();URL.revokeObjectURL(a.href);
    }
  }catch(e){alert('Export failed: '+e.message)}
}

// ── Unit calc ──
function calcUnitsFromA(){
  const px=parseFloat($('ucPxSize').value),a=parseFloat($('ucDiam').value);
  if(!isNaN(px)&&!isNaN(a)&&px>0&&a>0){
    const pxV=a/px;$('ucDiamPx').value=pxV.toFixed(2)+' px';
    const min=Math.ceil(pxV*1.5),sugg=GOOD_BOXES.filter(b=>b>=min).slice(0,8);
    $('ucBoxGrid').innerHTML=sugg.map(b=>`<span class="box-tag hl">${b}</span>`).join('');
    $('ucBoxSugg').style.display='block';
  }else{$('ucDiamPx').value='';$('ucBoxSugg').style.display='none'}
}
function calcUnitsFromPx(){
  const px=parseFloat($('ucPxSize').value),pxV=parseFloat($('ucPx').value);
  $('ucA').value=(!isNaN(px)&&!isNaN(pxV)&&px>0&&pxV>0)?(pxV*px).toFixed(2)+' Å':'';
}
function calcUnits(){calcUnitsFromA();calcUnitsFromPx()}