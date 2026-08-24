/* CryoSTAR-Base — wt_checklist.js
   Part of CryoSTAR-Base frontend — 2026
   Depends on: core.js (api, post, $, curProj, etc.)
   Lukas W. Bauer und Claude — 2026 */

// Star file validation
function tmaValidateStar(val){
  const help = $('tmaStarHelp');
  const inp = $('tmaStarPath');
  if(!val){ if(help)help.textContent='Converted PyTom STAR with _rlnLCCmax and _rlnSearchStd columns'; return; }
  if(!val.endsWith('.star')){
    if(help){help.textContent='⚠ Path must end with .star — select a file, not a folder';help.style.color='var(--rd)';}
    if(inp)inp.style.borderColor='var(--rd)';
  } else {
    if(help){help.textContent='✓ STAR file selected';help.style.color='var(--gn)';}
    if(inp)inp.style.borderColor='var(--gn)';
  }
}
