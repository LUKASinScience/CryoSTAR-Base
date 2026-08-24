/* CryoSTAR-Base — aretomo.js
   Part of CryoSTAR-Base frontend — auto-extracted from index.html
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// ══════════════════════════════════════════════════════════════
//  PHASE 6 — AreTomo3 Checker + Pbar Particle Count
// ══════════════════════════════════════════════════════════════

async function ckAreTomo3(){
  if(!curProj){ alert('Open a project first.'); return; }
  var dir = ($('ckAt3Dir')?.value||'').trim();
  var el = document.getElementById('ckAt3R');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--dm);font-size:.75rem">Checking…</div>';
  try{
    var url = '/api/projects/'+curProj+'/aretomo3/check';
    if(dir) url += '?aretomo_dir='+encodeURIComponent(dir);
    var d = await api(url);
    el.innerHTML = _renderAt3Report(d);
  }catch(e){
    el.innerHTML = '<div class="res error"><span>✖</span><pre>'+e.message+'</pre></div>';
  }
}

function _renderAt3Report(d){
  var statusColor = {ok:'var(--gn)', warning:'var(--yl)', error:'var(--rd)'}[d.status]||'var(--dm)';
  var statusIcon  = {ok:'✓', warning:'⚠', error:'✖'}[d.status]||'?';

  var html = '<div style="margin-bottom:.4rem">'
    +'<span style="color:'+statusColor+';font-weight:700;font-size:.8rem">'+statusIcon+' '
    +d.status.toUpperCase()+'</span>'
    +'<span style="font-size:.7rem;color:var(--dm);margin-left:.5rem">'+d.directory+'</span>'
    +'</div>';

  // Summary row
  var s = d.summary||{};
  if(s.xf_files !== undefined){
    html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.4rem">';
    var items = [
      ['XF', s.xf_files],
      ['TLT', s.tlt_files],
    ];
    if(s.mdoc_files) items.unshift(['MDOCs', s.mdoc_files]);
    if(s.max_z_shift_px !== undefined) items.push(['Max Z-shift', s.max_z_shift_px+'px']);
    if(s.mean_z_shift_px !== undefined) items.push(['Mean Z-shift', s.mean_z_shift_px+'px']);
    items.forEach(function(item){
      html += '<div class="dash-metric"><span class="dash-metric-label">'+item[0]+'</span>'
        +'<span class="dash-metric-value">'+item[1]+'</span></div>';
    });
    html += '</div>';
  }

  // Check items
  html += (d.checks||[]).map(function(c){
    var col = {ok:'var(--gn)',warning:'var(--yl)',error:'var(--rd)'}[c.status]||'var(--dm)';
    var ic  = {ok:'✓',warning:'⚠',error:'✖'}[c.status]||'?';
    return '<div class="chk '+c.status+'">'
      +'<span class="ci" style="color:'+col+'">'+ic+'</span>'
      +'<span class="cn">'+c.name+'</span>'
      +'<span class="cm">'+c.msg+'</span>'
      +'</div>';
  }).join('');

  // Z-shift details table (top worst)
  if(s.z_shift_details && s.z_shift_details.length){
    html += '<div style="margin-top:.5rem;font-size:.68rem;color:var(--dm);font-weight:700;'
      +'text-transform:uppercase;letter-spacing:.05em;margin-bottom:.2rem">Worst Z-shifts</div>'
      +'<table class="tbl" style="font-size:.7rem"><thead><tr>'
      +'<th>Tomogram</th><th>Max Z-shift (px)</th><th>Mean Z-shift (px)</th></tr></thead><tbody>'
      +s.z_shift_details.slice(0,8).map(function(r){
        var bad = r.max_z_shift >= 50;
        return '<tr style="'+(bad?'color:var(--rd)':'')+'">'
          +'<td style="font-family:monospace">'+r.name+'</td>'
          +'<td style="text-align:right">'+r.max_z_shift+'</td>'
          +'<td style="text-align:right">'+r.mean_z_shift+'</td></tr>';
      }).join('')
      +'</tbody></table>';
  }

  // Save to notebook button
  html += '<div style="margin-top:.5rem">'
    +'<button class="bsm" onclick="at3SaveReport()" '
    +'style="font-size:.7rem">→ Save report to Notebook</button></div>';

  return html;
}

// Store last report for notebook saving
var _lastAt3Report = null;

async function at3SaveReport(){
  var el=document.getElementById('ckAt3R');
  if(!el||!curProj)return;
  try{
    var dir=($('ckAt3Dir')?.value||'').trim();
    var url='/api/projects/'+curProj+'/aretomo3/check'+(dir?'?aretomo_dir='+encodeURIComponent(dir):'');
    var d=await api(url);
    var s=d.summary||{};
    var nl='\n';
    var lines=['**AreTomo3 Alignment Check**','Directory: '+d.directory,'Status: '+d.status.toUpperCase(),''];
    if(s.xf_files!==undefined) lines.push('XF: '+s.xf_files+' / TLT: '+s.tlt_files+(s.mdoc_files?' / MDOCs: '+s.mdoc_files:''));
    if(s.max_z_shift_px!==undefined) lines.push('Max Z-shift: '+s.max_z_shift_px+'px / Mean: '+s.mean_z_shift_px+'px');
    lines.push('');
    (d.checks||[]).forEach(function(c){ lines.push((c.status==='ok'?'[ok]':'[warn]')+' '+c.name+': '+c.msg); });
    await post('/api/notes',{project:curProj,text:lines.join(nl)});
    loadNotes();
    var btn=el.querySelector('[onclick="at3SaveReport()"]');
    if(btn){btn.textContent='Saved';setTimeout(function(){btn.textContent='Save report to Notebook';},2000);}
  }catch(e){console.error('at3SaveReport',e);}
}

// Update particle count in pInfo when jobs change
function pbarUpdateParticles(){
  if(!curProj)return;
  api('/api/projects/'+curProj+'/particles/count').then(function(d){
    var el=document.getElementById('pInfoParticles');
    if(el){
      if(d.count) el.innerHTML='<div style="color:var(--gn);font-weight:600">'+d.count.toLocaleString()+' particles</div>';
      else el.innerHTML='';
    }
  }).catch(function(){});
}


// ══════════════════════════════════════════════════════════════
//  AreTomo3 directory auto-fill + save
// ══════════════════════════════════════════════════════════════

async function at3AutoFill(){
  if(!curProj) return;
  try{
    var c = await api('/api/projects/'+curProj+'/config');
    var warpDir = c.warptools_dir || '';
    // Derive preprocessing root = warptools/../  (parent of warptools/)
    var preprocRoot = warpDir ? warpDir.replace(/\/warptools\/?$/, '') : '';

    var wd = document.getElementById('at3WorkDir');
    var id = document.getElementById('at3InputDir');

    // Auto-fill working dir = preprocessing_root/aretomo3/
    if(wd && !wd.value && preprocRoot){
      wd.value = preprocRoot + '/aretomo3';
    }
    // Auto-fill input dir = working_dir/raw_data_frames/
    if(id && !id.value){
      var base = (wd && wd.value) ? wd.value : (preprocRoot ? preprocRoot+'/aretomo3' : '');
      if(base) id.value = base.replace(/\/$/, '') + '/raw_data_frames';
    }

    // Also auto-fill saved values from config
    if(wd && !wd.value && c.at3_work_dir) wd.value = c.at3_work_dir;
    if(id && !id.value && c.at3_input_dir) id.value = c.at3_input_dir;

  }catch(e){}
}

async function at3SaveDirs(){
  if(!curProj) return;
  var wd = (document.getElementById('at3WorkDir')||{value:''}).value.trim();
  var id = (document.getElementById('at3InputDir')||{value:''}).value.trim();
  try{
    await post('/api/projects/'+curProj+'/config',{
      at3_work_dir: wd,
      at3_input_dir: id,
    });
  }catch(e){}
}