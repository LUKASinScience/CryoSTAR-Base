"""Generate SLURM sbatch scripts or run direct submission for PyTom template matching.
CryoSTAR-Base — 2026
"""

import argparse
import os
import subprocess
from pathlib import Path

from cryostarbase.scripts._common import write_pytom_slurm_script, submit_sbatch


def generate_tm_scripts(
    tomo_dir: str,
    xml_dir: str,
    results_dir: str,
    template_file: str,
    mask_file: str,
    tomogram_mask_dir: str,
    tomo_suffix: str = "",
    particle_diameter: float = 110.0,
    voxel_size: float = 11.056,
    symmetry: int = 1,
    voltage: int = 300,
    cs: float = 2.7,
    amp: float = 0.07,
    gpu: str = "0",
    partition: str = "gpu",
    time_limit: str = "24:00:00",
    memory: str = "64G",
    submit: bool = False,
    direct: bool = False,
) -> list[dict]:
    """
    Generate SLURM scripts or run direct submission for template matching.
    direct=True: run pytom_match_template.py via Popen (workstation mode).
    submit=True: generate scripts AND submit via sbatch (cluster mode).
    Default: generate scripts only.
    """
    tomo_path = Path(tomo_dir)
    xml_path  = Path(xml_dir)
    res_path  = Path(results_dir)
    res_path.mkdir(parents=True, exist_ok=True)

    mrcs = sorted(tomo_path.glob("*.mrc"))
    if not mrcs:
        return [{"status": "error", "msg": f"No .mrc files in {tomo_dir}"}]

    results = []
    suffix_mismatch_warned = False

    for mrc in mrcs:
        base_name = mrc.stem

        # Strip suffix — WarpTools uses 2 decimal places e.g. _10.71Apx
        if tomo_suffix:
            sfx_check = tomo_suffix.replace(".mrc", "")
            if base_name.endswith(sfx_check):
                base_name = base_name[: -len(sfx_check)]
            else:
                # Bug12: clear warning when suffix doesn't match
                if not suffix_mismatch_warned:
                    print(f"  [WARN] Suffix '{tomo_suffix}' not found in '{mrc.stem}'")
                    print(f"  [WARN] Check: WarpTools uses 2 decimal places e.g. _10.71Apx (not _10.712Apx)")
                    print(f"  [WARN] Leave suffix empty to use full stem for file lookup")
                    suffix_mismatch_warned = True
                # base_name stays as full stem — will likely fail file lookup

        tlt_file     = xml_path / f"{base_name}.tlt"
        defocus_file = xml_path / f"{base_name}_defocus.txt"
        dose_file    = xml_path / f"{base_name}_dose.txt"
        tomo_mask    = Path(tomogram_mask_dir) / f"{mrc.stem}_mask.mrc"

        missing = []
        if not tlt_file.exists():     missing.append(f"tlt: {tlt_file}")
        if not defocus_file.exists(): missing.append(f"defocus: {defocus_file}")
        if not dose_file.exists():    missing.append(f"dose: {dose_file}")

        if missing:
            results.append({"status": "skipped", "tomo": base_name or mrc.stem,
                            "msg": f"Missing: {', '.join(missing)}"})
            continue

        # Bug13: warn if tomo_mask missing (don't skip — let pytom handle it)
        if not tomo_mask.exists():
            print(f"  [WARN] Tomo mask not found: {tomo_mask} — pytom will run without mask")

        pytom_args = [
            "-v", str(mrc),
            "-t", str(template_file),
            "-m", str(mask_file),
            "-d", str(results_dir),
            "-a", str(tlt_file),
            "--particle-diameter", str(particle_diameter),
            "--voxel-size-angstrom", str(voxel_size),
            "--z-axis-rotational-symmetry", str(symmetry),
            "--defocus", str(defocus_file),
            "--voltage", str(voltage),
            "--spherical-aberration", str(cs),
            "--dose-accumulation", str(dose_file),
            "--amplitude-contrast", str(amp),
            "--tomogram-ctf-model", "phase-flip",
            "--per-tilt-weighting",
            "-g", str(gpu),
        ]
        # Only add mask if it exists
        if tomo_mask.exists():
            pytom_args += ["--tomogram-mask", str(tomo_mask)]

        # ── Direct submission (workstation) ──
        if direct:
            cmd = ["pytom_match_template.py"] + pytom_args
            print(f"  Running: {base_name or mrc.stem}")
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1)
            if proc.stdout:
                for line in proc.stdout:
                    print(line, end="", flush=True)
            rc = proc.wait()
            results.append({
                "status": "ok" if rc == 0 else "error",
                "tomo": base_name or mrc.stem, "mode": "direct", "returncode": rc,
            })
            continue

        # ── SLURM script generation ──
        job_name    = f"pytom_{base_name or mrc.stem}"
        script_name = f"submit_{job_name}.sh"
        pytom_cmd   = "pytom_match_template.py \\\n    " + " \\\n    ".join(pytom_args)

        write_pytom_slurm_script(
            script_name, job_name, str(results_dir), partition, time_limit, memory,
            echo_label=f"PyTom TM: {base_name or mrc.stem}",
            command_body=pytom_cmd,
        )

        result = {"status": "ok", "tomo": base_name or mrc.stem,
                  "script": script_name, "mode": "slurm"}
        if submit:
            result["submitted"] = submit_sbatch(script_name)
        results.append(result)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Run PyTom template matching — direct or generate SLURM scripts")
    parser.add_argument("--tomo-dir",      default="_pytom/reconstruction",
                        help="Tomogram directory (WarpTools: warptools_dir/warp_tiltseries/reconstruction)")
    parser.add_argument("--xml-dir",       default="_pytom/xml",
                        help="Directory with .tlt/.dose/.defocus files (run extract_warp_xml first)")
    parser.add_argument("--results-dir",   required=True,       help="Output results directory")
    parser.add_argument("--template",      required=True,       help="Template .mrc file")
    parser.add_argument("--mask",          required=True,       help="Mask .mrc file")
    parser.add_argument("--tomo-mask-dir", default="_pytom/slabified",
                        help="Tomogram mask directory (from slabify)")
    parser.add_argument("--suffix",        default="",
                        help="Suffix to strip from tomo names (WarpTools: 2dp e.g. _10.71Apx). Leave empty if unsure.")
    parser.add_argument("--diameter",      type=float, default=110,      help="Particle diameter (Å)")
    parser.add_argument("--voxel-size",    type=float, default=11.056,   help="Voxel size = bin_pixel_size (Å/px)")
    parser.add_argument("--symmetry",      type=int,   default=1,        help="Z-axis rotational symmetry")
    parser.add_argument("--voltage",       type=int,   default=300,      help="Voltage (kV)")
    parser.add_argument("--cs",            type=float, default=2.7,      help="Spherical aberration (mm)")
    parser.add_argument("--amp",           type=float, default=0.07,     help="Amplitude contrast")
    parser.add_argument("--gpu",           type=str,   default="0",      help="GPU ID(s)")
    parser.add_argument("--partition",     type=str,   default="gpu",    help="SLURM partition")
    parser.add_argument("--time-limit",    type=str,   default="24:00:00", help="SLURM time limit")
    parser.add_argument("--memory",        type=str,   default="64G",    help="SLURM memory")
    parser.add_argument("--submit",        action="store_true",          help="Submit SLURM scripts via sbatch")
    parser.add_argument("--direct",        action="store_true",
                        help="Run directly on workstation (no SLURM scripts)")
    args = parser.parse_args()

    mode = "Direct run" if args.direct else ("SLURM + submit" if args.submit else "Generate SLURM Scripts")
    print("=" * 56)
    print(f"     PyTom Template Matching — {mode}")
    print("=" * 56)

    results = generate_tm_scripts(
        args.tomo_dir, args.xml_dir, args.results_dir,
        args.template, args.mask, args.tomo_mask_dir,
        args.suffix, args.diameter, args.voxel_size,
        args.symmetry, args.voltage, args.cs, args.amp,
        args.gpu, args.partition, args.time_limit, args.memory,
        submit=args.submit, direct=args.direct)

    ok   = sum(1 for r in results if r["status"] == "ok")
    skip = sum(1 for r in results if r["status"] == "skipped")
    err  = sum(1 for r in results if r["status"] == "error")
    print(f"\n{ok} {'run' if args.direct else 'scripts generated'}, {skip} skipped, {err} errors")
    for r in results:
        if r["status"] in ("skipped", "error"):
            print(f"  {r['status'].upper()} {r['tomo']}: {r.get('msg','')}")


if __name__ == "__main__":
    main()