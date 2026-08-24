"""CryoSTAR-Base — 2026
Pretilt MDOC correction module.
Adapted from pretilt_mdocs.py by Hamid Rahmani.
Source: github.com/hamid13r/warp_lamella_adapters

Corrects TiltAngle entries in SerialEM MDOC files to account for
stage pretilt in FIB-SEM lamella data. Creates corrected MDOCs in
output_dir (mdocs_pretilt/ next to original MDOCs).
"""
import re
import glob
import os
from typing import Callable


def adjust_mdoc(mdoc_path: str, pretilt: float, output_dir: str) -> str:
    """Correct TiltAngle and bidir entries in one MDOC file."""
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, os.path.basename(mdoc_path))
    with open(mdoc_path, "r") as f_in, open(out_path, "w") as f_out:
        for line in f_in:
            m2 = re.search(r'TiltAngle = ?(-?\d*\.?\d*)', line)
            m3 = re.search(r'bidir = ?(-?\d*\.?\d*)', line)
            if m2:
                line = re.sub(r'TiltAngle = ?(-?\d*\.?\d*)',
                              f'TiltAngle = {float(m2.group(1)) - pretilt}', line)
            if m3:
                line = re.sub(r'bidir = ?(-?\d*\.?\d*)',
                              f'bidir = {float(m3.group(1)) - pretilt}', line)
            f_out.write(line)
    return out_path


def run_pretilt(
    mdocs_dir: str,
    pretilt_angle: float,
    output_dir: str,
    log: Callable[[str], None] = print,
) -> int:
    """Apply pretilt correction to all MDOCs in mdocs_dir."""
    mdoc_files = sorted(glob.glob(os.path.join(mdocs_dir, "*.mdoc")))
    if not mdoc_files:
        log(f"[WARN] No .mdoc files found in {mdocs_dir}")
        return 0
    log(f"Pretilt correction: {pretilt_angle}deg — {len(mdoc_files)} MDOCs → {output_dir}")
    for mdoc_path in mdoc_files:
        adjust_mdoc(mdoc_path, pretilt_angle, output_dir)
        log(f"  [OK] {os.path.basename(mdoc_path)}")
    log(f"Done. {len(mdoc_files)} MDOCs written to {output_dir}")
    return len(mdoc_files)


# Alias for backward compatibility with server.py /api/preliproc/pretilt_mdocs endpoint
run_pretilt_correction = run_pretilt


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Correct TiltAngle in SerialEM MDOC files for FIB-lamella stage pretilt.")
    parser.add_argument("mdocs_dir",     help="Folder containing .mdoc files")
    parser.add_argument("--pretilt",     required=True, type=float, help="Pretilt angle in degrees (e.g. 9)")
    parser.add_argument("--output",      required=True, help="Output directory for corrected MDOCs")
    args = parser.parse_args()
    count = run_pretilt(args.mdocs_dir, args.pretilt, args.output)
    print(f"Done: {count} MDOCs written to {args.output}")


if __name__ == "__main__":
    main()
