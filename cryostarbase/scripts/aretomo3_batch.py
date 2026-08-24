"""aretomo3_batch.py — Run AreTomo3 on all MDOC files in a directory.

Supports two execution modes:
  - Direct  : launches AreTomo3 as a subprocess on the local GPU (default)
  - SLURM   : generates and submits a Slurm job script per MDOC file

Set execution mode via --mode (direct / slurm).
For SLURM, configure --partition, --time, --mem, --reservation as needed.

Usage:
    # Direct execution (default):
    python aretomo3_batch.py \\
        --aretomo3 AreTomo3 \\
        --gain gainref.mrc \\
        --outdir aretomo3_results \\
        --angpix 1.382 \\
        --volz 2500 \\
        --alignz 1000 \\
        --atbin 8

    # SLURM:
    python aretomo3_batch.py \\
        --aretomo3 AreTomo3 \\
        --gain gainref.mrc \\
        --outdir aretomo3_results \\
        --angpix 1.382 \\
        --mode slurm \\
        --partition gpu \\
        --time 24:00:00 \\
        --mem 64G

Run from the folder that contains your .mdoc files (and frames + gain ref).

Written together by Lukas W. Bauer und Claude — 2026.
"""

import os
import sys
import argparse
import subprocess
import shlex
from pathlib import Path

from cryostarbase.scripts._common import submit_sbatch
from datetime import datetime


# ── SLURM script template ─────────────────────────────────────────────────────
# Uncomment / adjust #SBATCH lines for your cluster.

SLURM_TEMPLATE = """\
#!/bin/bash
#SBATCH --ntasks=1
#SBATCH --nodes=1
#SBATCH --cpus-per-task=1
#SBATCH --time={time}
#SBATCH --mem={mem}
#SBATCH --partition={partition}
#SBATCH --gres=gpu:1
#SBATCH --export=NONE
#SBATCH --output=aretomo3_{stem}-%j.log
#SBATCH --error=aretomo3_{stem}-%j.err
{reservation_line}

unset SLURM_EXPORT_ENV

{aretomo3_cmd}
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def check_aretomo3_binary(binary_path: str) -> dict:
    """Test if AreTomo3 binary is executable and available.
    
    Returns dict with:
        - ok (bool): True if binary is working
        - version (str): Version info if detected
        - error (str): Error message if failed
    """
    result = {"ok": False, "version": "unknown", "error": ""}
    
    try:
        # Run AreTomo3 without args - it will print usage to stderr
        test_result = subprocess.run(
            [binary_path],
            capture_output=True,
            text=True,
            timeout=5
        )
        # AreTomo3 outputs usage to stderr when called without args
        output = test_result.stderr + test_result.stdout
        
        # Check if output looks like AreTomo3
        if "AreTomo" in output or "aretomo" in output.lower():
            result["ok"] = True
            
            # Try to extract version number (e.g., "v1.3.4" or "AreTomo3 1.3.4")
            import re
            version_match = re.search(r'[vV]?(\d+\.\d+(?:\.\d+)?)', output)
            if version_match:
                result["version"] = f"v{version_match.group(1)}"
            else:
                result["version"] = "detected"
        else:
            result["error"] = "Binary doesn't appear to be AreTomo3"
            
    except FileNotFoundError:
        result["error"] = f"Binary not found: {binary_path}"
    except subprocess.TimeoutExpired:
        result["error"] = "Binary test timed out"
    except Exception as e:
        result["error"] = f"Binary test failed: {str(e)}"
    
    return result


def build_aretomo3_cmd(
    aretomo3: str,
    mdoc: Path,
    gain: str,
    outdir: str,
    angpix: float,
    volz: int,
    alignz: int,
    atbin: int,
    kv: int,
    cs: float,
    corr_ctf: int,
    tilt_cor: int,
    dark_tol: float,
    flip_gain: int,
    mc_patch: str,
    mc_bin: int,
    group: str,
    flip_vol: int,
    out_imod: int,
    wbp: int,
    at_patch: str,
) -> str:
    """Build AreTomo3 command string with all parameters."""
    return (
        f"{shlex.quote(str(aretomo3))} "
        f"-InMdoc {shlex.quote(str(mdoc))} "
        f"-Gain {shlex.quote(str(gain))} "
        f"-OutDir {shlex.quote(str(outdir))} "
        f"-kV {kv} "
        f"-Cs {cs} "
        f"-FlipGain {flip_gain} "
        f"-McPatch {shlex.quote(str(mc_patch))} "
        f"-McBin {mc_bin} "
        f"-Group {shlex.quote(str(group))} "
        f"-PixSize {angpix} "
        f"-AtBin {atbin} 0 0 "
        f"-AtPatch {shlex.quote(str(at_patch))} "
        f"-FlipVol {flip_vol} "
        f"-Wbp {wbp} "
        f"-AlignZ {alignz} "
        f"-VolZ {volz} "
        f"-OutImod {out_imod} "
        f"-TiltCor {tilt_cor} "
        f"-DarkTol {dark_tol} "
        f"-CorrCTF {corr_ctf}"
    )


def run_direct(cmd: str, mdoc: Path) -> None:
    """Run AreTomo3 command directly (blocking)."""
    print(f"\n[Direct] Running AreTomo3 for: {mdoc.name}")
    print(f"  Command: {cmd}\n")
    result = subprocess.run(cmd, shell=True)
    if result.returncode != 0:
        print(f"  ⚠ AreTomo3 exited with code {result.returncode} for {mdoc.name}")
    else:
        print(f"  ✓ Done: {mdoc.name}")


def submit_slurm(
    cmd: str,
    mdoc: Path,
    partition: str,
    time: str,
    mem: str,
    reservation: str,
) -> None:
    """Generate SLURM script and submit via sbatch."""
    stem = mdoc.stem.replace(" ", "_")
    reservation_line = (
        f"#SBATCH --reservation={reservation}" if reservation else ""
    )
    script_content = SLURM_TEMPLATE.format(
        stem=stem,
        time=time,
        mem=mem,
        partition=partition,
        reservation_line=reservation_line,
        aretomo3_cmd=cmd,
    )
    script_path = Path(f"aretomo3_slurm_{stem}.sh")
    script_path.write_text(script_content)
    print(f"\n[SLURM] Submitting job for: {mdoc.name}")
    submit_sbatch(str(script_path))


# ── Main ──────────────────────────────────────────────────────────────────────

def _check_gpu_availability(verbose: bool = True) -> None:
    """Query nvidia-smi and print GPU status. Shared by the pre-run and
    post-run GPU checks in main(); verbose=True (pre-run) additionally
    prints per-GPU driver version, CUDA version, CUDA_VISIBLE_DEVICES, and
    a best-GPU-by-free-VRAM recommendation, plus failure diagnostics."""
    try:
        gpu_result = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=index,name,memory.free,memory.total,utilization.gpu,driver_version",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )

        if gpu_result.returncode == 0 and gpu_result.stdout.strip():
            lines = gpu_result.stdout.strip().splitlines()
            print(f"✓ GPU Available: {len(lines)} device(s)")

            gpus = []
            for line in lines:
                parts = [p.strip() for p in line.split(',')]
                if len(parts) >= 6:
                    idx, name, mem_free, mem_total, util, driver = parts
                    print(f"  GPU {idx}: {name}")
                    print(f"    VRAM: {mem_free} / {mem_total} MB free")
                    print(f"    Utilization: {util}%")
                    if verbose:
                        print(f"    Driver: {driver}")
                    try:
                        gpus.append((int(idx), int(mem_free)))
                    except ValueError:
                        pass

            if verbose:
                # Check CUDA version
                try:
                    cuda_check = subprocess.run(
                        ["nvidia-smi", "--query-gpu=cuda_version", "--format=csv,noheader"],
                        capture_output=True, text=True, timeout=3
                    )
                    if cuda_check.returncode == 0 and cuda_check.stdout.strip():
                        cuda_version = cuda_check.stdout.strip().split('\n')[0]
                        print(f"CUDA: {cuda_version}")
                except Exception:
                    pass

                cuda_visible = os.environ.get('CUDA_VISIBLE_DEVICES', 'not set')
                print(f"CUDA_VISIBLE_DEVICES: {cuda_visible}")

                if len(gpus) > 1:
                    best_gpu = max(gpus, key=lambda x: x[1])
                    print(f"✓ Recommended: GPU {best_gpu[0]} ({best_gpu[1]} MB free)")
        elif verbose:
            print("⚠ nvidia-smi returned no GPU info — GPU might not be available")
            print(f"  Return code: {gpu_result.returncode}")
            print(f"  Stdout: {gpu_result.stdout[:200]}")
            print(f"  Stderr: {gpu_result.stderr[:200]}")

    except FileNotFoundError:
        if verbose:
            print("⚠ nvidia-smi not found — cannot check GPU status")
            print("  AreTomo3 requires CUDA-capable GPU")
    except Exception as e:
        if verbose:
            print(f"⚠ GPU check failed: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch AreTomo3 processing — direct or SLURM.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    # Required
    parser.add_argument("--aretomo3",  required=True, help="AreTomo3 binary or full path")
    parser.add_argument("--gain",      required=True, help="Gain reference path (absolute or relative to mdocs_dir)")
    parser.add_argument("--outdir",    default="aretomo3_results", help="Output directory (relative to mdocs_dir parent)")
    parser.add_argument("--angpix",    type=float, required=True, help="Raw pixel size (Å/px)")
    # Reconstruction
    parser.add_argument("--volz",      type=int,   default=2500,  help="VolZ in Å (tomogram Z thickness)")
    parser.add_argument("--alignz",    type=int,   default=1000,  help="AlignZ in Å (~sample thickness)")
    parser.add_argument("--atbin",     type=int,   default=8,     help="AtBin — ⚠ must match WarpTools binning")
    # Microscope
    parser.add_argument("--kv",        type=int,   default=300,   help="Acceleration voltage (kV)")
    parser.add_argument("--cs",        type=float, default=2.7,   help="Spherical aberration Cs (mm)")
    parser.add_argument("--corr_ctf",  type=int,   default=1,     choices=[0, 1], help="CTF correction (1=on)")
    # AreTomo3 advanced
    parser.add_argument("--tilt_cor",  type=int,   default=-1,    help="-TiltCor value (-1=off for STA)")
    parser.add_argument("--dark_tol",  type=float, default=0.7,   help="-DarkTol (removes black tilts)")
    parser.add_argument("--flip_gain", type=int,   default=1,     help="-FlipGain (1=flip Y)")
    parser.add_argument("--mc_patch",  default="5 4",             help="-McPatch rows cols")
    parser.add_argument("--mc_bin",    type=int,   default=1,     help="-McBin")
    parser.add_argument("--group",     default="2 4",             help="-Group global local")
    parser.add_argument("--flip_vol",  type=int,   default=1,     help="-FlipVol")
    parser.add_argument("--out_imod",  type=int,   default=1,     help="-OutImod (1=generate Imod files for WarpTools)")
    parser.add_argument("--wbp",       type=int,   default=1,     help="-Wbp (1=weighted backprojection)")
    parser.add_argument("--at_patch",  default="5 4",             help="-AtPatch rows cols")
    # MDOC folder
    parser.add_argument("--mdocs_dir", default=".", help="Folder containing .mdoc files (default: current dir)")
    # Execution mode
    parser.add_argument("--mode",      default="direct", choices=["direct", "slurm"],
                        help="Execution mode: direct (local GPU) or slurm (submit via sbatch)")
    # SLURM options (used only when --mode slurm)
    parser.add_argument("--partition",   default="gpu",      help="SLURM partition name")
    parser.add_argument("--time",        default="24:00:00", help="SLURM wall time")
    parser.add_argument("--mem",         default="64G",      help="SLURM memory")
    parser.add_argument("--reservation", default="",         help="SLURM reservation (leave empty if none)")

    args = parser.parse_args()

    # ══════════════════════════════════════════════════════════════════════════
    # PATH RESOLUTION — Convert relative paths to absolute
    # ══════════════════════════════════════════════════════════════════════════
    
    # 1. Resolve mdocs_dir to absolute path
    mdocs_dir = Path(args.mdocs_dir).resolve()
    
    # 2. Convert output dir to absolute path if relative
    #    Strategy: relative paths are resolved relative to mdocs_dir.parent
    #    Example: mdocs_dir = /preprocessing/aretomo3/raw_data_frames
    #             outdir = aretomo3_results
    #             → /preprocessing/aretomo3/aretomo3_results
    if not Path(args.outdir).is_absolute():
        output_dir = (mdocs_dir.parent / args.outdir).resolve()
    else:
        output_dir = Path(args.outdir).resolve()
    
    # Update args with absolute path
    args.outdir = str(output_dir)
    
    # 3. Resolve gain reference path
    #    If relative, resolve relative to mdocs_dir
    if not Path(args.gain).is_absolute():
        gain_path = (mdocs_dir / args.gain).resolve()
    else:
        gain_path = Path(args.gain).resolve()
    
    # Update args with absolute path
    args.gain = str(gain_path)

    # ══════════════════════════════════════════════════════════════════════════
    # VALIDATION — Check files and directories exist
    # ══════════════════════════════════════════════════════════════════════════
    
    if not mdocs_dir.exists():
        print(f"✗ MDOC directory not found: {mdocs_dir}")
        sys.exit(1)
    
    if not gain_path.exists():
        print(f"✗ Gain reference not found: {gain_path}")
        sys.exit(1)
    
    mdoc_files = sorted(mdocs_dir.glob("*.mdoc"))
    if not mdoc_files:
        print(f"✗ No .mdoc files found in: {mdocs_dir}")
        sys.exit(1)

    # ══════════════════════════════════════════════════════════════════════════
    # GPU PRE-CHECK
    # ══════════════════════════════════════════════════════════════════════════
    print("")
    print("=" * 70)
    print(f"[GPU PRE-CHECK] {datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}")
    print("=" * 70)
    
    # Check AreTomo3 binary
    binary_check = check_aretomo3_binary(args.aretomo3)
    if not binary_check["ok"]:
        print(f"✗ AreTomo3 binary check FAILED:")
        print(f"  Error: {binary_check['error']}")
        print(f"  Binary path: {args.aretomo3}")
        print("")
        print("  Troubleshooting:")
        print("  1. Check if AreTomo3 is installed: which AreTomo3")
        print("  2. Verify the binary path is correct")
        print("  3. Test manually: /path/to/AreTomo3")
        sys.exit(1)
    
    print(f"✓ AreTomo3 binary: {args.aretomo3}")
    print(f"  Version: {binary_check['version']}")
    
    # Check GPU availability
    _check_gpu_availability(verbose=True)
    
    print("=" * 70)
    print("")

    # ══════════════════════════════════════════════════════════════════════════
    # SETUP — Create output directory and print summary
    # ══════════════════════════════════════════════════════════════════════════
    
    print(f"Found {len(mdoc_files)} .mdoc file(s) in: {mdocs_dir}")
    print(f"Execution mode : {args.mode}")
    print(f"Output dir     : {args.outdir}")
    print(f"AreTomo3       : {args.aretomo3}")
    print(f"Gain reference : {args.gain}")
    print(f"Pixel size     : {args.angpix} Å/px")
    print(f"AtBin          : {args.atbin}  ← must match WarpTools binning")
    print("")
    
    # Create output directory
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        print(f"✓ Output directory ready: {output_dir}")
    except Exception as e:
        print(f"✗ Failed to create output directory: {e}")
        sys.exit(1)
    
    print("")

    # ══════════════════════════════════════════════════════════════════════════
    # MAIN PROCESSING LOOP
    # ══════════════════════════════════════════════════════════════════════════

    for mdoc in mdoc_files:
        cmd = build_aretomo3_cmd(
            aretomo3=args.aretomo3,
            mdoc=mdoc,
            gain=args.gain,
            outdir=args.outdir,
            angpix=args.angpix,
            volz=args.volz,
            alignz=args.alignz,
            atbin=args.atbin,
            kv=args.kv,
            cs=args.cs,
            corr_ctf=args.corr_ctf,
            tilt_cor=args.tilt_cor,
            dark_tol=args.dark_tol,
            flip_gain=args.flip_gain,
            mc_patch=args.mc_patch,
            mc_bin=args.mc_bin,
            group=args.group,
            flip_vol=args.flip_vol,
            out_imod=args.out_imod,
            wbp=args.wbp,
            at_patch=args.at_patch,
        )
        if args.mode == "slurm":
            submit_slurm(
                cmd=cmd,
                mdoc=mdoc,
                partition=args.partition,
                time=args.time,
                mem=args.mem,
                reservation=args.reservation,
            )
        else:
            run_direct(cmd, mdoc)

    print(f"\nAll {len(mdoc_files)} job(s) {'submitted' if args.mode == 'slurm' else 'completed'}.")

    # ══════════════════════════════════════════════════════════════════════════
    # GPU POST-CHECK
    # ══════════════════════════════════════════════════════════════════════════
    print("")
    print("-" * 70)
    print(f"[GPU POST-CHECK] {datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}")
    print("-" * 70)
    
    _check_gpu_availability(verbose=False)

    print("-" * 70)


if __name__ == "__main__":
    main()