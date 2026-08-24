"""aretomo3_mdoc_path.py — Fix SubFramePath entries in MDOC files.

AreTomo3 requires that MDOC files and frame files are in the same flat
directory. If your MDOCs still point to an old path, this script rewrites
every SubFramePath entry so only the filename is kept and the new frames
directory is prepended.

Usage (interactive):
    python aretomo3_mdoc_path.py

Usage (scripted):
    python aretomo3_mdoc_path.py --frames_dir /full/path/to/frames/

Run this from within the folder that contains your .mdoc files, or pass
--mdocs_dir to point to another folder.

Written together by Lukas W. Bauer und Claude — 2026.
"""

import re
import os
import glob
import argparse
from pathlib import Path


# ── Core helpers ─────────────────────────────────────────────────────────────

def _fix_subframe_path(content: str, new_frame_path: str) -> str:
    """Replace the directory part of every SubFramePath entry."""
    # Ensure trailing slash
    if not new_frame_path.endswith("/"):
        new_frame_path += "/"

    # Match:  SubFramePath = <anything><filename>.tif  (or .eer / .mrc)
    pattern = re.compile(
        r"(SubFramePath\s*=\s*)"       # group 1: key + equals
        r"(.*?)"                        # group 2: old directory (non-greedy)
        r"([^\\/:*?\"<>|\r\n]+\.(tif|eer|mrc))",  # group 3: filename
        re.IGNORECASE,
    )

    def _replace(m: re.Match) -> str:
        return f"{m.group(1)}{new_frame_path}{m.group(3)}"

    return re.sub(pattern, _replace, content)


def process_mdoc_file(mdoc_path: Path, new_frame_path: str) -> None:
    content = mdoc_path.read_text(encoding="utf-8", errors="replace")
    updated = _fix_subframe_path(content, new_frame_path)
    if updated == content:
        print(f"  (no change) {mdoc_path.name}")
    else:
        mdoc_path.write_text(updated, encoding="utf-8")
        print(f"  [updated]   {mdoc_path.name}")


def process_folder(mdocs_dir: Path, new_frame_path: str) -> int:
    mdoc_files = sorted(mdocs_dir.glob("*.mdoc"))
    if not mdoc_files:
        print(f"No .mdoc files found in: {mdocs_dir}")
        return 0
    print(f"\nProcessing {len(mdoc_files)} .mdoc file(s) in: {mdocs_dir}")
    for f in mdoc_files:
        process_mdoc_file(f, new_frame_path)
    return len(mdoc_files)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix SubFramePath entries in MDOC files for AreTomo3.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  # Interactive — prompts for frames directory:\n"
            "  python aretomo3_mdoc_path.py\n\n"
            "  # Scripted:\n"
            "  python aretomo3_mdoc_path.py --frames_dir /data/frames/\n\n"
            "  # Different mdoc folder:\n"
            "  python aretomo3_mdoc_path.py --mdocs_dir /data/mdocs/ --frames_dir /data/frames/\n"
        ),
    )
    parser.add_argument(
        "--frames_dir", default=None,
        help="Full path to the folder containing raw frame files (.tif / .eer / .mrc)",
    )
    parser.add_argument(
        "--mdocs_dir", default=".",
        help="Folder containing .mdoc files (default: current directory)",
    )
    args = parser.parse_args()

    mdocs_dir = Path(args.mdocs_dir).resolve()
    if not mdocs_dir.is_dir():
        print(f"Error: MDOC folder does not exist: {mdocs_dir}")
        raise SystemExit(1)

    # Frames directory — prompt if not supplied
    if args.frames_dir:
        frames_dir = args.frames_dir.rstrip("/")
    else:
        frames_dir = input("Enter the full path to your frames folder: ").strip().rstrip("/")

    if not frames_dir:
        print("Error: frames directory cannot be empty.")
        raise SystemExit(1)

    count = process_folder(mdocs_dir, frames_dir)
    print(f"\nDone — {count} file(s) processed.")
    print("SubFramePath entries have been updated in all .mdoc files.")


if __name__ == "__main__":
    main()
