"""CryoSTAR-Base — 2026
Convert IMOD .mod models to RELION-compatible STAR file.

Uses model2point (IMOD) to extract XYZ coordinates from .mod files,
then merges them into a single particles_all.star file.

Usage:
    python -m cryostarbase.scripts.mod2star \\
        --mods_folder /path/to/mods \\
        --suffix _10.71Apx \\
        --output particles_all.star \\
        --csv_folder csv
"""

import os
import glob
import argparse
import subprocess


def main():
    parser = argparse.ArgumentParser(
        description="Convert IMOD .mod picks to RELION STAR file via model2point."
    )
    parser.add_argument("--mods_folder",  default=".",                 help="Folder containing .mod files")
    parser.add_argument("--suffix",       default="",                  help="Suffix to strip from CSV filename to build .tomostar name (e.g. _10.71Apx)")
    parser.add_argument("--output",       default="particles_all.star", help="Output STAR file path")
    parser.add_argument("--csv_folder",   default="csv",               help="Folder for intermediate CSV files")
    args = parser.parse_args()

    mods_folder     = args.mods_folder
    suffix_to_remove = args.suffix
    output_star_file = args.output
    csv_folder       = args.csv_folder
    angle_defaults   = (0.0, 0.0, 0.0)  # Rot, Tilt, Psi

    # Ensure CSV folder exists
    os.makedirs(csv_folder, exist_ok=True)

    # Find .mod files
    mod_files = sorted(glob.glob(os.path.join(mods_folder, "*.mod")))
    print(f"Found {len(mod_files)} .mod files in '{mods_folder}'")
    if not mod_files:
        print("No .mod files found. Exiting.")
        raise SystemExit(1)

    # Convert each .mod to CSV via model2point
    for mod_file in mod_files:
        base     = os.path.basename(mod_file)
        csv_name = os.path.splitext(base)[0] + ".csv"
        csv_path = os.path.join(csv_folder, csv_name)
        cmd      = ["model2point", mod_file, csv_path]
        print(f"  Running: {' '.join(cmd)}")
        try:
            subprocess.run(cmd, check=True)
            print(f"  Created CSV: {csv_path}")
        except subprocess.CalledProcessError as e:
            print(f"  model2point failed for {mod_file}: {e}")

    # Merge CSVs into STAR
    csv_files = sorted(glob.glob(os.path.join(csv_folder, "*.csv")))
    print(f"Merging {len(csv_files)} CSV files into '{output_star_file}'")

    total_particles = 0
    with open(output_star_file, "w") as out:
        out.write("data_particles\n\n")
        out.write("loop_\n")
        out.write("_rlnCoordinateX #1\n")
        out.write("_rlnCoordinateY #2\n")
        out.write("_rlnCoordinateZ #3\n")
        out.write("_rlnAngleRot #4\n")
        out.write("_rlnAngleTilt #5\n")
        out.write("_rlnAnglePsi #6\n")
        out.write("_rlnMicrographName #7\n")

        for csv_file in csv_files:
            print(f"  Processing CSV: {csv_file}")
            name_part       = os.path.basename(csv_file).replace(".csv", "")
            if suffix_to_remove:
                name_part   = name_part.replace(suffix_to_remove, "")
            micrograph_name = f"{name_part}.tomostar"
            print(f"    Micrograph name: {micrograph_name}")
            try:
                with open(csv_file, "r") as f:
                    lines = [ln.strip() for ln in f if ln.strip()]
                print(f"    Read {len(lines)} coordinate lines.")
            except Exception as e:
                print(f"  Error reading {csv_file}: {e}")
                continue

            for idx, line in enumerate(lines, 1):
                try:
                    x, y, z = map(float, line.split())
                    out.write(
                        f"{x:.6f}\t{y:.6f}\t{z:.6f}\t"
                        f"{angle_defaults[0]:.6f}\t{angle_defaults[1]:.6f}\t{angle_defaults[2]:.6f}\t"
                        f"{micrograph_name}\n"
                    )
                    total_particles += 1
                except ValueError:
                    print(f"  Skipped malformed line {idx} in {csv_file}: '{line}'")

    print(f"Wrote {total_particles} particles to '{output_star_file}'")


if __name__ == "__main__":
    main()
