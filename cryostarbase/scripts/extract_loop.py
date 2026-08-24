"""Generate SLURM sbatch scripts or run direct submission for PyTom candidate extraction.
CryoSTAR-Base — 2026
"""

import argparse
import os
import subprocess
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from cryostarbase.scripts._common import write_pytom_slurm_script, submit_sbatch


def _run_single(jf_str, tomo_mask_str, mask_exists, n_particles, cutoff_args,
                tophat_flag, relion_flag):
    """Worker: run pytom_extract_candidates.py for one tomogram. Returns (base, rc)."""
    from pathlib import Path
    jf   = Path(jf_str)
    base = jf.stem.replace("_job", "")
    cmd  = (["pytom_extract_candidates.py", "-j", str(jf), "-n", str(n_particles)]
            + cutoff_args
            + (["--tomogram-mask", tomo_mask_str] if mask_exists else [])
            + tophat_flag
            + ([relion_flag] if relion_flag else []))
    print(f"  [{base}] CMD: {' '.join(cmd)}", flush=True)
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1)
    if proc.stdout:
        for line in proc.stdout:
            print(f"  [{base}] {line}", end="", flush=True)
    rc = proc.wait()
    return base, rc


def generate_extract_scripts(
    results_dir: str,
    tomogram_mask_dir: str,
    n_particles: int = 3000,
    cutoff: str = "",
    relion5_compat: bool = True,
    tophat_filter: bool = False,
    partition: str = "gpu",
    time_limit: str = "04:00:00",
    memory: str = "30G",
    submit: bool = False,
    direct: bool = False,
    workers: int = 1,
) -> list[dict]:
    """
    Generate SLURM scripts or run direct extraction for PyTom candidates.
    direct=True: run pytom_extract_candidates.py directly via Popen (workstation).
    submit=True: generate AND submit SLURM scripts.
    Default: generate scripts only.
    """
    res = Path(results_dir)
    json_files = sorted(res.glob("*_job.json"))
    if not json_files:
        return [{"status": "error", "msg": f"No _job.json files in {results_dir}"}]

    relion_flag  = "--relion5-compat" if relion5_compat else ""
    cutoff_args  = cutoff.split() if cutoff else []
    tophat_flag  = ["--tophat-filter"] if tophat_filter else []

    # ── Pre-check masks, build work list ──
    work = []
    results = []
    for jf in json_files:
        base       = jf.stem.replace("_job", "")
        tomo_mask  = Path(tomogram_mask_dir) / f"{base}_mask.mrc"
        mask_exists = tomo_mask.exists()
        if not mask_exists:
            print(f"  [WARN] [{base}] Tomo mask not found: {tomo_mask} — running without mask")
        work.append((jf, tomo_mask, mask_exists, base))

    # ── Direct mode (workstation) ──
    if direct:
        n_workers = max(1, workers)
        print(f"  Workers: {n_workers}")
        if n_workers == 1:
            # Serial — simpler, ordered output
            for jf, tomo_mask, mask_exists, base in work:
                print(f"  Running: {base}" + (" [tophat]" if tophat_filter else ""))
                _, rc = _run_single(str(jf), str(tomo_mask), mask_exists,
                                    n_particles, cutoff_args, tophat_flag, relion_flag)
                results.append({"status": "ok" if rc == 0 else "error",
                                 "tomo": base, "mode": "direct", "returncode": rc})
        else:
            # Parallel — each worker prints with [base] prefix
            futures = {}
            with ProcessPoolExecutor(max_workers=n_workers) as pool:
                for jf, tomo_mask, mask_exists, base in work:
                    f = pool.submit(_run_single, str(jf), str(tomo_mask), mask_exists,
                                    n_particles, cutoff_args, tophat_flag, relion_flag)
                    futures[f] = base
                for f in as_completed(futures):
                    base, rc = f.result()
                    results.append({"status": "ok" if rc == 0 else "error",
                                     "tomo": base, "mode": "direct", "returncode": rc})
        return results

    # ── SLURM script generation ──
    for jf, tomo_mask, mask_exists, base in work:
        job_name    = f"pytom_extract_{base}"
        script_name = f"submit_{job_name}.sh"
        tophat_line = "    --tophat-filter \\\n" if tophat_filter else ""
        relion_line = f"    {relion_flag} \\\n" if relion_flag else ""
        cutoff_line = f"    {cutoff} \\\n" if cutoff else ""
        mask_line   = f"    --tomogram-mask {tomo_mask} \\\n" if mask_exists else ""

        extract_cmd = (
            f"pytom_extract_candidates.py \\\n"
            f"    -j {jf} \\\n"
            f"    -n {n_particles} \\\n"
            f"{cutoff_line}{mask_line}{tophat_line}{relion_line}    --log WARNING"
        )
        write_pytom_slurm_script(
            script_name, job_name, str(results_dir), partition, time_limit, memory,
            echo_label=f"PyTom Extract: {base}",
            command_body=extract_cmd,
        )
        result = {"status": "ok", "tomo": base, "script": script_name, "mode": "slurm"}
        if submit:
            result["submitted"] = submit_sbatch(script_name)
        results.append(result)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Run PyTom candidate extraction — direct or generate SLURM scripts")
    parser.add_argument("--results-dir",      required=True,
                        help="TM results directory (_job.json files)")
    parser.add_argument("--tomo-mask-dir",    default="_pytom/slabified",
                        help="Tomogram mask directory")
    parser.add_argument("-n", "--n-particles", type=int, default=3000,
                        help="Max particles to extract")
    parser.add_argument("-c", "--cutoff",     default="",
                        help="Cutoff: empty=auto, '-c -1'=top N, '-c 0.3'=threshold")
    relion_grp = parser.add_mutually_exclusive_group()
    relion_grp.add_argument("--relion5-compat", dest="relion5_compat",
                            action="store_true", default=True,
                            help="Output RELION5-compatible STAR format (default)")
    relion_grp.add_argument("--no-relion5",     dest="relion5_compat",
                            action="store_false",
                            help="Output legacy RELION4 STAR format")
    parser.add_argument("--tophat-filter",    action="store_true",
                        help="Apply tophat filter (recommended for lamellae)")
    parser.add_argument("--workers",          type=int, default=1,
                        help="Number of parallel workers for direct mode (default: 1 = serial)")
    parser.add_argument("--partition",        default="gpu",    help="SLURM partition")
    parser.add_argument("--time-limit",       default="04:00:00", help="SLURM time limit")
    parser.add_argument("--memory",           default="30G",    help="SLURM memory")
    parser.add_argument("--submit",           action="store_true",
                        help="Submit SLURM scripts via sbatch")
    parser.add_argument("--direct",           action="store_true",
                        help="Run directly on workstation (no SLURM scripts)")
    args = parser.parse_args()

    mode = "Direct run" if args.direct else ("SLURM + submit" if args.submit else "Generate SLURM Scripts")
    print("=" * 56)
    print(f"     PyTom Extract Candidates — {mode}")
    print("=" * 56)
    if args.tophat_filter:
        print("  Tophat filter: ON (removes ice, FIB contamination, gold beads)")
    print(f"  RELION5 compat: {'ON' if args.relion5_compat else 'OFF (legacy RELION4)'}")

    results = generate_extract_scripts(
        args.results_dir, args.tomo_mask_dir,
        args.n_particles, args.cutoff, args.relion5_compat,
        args.tophat_filter,
        args.partition, args.time_limit, args.memory,
        submit=args.submit, direct=args.direct, workers=args.workers)

    ok   = sum(1 for r in results if r["status"] == "ok")
    skip = sum(1 for r in results if r["status"] == "skipped")
    err  = sum(1 for r in results if r["status"] == "error")
    print(f"\n{ok} {'run' if args.direct else 'scripts generated'}, {skip} skipped, {err} errors")
    for r in results:
        if r["status"] in ("skipped", "error"):
            print(f"  {r['status'].upper()} {r['tomo']}: {r.get('msg', '')}")


if __name__ == "__main__":
    main()