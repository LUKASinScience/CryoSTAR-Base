"""CryoSTAR-Base — 2026
Convert PyTom STAR file: centered-Angstrom coordinates → pixel coordinates.
Preserves scoring columns: _rlnLCCmax, _rlnCutOff, _rlnSearchStd.

Usage:
    python -m cryostarbase.scripts.ang_to_pix input.star output.star \\
        --x_dim 1440 --y_dim 1024 --z_dim 250 \\
        --pixel_size 10.71 --suffix _10.71Apx -y
"""

import argparse
import os
import sys


REQUIRED_COLUMNS = [
    "_rlnCenteredCoordinateXAngst",
    "_rlnCenteredCoordinateYAngst",
    "_rlnCenteredCoordinateZAngst",
    "_rlnAngleRot",
    "_rlnAngleTilt",
    "_rlnAnglePsi",
    "_rlnTomoName",
    "_rlnLCCmax",
    "_rlnCutOff",
    "_rlnSearchStd",
]


def process_star_file(input_path, output_path, x_dim, y_dim, z_dim,
                      pixel_size, suffix, force_overwrite=False):
    if not os.path.exists(input_path):
        print(f"Error: Input file not found: '{input_path}'")
        sys.exit(1)

    if os.path.exists(output_path) and not force_overwrite:
        ans = input(f"Warning: '{output_path}' exists. Overwrite? (y/n): ").lower()
        if ans != "y":
            print("Aborted.")
            sys.exit(0)

    x_center = x_dim / 2
    y_center = y_dim / 2
    z_center = z_dim / 2

    print(f"  Input:  {input_path}")
    print(f"  Output: {output_path}")
    print(f"  Dims:   {x_dim} × {y_dim} × {z_dim} vox  |  center ({x_center}, {y_center}, {z_center})")
    print(f"  Pixel size: {pixel_size} Å/px  |  suffix: '{suffix}'")

    with open(input_path, "r") as fh:
        lines = fh.readlines()

    output_lines = []
    column_indices = {}
    in_loop = False
    in_data = False
    particle_count = 0

    def build_line(parts):
        x_a = float(parts[column_indices["_rlnCenteredCoordinateXAngst"]])
        y_a = float(parts[column_indices["_rlnCenteredCoordinateYAngst"]])
        z_a = float(parts[column_indices["_rlnCenteredCoordinateZAngst"]])
        x_px = (x_a / pixel_size) + x_center
        y_px = (y_a / pixel_size) + y_center
        z_px = (z_a / pixel_size) + z_center
        rot  = parts[column_indices["_rlnAngleRot"]]
        tilt = parts[column_indices["_rlnAngleTilt"]]
        psi  = parts[column_indices["_rlnAnglePsi"]]
        tomo = parts[column_indices["_rlnTomoName"]]
        micro = tomo.replace(suffix, "") + ".tomostar" if suffix else tomo + ".tomostar"
        lcc  = parts[column_indices["_rlnLCCmax"]]
        cut  = parts[column_indices["_rlnCutOff"]]
        std  = parts[column_indices["_rlnSearchStd"]]
        return (f"  {x_px:10.6f}  {y_px:10.6f}  {z_px:10.6f}  "
                f"{rot:>10s}  {tilt:>10s}  {psi:>10s}  {micro:s}  "
                f"{lcc:>10s}  {cut:>10s}  {std:>10s}\n")

    for line in lines:
        stripped = line.strip()
        if not stripped:
            output_lines.append("\n")
            continue

        if in_data:
            parts = stripped.split()
            try:
                output_lines.append(build_line(parts))
                particle_count += 1
            except (ValueError, IndexError, KeyError):
                print(f"  Warning: Skipped malformed line: {stripped[:80]}")
            continue

        if stripped == "loop_":
            in_loop = True
        elif in_loop and stripped.startswith("_"):
            parts = stripped.split()
            column_indices[parts[0]] = int(parts[1].strip("#")) - 1
        elif in_loop and not stripped.startswith("_"):
            in_data = True
            missing = [c for c in REQUIRED_COLUMNS if c not in column_indices]
            if missing:
                print(f"Error: Missing required columns: {', '.join(missing)}")
                sys.exit(1)
            output_lines.append("\nloop_\n")
            output_lines.append("_rlnCoordinateX #1\n")
            output_lines.append("_rlnCoordinateY #2\n")
            output_lines.append("_rlnCoordinateZ #3\n")
            output_lines.append("_rlnAngleRot #4\n")
            output_lines.append("_rlnAngleTilt #5\n")
            output_lines.append("_rlnAnglePsi #6\n")
            output_lines.append("_rlnMicrographName #7\n")
            output_lines.append("_rlnLCCmax #8\n")
            output_lines.append("_rlnCutOff #9\n")
            output_lines.append("_rlnSearchStd #10\n\n")
            parts = stripped.split()
            try:
                output_lines.append(build_line(parts))
                particle_count += 1
            except (ValueError, IndexError, KeyError) as e:
                print(f"Error: Could not process first data line: {e}")
                sys.exit(1)
            continue

        if not in_loop and not in_data:
            output_lines.append(line)

    with open(output_path, "w") as fh:
        fh.writelines(output_lines)

    print(f"  Done: {particle_count} particles written to '{output_path}'")


def main():
    parser = argparse.ArgumentParser(
        description="Convert PyTom STAR: centered Å coords → pixel coords. Preserves LCCmax/CutOff/SearchStd."
    )
    parser.add_argument("input_star")
    parser.add_argument("output_star")
    parser.add_argument("--x_dim",      required=True, type=int)
    parser.add_argument("--y_dim",      required=True, type=int)
    parser.add_argument("--z_dim",      required=True, type=int)
    parser.add_argument("--pixel_size", required=True, type=float)
    parser.add_argument("--suffix",     required=True, type=str)
    parser.add_argument("-y", "--yes",  action="store_true")
    args = parser.parse_args()

    print("=" * 56)
    print("     PyTom STAR — Ang to Pixel Converter")
    print("=" * 56)
    process_star_file(
        args.input_star, args.output_star,
        args.x_dim, args.y_dim, args.z_dim,
        args.pixel_size, args.suffix, args.yes
    )


if __name__ == "__main__":
    main()