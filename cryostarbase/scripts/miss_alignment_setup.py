"""miss_alignment_setup.py — Prepare warp_tiltseries/ for miss-alignment training.

Does three things:
  1. Optionally backs up existing XML files
  2. Updates Warp XML volume/image dimensions (required by miss-alignment)
  3. Writes miss_alignment_config.yaml with correct training_directory

Run BEFORE miss-alignment, AFTER WarpTools tilt-series alignment (ts_etomo_patches or
ts_import_alignments).

Usage:
    python -m cryostarbase.scripts.miss_alignment_setup \\
        --xml_dir /path/to/warp_tiltseries \\
        --stack_x 5760 --stack_y 4092 \\
        --vol_x 5760 --vol_y 4092 --vol_z 2500 \\
        --pixel_size 2.678 \\
        --batch_size 32

Written together by Lukas W. Bauer und Claude — 2026.
"""

import argparse
import glob
import os
import shutil
import sys
from pathlib import Path


# ── Config YAML template ──────────────────────────────────────────────────────
# Based on: https://github.com/warpem/miss-alignment/blob/main/docs/config_template.yaml

CONFIG_TEMPLATE = """\
general:
  # MissAlignment iteratively trains models and realigns the tilt-series
  training_directory: {training_directory}
  apply_ctf: False                # leave False; enabling CTF doubles processing time
  iteration_settings:
    - {{ downsample: 3, alignment: anchoring }}
    - {{ downsample: 2, alignment: anchoring }}
    - {{ downsample: 1, alignment: global }}
    - {{ downsample: 1, alignment: global }}
    - {{ downsample: 1, alignment: [3, 3] }}
    - {{ downsample: 1, alignment: [3, 3] }}
    - {{ downsample: 1, alignment: [3, 3] }}
    - {{ downsample: 1, alignment: [3, 3] }}
  seed: 45132

model_training:
  model_architecture: 'default'
  model_checkpoint: null
  loss_margin: 0.5
  learning_rate: 1.0e-3
  weight_decay: 1.0e-4
  max_epochs_per_iteration: 20    # reduced from 30: larger batch converges faster
  warmup_steps: 200               # reduced proportionally
  multistep_lr_scheduler:
    milestones: [5, 10]    # [5,15] with max_epochs=20 prevents early stopping; [5,10] allows patience=5 to trigger
    gamma: 0.5

data_loading:
  batch_size: 32                  # conservative default; safe for all VRAM sizes including downsample 1
  patch_size: 96
  steps_per_epoch: 500            # reduced from 1000: sufficient for 35 tilt series

shift_generation:
  trajectory_probability: .5
  trajectory_max_shift: 10.0
  jitter_probability: .5
  jitter_max_std: 2.0
  outlier_probability: .5
  outlier_max_shift: 20.0
  fracture_probability: .5
  fracture_max_shift: 20.0

tilt_series_alignment:
  patch_size: 96
  patch_overlap: 0.1
  batch_size: {batch_size}    # patches reconstructed simultaneously; 32 for 24GB VRAM
"""


def step_a_backup(xml_dir: Path, backup_dir: Path) -> None:
    """Step A: Backup XML files before modification."""
    xml_files = list(xml_dir.glob("*.xml"))
    if not xml_files:
        print(f"[miss_alignment_setup] WARNING: No XML files found in {xml_dir}")
        return
    backup_dir.mkdir(parents=True, exist_ok=True)
    for f in xml_files:
        shutil.copy2(f, backup_dir / f.name)
    print(f"[miss_alignment_setup] ✓ Backup done: {len(xml_files)} XML files → {backup_dir}")


def step_b_update_xml(
    xml_dir: Path,
    stack_x: int, stack_y: int,
    vol_x: int, vol_y: int, vol_z: int,
    pixel_size: float,
) -> None:
    """Step B: Update Warp XML volume/image dimensions for miss-alignment.

    Required before running miss-alignment — see:
    https://gist.github.com/McHaillet/117b321f504ac54d2f082bbe9bb01f16
    """
    try:
        import torch
        from warpylib import TiltSeries
    except ImportError as e:
        print(f"[miss_alignment_setup] ERROR: Could not import warpylib/torch: {e}")
        print("[miss_alignment_setup] Make sure you are running in the miss-alignment conda env")
        sys.exit(1)

    xml_files = list(xml_dir.glob("*.xml"))
    if not xml_files:
        print(f"[miss_alignment_setup] WARNING: No XML files found in {xml_dir}")
        return

    for x in xml_files:
        ts = TiltSeries(x)
        ts.image_dimensions_physical = torch.tensor(
            [stack_x * pixel_size, stack_y * pixel_size],
            dtype=torch.float32,
        )
        ts.volume_dimensions_physical = torch.tensor(
            [vol_x * pixel_size, vol_y * pixel_size, vol_z * pixel_size],
            dtype=torch.float32,
        )
        ts.save_meta(x)

    print(f"[miss_alignment_setup] ✓ Updated {len(xml_files)} XML files")
    print(f"  stack_shape : ({stack_x}, {stack_y})")
    print(f"  vol_shape   : ({vol_x}, {vol_y}, {vol_z})")
    print(f"  pixel_size  : {pixel_size} Å")


def step_c_write_config(xml_dir: Path, batch_size: int) -> Path:
    """Step C: Write miss_alignment_config.yaml into warp_tiltseries/."""
    config_path = xml_dir / "miss_alignment_config.yaml"
    config_text = CONFIG_TEMPLATE.format(
        training_directory=str(xml_dir),
        batch_size=batch_size,
    )
    config_path.write_text(config_text)
    print(f"[miss_alignment_setup] ✓ Config written to {config_path}")
    print(f"  training_directory: {xml_dir}")
    print(f"  tilt_series_alignment.batch_size: {batch_size}")
    return config_path


def main():
    parser = argparse.ArgumentParser(
        description="Prepare warp_tiltseries/ for miss-alignment training."
    )
    parser.add_argument("--xml_dir",    required=True,  help="Absolute path to warp_tiltseries/ directory")
    parser.add_argument("--stack_x",    required=True,  type=int,   help="Stack image X dimension (pixels)")
    parser.add_argument("--stack_y",    required=True,  type=int,   help="Stack image Y dimension (pixels)")
    parser.add_argument("--vol_x",      required=True,  type=int,   help="Volume X dimension (pixels)")
    parser.add_argument("--vol_y",      required=True,  type=int,   help="Volume Y dimension (pixels)")
    parser.add_argument("--vol_z",      required=True,  type=int,   help="Volume Z dimension (pixels) — tightly fit your sample")
    parser.add_argument("--pixel_size", required=True,  type=float, help="Raw pixel size in Angstrom")
    parser.add_argument("--batch_size", default=32,     type=int,   help="tilt_series_alignment batch_size (default: 32 for 24GB VRAM)")
    parser.add_argument("--backup",     default="false",            help="Backup XMLs before update: true/false")
    parser.add_argument("--backup_dir", default="",                 help="Backup destination directory (required if --backup true)")
    args = parser.parse_args()

    xml_dir = Path(args.xml_dir)
    if not xml_dir.exists():
        print(f"[miss_alignment_setup] ERROR: xml_dir does not exist: {xml_dir}")
        sys.exit(1)

    print(f"[miss_alignment_setup] Starting setup in {xml_dir}")
    print("=" * 60)

    # Step A: Backup
    if args.backup.lower() == "true":
        if not args.backup_dir:
            print("[miss_alignment_setup] ERROR: --backup_dir required when --backup true")
            sys.exit(1)
        step_a_backup(xml_dir, Path(args.backup_dir))
    else:
        print("[miss_alignment_setup] Skipping backup (--backup false)")

    # Step B: Update XML dimensions
    step_b_update_xml(
        xml_dir,
        args.stack_x, args.stack_y,
        args.vol_x, args.vol_y, args.vol_z,
        args.pixel_size,
    )

    # Step C: Write config.yaml
    step_c_write_config(xml_dir, args.batch_size)

    print("=" * 60)
    print("[miss_alignment_setup] ✓ Setup complete — ready to run miss-alignment")


if __name__ == "__main__":
    main()