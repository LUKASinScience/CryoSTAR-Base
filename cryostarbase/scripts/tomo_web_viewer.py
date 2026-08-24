#!/usr/bin/env python3
import base64
import io
import os
from pathlib import Path
import mrcfile
import numpy as np
from PIL import Image

from trame.app import get_server
from trame.ui.vuetify3 import SinglePageWithDrawerLayout
from trame.widgets import vuetify3 as v3, html

# -----------------------------------------------------------------------------
# Trame Server Setup
# -----------------------------------------------------------------------------
server = get_server(client_type="vue3")
state, ctrl = server.state, server.controller

# Configuration
TOMO_FOLDER = Path.cwd()
ANNOTATION_FOLDER = Path.cwd()
annotation_folder_explicitly_set = False  # becomes True once the user picks an annotation folder themselves
ALLOWED_EXTENSIONS = {".mrc", ".rec"}
DEFAULT_PATTERN = "*_rec.mrc"
AVG_OPTIONS = [1, 5, 11, 21]
GALLERY_THUMB_SIZE = 220
DISPLAY_MAX_DIM = 1200  # max width/height for the live slice preview; source MRC files are never modified

# Global backend state
current_mrc = None
current_data = None
avg_cache = None
current_files = []  # list[Path], absolute paths, sorted
current_files_index = {}  # Path -> index in current_files, kept in sync, O(1) lookup

# -----------------------------------------------------------------------------
# Listing MRC files
# -----------------------------------------------------------------------------
def get_mrc_files(folder: Path, patterns):
    """Returns a sorted, de-duplicated list of Path objects matching ANY of
    the given glob patterns (rglob per pattern, results unioned).
    Falls back to the extension whitelist if no patterns match anything."""
    if not folder.exists():
        return []

    if isinstance(patterns, str):
        patterns = [patterns] if patterns else []

    found = set()
    for pattern in patterns:
        found.update(folder.rglob(pattern))

    if not found:
        found = {p for p in folder.rglob("*") if p.suffix.lower() in ALLOWED_EXTENSIONS}

    return sorted(found)

def combo_labels(files, root: Path):
    total = len(files)
    return [f"{i + 1}/{total} | {p.relative_to(root)}" for i, p in enumerate(files)]

def list_subdirs(folder: Path):
    """Direct subdirectories of a given folder, sorted."""
    if not folder.exists() or not folder.is_dir():
        return []
    try:
        return sorted(
            p.name for p in folder.iterdir() if p.is_dir() and not p.name.startswith(".")
        )
    except PermissionError:
        return []

# -----------------------------------------------------------------------------
# Core slicing logic with extended debug output
# -----------------------------------------------------------------------------
def close_current_mrc():
    global current_mrc, current_data, avg_cache
    if current_mrc is not None:
        current_mrc.close()
        current_mrc = None
        current_data = None
        avg_cache = None

def load_file(full_path: Path):
    global current_mrc, current_data, avg_cache
    close_current_mrc()

    state.file_loading = True
    state.flush()
    print(f"\n[BACKEND] Loading file: {full_path}")
    try:
        current_mrc = mrcfile.mmap(full_path, permissive=True)
        current_data = current_mrc.data

        if current_data is None:
            raise ValueError("File could not be read as MRC data (data is None)")
        if current_data.ndim != 3:
            raise ValueError(
                f"Expected a 3D tomogram stack, got {current_data.ndim}D data "
                f"with shape {current_data.shape}"
            )

        avg_cache = None
        
        print(f"[BACKEND] File loaded successfully. Shape: {current_data.shape}, Dtype: {current_data.dtype}")
        
        # Initialize UI state
        state.z_max = current_data.shape[0] - 1
        state.z_index = current_data.shape[0] // 2
        state.current_file_name = full_path.name

        if full_path in current_files_index:
            idx = current_files_index[full_path]
            state.file_index = idx
            state.selected_file_index = idx

        load_annotation_for_current_file()
        update_slice()
    except Exception as e:
        print(f"[ERROR] Failed to load {full_path}: {e}")
        close_current_mrc()
        state.current_file_name = f"Failed to load: {full_path.name} ({e})"
        state.image_src = ""
    finally:
        state.file_loading = False

# -----------------------------------------------------------------------------
# Directory tree browser & file navigation
# -----------------------------------------------------------------------------
def effective_patterns():
    """Combines toggled pattern pills (state.active_patterns) with the
    free-text pattern field (state.file_pattern), if non-empty."""
    patterns = list(state.active_patterns)
    if state.file_pattern and state.file_pattern not in patterns:
        patterns.append(state.file_pattern)
    return patterns

def refresh_file_list():
    """Re-reads current_files from TOMO_FOLDER + effective_patterns() and
    updates the dropdown labels. Does NOT load any file (caller decides)."""
    global current_files, current_files_index
    patterns = effective_patterns()
    current_files = get_mrc_files(TOMO_FOLDER, patterns)
    current_files_index = {path: i for i, path in enumerate(current_files)}
    labels = combo_labels(current_files, TOMO_FOLDER)
    state.file_list_labels = labels
    state.file_select_items = [
        {"title": label, "value": i} for i, label in enumerate(labels)
    ]
    state.file_count = len(current_files)

    if not current_files:
        print(f"[WARN] No files found in {TOMO_FOLDER} with patterns {patterns} (fallback also found nothing)")

def refresh_browse_subdirs():
    """Updates the subdirectory list for the directory tree browser
    based on state.browse_current_dir."""
    state.browse_subdirs = list_subdirs(Path(state.browse_current_dir))

def navigate_browse_into(subdir_name: str):
    new_dir = Path(state.browse_current_dir) / subdir_name
    if new_dir.exists() and new_dir.is_dir():
        state.browse_current_dir = str(new_dir)
        refresh_browse_subdirs()

ctrl.trigger("navigate_browse_into")(navigate_browse_into)

def navigate_browse_up():
    current = Path(state.browse_current_dir)
    parent = current.parent
    if parent != current:
        state.browse_current_dir = str(parent)
        refresh_browse_subdirs()

def browse_folder_refresh():
    """'Browse' action: reloads the subfolder list for the currently
    displayed path (covers the rare case where disk contents changed
    externally) and closes the panel, giving the button a clearly
    visible effect."""
    refresh_browse_subdirs()
    state.expansion_panel_open = None

def select_browsed_folder():
    """Applies browse_current_dir as the new TOMO_FOLDER and rescans. Does
    NOT build gallery thumbnails (that's deferred until the gallery view
    is actually opened, since generating them is the expensive part).

    If the user has not explicitly chosen a separate annotation folder,
    ANNOTATION_FOLDER follows TOMO_FOLDER automatically, so annotations
    default to living alongside the tomograms instead of silently landing
    in whatever directory the script happened to be launched from."""
    global TOMO_FOLDER, ANNOTATION_FOLDER
    TOMO_FOLDER = Path(state.browse_current_dir).resolve()
    state.current_folder_display = str(TOMO_FOLDER)
    state.detected_file_patterns = scan_file_type_patterns(TOMO_FOLDER)
    refresh_file_list()

    if not annotation_folder_explicitly_set:
        ANNOTATION_FOLDER = TOMO_FOLDER
        state.annotation_browse_current_dir = str(ANNOTATION_FOLDER)
        state.annotation_folder_display = str(ANNOTATION_FOLDER)
        refresh_annotation_browse_subdirs()
        existing = list_existing_annotation_files(ANNOTATION_FOLDER)
        state.existing_annotation_files = existing
        state.annotation_filename = existing[0] if len(existing) == 1 else default_annotation_filename(ANNOTATION_FOLDER)
        load_annotation_table()

    load_annotation_for_current_file()
    state.gallery_thumbnails = []  # stale; will be rebuilt next time gallery view opens

    if current_files:
        load_file(current_files[0])
    else:
        close_current_mrc()
        state.current_file_name = "No file found"
        state.image_src = ""

# -----------------------------------------------------------------------------
# Independent annotation-folder browser
# -----------------------------------------------------------------------------
def refresh_annotation_browse_subdirs():
    state.annotation_browse_subdirs = list_subdirs(Path(state.annotation_browse_current_dir))

def navigate_annotation_browse_into(subdir_name: str):
    new_dir = Path(state.annotation_browse_current_dir) / subdir_name
    if new_dir.exists() and new_dir.is_dir():
        state.annotation_browse_current_dir = str(new_dir)
        refresh_annotation_browse_subdirs()

ctrl.trigger("navigate_annotation_browse_into")(navigate_annotation_browse_into)

def navigate_annotation_browse_up():
    current = Path(state.annotation_browse_current_dir)
    parent = current.parent
    if parent != current:
        state.annotation_browse_current_dir = str(parent)
        refresh_annotation_browse_subdirs()

def annotation_browse_refresh():
    """'Browse' action: reloads the subfolder list for the currently
    displayed annotation path and closes the panel, giving the button a
    clearly visible effect."""
    refresh_annotation_browse_subdirs()
    state.expansion_panel_open = None


def select_annotation_folder():
    """Applies annotation_browse_current_dir as the new ANNOTATION_FOLDER,
    independent of TOMO_FOLDER. Marks the annotation folder as explicitly
    chosen, so it stops auto-following TOMO_FOLDER from this point on. If
    exactly one annotation CSV already exists in the folder, it is
    selected automatically (so re-confirming the same folder never
    silently switches away from real data to an empty default filename).
    Otherwise falls back to the suggested default name."""
    global ANNOTATION_FOLDER, annotation_folder_explicitly_set
    ANNOTATION_FOLDER = Path(state.annotation_browse_current_dir).resolve()
    annotation_folder_explicitly_set = True
    state.annotation_folder_display = str(ANNOTATION_FOLDER)
    existing = list_existing_annotation_files(ANNOTATION_FOLDER)
    state.existing_annotation_files = existing
    if len(existing) == 1:
        state.annotation_filename = existing[0]
    else:
        state.annotation_filename = default_annotation_filename(ANNOTATION_FOLDER)
    load_annotation_table()
    load_annotation_for_current_file()
    rebuild_gallery_annotation_badges()

def goto_file_index(index: int):
    if not current_files:
        return
    index = max(0, min(index, len(current_files) - 1))
    load_file(current_files[index])

def next_file():
    goto_file_index(state.file_index + 1)

def previous_file():
    goto_file_index(state.file_index - 1)

# -----------------------------------------------------------------------------
# Slice averaging (+/- style avg_index / avg_options)
# -----------------------------------------------------------------------------
def avg_label():
    avg = AVG_OPTIONS[state.avg_index]
    return "raw" if avg == 1 else f"avg{avg}"

def increase_average():
    if state.avg_index < len(AVG_OPTIONS) - 1:
        state.avg_index += 1
        state.avg_value = AVG_OPTIONS[state.avg_index]
        state.avg_status_label = avg_label()

def decrease_average():
    if state.avg_index > 0:
        state.avg_index -= 1
        state.avg_value = AVG_OPTIONS[state.avg_index]
        state.avg_status_label = avg_label()

def set_raw():
    state.avg_index = 0
    state.avg_value = AVG_OPTIONS[0]
    state.avg_status_label = avg_label()

# -----------------------------------------------------------------------------
# Gallery (in-memory thumbnails of the center Z-slice, right sidebar)
# -----------------------------------------------------------------------------
def make_thumbnail_b64(path: Path) -> str:
    """Reads the center Z-slice of a tomogram and returns a small base64 JPEG."""
    with mrcfile.mmap(path, permissive=True) as mrc:
        data = mrc.data
        z = data.shape[0] // 2
        img = np.asarray(data[z], dtype=np.float32)

    sample = img[::4, ::4]
    lo, hi = np.nanpercentile(sample, (0.5, 99.5))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        lo, hi = np.nanmin(sample), np.nanmax(sample)
    if hi <= lo:
        hi = lo + 1.0

    img_scaled = np.clip((img - lo) / (hi - lo) * 255.0, 0, 255)
    img_scaled = np.nan_to_num(img_scaled, nan=0.0).astype(np.uint8)

    pil_img = Image.fromarray(img_scaled)
    pil_img.thumbnail((GALLERY_THUMB_SIZE, GALLERY_THUMB_SIZE))

    buffer = io.BytesIO()
    pil_img.save(buffer, format="JPEG", quality=80)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")

def build_gallery_thumbnails():
    """Builds in-memory gallery thumbnails for all files in current_files,
    including a quality color badge and magnification label from
    annotation_table if present. Updates gallery_progress_current and
    flushes periodically so a progress bar can show live progress, since
    this is now a deliberate, on-demand operation (triggered by opening
    the gallery view) rather than something run automatically on folder
    load."""
    total = len(current_files)
    state.gallery_loading = True
    state.gallery_progress_current = 0
    state.gallery_progress_total = total
    state.flush()

    thumbnails = []
    for i, path in enumerate(current_files):
        entry = annotation_table.get(path.name, {"quality": "", "mag": ""})
        badge_color = QUALITY_COLORS.get(entry["quality"], "")
        try:
            b64 = make_thumbnail_b64(path)
            thumbnails.append({
                "index": i,
                "name": path.name,
                "src": f"data:image/jpeg;base64,{b64}",
                "quality_color": badge_color,
                "mag": entry["mag"],
            })
        except Exception as e:
            print(f"[WARN] Could not build thumbnail for {path}: {e}")
            thumbnails.append({
                "index": i, "name": path.name, "src": "",
                "quality_color": badge_color, "mag": entry["mag"],
            })

        state.gallery_progress_current = i + 1
        # Flush periodically (not every single file) so the progress bar is
        # visibly live without the flush overhead dominating the loop.
        if (i + 1) % 5 == 0 or (i + 1) == total:
            state.gallery_thumbnails = list(thumbnails)
            state.flush()

    state.gallery_thumbnails = thumbnails
    state.gallery_loading = False
    state.flush()

def open_gallery_view():
    """Switches to gallery view and builds thumbnails on demand if the
    current file list hasn't been rendered into thumbnails yet."""
    state.view_mode = "gallery"
    if len(state.gallery_thumbnails) != len(current_files):
        build_gallery_thumbnails()

ctrl.trigger("open_gallery_view")(open_gallery_view)

def open_stack_view():
    state.view_mode = "stack"

ctrl.trigger("open_stack_view")(open_stack_view)

def rebuild_gallery_annotation_badges():
    """Lightweight refresh: just updates the badge/mag fields on existing
    gallery thumbnails without re-reading the MRC files for new images."""
    updated = []
    for thumb in state.gallery_thumbnails:
        path = current_files[thumb["index"]] if thumb["index"] < len(current_files) else None
        if path is None:
            updated.append(thumb)
            continue
        entry = annotation_table.get(path.name, {"quality": "", "mag": ""})
        thumb = dict(thumb)
        thumb["quality_color"] = QUALITY_COLORS.get(entry["quality"], "")
        thumb["mag"] = entry["mag"]
        updated.append(thumb)
    state.gallery_thumbnails = updated

def gallery_select(index: int):
    goto_file_index(index)

ctrl.trigger("gallery_select")(gallery_select)

def scan_file_type_patterns(folder: Path):
    """Scans the folder for files matching ALLOWED_EXTENSIONS and derives
    a list of glob patterns based on (prefix-before-first-underscore, suffix
    after the last underscore, extension). e.g. tomo01_rec.mrc -> '*_rec.mrc'.
    Files without an underscore fall back to '*<ext>'. Returns sorted unique
    patterns with file counts."""
    if not folder.exists():
        return []

    counts = {}
    for p in folder.rglob("*"):
        if p.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        stem = p.stem
        if "_" in stem:
            suffix_part = stem.rsplit("_", 1)[1]
            pattern = f"*_{suffix_part}{p.suffix}"
        else:
            pattern = f"*{p.suffix}"
        counts[pattern] = counts.get(pattern, 0) + 1

    return sorted(
        [{"pattern": pat, "count": n} for pat, n in counts.items()],
        key=lambda d: -d["count"],
    )

QUALITY_OPTIONS = ["very good", "good", "ok", "not usable", "lost"]
MAG_OPTIONS = ["high mag", "low mag"]

QUALITY_COLORS = {
    "very good": "#1b5e20",   # dark green
    "good": "#66bb6a",        # light green
    "ok": "#fb8c00",          # orange
    "not usable": "#e53935",  # red
    "lost": "#7b1fa2",        # dark red/purple (clearly distinct from "not usable")
}

# In-memory annotation table for the currently selected annotation file.
# Keyed by tomogram filename (not full path) -> {"quality": ..., "mag": ...}
annotation_table = {}

def default_annotation_filename(folder: Path) -> str:
    return f"{folder.name}_annotations.csv"

def annotation_file_path() -> Path:
    # .name strips any directory component (../, absolute paths, etc.) so a
    # crafted filename from the UI field can't read/write outside ANNOTATION_FOLDER.
    return ANNOTATION_FOLDER / Path(state.annotation_filename).name

def load_annotation_table():
    """Reads the shared annotation CSV for ANNOTATION_FOLDER into annotation_table.
    Format: header 'filename,quality,mag' followed by one row per tomogram."""
    global annotation_table
    annotation_table = {}
    path = annotation_file_path()
    if not path.exists():
        return
    try:
        lines = path.read_text().splitlines()
        for line in lines[1:]:  # skip header
            parts = line.split(",", 2)
            if len(parts) != 3:
                continue
            filename, quality, mag = parts
            annotation_table[filename] = {"quality": quality, "mag": mag}
    except OSError as e:
        print(f"[WARN] Could not read annotation file {path}: {e}")

def save_annotation_table():
    """Writes annotation_table back to the shared annotation CSV.

    Safety guard: if the in-memory table is empty but a non-empty file
    already exists on disk at the target path, refuse to overwrite it.
    An empty in-memory table at save time is virtually always a sign that
    something reset annotation_table (e.g. a folder/filename change)
    rather than the user genuinely wanting to erase all annotations —
    overwriting real data with nothing should never happen silently.
    """
    path = annotation_file_path()
    if not annotation_table and path.exists():
        try:
            existing_rows = [
                line for line in path.read_text().splitlines()[1:] if line.strip()
            ]
        except OSError:
            existing_rows = []
        if existing_rows:
            print(
                f"[WARN] Refusing to overwrite {path} with an empty annotation "
                f"table - the file already has {len(existing_rows)} row(s) on disk. "
                f"This usually means the in-memory table was reset (e.g. by "
                f"reselecting the annotation folder). Reload the correct "
                f"annotation file before annotating to avoid this."
            )
            return
    try:
        lines = ["filename,quality,mag"]
        for filename, entry in sorted(annotation_table.items()):
            lines.append(f"{filename},{entry['quality']},{entry['mag']}")
        path.write_text("\n".join(lines) + "\n")
        print(f"[BACKEND] Annotation file saved: {path}")
    except OSError as e:
        print(f"[ERROR] Could not write annotation file {path}: {e}")

def load_annotation_for_current_file():
    """Updates state.annotation_quality/mag from annotation_table for the
    currently loaded tomogram."""
    if not current_files or state.file_index >= len(current_files):
        state.annotation_quality = ""
        state.annotation_mag = ""
        return
    filename = current_files[state.file_index].name
    entry = annotation_table.get(filename, {"quality": "", "mag": ""})
    state.annotation_quality = entry["quality"]
    state.annotation_mag = entry["mag"]

def set_annotation_quality(value: str):
    if not current_files or state.file_index >= len(current_files):
        return
    filename = current_files[state.file_index].name
    entry = annotation_table.setdefault(filename, {"quality": "", "mag": ""})
    entry["quality"] = value
    state.annotation_quality = value
    save_annotation_table()
    rebuild_gallery_annotation_badges()

def set_annotation_mag(value: str):
    if not current_files or state.file_index >= len(current_files):
        return
    filename = current_files[state.file_index].name
    entry = annotation_table.setdefault(filename, {"quality": "", "mag": ""})
    entry["mag"] = value
    state.annotation_mag = value
    save_annotation_table()
    rebuild_gallery_annotation_badges()

ctrl.trigger("set_annotation_quality")(set_annotation_quality)
ctrl.trigger("set_annotation_mag")(set_annotation_mag)

def list_existing_annotation_files(folder: Path):
    """Lists .csv files directly in folder that look like annotation
    files (used to let the user pick an existing one instead of typing)."""
    if not folder.exists():
        return []
    try:
        return sorted(p.name for p in folder.glob("*.csv"))
    except PermissionError:
        return []

def on_annotation_filename_change(new_name: str):
    """Called when the user edits the annotation filename text field or
    picks an existing annotation file via browse. Reloads the table for
    the (possibly new) file and refreshes the current view + gallery."""
    state.annotation_filename = new_name
    load_annotation_table()
    load_annotation_for_current_file()
    rebuild_gallery_annotation_badges()

ctrl.trigger("on_annotation_filename_change")(on_annotation_filename_change)

def save_annotation_button_click():
    """Explicit save button: writes the current annotation_table to disk.
    Acts as a safety net in addition to the automatic save on every
    quality/mag chip click."""
    save_annotation_table()

ctrl.trigger("save_annotation_button_click")(save_annotation_button_click)

def step_z(delta: int):
    """Moves z_index by delta, clamped to [0, z_max]. Used for mouse-wheel
    scrolling through the tomogram, analogous to a SliceViewBox.wheelEvent.
    delta may be a multi-tick accumulated value when the client-side wheel
    handler throttles rapid scrolling into a single call."""
    if current_data is None:
        return
    new_z = max(0, min(state.z_index + delta, state.z_max))
    if new_z != state.z_index:
        state.z_index = new_z
        update_slice()

ctrl.trigger("step_z")(step_z)

def apply_pattern_chip(pattern: str):
    """Toggles a detected pattern on/off in the active multi-select set."""
    patterns = list(state.active_patterns)
    if pattern in patterns:
        patterns.remove(pattern)
    else:
        patterns.append(pattern)
    state.active_patterns = patterns
    apply_file_pattern()

ctrl.trigger("apply_pattern_chip")(apply_pattern_chip)

def update_slice():
    global current_data, avg_cache
    if current_data is None:
        return

    try:
        state.slice_loading = True
        state.flush()
        z = int(state.z_index)
        avg = int(state.avg_value)
        contrast_low = float(state.contrast_low)
        contrast_high = float(state.contrast_high)

        print(f"[BACKEND] Computing slice: Z={z}, Average={avg}, Contrast=({contrast_low}%, {contrast_high}%)")

        # 1. Compute slice / average
        if avg <= 1:
            img = current_data[z]
        else:
            half = avg // 2
            z0 = max(0, z - half)
            z1 = min(current_data.shape[0], z + half + 1)

            if avg_cache is None or avg_cache.get("avg") != avg:
                sum_img = current_data[z0:z1].sum(axis=0, dtype=np.float32)
                avg_cache = {"avg": avg, "z0": z0, "z1": z1, "sum": sum_img}
            else:
                old_z0 = avg_cache["z0"]
                old_z1 = avg_cache["z1"]
                sum_img = avg_cache["sum"]

                if old_z0 < z0:
                    sum_img -= current_data[old_z0:z0].sum(axis=0, dtype=np.float32)
                if old_z1 > z1:
                    sum_img -= current_data[z1:old_z1].sum(axis=0, dtype=np.float32)
                if z0 < old_z0:
                    sum_img += current_data[z0:old_z0].sum(axis=0, dtype=np.float32)
                if z1 > old_z1:
                    sum_img += current_data[old_z1:z1].sum(axis=0, dtype=np.float32)

                avg_cache = {"avg": avg, "z0": z0, "z1": z1, "sum": sum_img}
            
            img = sum_img / (z1 - z0)

        # 2. Compute contrast levels from a cheap subsample of the full-res
        # slice (guarded against NaNs). This keeps contrast stats accurate
        # regardless of the display downscale applied below.
        sample = np.asarray(img[::4, ::4], dtype=np.float32)
        
        # Use nanpercentile to ignore corrupt pixels/edges
        lo, hi = np.nanpercentile(sample, (contrast_low, contrast_high))
        
        if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
            lo, hi = np.nanmin(sample), np.nanmax(sample)
        if hi <= lo:
            hi = lo + 1.0

        print(f"[BACKEND] Raw value range of slice: Min={np.nanmin(sample)}, Max={np.nanmax(sample)} -> Scaled to Lo={lo}, Hi={hi}")

        # 3. Downscale to display resolution BEFORE normalizing/encoding.
        # The display container is capped well below typical tilt-series
        # resolutions (e.g. 4096x4096), so normalizing and JPEG-encoding
        # the full-resolution array wastes CPU time and network bandwidth
        # on pixels the browser can't show anyway. The source MRC file on
        # disk is never touched; only this live preview is resized.
        if max(img.shape) > DISPLAY_MAX_DIM:
            # Cast to float32 first: PIL's Image.fromarray does not support
            # float16, which is a common on-disk dtype for real tilt series
            # (mrcfile preserves the file's native dtype without casting).
            # Casting here is required for correctness, not a performance
            # change — the array was already being cast to float32 right
            # after the resize regardless.
            pil_raw = Image.fromarray(np.asarray(img, dtype=np.float32))
            # BOX filter is the correct choice for pure downsampling (not
            # upsampling): it's an area average, giving LANCZOS-equivalent
            # quality for size reduction while being several times faster.
            pil_raw.thumbnail((DISPLAY_MAX_DIM, DISPLAY_MAX_DIM), Image.BOX)
            img = np.asarray(pil_raw, dtype=np.float32)

        # Normalize to 0-255
        img_scaled = np.clip((img - lo) / (hi - lo) * 255.0, 0, 255)
        # Convert NaNs to black (0)
        img_scaled = np.nan_to_num(img_scaled, nan=0.0).astype(np.uint8)

        # 4. Compress to JPEG
        pil_img = Image.fromarray(img_scaled)
        buffer = io.BytesIO()
        pil_img.save(buffer, format="JPEG", quality=85)
        b64_encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        
        print(f"[BACKEND] JPEG compressed successfully. Base64 length: {len(b64_encoded)} characters.")
        
        # Send state to the browser
        state.image_src = f"data:image/jpeg;base64,{b64_encoded}"
        
    except Exception as e:
        print(f"[ERROR] Slice computation failed: {e}")
    finally:
        state.slice_loading = False

# -----------------------------------------------------------------------------
# Trame State Change Listeners
# -----------------------------------------------------------------------------
@state.change("z_index", "avg_value", "contrast_low", "contrast_high")
def on_ui_change(**kwargs):
    update_slice()

def select_file_by_index(index):
    """Called directly from the UI trigger when a file is picked from
    the dropdown. Bypasses v_model/state.change round-tripping, which
    proved unreliable, in favor of the same direct-trigger pattern used
    by the gallery and directory browser."""
    if index is None or index == "":
        return
    goto_file_index(int(index))

ctrl.trigger("select_file_by_index")(select_file_by_index)

def apply_file_pattern():
    """Re-scans current_files using the current state.file_pattern and
    loads the first matching file. Gallery thumbnails are invalidated and
    rebuilt lazily next time the gallery view is opened."""
    refresh_file_list()
    state.gallery_thumbnails = []
    if current_files:
        load_file(current_files[0])
    else:
        close_current_mrc()
        state.current_file_name = "No file found"
        state.image_src = ""

@state.change("file_pattern")
def on_pattern_change(**kwargs):
    apply_file_pattern()

# -----------------------------------------------------------------------------
# Web Frontend UI Definition (Vuetify 3)
# -----------------------------------------------------------------------------
state.file_pattern = ""
state.active_patterns = [DEFAULT_PATTERN]
state.browse_current_dir = str(TOMO_FOLDER)
state.current_folder_display = str(TOMO_FOLDER)
state.browse_subdirs = []
state.file_list_labels = []
state.file_select_items = []
state.file_count = 0
state.file_index = 0
state.selected_file_index = 0
state.current_file_name = "No file loaded"
state.image_src = ""
state.z_index = 0
state.z_max = 100
state.avg_index = 0
state.avg_value = AVG_OPTIONS[0]
state.avg_status_label = avg_label()
state.contrast_low = 0.5
state.contrast_high = 99.5
state.gallery_thumbnails = []
state.view_mode = "stack"
state.gallery_loading = False
state.gallery_progress_current = 0
state.gallery_progress_total = 0
state.file_loading = False
state.slice_loading = False
state.expansion_panel_open = None
state.detected_file_patterns = []
state.annotation_quality = ""
state.annotation_mag = ""
state.quality_options = QUALITY_OPTIONS
state.mag_options = MAG_OPTIONS
state.quality_colors = QUALITY_COLORS
state.annotation_browse_current_dir = str(ANNOTATION_FOLDER)
state.annotation_folder_display = str(ANNOTATION_FOLDER)
state.annotation_browse_subdirs = []
state.annotation_filename = default_annotation_filename(ANNOTATION_FOLDER)
state.existing_annotation_files = list_existing_annotation_files(ANNOTATION_FOLDER)

refresh_browse_subdirs()
refresh_annotation_browse_subdirs()
refresh_file_list()
load_annotation_table()
state.detected_file_patterns = scan_file_type_patterns(TOMO_FOLDER)

if current_files:
    load_file(current_files[0])

with SinglePageWithDrawerLayout(server) as layout:
    with layout.title:
        with html.Div(classes="d-flex align-center justify-space-between", style="width: 100%;"):
            html.Span("🔬 Batch Tomo Web Viewer", classes="text-subtitle-1")
            with html.Div(classes="d-flex", style="gap: 4px;"):
                v3.VBtn(
                    "🧊 Stack View",
                    size="small",
                    variant=("view_mode === 'stack' ? 'flat' : 'outlined'",),
                    color=("view_mode === 'stack' ? 'primary' : undefined",),
                    click="trigger('open_stack_view', [])",
                )
                v3.VBtn(
                    "🗂️ Gallery View",
                    size="small",
                    variant=("view_mode === 'gallery' ? 'flat' : 'outlined'",),
                    color=("view_mode === 'gallery' ? 'primary' : undefined",),
                    click="trigger('open_gallery_view', [])",
                )
    
    with layout.drawer as drawer:
        drawer.width = 380

        v3.VCardTitle("File Filter")
        html.Div("Toggle file types to show:", classes="text-caption text-grey px-3")
        with html.Div(classes="d-flex flex-wrap px-3 mb-2", style="gap: 6px;"):
            v3.VChip(
                "{{ p.pattern }} ({{ p.count }})",
                v_for="p, idx in detected_file_patterns",
                key="idx",
                size="small",
                variant=("active_patterns.includes(p.pattern) ? 'flat' : 'outlined'",),
                color=("active_patterns.includes(p.pattern) ? 'primary' : undefined",),
                click="trigger('apply_pattern_chip', [p.pattern])",
            )
        v3.VTextField(
            v_model=("file_pattern", ""),
            label="Custom pattern (optional, e.g. *_ali.mrc)",
            density="compact",
            classes="mx-3"
        )

        v3.VDivider(classes="my-3")

        with v3.VExpansionPanels(variant="accordion", model_value=("expansion_panel_open", None)):
            # --- Browse Folder ---
            with v3.VExpansionPanel():
                with v3.VExpansionPanelTitle():
                    html.Span("📂 Browse Folder")
                    html.Span(
                        "{{ current_folder_display }}",
                        classes="text-caption text-grey ml-2",
                        style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;"
                    )
                with v3.VExpansionPanelText():
                    html.Div("{{ browse_current_dir }}", classes="text-caption text-grey mb-1", style="word-break: break-all;")
                    with html.Div(classes="d-flex mb-2", style="gap: 8px;"):
                        v3.VBtn("🔍 Browse", size="small", variant="outlined", click=browse_folder_refresh)
                        v3.VBtn("Use This Folder", size="small", color="primary", variant="flat", click=select_browsed_folder)
                    with html.Div(style="max-height: 180px; overflow-y: auto; border: 1px solid #444; border-radius: 4px;", classes="mb-1"):
                        html.Div(
                            "⬆️ ..",
                            classes="px-2 py-1",
                            style="cursor: pointer; border-bottom: 1px solid #333; color: #999;",
                            click=navigate_browse_up,
                        )
                        with html.Div(
                            v_for="dirname, idx in browse_subdirs",
                            key="idx",
                            classes="px-2 py-1",
                            style="cursor: pointer; border-bottom: 1px solid #333;",
                            click="trigger('navigate_browse_into', [dirname])",
                        ):
                            html.Span("📁 {{ dirname }}")

            # --- File Selection ---
            with v3.VExpansionPanel():
                with v3.VExpansionPanelTitle():
                    html.Span("🔍 File Selection")
                    html.Span(
                        "{{ current_file_name }}",
                        classes="text-caption text-grey ml-2",
                        style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;"
                    )
                with v3.VExpansionPanelText():
                    v3.VAutocomplete(
                        model_value=("selected_file_index", 0),
                        items=("file_select_items", []),
                        label="Search / select tomogram",
                        density="compact",
                        clearable=True,
                        update_modelValue="trigger('select_file_by_index', [$event])",
                    )
                    with html.Div(classes="d-flex mt-1", style="gap: 8px;"):
                        v3.VBtn("← Previous", size="small", variant="outlined", click=previous_file, classes="flex-grow-1")
                        v3.VBtn("Next →", size="small", variant="outlined", click=next_file, classes="flex-grow-1")

            # --- Annotation File ---
            with v3.VExpansionPanel():
                with v3.VExpansionPanelTitle():
                    html.Span("🏷️ Annotation File")
                    html.Span(
                        "{{ annotation_filename }}",
                        classes="text-caption text-grey ml-2",
                        style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;"
                    )
                with v3.VExpansionPanelText():
                    html.Div(
                        "One shared annotation file is used for all tomograms in this folder. "
                        "Its storage location is independent of the tomogram folder above.",
                        classes="text-caption text-grey mb-1"
                    )
                    html.Div("{{ annotation_browse_current_dir }}", classes="text-caption text-grey mb-1", style="word-break: break-all;")
                    with html.Div(classes="d-flex mb-2", style="gap: 8px;"):
                        v3.VBtn("🔍 Browse", size="small", variant="outlined", click=annotation_browse_refresh)
                        v3.VBtn("Use This Folder", size="small", color="primary", variant="flat", click=select_annotation_folder)

                    with html.Div(style="max-height: 140px; overflow-y: auto; border: 1px solid #444; border-radius: 4px;", classes="mb-3"):
                        html.Div(
                            "⬆️ ..",
                            classes="px-2 py-1",
                            style="cursor: pointer; border-bottom: 1px solid #333; color: #999;",
                            click=navigate_annotation_browse_up,
                        )
                        with html.Div(
                            v_for="dirname, idx in annotation_browse_subdirs",
                            key="idx",
                            classes="px-2 py-1",
                            style="cursor: pointer; border-bottom: 1px solid #333;",
                            click="trigger('navigate_annotation_browse_into', [dirname])",
                        ):
                            html.Span("📁 {{ dirname }}")

                    v3.VTextField(
                        model_value=("annotation_filename", ""),
                        label="Annotation filename",
                        density="compact",
                        update_modelValue="trigger('on_annotation_filename_change', [$event])",
                    )
                    with html.Div(
                        v_if="existing_annotation_files.length > 0",
                        classes="d-flex flex-wrap mb-2 mt-1",
                        style="gap: 6px;"
                    ):
                        v3.VChip(
                            "{{ f }}",
                            v_for="f, idx in existing_annotation_files",
                            key="idx",
                            size="small",
                            variant=("annotation_filename === f ? 'flat' : 'outlined'",),
                            color=("annotation_filename === f ? 'primary' : undefined",),
                            click="trigger('on_annotation_filename_change', [f])",
                        )
                    v3.VBtn(
                        "💾 Save Annotation File",
                        size="small",
                        color="primary",
                        variant="outlined",
                        block=True,
                        click="trigger('save_annotation_button_click', [])",
                    )

            # --- Contrast Percentiles ---
            with v3.VExpansionPanel():
                with v3.VExpansionPanelTitle():
                    html.Span("🌗 Contrast")
                    html.Span(
                        "{{ contrast_low + '% / ' + contrast_high + '%' }}",
                        classes="text-caption text-grey ml-2",
                    )
                with v3.VExpansionPanelText():
                    v3.VSlider(
                        v_model=("contrast_low", 0.5),
                        min=0, max=10, step=0.1,
                        label="Low %",
                        thumb_label=True,
                    )
                    v3.VSlider(
                        v_model=("contrast_high", 99.5),
                        min=90, max=100, step=0.1,
                        label="High %",
                        thumb_label=True,
                    )

        v3.VDivider(classes="my-3")
        v3.VCardTitle("Slice Averaging")
        with html.Div(classes="d-flex px-3 align-center", style="gap: 8px;"):
            v3.VBtn("Average -", size="small", variant="outlined", click=decrease_average)
            v3.VBtn("{{ 'Average: ' + avg_status_label }}", size="small", variant="flat", click=set_raw, classes="flex-grow-1")
            v3.VBtn("Average +", size="small", variant="outlined", click=increase_average)

    with layout.content:
        # --- Gallery View (full width, only visible when view_mode == 'gallery') ---
        with html.Div(v_if="view_mode === 'gallery'", classes="fill-height pa-4", style="overflow-y: auto;"):
            with html.Div(v_if="gallery_loading", classes="mb-4"):
                html.Div(
                    "{{ 'Loading thumbnails: ' + gallery_progress_current + ' / ' + gallery_progress_total }}",
                    classes="text-body-2 mb-1"
                )
                v3.VProgressLinear(
                    model_value=("gallery_progress_total > 0 ? (gallery_progress_current / gallery_progress_total * 100) : 0",),
                    height=8,
                    color="primary",
                    rounded=True,
                )
            with html.Div(
                style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;"
            ):
                with html.Div(
                    v_for="thumb, idx in gallery_thumbnails",
                    key="idx",
                    classes="d-flex flex-column align-center pa-1",
                    style=("file_index === thumb.index ? 'cursor: pointer; border: 2px solid #1976d2; border-radius: 4px;' : 'cursor: pointer; border: 2px solid transparent; border-radius: 4px;'",),
                    click="trigger('open_stack_view', []); trigger('gallery_select', [thumb.index])",
                ):
                    with html.Div(style="position: relative; width: 100%;"):
                        v3.VImg(src=("thumb.src",), width="100%", aspect_ratio="1")
                        html.Div(
                            v_if="thumb.quality_color",
                            style=("'position: absolute; top: 4px; left: 4px; width: 14px; height: 14px; border-radius: 50%; border: 1px solid white; background-color: ' + thumb.quality_color",),
                        )
                        html.Div(
                            "{{ thumb.mag === 'high mag' ? 'HM' : (thumb.mag === 'low mag' ? 'LM' : '') }}",
                            v_if="thumb.mag",
                            classes="text-caption text-white",
                            style="position: absolute; top: 4px; right: 4px; background-color: rgba(0,0,0,0.7); padding: 1px 4px; border-radius: 3px;",
                        )
                    html.Span("{{ thumb.name }}", classes="text-caption text-center", style="word-break: break-all;")

        # --- Stack View (single tomogram Z-slice viewer, default) ---
        with v3.VContainer(v_if="view_mode === 'stack'", fluid=True, classes="fill-height d-flex flex-column align-center justify-center bg-grey-darken-4"):
            
            html.H3("{{ current_file_name }} (Z: {{ z_index + 1 }} / {{ z_max + 1 }})", classes="text-white mb-3")
            
            # FIX: fixed square aspect ratio (70vh) so the layout never collapses in the browser
            with html.Div(style="position: relative; width: 70vh; height: 70vh;"):
                with html.Div(
                    style="width: 100%; height: 100%; border: 2px solid #555; background: black; display: flex; align-items: center; justify-center: center; overflow: hidden; cursor: ns-resize;",
                    wheel="""
                        window.__tomoWheelAccum = (window.__tomoWheelAccum || 0) + ($event.deltaY > 0 ? -1 : 1);
                        clearTimeout(window.__tomoWheelTimer);
                        window.__tomoWheelTimer = setTimeout(() => {
                            const delta = window.__tomoWheelAccum;
                            window.__tomoWheelAccum = 0;
                            trigger('step_z', [delta]);
                        }, 60);
                    """,
                    wheel_modifiers="prevent",
                ):
                    v3.VImg(
                        src=("image_src", ""),
                        width="100%",
                        height="100%"
                    )
                with html.Div(
                    v_if="file_loading || slice_loading",
                    style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.35); pointer-events: none;",
                ):
                    v3.VProgressCircular(indeterminate=True, color="primary", size=48)

            
            v3.VSlider(
                v_model=("z_index", 0),
                min=0,
                max=("z_max", 100),
                step=1,
                label="Z-Slice",
                classes="w-75 mt-4 text-white",
                thumb_label=True
            )

            with html.Div(classes="d-flex flex-column align-center mt-4", style="gap: 8px;"):
                with html.Div(classes="d-flex align-center", style="gap: 8px;"):
                    html.Span("Quality:", classes="text-white text-caption")
                    v3.VChip(
                        "{{ q }}",
                        v_for="q, idx in quality_options",
                        key="idx",
                        size="small",
                        variant=("annotation_quality === q ? 'flat' : 'outlined'",),
                        color=("quality_colors[q]",),
                        click="trigger('set_annotation_quality', [q])",
                    )
                with html.Div(classes="d-flex align-center", style="gap: 8px;"):
                    html.Span("Magnification:", classes="text-white text-caption")
                    v3.VChip(
                        "{{ m }}",
                        v_for="m, idx in mag_options",
                        key="idx",
                        size="small",
                        variant=("annotation_mag === m ? 'flat' : 'outlined'",),
                        color=("annotation_mag === m ? 'primary' : undefined",),
                        click="trigger('set_annotation_mag', [m])",
                    )

if __name__ == "__main__":
    import argparse as _ap
    _parser = _ap.ArgumentParser(description="CryoSTAR-Base Tomo Viewer (Trame)")
    _parser.add_argument("--folder", type=str, default=None,
                         help="Initial tomogram folder to open")
    _parser.add_argument("--port",   type=int, default=8788,
                         help="Port for the Trame web server (default: 8788)")
    _args = _parser.parse_args()
    if _args.folder:
        from pathlib import Path as _Path
        TOMO_FOLDER = _Path(_args.folder).resolve()
        ANNOTATION_FOLDER = TOMO_FOLDER
        # Trigger initial file scan with the provided folder
        state.browse_current_dir = str(TOMO_FOLDER)
    server.start(port=_args.port, open_browser=False)