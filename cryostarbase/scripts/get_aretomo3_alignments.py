"""get_aretomo3_alignments.py — Collect AreTomo3 alignment files for WarpTools.

AreTomo3 writes alignment results into <name>_Imod/ subfolders, one per
tilt series.  WarpTools ts_import_alignments needs all .xf and .tlt files
in a single flat directory.

This script scans the AreTomo3 output folder, finds every _Imod/ subfolder,
and copies the .xf and .tlt files into one destination folder.

Usage (interactive):
    python get_aretomo3_alignments.py

Usage (scripted):
    python get_aretomo3_alignments.py \\
        --source  aretomo3_results/ \\
        --dest    aretomo3_alignments/

Then pass --dest to WarpTools:
    WarpTools ts_import_alignments \\
        --settings warp_tiltseries.settings \\
        --alignment_angpix <angpix> \\
        --alignments aretomo3_alignments/

Written together by Lukas W. Bauer und Claude — 2026.
"""

import argparse
import shutil
from pathlib import Path


# ── Core logic ────────────────────────────────────────────────────────────────

def collect_alignments(source: Path, dest: Path) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    imod_dirs = sorted(d for d in source.iterdir() if d.is_dir() and d.name.endswith("_Imod"))

    if not imod_dirs:
        print(f"No _Imod/ subfolders found in: {source}")
        return 0

    print(f"Scanning {len(imod_dirs)} _Imod/ folder(s)...")
    for imod_dir in imod_dirs:
        for f in sorted(imod_dir.glob("*")):
            if f.suffix.lower() in (".xf", ".tlt"):
                target = dest / f.name
                shutil.copy2(f, target)
                print(f"  [+] {f.name}")
                count += 1

    return count


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect AreTomo3 .xf/.tlt files into a flat folder for WarpTools.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--source", default=None,
        help="AreTomo3 output directory containing _Imod/ subfolders",
    )
    parser.add_argument(
        "--dest", default=None,
        help="Destination folder for collected alignment files (default: aretomo3_alignments/)",
    )
    args = parser.parse_args()

    # Interactive fallback
    if args.source:
        source = Path(args.source)
    else:
        source = Path(input("Enter the AreTomo3 output directory path: ").strip())

    if not source.exists() or not source.is_dir():
        print(f"Error: directory does not exist: {source}")
        raise SystemExit(1)

    if args.dest:
        dest = Path(args.dest)
    else:
        default_dest = source.parent / "aretomo3_alignments"
        raw = input(f"Enter destination folder [{default_dest}]: ").strip()
        dest = Path(raw) if raw else default_dest

    print(f"\nSource : {source.resolve()}")
    print(f"Dest   : {dest.resolve()}")

    count = collect_alignments(source, dest)

    print("\n" + "=" * 40)
    print(f"Task finished — {count} file(s) copied")
    print(f"Location: {dest.resolve()}")
    print("=" * 40)
    if count > 0:
        print(
            f"\nNext step — WarpTools:\n"
            f"  WarpTools ts_import_alignments \\\n"
            f"    --settings warp_tiltseries.settings \\\n"
            f"    --alignment_angpix <your_angpix> \\\n"
            f"    --alignments {dest.resolve()}/\n"
        )


if __name__ == "__main__":
    main()
