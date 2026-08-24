"""CryoSTAR-Base — 2026
Remove skipped views from WarpTools XML files.
Adapted from Hamid's remove_skipped_view.py for CryoSTAR-Base integration.

Key adaptation: taSolution.log is read from process_dir/TS_NAME/basic_com/
(where the IMOD preprocess step creates it) instead of process_dir/TS_NAME/.
"""
import os
import shutil
import glob
import xml.etree.ElementTree as ET
import io
from pathlib import Path
from typing import Optional


def run_remove_skipped(
    xml_dir: str,
    tiltstack_dir: str,
    backup_dir: str,
    xml_pattern: str = "*.xml",
    all_true: bool = False,
    n_tilts: int = 0,
    max_tilt: float = 0,
    log: callable = print,
) -> dict:
    """
    Process WarpTools XML files and update UseTilt values based on taSolution.log.

    Args:
        xml_dir:       Directory containing WarpTools XML files
        tiltstack_dir: IMOD output directory (process_dir from the IMOD pipeline)
                       taSolution.log is read from tiltstack_dir/TS_NAME/basic_com/
        backup_dir:    Directory for XML backups (e.g. xml_backup_20260622_all_tilts)
        xml_pattern:   Glob pattern for XML files
        all_true:      Set all UseTilt values to True (reset)
        n_tilts:       Keep N lowest-dose tilts
        max_tilt:      Maximum tilt angle to keep
        log:           Logging callable

    Returns:
        dict with 'processed', 'skipped', 'errors' counts
    """
    import pandas as pd

    xml_files = glob.glob(os.path.join(xml_dir, xml_pattern))
    if not xml_files:
        log("No XML files found.")
        return {"processed": 0, "skipped": 0, "errors": 0}

    os.makedirs(backup_dir, exist_ok=True)
    counts = {"processed": 0, "skipped": 0, "errors": 0}

    for xml_file in sorted(xml_files):
        ts_name = os.path.splitext(os.path.basename(xml_file))[0]

        # Backup first
        backup_path = os.path.join(backup_dir, os.path.basename(xml_file))
        if os.path.exists(backup_path):
            log(f"[STOP] Backup already exists for {ts_name} — stopping to protect originals.")
            log(f"       Delete or rename backup dir '{backup_dir}' to run again.")
            counts["skipped"] += 1
            continue
        shutil.copy(xml_file, backup_dir)

        # Search for taSolution.log in order:
        # 1. basic_com/ (IMOD xcorr output: imod_dir/TS_NAME/basic_com/)
        # 2. root of TS dir (WarpTools ts_etomo_patches: tiltstack/TS_NAME/taSolution.log)
        ts_root = os.path.join(tiltstack_dir, ts_name)
        log_candidates = [
            os.path.join(ts_root, "basic_com", "taSolution.log"),
            os.path.join(ts_root, "taSolution.log"),
        ]
        log_path = next((p for p in log_candidates if os.path.exists(p)), None)
        if log_path is None:
            log(f"[SKIP] No taSolution.log for {ts_name} (searched basic_com/, root of {ts_root})")
            counts["skipped"] += 1
            continue

        try:
            with open(log_path, "r") as f:
                lines = f.readlines()

            view_line_idx = next(
                (idx for idx, line in enumerate(lines) if "view" in line), None
            )
            if view_line_idx is None:
                log(f"[SKIP] No 'view' header in {log_path}")
                counts["skipped"] += 1
                continue

            data_str = "".join(lines[view_line_idx:])
            df = pd.read_csv(io.StringIO(data_str), sep=r"\s+")
            views_in_log = set(df["view"].unique())
            tilts_in_log = df["tilt"].tolist()

            tree = ET.parse(xml_file)
            root = tree.getroot()
            use_tilt_elem = root.find("UseTilt")

            if use_tilt_elem is None:
                log(f"[SKIP] No UseTilt element in {xml_file}")
                counts["skipped"] += 1
                continue

            current_values = [v.strip() for v in use_tilt_elem.text.split("\n") if v.strip()]
            updated_values = ["False"] * len(current_values)
            changes_made = 0

            if all_true:
                updated_values = ["True"] * len(current_values)
                changes_made = sum(1 for v in current_values if v != "True")

            elif n_tilts == 0 and max_tilt == 0:
                # Default: keep views that IMOD successfully aligned
                for i, value in enumerate(current_values):
                    view_number = i + 1
                    if view_number in views_in_log:
                        updated_values[i] = "True"
                    elif value == "True":
                        changes_made += 1

            elif n_tilts > 0:
                # Keep N lowest-dose views
                dose_elems = root.findall("Dose")
                dose_values = [float(e.text.strip()) for e in dose_elems]
                sorted_indices = sorted(range(len(dose_values)), key=lambda i: dose_values[i])
                for idx in sorted_indices[:n_tilts]:
                    updated_values[idx] = "True"
                # Still exclude views not in log
                for i in range(len(current_values)):
                    if (i + 1) not in views_in_log:
                        updated_values[i] = "False"
                changes_made = sum(1 for i, v in enumerate(current_values) if updated_values[i] != v)

            elif max_tilt > 0:
                # Keep views within max_tilt angle
                dose_elems = root.findall("Dose")
                dose_values = [float(e.text.strip()) for e in dose_elems]
                min_dose_idx = dose_values.index(min(dose_values))
                min_dose_tilt = tilts_in_log[min_dose_idx]
                max_tilt_to_keep = abs(min_dose_tilt) + max_tilt
                for i, value in enumerate(current_values):
                    view_number = i + 1
                    tilt_angle = tilts_in_log[i] if i < len(tilts_in_log) else 0
                    if view_number in views_in_log and abs(tilt_angle) <= max_tilt_to_keep:
                        updated_values[i] = "True"
                    elif value == "True":
                        changes_made += 1

            use_tilt_elem.text = "\n".join(updated_values)
            tree.write(xml_file)
            log(f"[OK] {ts_name}: {changes_made} UseTilt changes made.")
            counts["processed"] += 1

        except Exception as e:
            log(f"[ERROR] {ts_name}: {e}")
            counts["errors"] += 1

    return counts


def apply_manual_exclusions_to_xml(
    xml_dir: str,
    bad_tilts: dict,
    backup_dir: str,
    log: callable = print,
) -> dict:
    """
    Apply manual tilt exclusions from inspect_bad_tilts.json to WarpTools XMLs.
    Sets UseTilt=False for manually marked bad tilts.

    Args:
        xml_dir:    WarpTools XML directory
        bad_tilts:  dict {ts_stem: [tilt_index_1based, ...]} from inspect_bad_tilts.json
        backup_dir: Backup directory
        log:        Logging callable
    """
    os.makedirs(backup_dir, exist_ok=True)
    counts = {"processed": 0, "skipped": 0, "errors": 0}

    for ts_name, bad_indices in bad_tilts.items():
        if not bad_indices:
            continue
        xml_file = os.path.join(xml_dir, f"{ts_name}.xml")
        if not os.path.exists(xml_file):
            log(f"[SKIP] XML not found for {ts_name}")
            counts["skipped"] += 1
            continue

        backup_path = os.path.join(backup_dir, f"{ts_name}.xml")
        if not os.path.exists(backup_path):
            shutil.copy(xml_file, backup_dir)

        try:
            tree = ET.parse(xml_file)
            root = tree.getroot()
            use_tilt_elem = root.find("UseTilt")
            if use_tilt_elem is None:
                counts["skipped"] += 1
                continue

            values = [v.strip() for v in use_tilt_elem.text.split("\n") if v.strip()]
            changed = 0
            bad_set = set(bad_indices)
            for i in range(len(values)):
                if (i + 1) in bad_set and values[i] == "True":
                    values[i] = "False"
                    changed += 1

            use_tilt_elem.text = "\n".join(values)
            tree.write(xml_file)
            log(f"[OK] {ts_name}: {changed} manual exclusions applied.")
            counts["processed"] += 1
        except Exception as e:
            log(f"[ERROR] {ts_name}: {e}")
            counts["errors"] += 1

    return counts


def main():
    import argparse, json as _json
    parser = argparse.ArgumentParser(
        description="Remove skipped or bad tilts from WarpTools XML files.")
    subparsers = parser.add_subparsers(dest="cmd")

    # Default (no subcommand): taSolution.log mode
    # Also callable directly with legacy args for backward compat
    parser.add_argument("--xml-dir",      help="WarpTools XML directory (warp_tiltseries/)")
    parser.add_argument("--imod-dir",     help="Tiltstack dir with TS_NAME/ subfolders containing taSolution.log")
    parser.add_argument("--backup-dir",   help="New folder for XML backups (must not exist)")
    parser.add_argument("--xml-pattern",  default="*.xml")
    parser.add_argument("--all-true",     action="store_true", help="Reset all UseTilt to True (undo mode)")
    parser.add_argument("--n-tilts",      type=int, default=0)
    parser.add_argument("--max-tilt",     type=float, default=0)

    # Subcommand: apply-bad-tilts (from inspect_bad_tilts.json)
    sp = subparsers.add_parser("apply-bad-tilts",
        help="Apply manual bad tilt markings from inspect_bad_tilts.json to WarpTools XMLs")
    sp.add_argument("--xml-dir",    required=True, help="WarpTools XML directory")
    sp.add_argument("--bad-tilts",  required=True, help="Path to inspect_bad_tilts.json")
    sp.add_argument("--backup-dir", required=True, help="New folder for XML backups")

    args = parser.parse_args()

    if args.cmd == "apply-bad-tilts":
        # Load bad tilts JSON — keys may be filenames, strip extensions, convert 0-based to 1-based
        raw = _json.loads(Path(args.bad_tilts).read_text())
        bad_tilts = {
            k.removesuffix(".mrc").removesuffix(".mrcs").removesuffix(".st"): [i + 1 for i in v]
            for k, v in raw.items() if v
        }
        counts = apply_manual_exclusions_to_xml(args.xml_dir, bad_tilts, args.backup_dir)
        print(f"Done: {counts['processed']} processed, {counts['skipped']} skipped, {counts['errors']} errors")
    else:
        if not args.xml_dir or not args.imod_dir or not args.backup_dir:
            parser.error("--xml-dir, --imod-dir and --backup-dir are required")
        counts = run_remove_skipped(
            xml_dir=args.xml_dir, tiltstack_dir=args.imod_dir, backup_dir=args.backup_dir,
            xml_pattern=args.xml_pattern, all_true=args.all_true,
            n_tilts=args.n_tilts, max_tilt=args.max_tilt,
        )
        print(f"Done: {counts['processed']} processed, {counts['skipped']} skipped, {counts['errors']} errors")


if __name__ == "__main__":
    main()
