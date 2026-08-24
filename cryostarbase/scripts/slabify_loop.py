"""Generate tomogram boundary masks for all tomograms using Slabify."""

import argparse
import subprocess
import sys
from pathlib import Path


def run_slabify(
    reconstruction_dir: str,
    output_dir: str,
    extra_args: list[str] = None,
) -> list[dict]:
    """
    Run slabify on all .mrc files in a reconstruction directory.
    
    Args:
        reconstruction_dir: Path to directory containing tomogram .mrc files
        output_dir: Path to output directory for masks
        extra_args: Additional arguments to pass to slabify
    
    Returns:
        List of results per tomogram
    """
    recon = Path(reconstruction_dir)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    
    mrcs = sorted(recon.glob("*.mrc"))
    if not mrcs:
        return [{"status": "error", "msg": f"No .mrc files in {reconstruction_dir}"}]
    
    results = []
    for mrc in mrcs:
        base = mrc.stem
        mask_path = out / f"{base}_mask.mrc"
        
        cmd = ["slabify", "--input", str(mrc), "--output", str(mask_path)]
        if extra_args:
            cmd.extend(extra_args)
        
        print(f"  Slabify: {mrc.name} → {mask_path.name}")
        
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if proc.returncode == 0:
                results.append({
                    "status": "ok",
                    "input": mrc.name,
                    "output": str(mask_path),
                })
            else:
                results.append({
                    "status": "error",
                    "input": mrc.name,
                    "msg": proc.stderr[:500],
                })
        except FileNotFoundError:
            return [{"status": "error",
                     "msg": "slabify not found. Install: pip install slabify-et"}]
        except subprocess.TimeoutExpired:
            results.append({"status": "error", "input": mrc.name, "msg": "Timeout (>5min)"})
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Run slabify on all tomograms to generate boundary masks")
    parser.add_argument("-i", "--input-dir", required=True,
                        help="Directory with tomogram .mrc files")
    parser.add_argument("-o", "--output-dir", required=True,
                        help="Output directory for mask files")
    parser.add_argument("--border", type=int, default=0,
                        help="Voxels to exclude from XY border (default: 0)")
    parser.add_argument("--offset", type=int, default=0,
                        help="Voxels to offset along Z (default: 0)")
    
    args = parser.parse_args()
    
    print("=" * 56)
    print("     Batch Slabify — Tomogram Mask Generation")
    print("=" * 56)
    print(f"  Input:  {args.input_dir}")
    print(f"  Output: {args.output_dir}")
    print()
    
    extra = []
    if args.border:
        extra.extend(["--border", str(args.border)])
    if args.offset:
        extra.extend(["--offset", str(args.offset)])
    
    results = run_slabify(args.input_dir, args.output_dir, extra or None)
    
    ok = sum(1 for r in results if r["status"] == "ok")
    err = sum(1 for r in results if r["status"] == "error")
    print(f"\nDone: {ok} masks created, {err} errors")


if __name__ == "__main__":
    main()