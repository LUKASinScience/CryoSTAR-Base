/* CryoSTAR-Base — preliproc.js
   Pretilt Correction tab
   Pretilt correction: Hamid Rahmani (github.com/hamid13r/warp_lamella_adapters)
   Depends on: core.js (api, post, $, curProj)
   Lukas W. Bauer und Claude — 2026 */

// ── Tab open — auto-fill from project config ───────────────────
async function preliProcOnTabOpen(){
  if(!curProj) return;
  try {
    var c = await api('/api/projects/' + curProj + '/config');
    _ppAutofill('ppMdocsDir',     c.warp_mdocs_dir || '');
    _ppAutofill('ppPretiltAngle', c.pretilt_angle !== 0 ? String(c.pretilt_angle) : '');
    _ppAutofill('ppPretiltOut',   c.mdocs_pretilt_dir || '');
  } catch(e) {}
}

function _ppAutofill(id, val){
  var el = document.getElementById(id);
  if(el && !el.value && val) el.value = val;
}

// ── Pretilt MDOC correction ─────────────────────────────────────
async function ppRunPretilt(){
  var mdocsDir = (document.getElementById('ppMdocsDir')     || {}).value || '';
  var angle    = parseFloat((document.getElementById('ppPretiltAngle') || {}).value || '0');
  var outDir   = (document.getElementById('ppPretiltOut')   || {}).value || '';
  if(!mdocsDir || !angle){ alert('Set MDOCs folder and pretilt angle.'); return; }
  ppLog('Running pretilt correction (' + angle + '°) on ' + mdocsDir + '...');
  try {
    var r = await post('/api/preliproc/run_pretilt', {
      mdocs_dir: mdocsDir, pretilt_angle: angle, output_dir: outDir, project: curProj||''
    });
    ppLog(r.log.join('\n'));
    // Update pretilt output field
    var el = document.getElementById('ppPretiltOut');
    if(el && r.output_dir) el.value = r.output_dir;
  } catch(e) { ppLog('ERROR: ' + e.message); }
}

// ── Log ────────────────────────────────────────────────────────
function ppLog(text){
  var el = document.getElementById('ppLog');
  if(!el) return;
  el.textContent = text;
  el.scrollTop = el.scrollHeight;
}
