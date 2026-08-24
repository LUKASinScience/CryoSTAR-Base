"""All business logic for CryoSTAR-Base.

Written together by Lukas W. Bauer und Claude — 2026.
"""

from __future__ import annotations
import asyncio
import math
import os
import re
import shlex
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from cryostarbase.models import (
    WorkspaceConfig, ProjectConfig, JobRecord, JobStatus, JOB_DOC_URLS,
    PROJECT_SUFFIX, GOOD_BOX_SIZES, TEMPLATES,
    SetupDataRequest,
)

# ═══════════════════════════════════════════
#  SYSTEM RESOURCES
# ═══════════════════════════════════════════

def _query_nvidia_smi_gpus() -> list[dict]:
    """Low-level nvidia-smi query shared by get_gpu_resources() and
    Runner._get_gpu_snapshot(). Returns raw per-GPU dicts (index, name,
    mem_used_mb, mem_free_mb, mem_total_mb, util_pct, driver), or an empty
    list if nvidia-smi is unavailable / returns no parseable rows."""
    import subprocess
    gpus = []
    try:
        r = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=index,name,memory.used,memory.free,memory.total,utilization.gpu,driver_version",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            for line in r.stdout.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 7:
                    try:
                        gpus.append({
                            "index": int(parts[0]),
                            "name": parts[1],
                            "mem_used_mb": int(parts[2]),
                            "mem_free_mb": int(parts[3]),
                            "mem_total_mb": int(parts[4]),
                            "util_pct": int(parts[5]) if parts[5].isdigit() else 0,
                            "driver": parts[6],
                        })
                    except (ValueError, IndexError):
                        pass
    except Exception:
        pass
    return gpus


def get_gpu_resources() -> list[dict]:
    """Poll live GPU status via nvidia-smi.
    Returns list of dicts with: index, name, mem_used_mb, mem_total_mb, utilization_pct, status
    """
    gpus = []
    for g in _query_nvidia_smi_gpus():
        mem_used, mem_total, util = g["mem_used_mb"], g["mem_total_mb"], g["util_pct"]
        pct_used = round(mem_used / mem_total * 100) if mem_total > 0 else 0
        if util > 60 or pct_used > 70:
            status = "busy"
        elif util > 0 or pct_used > 5:
            status = "active"
        else:
            status = "free"
        gpus.append({
            "index": g["index"],
            "name": g["name"],
            "mem_used_mb": mem_used,
            "mem_total_mb": mem_total,
            "mem_used_gb": round(mem_used / 1024, 1),
            "mem_total_gb": round(mem_total / 1024, 1),
            "utilization_pct": util,
            "status": status,
        })
    return gpus


def get_system_resources() -> dict:
    """Return CPU, RAM, and GPU utilization."""
    result: dict = {"gpus": get_gpu_resources(), "cpu_pct": 0, "ram_used_gb": 0,
                    "ram_total_gb": 0, "available": False}
    try:
        import psutil
        result["cpu_pct"] = round(psutil.cpu_percent(interval=0.1))
        vm = psutil.virtual_memory()
        result["ram_used_gb"] = round(vm.used / 1e9, 1)
        result["ram_total_gb"] = round(vm.total / 1e9, 1)
        result["available"] = True
    except ImportError:
        pass
    return result


# ═══════════════════════════════════════════
#  JOB DASHBOARD PARSER
# ═══════════════════════════════════════════

def _parse_dashboard_data(job: "JobRecord", project_dir: Path) -> dict:
    """Extract key metrics from job output for the dashboard card.
    Returns a dict of metrics appropriate for the job type.
    Falls back gracefully — never raises.
    """
    try:
        return _parse_dashboard_impl(job, project_dir)
    except Exception:
        return {}


def _parse_dashboard_impl(job: "JobRecord", project_dir: Path) -> dict:
    jt = job.job_type
    wdir = Path(job.working_dir) if job.working_dir else project_dir
    data: dict = {"job_type": jt}

    # ── Log-based metrics (available for all jobs) ──
    log_lines = job.read_log(project_dir)
    log_text = "\n".join(log_lines)

    # Duration
    if job.started_at and job.finished_at:
        try:
            from datetime import datetime as dt
            t0 = dt.fromisoformat(job.started_at)
            t1 = dt.fromisoformat(job.finished_at)
            secs = int((t1 - t0).total_seconds())
            data["duration_s"] = secs
            data["duration_str"] = f"{secs//60}m {secs%60}s" if secs >= 60 else f"{secs}s"
        except Exception:
            pass

    # ── WarpTools: Pre-Processing ──
    if jt in ("warp_ts_reconstruct", "warp_fs_motion_ctf"):
        # Count processed files from log
        n = len(re.findall(r"Processing|Processed|Done:", log_text, re.IGNORECASE))
        if n:
            data["processed"] = n
        # Look for tomostar or xml output count
        tomostar_dir = wdir / "tomostar"
        if tomostar_dir.exists():
            stars = list(tomostar_dir.glob("*.tomostar"))
            if stars:
                data["tomograms"] = len(stars)
                data["tomograms_label"] = "Tomos"

    if jt == "warp_ts_reconstruct":
        # Find reconstruction files
        rec_files = list(wdir.glob("**/*.mrc")) + list(wdir.glob("**/*.rec"))
        mrc_count = len([f for f in rec_files if f.stat().st_size > 1_000_000])
        if mrc_count:
            data["tomograms"] = mrc_count
            data["tomograms_label"] = "Tomos"

    if jt in ("warp_create_settings_fs", "warp_create_settings_ts"):
        settings_files = list(wdir.glob("*.settings"))
        if settings_files:
            data["settings_files"] = len(settings_files)

    # ── WarpTools CTF ──
    if jt == "warp_ts_ctf":
        m = re.search(r"(\d+)\s+(?:tilt.series|tomos?)", log_text, re.IGNORECASE)
        if m:
            data["tomograms"] = int(m.group(1))
            data["tomograms_label"] = "Tomos"

    # ── PyTom Template Matching ──
    if jt in ("tm_single", "tm_batch"):
        # Count output score/angle maps
        score_files = list(wdir.glob("**/*scores*.mrc")) + list(wdir.glob("**/*ScoreMap*.mrc"))
        if score_files:
            data["score_maps"] = len(score_files)
        # SNR from log
        snr_match = re.search(r"(?:max|peak|best)\s+(?:score|snr)[^\d]*([\d.]+)", log_text, re.IGNORECASE)
        if snr_match:
            data["max_score"] = float(snr_match.group(1))

    if jt in ("extract_single", "extract_batch"):
        # Count extracted particles from STAR files
        star_files = list(wdir.glob("**/*.star"))
        total_particles = 0
        for sf_path in star_files[:5]:  # check first 5 only
            try:
                text = sf_path.read_text()
                rows = len([l for l in text.splitlines() if l.strip() and not l.startswith("_") and not l.startswith("#")])
                total_particles += max(0, rows - 5)
            except Exception:
                pass
        if total_particles:
            data["particles"] = total_particles
            data["particles_label"] = "Particles"

    # ── WarpTools Export ──
    if jt in ("warp_export_particles", "pytom2warp_convert"):
        star_files = list(wdir.glob("**/*.star"))
        if star_files:
            data["star_files"] = len(star_files)

    # ── RELION ──
    if jt == "relion_class3d":
        classes_match = re.search(r"--K\s+(\d+)", job.command)
        if classes_match:
            data["classes"] = int(classes_match.group(1))
        iter_match = re.search(r"--iter\s+(\d+)", job.command)
        if iter_match:
            data["iterations"] = int(iter_match.group(1))
        # Find model star
        model_stars = list(wdir.glob("**/*model.star"))
        if model_stars:
            data["output_model"] = str(model_stars[-1].name)

    # ── AreTomo3 ──
    if jt == "aretomo3_batch":
        aligned = len(re.findall(r"(?:Done|Finished|Aligned|Completed).*\.mdoc", log_text, re.IGNORECASE))
        if aligned:
            data["aligned"] = aligned
            data["aligned_label"] = "MDOCs aligned"
        # Count .xf files produced
        xf_files = list(wdir.glob("**/*.xf"))
        if xf_files:
            data["xf_files"] = len(xf_files)
            data["aligned"] = len(xf_files)
            data["aligned_label"] = "Alignments"

    if jt == "aretomo3_collect":
        xf_files = list(wdir.glob("*.xf"))
        if xf_files:
            data["collected"] = len(xf_files)
            data["collected_label"] = "Files collected"

    # ── Import ──
    if jt == "link_reconstruction":
        linked = len(re.findall(r"Link|Linked", log_text, re.IGNORECASE))
        if linked:
            data["linked"] = linked
        # Count tomostar files
        ts_files = list(wdir.glob("**/*.tomostar"))
        if ts_files:
            data["tomostar"] = len(ts_files)
            data["tomostar_label"] = "Tomostar files"

    if jt == "copy_xmls":
        xml_count = len(re.findall(r"Copied|\.xml", log_text, re.IGNORECASE))
        if xml_count:
            data["xml_files"] = xml_count // 2  # rough estimate

    # ── Output files (all jobs) ──
    output_files = []
    if job.output_files:
        output_files = job.output_files[:8]
    else:
        # Auto-detect common output patterns in working dir
        for pattern in ["*.star", "*.tomostar", "*.log", "*.txt"]:
            found = list(wdir.glob(pattern))[:3]
            output_files.extend([str(f.name) for f in found])
        output_files = list(dict.fromkeys(output_files))[:6]  # dedupe, max 6

    data["output_files"] = output_files

    return data


# ═══════════════════════════════════════════
#  WORKSPACE
# ═══════════════════════════════════════════

_ws: Optional[WorkspaceConfig] = None

def get_ws() -> WorkspaceConfig:
    global _ws
    if _ws is None:
        _ws = WorkspaceConfig()
    return _ws

def set_workspace(path: Path):
    global _ws
    _ws = WorkspaceConfig(workspace_dir=path.resolve())


# ── Project registry — tracks projects created outside workspace_dir ──
# Module-level cache: folder_name -> absolute Path
# Populated by discover_projects(), used by resolve_project_dir()
_project_dir_cache: dict = {}


def _registry_path() -> Path:
    """~/cryostarbase_projects.json — persists across sessions."""
    return Path.home() / ".cryostar_base_projects.json"


def _load_registry() -> list[str]:
    """Return list of known project directory paths."""
    rp = _registry_path()
    if not rp.exists():
        return []
    try:
        import json
        data = json.loads(rp.read_text())
        return [p for p in data.get("projects", []) if Path(p).exists()]
    except Exception:
        return []


def _save_registry(paths: list[str]):
    import json
    rp = _registry_path()
    # Deduplicate, keep only existing paths
    seen = []
    for p in paths:
        if p not in seen and Path(p).exists():
            seen.append(p)
    rp.write_text(json.dumps({"projects": seen}, indent=2))


def _register_project(proj_dir: Path):
    """Add a project directory to the registry."""
    paths = _load_registry()
    s = str(proj_dir.resolve())
    if s not in paths:
        paths.append(s)
        _save_registry(paths)

# ═══════════════════════════════════════════
#  PROJECTS
# ═══════════════════════════════════════════

def _bootstrap_project_config(proj_dir: Path) -> None:
    """Create a minimal cryostarbase.json + notes.md for a project dir
    that has no config yet. Called when -d points directly to a *_base folder.
    Never overwrites an existing config."""
    config_file = proj_dir / "cryostarbase.json"
    if config_file.exists():
        return  # already exists — never overwrite
    proj_dir.mkdir(parents=True, exist_ok=True)
    clean_name = proj_dir.name.removesuffix(PROJECT_SUFFIX)
    now = datetime.now().isoformat(timespec="seconds")
    cfg = ProjectConfig(
        project_name=clean_name,
        project_dir=proj_dir,
        created_at=now,
    )
    cfg.save()
    notes_file = proj_dir / "notes.md"
    if not notes_file.exists():
        notes_file.write_text(
            f"# {clean_name} — Lab Notebook\n\n"
            f"**Created:** {now.split('T')[0]}\n\n---\n\n"
            f"## 📜 History\n\n**{now.split('T')[0]}** Project created (auto)\n\n---\n\n"
            f"## 📝 Notes\n\n*(Add your observations here...)*\n\n"
        )
    _register_project(proj_dir)
    print(f"[discover_projects] New project bootstrapped: {proj_dir.name}")


def discover_projects() -> list[dict]:
    ws = get_ws().workspace_dir

    # ── Collect workspace candidates ──────────────────────────────────────────
    # Scenario B: -d points directly to a *_base project folder itself
    if ws.name.endswith(PROJECT_SUFFIX) and not ws.name.startswith('._'):
        _bootstrap_project_config(ws)   # no-op if config already exists
        workspace_candidates = [ws]
        print(f"[discover_projects] Single-project mode: {ws.name}")
    else:
        # Scenario A: -d is a container folder — scan for *_base subdirs
        workspace_candidates = []
        try:
            workspace_candidates = [
                d for d in sorted(ws.iterdir())
                if d.is_dir() and d.name.endswith(PROJECT_SUFFIX)
                and not d.name.startswith('._')
            ]
        except PermissionError:
            pass

    # ── Registry candidates (other sessions) — clearly separated ──────────────
    registry_candidates = []
    ws_resolved = {str(d.resolve()) for d in workspace_candidates}
    for rp in _load_registry():
        p = Path(rp)
        if str(p.resolve()) not in ws_resolved \
                and p.is_dir() and p.name.endswith(PROJECT_SUFFIX) \
                and not p.name.startswith('._'):
            registry_candidates.append(p)

    # ── Build project list ─────────────────────────────────────────────────────
    projects = []
    seen: set = set()
    all_candidates = (
        [(d, "workspace") for d in workspace_candidates] +
        [(d, "registry")  for d in registry_candidates]
    )

    for d, source in all_candidates:
        key = str(d.resolve())
        if key in seen:
            continue
        seen.add(key)
        cfg = ProjectConfig.safe_load(d)
        if cfg is None:
            print(f"[discover_projects] Skipping corrupt project: {d.name}")
            continue
        state = _scan_state(d)
        jobs = list_jobs(d.name)
        projects.append({
            "name": cfg.project_name,
            "folder": d.name,
            "dir": str(d),
            "source": source,           # "workspace" | "registry"
            "bin_pixel_size": cfg.bin_pixel_size,
            "symmetry": cfg.symmetry,
            "diameter": cfg.particle_diameter,
            "box_size": cfg.box_size,
            "warptools_dir": cfg.warptools_dir,
            "tomo_dims": cfg.tomo_dims,
            "tomo_suffix": cfg.tomo_suffix,
            "n_jobs": len(jobs),
            "has_notes": (d / "notes.md").exists(),
            "state": state,
            "created": cfg.created_at,
        })

    # Populate the module-level cache for fast lookup
    global _project_dir_cache
    _project_dir_cache = {d.name: d for d, _ in all_candidates}

    # ── Shared preprocessing detection ────────────────────────────────────────
    wt_map: dict = {}
    for p in projects:
        wt = p.get("warptools_dir", "").strip()
        if wt:
            wt_map.setdefault(wt, []).append(p["folder"])

    for p in projects:
        wt = p.get("warptools_dir", "").strip()
        if wt and len(wt_map.get(wt, [])) > 1:
            p["shared_preprocessing_with"] = [
                f for f in wt_map[wt] if f != p["folder"]
            ]
        else:
            p["shared_preprocessing_with"] = []

    return projects


def _scan_state(d: Path) -> dict:
    s = {}
    # New _base structure
    s['has_recon']    = (d / '_pytom' / 'reconstruction').exists()
    s['n_xmls']       = len(list((d / '_pytom' / 'xml').glob('*.xml')))    if (d / '_pytom' / 'xml').exists()    else 0
    s['n_tlts']       = len(list((d / '_pytom' / 'xml').glob('*.tlt')))    if (d / '_pytom' / 'xml').exists()    else 0
    s['has_template'] = any((d / '_pytom' / 'template').glob('*.mrc'))     if (d / '_pytom' / 'template').exists() else False
    s['has_mask']     = any((d / '_pytom' / 'mask').glob('*.mrc'))         if (d / '_pytom' / 'mask').exists()   else False
    s['n_tomo_masks'] = len(list((d / '_pytom' / 'slabified').glob('*_mask.mrc'))) if (d / '_pytom' / 'slabified').exists() else 0
    # Raw data in _preprocessing (frames, mdocs)
    frames_dir = d / '_preprocessing' / 'warptools' / 'frames'
    if frames_dir.exists():
        tif = list(frames_dir.glob('*.tif')) + list(frames_dir.glob('*.tiff'))
        eer = list(frames_dir.glob('*.eer'))
        s['n_frames'] = len(tif) or len(eer)
        s['frame_type'] = 'tif' if tif else ('eer' if eer else 'none')
    else:
        s['n_frames'] = 0
        s['frame_type'] = 'none'
    skip = {'_pytom', '_sta', '_m', '_preprocessing', '_logs', '_exports', '__pycache__'}
    s['tm_dirs']   = [x.name for x in d.iterdir() if x.is_dir() and x.name not in skip and any(x.glob('*_job.json'))]
    s['star_files'] = [x.name for x in d.glob('*.star')]
    return s


def resolve_project_dir(folder: str) -> Path:
    """Find the actual directory for a project folder name.
    Checks cache first, then workspace, then registry, then scans."""
    import json as _json
    # 0. Check module-level cache (populated by discover_projects)
    #    Cache stores absolute paths — works for GVFS/SMB paths too
    if folder in _project_dir_cache:
        cached = _project_dir_cache[folder]
        if cached.exists():
            return cached
    ws = get_ws().workspace_dir
    # 1. Direct match in workspace (works when -d points to project parent)
    candidate = ws / folder
    if candidate.exists() and (candidate / "cryostarbase.json").exists():
        _project_dir_cache[folder] = candidate
        return candidate
    # 1b. Workspace IS the project dir (Scenario B: -d points to *_base folder)
    if ws.name == folder and (ws / "cryostarbase.json").exists():
        _project_dir_cache[folder] = ws
        return ws
    # 2. Search registry by folder name
    for rp in _load_registry():
        p = Path(rp)
        if p.name == folder and p.exists():
            return p
    # 3. Search ALL dirs in workspace for a cryostarbase.json with matching project_dir
    for d in _discover_candidates():
        if d.name == folder:
            _register_project(d)
            return d
    # 4. Read stored project_dir from cryostarbase.json if the JSON exists anywhere we know
    for search_base in [ws, ws.parent, Path.home() / "Desktop", Path.home()]:
        found = search_base / folder
        if found.exists():
            j = found / "cryostarbase.json"
            if j.exists():
                try:
                    stored = Path(_json.loads(j.read_text()).get("project_dir", ""))
                    if stored.exists():
                        _register_project(stored)
                        return stored
                except Exception:
                    pass
            _register_project(found)
            return found
    # 5. Fallback
    return candidate


def _discover_candidates() -> list:
    """Return all project directories known to the app."""
    ws = get_ws().workspace_dir
    found = []
    try:
        found += [d for d in ws.iterdir()
                  if d.is_dir() and d.name.endswith(PROJECT_SUFFIX)]
    except PermissionError:
        pass
    for rp in _load_registry():
        p = Path(rp)
        if p not in found and p.is_dir():
            found.append(p)
    return found


def create_project(
    target_name: str,
    warptools_dir: str = "",
    tomo_name: str = "",
    investigators: list = None,       # type: ignore[assignment]
    processing_dir: str = "",
    preprocessing_name: str = "",     # Scenario B: name of new preprocessing root folder
    preprocessing_path: str = "",     # Scenario B: parent path for new preprocessing root
) -> dict:
    ws = get_ws().workspace_dir
    clean = target_name.strip().replace(" ", "_")
    folder = f"{clean}{PROJECT_SUFFIX}"

    # Where to create the project folder
    if processing_dir and processing_dir.strip():
        base = Path(processing_dir.strip()).expanduser().resolve()
    else:
        base = ws
    proj = base / folder

    if proj.exists():
        return {"status": "error", "msg": f"Already exists: {proj}"}

    # ── Resolve warptools_dir ──────────────────────────────────
    # Scenario A: warptools_dir given use directly, nothing to create
    # Scenario B: warptools_dir empty create preprocessing root with warptools/ + aretomo3/
    resolved_warptools_dir = warptools_dir.strip()

    if not resolved_warptools_dir:
        # Scenario B
        if preprocessing_name.strip():
            preproc_name = preprocessing_name.strip().replace(" ", "_")
            preproc_parent = Path(preprocessing_path.strip()).expanduser().resolve() \
                if preprocessing_path.strip() else base
            preproc_root = preproc_parent / preproc_name
            preproc_root.mkdir(parents=True, exist_ok=True)
            # warptools/ subtree — frames/ and mdocs/ are created manually by the user
            wt = preproc_root / "warptools"
            wt.mkdir(exist_ok=True)
            (wt / "warp_tiltseries").mkdir(exist_ok=True)
            (wt / "warp_tiltseries" / "xml").mkdir(exist_ok=True)
            (wt / "warp_tiltseries" / "reconstruction").mkdir(exist_ok=True)
            # aretomo3/ subtree
            at = preproc_root / "aretomo3"
            at.mkdir(exist_ok=True)
            (at / "alignments").mkdir(exist_ok=True)
            resolved_warptools_dir = str(wt)

    # ── Create project folder structure ───────────────────────
    proj.mkdir(parents=True)

    # _pytom/ — xml/ is a real folder (copy destination), reconstruction is a symlink placeholder
    (proj / "_pytom" / "xml").mkdir(parents=True)
    (proj / "_pytom" / "slabified").mkdir(parents=True)
    (proj / "_pytom" / "template").mkdir(parents=True)
    (proj / "_pytom" / "mask").mkdir(parents=True)
    (proj / "_pytom" / "results").mkdir(parents=True)

    # Create reconstruction symlink immediately if warptools_dir is known
    if resolved_warptools_dir:
        rec_source = Path(resolved_warptools_dir) / "warp_tiltseries" / "reconstruction"
        rec_link = proj / "_pytom" / "reconstruction"
        if rec_source.exists():
            try:
                rec_link.symlink_to(rec_source)
            except Exception:
                pass  # symlink already exists or permission error — not fatal

    # _sta/ — bin subdirs created by WarpTools export jobs
    (proj / "_sta").mkdir()

    # _m/ — M refinement
    (proj / "_m" / "population").mkdir(parents=True)
    (proj / "_m" / "species").mkdir(parents=True)

    # housekeeping
    (proj / "_logs").mkdir()
    (proj / "_exports").mkdir()
    (proj / "cryostarbase" / "jobs").mkdir(parents=True)
    (proj / "cryostarbase" / "workflows").mkdir(parents=True)

    # ── Save config ───────────────────────────────────────────
    now = datetime.now().isoformat(timespec="seconds")
    cfg = ProjectConfig(
        project_name=clean,
        project_dir=proj,
        created_at=now,
        warptools_dir=resolved_warptools_dir,
        tomo_name=tomo_name,
        investigators=investigators or [],
    )
    cfg.save()

    # ── Lab Notebook ──────────────────────────────────────────
    inv_str = ", ".join(investigators) if investigators else "—"
    warp_display = resolved_warptools_dir or "— not set"
    note = (
        f"# {clean} — Lab Notebook\n\n"
        f"## 🔬 Experiment Overview\n\n"
        f"**Created:** {now.split('T')[0]}  \n"
        f"**Sample:** {tomo_name or '*(auto-detect)*'}  \n"
        f"**Microscope:** *(not set)*  \n"
        f"**Tomogram:** *(not set)*  \n"
        f"**Preprocessing:** {warp_display}  \n"
        f"**Investigators:** {inv_str}\n\n"
        f"---\n\n"
        f"## 📜 History\n\n"
        f"**{now.split('T')[0]}** Project created\n\n"
        f"---\n\n"
        f"## 📝 Notes\n\n"
        f"*(Add your observations here...)*\n\n"
    )
    (proj / "notes.md").write_text(note)

    _register_project(proj)

    return {
        "status": "ok",
        "folder": folder,
        "dir": str(proj),
        "warptools_dir": resolved_warptools_dir,
        "needs_setup": True,
    }


def setup_project_data(
    folder: str,
    x_dim: int, y_dim: int, z_dim: int | None,
    raw_pixel_size: float,
    binning_factor: float,
) -> dict:
    """Step 2: store tomo dims + compute actual pixel size."""
    ws = get_ws().workspace_dir
    cfg = ProjectConfig.load(ws / folder)
    
    # Track changes for history
    old_dims = cfg.tomo_dims.copy() if cfg.tomo_dims else []
    old_binning = cfg.binning_factor
    old_raw_px = cfg.raw_pixel_size
    
    # Update config
    cfg.tomo_dims = [x_dim, y_dim, z_dim if (z_dim is not None and z_dim != 0) else 1000]
    cfg.raw_pixel_size = raw_pixel_size
    cfg.binning_factor = binning_factor
    cfg.bin_pixel_size = round(raw_pixel_size * binning_factor, 4)
    cfg.tomo_suffix = f"_{cfg.bin_pixel_size}Apx"
    cfg.save(ws / folder)
    
    # Update notebook overview
    _update_notebook_overview(folder, cfg)
    
    # Add history entries for changes
    if old_dims != cfg.tomo_dims:
        old_str = "×".join(str(d) if d else "?" for d in old_dims) if old_dims else "not set"
        new_str = "×".join(str(d) if d else "?" for d in cfg.tomo_dims)
        _add_history_entry(folder, f"Dimensions: {old_str} → {new_str} vox")
    if old_binning != binning_factor:
        _add_history_entry(folder, f"Binning: {old_binning or 'not set'} → {binning_factor}×")
    if old_raw_px != raw_pixel_size:
        _add_history_entry(folder, f"Raw pixel size: {old_raw_px or 'not set'} → {raw_pixel_size} Å/px")
    
    return {
        "status": "ok",
        "bin_pixel_size": cfg.bin_pixel_size,
        "tomo_dims": cfg.tomo_dims,
        "tomo_suffix": cfg.tomo_suffix,
    }


def get_project_config(folder: str) -> dict:
    d = resolve_project_dir(folder)
    if not d.exists():
        return {"error": f"Not found: {folder}"}
    cfg = ProjectConfig.load(d)
    # Auto-detect warptools_dir if empty but standard path exists
    if not cfg.warptools_dir:
        proj_parent = d.parent
        proj_stem = d.name.replace("_base", "")
        candidates = [
            proj_parent / f"{proj_stem}_preprocessing" / "warptools",
            proj_parent / "preprocessing" / "warptools",
            d / "_preprocessing" / "warptools",
        ]
        for candidate in candidates:
            if candidate.exists() and candidate.is_dir():
                cfg.warptools_dir = str(candidate)
                cfg.save(d)
                break
    return cfg.model_dump(mode="json")


def update_project_config(folder: str, updates: dict) -> dict:
    print(f"[update_project_config] START - folder: {folder}")
    print(f"[update_project_config] Updates received: {updates}")
    
    project_dir = resolve_project_dir(folder)
    cfg = ProjectConfig.load(project_dir)
    print(f"[update_project_config] Config loaded - voltage: {cfg.voltage}, magnification: {cfg.magnification}")

    # Track what changed for history
    old_warp_dir    = cfg.warptools_dir
    old_prepro_tool = cfg.preprocessing_tool
    old_dims        = list(cfg.tomo_dims) if cfg.tomo_dims else []
    old_raw_px      = cfg.raw_pixel_size
    old_bin         = cfg.binning_factor

    # Tilt/angle fields — don't overwrite existing non-zero values with 0
    # (happens when saveTomo is triggered before UI fields are populated)
    # Never overwrite an existing non-zero numeric value with 0 or None
    for k, v in updates.items():
        if hasattr(cfg, k):
            existing = getattr(cfg, k, None)
            if (v == 0 or v is None) and isinstance(existing, (int, float)) and existing != 0:
                print(f"[update_project_config] PROTECTED {k} = {existing} (not overwriting with {v})")
                continue
            # Protect tomo_dims[2] (z) — NEVER overwrite with 0 or null
            # Z is user-set only, MDOC never provides it
            if k == 'tomo_dims' and isinstance(v, list):
                existing = getattr(cfg, 'tomo_dims', None) or []
                existing_z = existing[2] if len(existing) > 2 else 0
                new_z = v[2] if len(v) > 2 else None
                if (new_z is None or new_z == 0) and existing_z and existing_z > 0:
                    v = [v[0], v[1], existing_z]
                    print(f"[update_project_config] PROTECTED tomo_dims z={existing_z} (not overwriting with {new_z})")
                elif len(v) == 2 and existing_z and existing_z > 0:
                    v = [v[0], v[1], existing_z]  # MDOC sent only x,y — keep existing z
                    print(f"[update_project_config] PROTECTED tomo_dims z={existing_z} (MDOC sent no z)")
            print(f"[update_project_config] Setting {k} = {v}")
            setattr(cfg, k, v)
        else:
            print(f"[update_project_config] ⚠️  SKIPPED {k} - attribute not found on ProjectConfig!")

    # ── Auto-compute derived fields ──
    # pixel_size = raw × bin
    if cfg.raw_pixel_size and cfg.binning_factor:
        cfg.bin_pixel_size = round(cfg.raw_pixel_size * cfg.binning_factor, 4)
        cfg.tomo_suffix = f"_{cfg.bin_pixel_size}Apx"

    # warp_m_grid from frames_per_tilt if not explicitly provided
    if 'frames_per_tilt' in updates and cfg.frames_per_tilt > 0:
        if 'warp_m_grid' not in updates:
            cfg.warp_m_grid = f"1x1x{cfg.frames_per_tilt}"

    # warp_tilt_exposure = dose_per_tilt
    if 'dose_per_tilt' in updates and cfg.dose_per_tilt > 0:
        if 'warp_tilt_exposure' not in updates:
            cfg.warp_tilt_exposure = cfg.dose_per_tilt

    # dose_per_tilt from total_dose / n_tilts (only if dose_per_tilt not explicitly provided)
    if ('total_dose' in updates or 'n_tilts' in updates) and 'dose_per_tilt' not in updates:
        if cfg.total_dose > 0 and cfg.n_tilts > 0:
            cfg.dose_per_tilt = round(cfg.total_dose / cfg.n_tilts, 4)
            cfg.warp_tilt_exposure = cfg.dose_per_tilt

    cfg.save(project_dir)
    print(f"[update_project_config] ✓ Config saved - voltage: {cfg.voltage}, magnification: {cfg.magnification}, tomo_dims: {cfg.tomo_dims}")

    # Update notebook overview
    _update_notebook_overview(folder, cfg)

    # Add history entries for relevant changes
    if 'warptools_dir' in updates and old_warp_dir != cfg.warptools_dir:
        _add_history_entry(folder, f"Preprocessing directory set: `{cfg.warptools_dir}`")
    if 'preprocessing_tool' in updates and old_prepro_tool != cfg.preprocessing_tool:
        _add_history_entry(folder, f"Preprocessing tool: {old_prepro_tool} → {cfg.preprocessing_tool}")
    if 'tomo_dims' in updates and old_dims != cfg.tomo_dims:
        new_str = "x".join(str(d) if d else "?" for d in cfg.tomo_dims)
        _add_history_entry(folder, f"Dimensions: {new_str} vox")
    if 'raw_pixel_size' in updates and old_raw_px != cfg.raw_pixel_size and cfg.raw_pixel_size:
        _add_history_entry(folder, f"Raw pixel size: {cfg.raw_pixel_size} Å/px")
    if 'binning_factor' in updates and old_bin != cfg.binning_factor and cfg.binning_factor:
        _add_history_entry(folder, f"Binning: {cfg.binning_factor}×")

    return {"status": "ok", "bin_pixel_size": cfg.bin_pixel_size, "tomo_dims": cfg.tomo_dims}


def _detect_dims(recon_dir: Path) -> list[int]:
    mrcs = sorted(recon_dir.glob("*.mrc"))
    if mrcs:
        dims, _voxel = _read_mrc_header(mrcs[0])
        if dims:
            return dims
    return [512, 720, 250]


# ═══════════════════════════════════════════
#  JOBS
# ═══════════════════════════════════════════

def create_job(project_folder: str, job_type: str, title: str,
               command: str, parameters: dict = None, notes: str = "",  # type: ignore[assignment]
               tags: list = None, parent_jobs: list = None) -> JobRecord:  # type: ignore[assignment]
    proj = resolve_project_dir(project_folder)
    cfg = ProjectConfig.load(proj)
    jid = cfg.allocate_job_id()
    now = datetime.now().isoformat(timespec="seconds")
    job = JobRecord(
        job_id=jid, job_type=job_type, title=title or f"{job_type} ({jid})",
        command=command, parameters=parameters or {},
        working_dir=str(proj), status="queued", created_at=now, notes=notes,
        tags=tags or [],
        parent_jobs=parent_jobs or [],
        doc_url=JOB_DOC_URLS.get(job_type, ""),
    )
    job.save(proj)
    _jcat = {
        "import":"IMPORT", "pytom":"PYTOM", "warp_export":"WARP M",
        "warp_preproc":"PREPROC", "aretomo3":"ARETOMO", "relion":"RELION",
        "mtools":"MTOOLS", "convert":"CONVERT", "other":"OTHER",
        "missalign":"MISSALIGN",
    }
    from cryostarbase.models import TEMPLATES as _T
    _jc = next((t.get("category","other") for t in _T if t.get("id")==job_type),"other")
    _note_body = "Command:\n```\n" + command + "\n```"
    _auto_note(project_folder,
        f"**[{_jcat.get(_jc, job_type.upper()[:8])}] {jid} — {job.title}**",
        _note_body)
    return job


def update_job(project_folder: str, job_id: str, **updates) -> dict:
    proj = resolve_project_dir(project_folder)
    job = JobRecord.load(proj, job_id)
    if not job:
        return {"error": "not found"}
    for k, v in updates.items():
        if hasattr(job, k):
            setattr(job, k, v)
    job.save(proj)
    return {"status": "ok"}


def list_jobs(project_folder: str) -> list[dict]:
    d = resolve_project_dir(project_folder) / "cryostarbase" / "jobs"
    if not d.exists():
        return []
    jobs = []
    for f in sorted(d.glob("J*.json")):
        try:
            jobs.append(JobRecord.model_validate_json(f.read_text()).model_dump())
        except Exception:
            continue
    return jobs


def get_job(project_folder: str, job_id: str) -> Optional[dict]:
    ws = get_ws().workspace_dir
    j = JobRecord.load(ws / project_folder, job_id)
    return j.model_dump() if j else None


def add_job_note(project_folder: str, job_id: str, text: str) -> dict:
    ws = get_ws().workspace_dir
    j = JobRecord.load(ws / project_folder, job_id)
    if not j:
        return {"error": "not found"}
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    j.notes = (j.notes + f"\n[{now}] {text}") if j.notes else f"[{now}] {text}"
    j.save(ws / project_folder)
    return {"status": "ok"}


# ═══════════════════════════════════════════
#  NOTES
# ═══════════════════════════════════════════

def read_notes(project_folder: str) -> dict:
    p = resolve_project_dir(project_folder) / "notes.md"
    return {"content": p.read_text() if p.exists() else "", "exists": p.exists()}


def append_note(project_folder: str, text: str) -> dict:
    p = resolve_project_dir(project_folder) / "notes.md"
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    entry = f"\n### {now}\n\n{text.strip()}\n\n---\n\n"
    if p.exists():
        current = p.read_text()
        # Ensure file has History section for existing projects
        if "## 📜 History" not in current:
            current = current.rstrip() + "\n\n---\n\n## 📜 History\n\n"
    else:
        current = (
            f"# {project_folder}\n\n"
            f"*Auto-created notebook*\n\n"
            f"---\n\n"
            f"## 📜 History\n\n"
        )
    p.write_text(current + entry)
    return {"status": "ok", "timestamp": now}


def _auto_note(folder: str, action: str, detail: str = ""):
    try:
        append_note(folder, action + (f"\n\n{detail}" if detail else ""))
    except Exception:
        pass


def _update_notebook_overview(folder: str, config: ProjectConfig) -> None:
    """Update the Experiment Overview section with current config"""
    proj = resolve_project_dir(folder)
    notes_file = proj / "notes.md"
    if not notes_file.exists():
        return
    
    content = notes_file.read_text()
    
    # Find overview section
    start_marker = "## 🔬 Experiment Overview"
    end_marker = "---\n\n## 📜 History"
    
    if start_marker not in content or end_marker not in content:
        return
    
    # Build microscope line
    parts = []
    if config.voltage:
        parts.append(f"{config.voltage} kV")
    if config.spherical_aberration:
        parts.append(f"Cs {config.spherical_aberration}mm")
    if config.amplitude_contrast:
        parts.append(f"AC {config.amplitude_contrast}")
    microscope_str = ", ".join(parts) if parts else "*(not set)*"
    
    # Build tomogram line
    tomo_parts = []
    if config.tomo_dims and len(config.tomo_dims) >= 2:
        dims_str = "×".join(str(d) if d else "?" for d in config.tomo_dims) + " vox"
        tomo_parts.append(dims_str)
    if config.raw_pixel_size:
        tomo_parts.append(f"@ {config.raw_pixel_size} Å/px (raw)")
    if config.bin_pixel_size and config.binning_factor:
        tomo_parts.append(f"→ {config.bin_pixel_size} Å/px (bin {config.binning_factor}×)")
    tomogram_str = " ".join(tomo_parts) if tomo_parts else "*(not set)*"
    
    # Build preprocessing line
    prepro_parts = []
    if config.preprocessing_tool:
        prepro_parts.append(config.preprocessing_tool.capitalize())
    if config.warptools_dir:
        prepro_parts.append(f"@ `{config.warptools_dir}`")
    preprocessing_str = " ".join(prepro_parts) if prepro_parts else "*(not set)*"
    
    # Investigators
    inv_str = ", ".join(config.investigators) if config.investigators else "—"
    
    # Get created date from existing content
    created_match = content.split("**Created:**")[1].split("\n")[0].strip() if "**Created:**" in content else "*(unknown)*"
    
    # Sample name
    sample_str = config.tomo_name if config.tomo_name else "*(auto-detect)*"
    
    new_overview = (
        f"## 🔬 Experiment Overview\n\n"
        f"**Created:** {created_match}  \n"
        f"**Sample:** {sample_str}  \n"
        f"**Microscope:** {microscope_str}  \n"
        f"**Tomogram:** {tomogram_str}  \n"
        f"**Preprocessing:** {preprocessing_str}  \n"
        f"**Investigators:** {inv_str}\n\n"
    )
    
    # Replace overview section
    start_idx = content.index(start_marker)
    end_idx = content.index(end_marker)
    new_content = content[:start_idx] + new_overview + "---\n\n" + content[end_idx:]
    notes_file.write_text(new_content)


def _add_history_entry(folder: str, entry: str) -> None:
    """Add an entry to the History section"""
    proj = resolve_project_dir(folder)
    notes_file = proj / "notes.md"
    if not notes_file.exists():
        return
    
    content = notes_file.read_text()
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    
    # Find history section
    history_marker = "## 📜 History\n\n"
    if history_marker not in content:
        return
    
    # Insert at beginning of history
    history_idx = content.index(history_marker) + len(history_marker)
    new_entry = f"**{date_str}** {entry}\n"
    new_content = content[:history_idx] + new_entry + content[history_idx:]
    notes_file.write_text(new_content)


def _add_user_note(folder: str, note_text: str) -> None:
    """Add a timestamped note to the Notes section"""
    proj = resolve_project_dir(folder)
    notes_file = proj / "notes.md"
    if not notes_file.exists():
        return
    
    content = notes_file.read_text()
    now = datetime.now().isoformat(timespec="seconds")
    
    # Find notes section
    notes_marker = "## 📝 Notes\n"
    if notes_marker not in content:
        return
    
    # Check if placeholder exists
    placeholder = "*(Add your observations here...)*"
    if placeholder in content:
        # Replace placeholder
        content = content.replace(placeholder, f"**{now}**\n{note_text}\n")
    else:
        # Append to end
        content += f"\n**{now}**\n{note_text}\n"
    
    notes_file.write_text(content)


# ═══════════════════════════════════════════
#  FILES
# ═══════════════════════════════════════════

class SecurityError(Exception):
    pass


def _safe(path: str | Path) -> Path:
    ws = get_ws().workspace_dir.resolve()
    p = Path(path)
    # Accept both relative paths (joined with ws) and absolute paths within ws
    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (ws / p).resolve()
    if resolved != ws and not resolved.is_relative_to(ws):
        raise SecurityError(f"Denied: {resolved}")
    return resolved


def ls(path: str = ".") -> dict:
    p = _safe(path)
    if not p.is_dir():
        raise FileNotFoundError(f"Not a dir: {p}")
    ws = get_ws().workspace_dir.resolve()
    items = []
    for e in sorted(p.iterdir()):
        # Skip Apple Double files (._filename) created by macOS
        if e.name.startswith('._'):
            continue
        try:
            st = e.stat()
            # Use absolute path — relative_to() fails on GVFS/SMB mounts
            # where .resolve() may change the path prefix
            try:
                rel = str(e.relative_to(ws))
            except ValueError:
                rel = str(e)   # fallback: absolute path
            items.append({
                "name": e.name,
                "path": rel,
                "abs": str(e),
                "is_dir": e.is_dir(),
                "size": st.st_size if e.is_file() else None,
                "ext": e.suffix.lower() if e.is_file() else None,
                "is_link": e.is_symlink(),
            })
        except (PermissionError, OSError):
            continue
    try:
        cur_rel = str(p.relative_to(ws))
        parent_rel = str(p.parent.relative_to(ws)) if p != ws else None
    except ValueError:
        cur_rel = str(p)
        parent_rel = str(p.parent) if p != ws else None
    return {
        "path": cur_rel,
        "abs": str(p),
        "parent": parent_rel,
        "items": items,
    }


def read_file(path: str) -> dict:
    a = get_ws()
    p = _safe(path)
    if not p.is_file():
        raise FileNotFoundError(str(p))
    size = p.stat().st_size
    ext = p.suffix.lower()
    if ext not in a.allowed_extensions:
        return {"path": p.name, "type": "blocked", "size": size}
    if size > a.max_read_bytes:
        return {"path": p.name, "type": "too_large", "size": size}
    try:
        return {"path": p.name, "type": "text", "ext": ext,
                "content": p.read_text(errors="replace"), "size": size}
    except UnicodeDecodeError:
        return {"path": p.name, "type": "binary", "size": size}


# ═══════════════════════════════════════════
#  STAR PARSER
# ═══════════════════════════════════════════

class StarBlock:
    def __init__(self):
        self.is_loop = False
        self.columns: list[str] = []
        self.rows: list[list[str]] = []
        self.kv: dict[str, str] = {}

    @classmethod
    def parse(cls, text):
        b = cls()
        lines = text.strip().split("\n")
        i = 0
        while i < len(lines):
            s = lines[i].strip()
            if s.startswith("data_") or s == "":
                i += 1; continue
            break
        if i < len(lines) and lines[i].strip() == "loop_":
            b.is_loop = True; i += 1
            while i < len(lines):
                s = lines[i].strip()
                if s.startswith("_"):
                    b.columns.append(s.split()[0]); i += 1
                else:
                    break
            while i < len(lines):
                s = lines[i].strip()
                if s == "" or s.startswith("data_"):
                    break
                parts = s.split()
                if len(parts) == len(b.columns):
                    b.rows.append(parts)
                i += 1
        else:
            while i < len(lines):
                s = lines[i].strip()
                if s == "" or s.startswith("data_"):
                    break
                if s.startswith("_"):
                    parts = s.split(None, 1)
                    b.kv[parts[0]] = parts[1] if len(parts) > 1 else ""
                i += 1
        return b

    def col(self, name):
        return [r[self.columns.index(name)] for r in self.rows]

    def col_stats(self, name):
        vals = self.col(name)
        try:
            nums = [float(v) for v in vals]
            return {"column": name, "type": "numeric", "count": len(nums),
                    "min": min(nums), "max": max(nums), "mean": sum(nums)/len(nums)}
        except ValueError:
            u = set(vals)
            return {"column": name, "type": "text", "count": len(vals),
                    "unique": len(u), "examples": list(u)[:10]}

    def summary(self):
        if self.is_loop:
            return {"type": "loop", "columns": self.columns, "n_rows": len(self.rows)}
        return {"type": "kv", "keys": list(self.kv.keys())}


class StarFile:
    def __init__(self):
        self.blocks: dict[str, StarBlock] = {}

    @classmethod
    def read(cls, path):
        sf = cls()
        text = Path(path).read_text()
        splits = [(m.start(), m.group(1)) for m in re.finditer(r"^(data_\S*)", text, re.MULTILINE)]
        if not splits:
            sf.blocks["data_"] = StarBlock.parse(text)
            return sf
        for i, (start, name) in enumerate(splits):
            end = splits[i+1][0] if i+1 < len(splits) else len(text)
            sf.blocks[name] = StarBlock.parse(text[start:end])
        return sf

    def block(self, name=None):
        if name:
            return self.blocks.get(name)
        return next(iter(self.blocks.values()), None)

    def summary(self):
        return {n: b.summary() for n, b in self.blocks.items()}


def star_columns(path, block_name=None):
    p = _safe(path)
    sf = StarFile.read(p)
    blk = sf.block(block_name)
    if not blk or not blk.is_loop:
        return {"error": "No loop"}
    return {"columns": [blk.col_stats(c) for c in blk.columns], "n_rows": len(blk.rows)}


# ═══════════════════════════════════════════
#  WORKFLOWS
# ═══════════════════════════════════════════

def _wf_dir(project_folder: str) -> Path:
    return get_ws().workspace_dir / project_folder / "cryostarbase" / "workflows"


def list_workflows(project_folder: str) -> list[dict]:
    d = _wf_dir(project_folder)
    if not d.exists():
        return []
    result = []
    for f in sorted(d.glob("WF*.json")):
        try:
            from cryostarbase.models import WorkflowRecord
            result.append(WorkflowRecord.model_validate_json(f.read_text()).model_dump())
        except Exception:
            continue
    return result


def get_workflow(project_folder: str, workflow_id: str) -> Optional[dict]:
    from cryostarbase.models import WorkflowRecord
    proj = get_ws().workspace_dir / project_folder
    wf = WorkflowRecord.load(proj, workflow_id)
    return wf.model_dump() if wf else None


def create_workflow(project_folder: str, name: str, description: str,
                    steps: list[dict]) -> dict:
    from cryostarbase.models import WorkflowRecord, WorkflowStep
    proj = get_ws().workspace_dir / project_folder
    # Allocate ID
    d = proj / "cryostarbase" / "workflows"
    d.mkdir(parents=True, exist_ok=True)
    existing = sorted(d.glob("WF*.json"))
    num = len(existing) + 1
    wid = f"WF{num:03d}"
    now = datetime.now().isoformat(timespec="seconds")
    wf = WorkflowRecord(
        workflow_id=wid,
        name=name,
        description=description,
        steps=[WorkflowStep(**s) for s in steps],
        created_at=now,
    )
    wf.save(proj)
    _auto_note(project_folder, f"**{wid}** workflow created: {name}")
    return wf.model_dump()


def update_workflow(project_folder: str, workflow_id: str, updates: dict) -> dict:
    from cryostarbase.models import WorkflowRecord, WorkflowStep
    proj = get_ws().workspace_dir / project_folder
    wf = WorkflowRecord.load(proj, workflow_id)
    if not wf:
        return {"error": "not found"}
    if "name" in updates:
        wf.name = updates["name"]
    if "description" in updates:
        wf.description = updates["description"]
    if "steps" in updates:
        wf.steps = [WorkflowStep(**s) for s in updates["steps"]]
    wf.save(proj)
    return {"status": "ok"}


def delete_workflow(project_folder: str, workflow_id: str) -> dict:
    proj = get_ws().workspace_dir / project_folder
    p = proj / "cryostarbase" / "workflows" / f"{workflow_id}.json"
    if p.exists():
        p.unlink()
        return {"status": "ok"}
    return {"error": "not found"}


async def run_workflow(project_folder: str, workflow_id: str,
                       param_overrides: Optional[dict] = None) -> dict:
    """Run a workflow sequentially — each step waits for the previous to complete."""
    from cryostarbase.models import WorkflowRecord, TEMPLATES
    proj = get_ws().workspace_dir / project_folder
    wf = WorkflowRecord.load(proj, workflow_id)
    if not wf:
        return {"error": "Workflow not found"}

    now = datetime.now().isoformat(timespec="seconds")
    wf.last_run_at = now
    wf.last_run_status = "running"
    wf.last_run_job_ids = []
    wf.save(proj)

    overrides = param_overrides or {}
    completed_jobs = []  # list of (step_num, job_id, status)

    for step in wf.steps:
        for job_type in step.job_types:
            # Merge step params with overrides
            params = {**step.parameters, **overrides.get(job_type, {})}
            # Build command
            try:
                cmd = build_command(job_type, params, project_folder)
            except Exception as e:
                wf.last_run_status = "failed"
                wf.save(proj)
                return {"error": f"Step {step.step_num} ({job_type}): {e}",
                        "completed": completed_jobs}

            # Create job record
            jr = create_job(project_folder, job_type,
                            f"{step.label} — {job_type}", cmd, params)
            wf.last_run_job_ids.append(jr.job_id)
            wf.save(proj)

            # Run and wait — WarpTools jobs must run from warptools_dir
            cfg_for_wf = ProjectConfig.load(proj) if hasattr(ProjectConfig, 'load') else None
            if cfg_for_wf is None:
                try:
                    import json as _j
                    _cfg_path = proj / "cryostarbase.json"
                    cfg_for_wf = _j.loads(_cfg_path.read_text()) if _cfg_path.exists() else {}
                except Exception:
                    cfg_for_wf = {}
            _wt_dir = (cfg_for_wf.get("warptools_dir","") if isinstance(cfg_for_wf,dict)
                       else getattr(cfg_for_wf,"warptools_dir","")) or ""
            _is_warp_job = job_type.startswith("warp_")
            _is_import_job = (TEMPLATES.get(job_type, {}).get("category") == "import"
                               if hasattr(TEMPLATES, "get") else False)
            _is_at3_job = (TEMPLATES.get(job_type, {}).get("category") == "aretomo3"
                            if hasattr(TEMPLATES, "get") else False)
            # Derive preprocessing_root from warptools_dir
            _preproc_root = str(Path(_wt_dir).parent) if _wt_dir else ""
            if _is_warp_job and _wt_dir:
                _cwd = str(_wt_dir)
            elif _is_import_job and _preproc_root:
                _cwd = _preproc_root
            else:
                _cwd = str(proj)  # aretomo3 jobs use absolute paths, project_dir is fine
            rj = await runner.run(cmd, cwd=_cwd,
                                  project=project_folder, job_id=jr.job_id)
            completed_jobs.append({
                "step": step.step_num, "job_type": job_type,
                "job_id": jr.job_id, "status": rj.status.value,
                "exit_code": rj.exit_code,
            })

            # Stop on failure if configured
            if step.wait_for_exit_zero and rj.exit_code != 0:
                wf.last_run_status = "failed"
                wf.save(proj)
                _auto_note(project_folder,
                    f"**{workflow_id}** workflow FAILED at step {step.step_num} "
                    f"({job_type}, exit {rj.exit_code})")
                return {"status": "failed", "failed_at": job_type,
                        "completed": completed_jobs}

    wf.last_run_status = "completed"
    wf.save(proj)
    _auto_note(project_folder,
        f"**{workflow_id}** workflow completed — "
        f"{len(wf.last_run_job_ids)} jobs ran successfully")
    return {"status": "completed", "completed": completed_jobs}


# ═══════════════════════════════════════════
#  RELION HELPERS
# ═══════════════════════════════════════════

import math as _math

def crowther_healpix_order(pixel_size: float, diameter_angstrom: float) -> dict:
    """Calculate minimum healpix order (angular sampling) from Crowther criterion.
    delta_theta = arcsin(pixel_size / diameter_px) * (180/pi)
    Returns order, angle_deg, nyquist_angstrom.
    """
    if not pixel_size or not diameter_angstrom:
        return {"order": 5, "angle_deg": 3.7, "nyquist": None}
    diameter_px = diameter_angstrom / pixel_size
    nyquist = 2.0 * pixel_size
    delta_theta_rad = _math.asin(1.0 / diameter_px) if diameter_px > 1 else _math.pi / 2
    delta_theta_deg = _math.degrees(delta_theta_rad)
    # healpix orders: 1=30°, 2=15°, 3=7.5°, 4=3.75°, 5=1.875° pick smallest order >= delta_theta
    healpix_angles = {1: 30.0, 2: 15.0, 3: 7.5, 4: 3.75, 5: 1.875, 6: 0.9375, 7: 0.47}
    order = 7
    for o in sorted(healpix_angles.keys()):
        if healpix_angles[o] >= delta_theta_deg:
            order = o
            break
    return {
        "order": order,
        "angle_deg": round(healpix_angles[order], 4),
        "crowther_deg": round(delta_theta_deg, 3),
        "nyquist": round(nyquist, 3),
    }


def analyze_star_file(path: str) -> dict:
    """Read a RELION STAR file and return particle count, detected type (2D/3D STA),
    and suggested K = round(sqrt(N/200)).
    2D STAR: has particles block with rlnImageName pointing to .mrcs stacks,
             no rlnTomoName.
    3D STA STAR: has rlnTomoName or rlnCtfImage columns.
    """
    p = _safe(path)
    if not p.exists():
        return {"error": f"File not found: {p}"}
    try:
        sf = StarFile.read(p)
    except Exception as e:
        return {"error": f"Could not parse STAR: {e}"}
    # Find particles block
    blk = None
    for name in ["particles", "data_particles", "data_"]:
        blk = sf.blocks.get(name)
        if blk and blk.is_loop and blk.rows:
            break
    if not blk or not blk.is_loop:
        return {"error": "No particles loop found in STAR file"}
    n = len(blk.rows)
    cols = blk.columns
    # Detect type
    is_3d_sta = "_rlnTomoName" in cols or "_rlnCtfImage" in cols or "_rlnTomoParticleName" in cols
    is_2d = "_rlnImageName" in cols and not is_3d_sta
    if is_3d_sta:
        star_type = "3D STA"
    elif is_2d:
        # check if 2D mrcs stacks
        img_col = blk.col("_rlnImageName") if "_rlnImageName" in cols else []
        star_type = "2D stacks" if any(".mrcs" in str(v) for v in img_col[:5]) else "2D"
    else:
        star_type = "unknown"
    k_suggested = max(2, round(_math.sqrt(n / 200)))
    return {
        "n_particles": n,
        "columns": cols,
        "type": star_type,
        "is_3d_sta": is_3d_sta,
        "K_suggested": k_suggested,
        "relion_version": "5" if is_2d else "4 or 5",
    }


def create_relion_dir(project_folder: str, relion_subdir: str) -> dict:
    """Create a subdirectory under project/_sta/ for RELION processing."""
    proj = resolve_project_dir(project_folder)
    target = proj / "_sta" / relion_subdir
    target.mkdir(parents=True, exist_ok=True)
    return {"path": str(target), "relative": f"_sta/{relion_subdir}"}


def scan_preprocessing(project_folder: str) -> dict:
    """Scan the external warptools_dir for raw data and auto-detect parameters.

    Reads warptools_dir from project config, then scans:
    - frames/: .tif (preferred), .eer
    - mdocs/: .mdoc parse first for voltage, pixel_size, tilt info
    - warp_tiltseries/reconstruction/: .mrc dims + voxel size
    - warp_tiltseries/xml/: .xml count
    - aretomo3/alignments/: .xf, .tlt count (sibling of warptools/)

    Returns structured scan result for Tomo tab auto-fill.
    """
    proj = resolve_project_dir(project_folder)
    cfg = ProjectConfig.load(proj)
    wt_dir = Path(cfg.warptools_dir) if cfg.warptools_dir else None

    result: dict = {
        "has_warptools_dir": bool(wt_dir and wt_dir.exists()),
        "warptools_dir": cfg.warptools_dir or "",
        "frames": {"tif": 0, "eer": 0, "preferred": "none", "dir": ""},
        "mdocs": {"count": 0, "dir": "", "parsed": {}},
        "reconstructions": {"count": 0, "dir": "", "dims": [], "voxel_size": None},
        "xmls": {"count": 0, "dir": ""},
        "aretomo_alignments": {"xf": 0, "tlt": 0, "dir": ""},
        "suggestions": [],
    }

    if not wt_dir or not wt_dir.exists():
        result["suggestions"].append("No WarpTools directory set — configure in Tomo tab")
        return result

    # ── Raw frames ─────────────────────────────────────────────
    frames_dir = wt_dir / "frames"
    if frames_dir.exists():
        tif = list(frames_dir.glob("*.tif")) + list(frames_dir.glob("*.tiff"))
        eer = list(frames_dir.glob("*.eer"))
        result["frames"] = {
            "tif": len(tif), "eer": len(eer),
            "preferred": "tif" if tif else ("eer" if eer else "none"),
            "dir": str(frames_dir),
        }
        if tif:
            result["suggestions"].append(f"{len(tif)} .tif frames found")
        elif eer:
            result["suggestions"].append(f"{len(eer)} .eer frames found")
        else:
            result["suggestions"].append("frames/ exists but no .tif/.eer found — copy raw data manually")

    # ── MDOCs ──────────────────────────────────────────────────
    mdoc_dir = wt_dir / "mdocs"
    # also check frames/ and wt_dir root
    for candidate in [mdoc_dir, frames_dir, wt_dir]:
        if candidate.exists():
            mdocs = list(candidate.glob("*.mdoc"))
            if mdocs:
                result["mdocs"]["count"] = len(mdocs)
                result["mdocs"]["dir"] = str(candidate)
                try:
                    parsed = _parse_mdoc(mdocs[0])
                    result["mdocs"]["parsed"] = parsed
                    if parsed.get("voltage"):
                        result["suggestions"].append(f"Voltage from MDOC: {parsed['voltage']} kV")
                    if parsed.get("pixel_size"):
                        result["suggestions"].append(f"Pixel size from MDOC: {parsed['pixel_size']} Å/px")
                    if parsed.get("n_tilts"):
                        result["suggestions"].append(
                            f"Tilt series: {parsed['n_tilts']} tilts "
                            f"({parsed.get('tilt_min', '?')}° to {parsed.get('tilt_max', '?')}°)"
                        )
                except Exception:
                    pass
                break

    # ── Reconstructions ────────────────────────────────────────
    rec_dir = wt_dir / "warp_tiltseries" / "reconstruction"
    if rec_dir.exists():
        mrcs = [f for f in rec_dir.glob("*.mrc") if f.stat().st_size > 500_000]
        result["reconstructions"]["count"] = len(mrcs)
        result["reconstructions"]["dir"] = str(rec_dir)
        if mrcs:
            dims, voxel = _read_mrc_header(mrcs[0])
            result["reconstructions"]["dims"] = dims
            result["reconstructions"]["voxel_size"] = voxel
            if dims:
                result["suggestions"].append(
                    f"Tomo dims from reconstruction: {dims[0]}×{dims[1]}×{dims[2]}"
                )
            if voxel:
                result["suggestions"].append(f"Voxel size from reconstruction: {voxel} Å/px")
            result["suggestions"].append(
                f"{len(mrcs)} reconstructions — ready for symlink _pytom/reconstruction/"
            )

    # ── XMLs ───────────────────────────────────────────────────
    xml_dir = wt_dir / "warp_tiltseries" / "xml"
    if not xml_dir.exists():
        xml_dir = wt_dir / "warp_tiltseries"
    if xml_dir.exists():
        xmls = list(xml_dir.glob("*.xml"))
        result["xmls"]["count"] = len(xmls)
        result["xmls"]["dir"] = str(xml_dir)
        if xmls:
            result["suggestions"].append(
                f"{len(xmls)} Warp XML files — ready to copy _pytom/xml/"
            )

    # ── AreTomo3 alignments ────────────────────────────────────
    # aretomo3/ is a sibling of warptools/ inside the preprocessing root
    preproc_root = wt_dir.parent
    at_dir = preproc_root / "aretomo3" / "alignments"
    if at_dir.exists():
        xf  = list(at_dir.glob("*.xf"))
        tlt = list(at_dir.glob("*.tlt"))
        result["aretomo_alignments"] = {
            "xf": len(xf), "tlt": len(tlt), "dir": str(at_dir)
        }
        if xf:
            result["suggestions"].append(f"{len(xf)} AreTomo3 alignments (.xf) available")

    return result


def _parse_mdoc(mdoc_path: Path) -> dict:
    """Parse a SerialEM .mdoc file for key acquisition parameters."""
    parsed: dict = {}
    try:
        text = mdoc_path.read_text(errors="replace")
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("Voltage ="):
                try: parsed["voltage"] = int(float(s.split("=",1)[1].strip()))
                except Exception: pass
            elif s.startswith("PixelSpacing ="):
                try: parsed["pixel_size"] = round(float(s.split("=",1)[1].strip()), 4)
                except Exception: pass
            elif s.startswith("ExposureTime ="):
                try: parsed["exposure_time"] = float(s.split("=",1)[1].strip())
                except Exception: pass
            elif s.startswith("TiltAngle ="):
                try:
                    a = float(s.split("=",1)[1].strip())
                    parsed.setdefault("tilt_angles", []).append(a)
                except Exception: pass
        if "tilt_angles" in parsed:
            angles = parsed.pop("tilt_angles")
            parsed["tilt_min"] = round(min(angles), 1)
            parsed["tilt_max"] = round(max(angles), 1)
            parsed["n_tilts"] = len(angles)
    except Exception:
        pass
    return parsed


def _read_mrc_header(mrc_path: Path) -> tuple:
    """Read dims (x,y,z) and voxel size from an MRC file header, without
    loading the full data array. Returns (dims, voxel_size)."""
    try:
        import mrcfile
        with mrcfile.open(str(mrc_path), mode="r", permissive=True) as m:
            dims = [int(m.header.nx), int(m.header.ny), int(m.header.nz)]
            vsx, vsy = float(m.voxel_size.x), float(m.voxel_size.y)
            voxel = round(vsx if vsx > 0 else vsy, 4)
            return dims, voxel
    except Exception:
        pass
    return [], None


# ═══════════════════════════════════════════
#  PY2RELY DASHBOARD
# ═══════════════════════════════════════════

import subprocess as _subprocess
import signal as _signal

_py2rely_proc: "_subprocess.Popen | None" = None
_py2rely_relion_dir: str = ""
_py2rely_port: int = 3000

def start_py2rely_dashboard(relion_dir: str, py2rely_cmd: str, port: int = 3000) -> dict:
    """Start py2rely dashboard as subprocess in the given RELION working dir."""
    global _py2rely_proc, _py2rely_relion_dir, _py2rely_port
    # Stop existing process if running
    stop_py2rely_dashboard()
    wd = Path(relion_dir)
    if not wd.exists():
        return {"error": f"Directory not found: {relion_dir}"}
    # Build command — append --no-browser and --port. No shell=True: run the
    # argv list directly so a client-supplied py2rely_cmd can't inject shell
    # metacharacters (;, &&, $(), ...). The "conda activate ENV && CMD"
    # convention (used throughout the app, see Runner.run) is translated to
    # its argv-safe "conda run -n ENV CMD" equivalent before splitting, since
    # shlex.split alone would otherwise choke on the literal "&&" token.
    _ca = re.match(r'conda activate ([\w.\-]+)\s*&&\s*(.+)', py2rely_cmd.strip())
    if _ca:
        py2rely_cmd = f"conda run -n {_ca.group(1)} --no-capture-output {_ca.group(2)}"
    try:
        cmd_parts = shlex.split(py2rely_cmd) + ["--no-browser", "--port", str(port)]
    except ValueError as e:
        return {"error": f"Invalid py2rely command: {e}"}
    try:
        _py2rely_proc = _subprocess.Popen(
            cmd_parts, cwd=str(wd),
            stdout=_subprocess.DEVNULL, stderr=_subprocess.DEVNULL,
        )
        time.sleep(0.3)  # give it a moment to fail fast (bad command, missing binary, ...)
        if _py2rely_proc.poll() is not None:
            return {"error": f"py2rely exited immediately (code {_py2rely_proc.returncode}) — check the command"}
        _py2rely_relion_dir = str(relion_dir)
        _py2rely_port = port
        return {"status": "started", "pid": _py2rely_proc.pid, "port": port, "relion_dir": relion_dir}
    except Exception as e:
        return {"error": str(e)}

def stop_py2rely_dashboard() -> dict:
    """Stop running py2rely dashboard subprocess."""
    global _py2rely_proc
    if _py2rely_proc is not None:
        try:
            _py2rely_proc.terminate()
            _py2rely_proc.wait(timeout=3)
        except Exception:
            try: _py2rely_proc.kill()
            except Exception: pass
        _py2rely_proc = None
    return {"status": "stopped"}

def get_py2rely_status() -> dict:
    """Return current py2rely dashboard status."""
    global _py2rely_proc, _py2rely_relion_dir, _py2rely_port
    if _py2rely_proc is None:
        return {"running": False, "port": _py2rely_port, "relion_dir": _py2rely_relion_dir}
    poll = _py2rely_proc.poll()
    running = poll is None
    if not running:
        _py2rely_proc = None
    return {"running": running, "pid": _py2rely_proc.pid if (running and _py2rely_proc) else None,
            "port": _py2rely_port, "relion_dir": _py2rely_relion_dir}

def list_relion_sta_dirs(project_folder: str) -> dict:
    """List subdirectories of relion_sta/ for a project."""
    proj = get_ws().workspace_dir / project_folder
    relion_sta = proj / "relion_sta"
    if not relion_sta.exists():
        return {"dirs": [], "relion_sta": str(relion_sta)}
    dirs = sorted([d.name for d in relion_sta.iterdir() if d.is_dir()])
    return {"dirs": dirs, "relion_sta": str(relion_sta)}


# ═══════════════════════════════════════════
#  RUNNER
# ═══════════════════════════════════════════

ALLOWED = [
    # Science tools
    "pytom_", "relion", "relion_", "mpirun", "python", "python3",
    "py2rely", "slabify", "analyze_relion", "transfer_lcc", "plot_lcc",
    "WarpTools", "filter_quality", "MTools", "MCore",
    "imod", "3dmod", "newstack", "tilt", "trimvol", "binvol",  # IMOD
    "AreTomo3", "AreTomo",                                       # AreTomo
    "chimerax", "ChimeraX",                                      # ChimeraX
    "isonet", "isonet2",                                         # IsoNet
    "miss-alignment",                                            # Miss Alignment
    "activate_relion",                                           # RELION custom script
    # System / utility
    "which", "ls", "cat", "head", "tail", "wc", "grep",
    "mkdir", "cp", "mv", "ln", "find", "chmod", "bash",
    "module", "conda", "pip",
    "header", "cryostarbase-",
    "source",              # for system-type tools using source script
]
BLOCKED = ["rm -rf /", "rm -rf /*", "mkfs", "dd if=", "shutdown", "reboot"]


@dataclass
class RunningJob:
    id: str
    command: str
    cwd: str
    project: str = ""
    job_id: str = ""
    status: JobStatus = JobStatus.QUEUED
    pid: Optional[int] = None
    exit_code: Optional[int] = None
    t0: Optional[float] = None
    t1: Optional[float] = None
    stdout: list[str] = field(default_factory=list)
    stderr: list[str] = field(default_factory=list)

    @property
    def duration(self):
        return (self.t1 or time.time()) - self.t0 if self.t0 else None

    def to_dict(self, include_output: bool = False):
        d = {"id": self.id, "command": self.command, "cwd": self.cwd,
             "project": self.project, "job_id": self.job_id,
             "status": self.status.value, "pid": self.pid,
             "exit_code": self.exit_code, "duration": self.duration,
             "stdout_lines": len(self.stdout), "stderr_lines": len(self.stderr)}
        if include_output:
            d["stdout"] = "\n".join(
                l for l in self.stdout if not l.startswith("[stderr] ")
            )
            d["stderr"] = "\n".join(
                l.replace("[stderr] ", "") for l in self.stdout
                if l.startswith("[stderr] ")
            )
        return d


class Runner:
    def __init__(self):
        self._runs = {}
        self._procs = {}
        self._n = 0

    def _check(self, cmd):
        for p in BLOCKED:
            if p in cmd:
                raise PermissionError(f"Blocked: {p}")
        clean = ' '.join(line.rstrip('\\').strip() for line in cmd.splitlines() if line.strip())
        try:
            parts = shlex.split(clean)
        except ValueError:
            parts = clean.split()
        if not parts:
            raise PermissionError("Empty command")
        base = Path(parts[0]).name
        if not any(base.startswith(a) or base == a for a in ALLOWED):
            raise PermissionError(f"'{base}' not in allowed list")

    def _rid(self):
        self._n += 1
        return f"run_{self._n:04d}"

    def _is_gpu_job(self, cmd: str) -> bool:
        """Detect if a job likely uses GPU based on command keywords."""
        gpu_keywords = [
            'aretomo', 'relion', 'cryosparc', 'topaz', 'warp',
            'gpu', 'cuda', '--gpu', '-gpu', 'nvidia'
        ]
        cmd_lower = cmd.lower()
        return any(kw in cmd_lower for kw in gpu_keywords)

    def _get_gpu_snapshot(self) -> dict:
        """Quick GPU state snapshot via nvidia-smi.
        Returns: {
            'available': bool,
            'gpus': [{'index', 'name', 'mem_used_mb', 'mem_free_mb', 'mem_total_mb', 'util_pct', 'driver'}],
            'cuda_version': str,
            'timestamp': str
        }
        """
        import subprocess
        from datetime import datetime

        result = {
            'available': False,
            'gpus': [],
            'timestamp': datetime.now().isoformat(timespec='seconds')
        }

        # Get GPU info
        raw_gpus = _query_nvidia_smi_gpus()
        if raw_gpus:
            result['available'] = True
            result['gpus'] = raw_gpus

        # Get CUDA version
        try:
            nvcc = subprocess.run(['nvcc', '--version'], capture_output=True, text=True, timeout=5)
            if nvcc.returncode == 0:
                import re
                match = re.search(r'release (\d+\.\d+)', nvcc.stdout)
                result['cuda_version'] = match.group(1) if match else 'unknown'
            else:
                result['cuda_version'] = 'not found'
        except:
            result['cuda_version'] = 'not found'
        
        # Environment
        result['cuda_visible'] = os.environ.get('CUDA_VISIBLE_DEVICES', 'not set')
        
        return result

    def _log_gpu_info(self, project: str, job_id: str, gpu_info: dict, phase: str):
        """Write GPU information to job log file.
        
        Args:
            project: Project folder name
            job_id: Job ID
            gpu_info: GPU snapshot from _get_gpu_snapshot()
            phase: 'pre' or 'post'
        """
        try:
            proj_path = get_ws().workspace_dir / project
            job = JobRecord.load(proj_path, job_id)
            if not job:
                return
            
            # Write GPU info to log
            if phase == 'pre':
                job.append_log(proj_path, "")
                job.append_log(proj_path, "="*70)
                job.append_log(proj_path, f"[GPU PRE-CHECK] {gpu_info['timestamp']}")
                job.append_log(proj_path, "="*70)
            else:
                job.append_log(proj_path, "")
                job.append_log(proj_path, "-"*70)
                job.append_log(proj_path, f"[GPU POST-CHECK] {gpu_info['timestamp']}")
                job.append_log(proj_path, "-"*70)
            
            if gpu_info['available']:
                job.append_log(proj_path, f"✓ GPU Available: {len(gpu_info['gpus'])} device(s)")
                
                for gpu in gpu_info['gpus']:
                    job.append_log(proj_path, f"  GPU {gpu['index']}: {gpu['name']}")
                    job.append_log(proj_path, f"    VRAM: {gpu['mem_free_mb']} / {gpu['mem_total_mb']} MB free")
                    job.append_log(proj_path, f"    Utilization: {gpu['util_pct']}%")
                    if phase == 'pre':
                        job.append_log(proj_path, f"    Driver: {gpu['driver']}")
                
                if phase == 'pre':
                    job.append_log(proj_path, f"CUDA: {gpu_info.get('cuda_version', 'unknown')}")
                    job.append_log(proj_path, f"CUDA_VISIBLE_DEVICES: {gpu_info.get('cuda_visible', 'not set')}")
                    
                    # Memory recommendation
                    if gpu_info['gpus']:
                        best = max(gpu_info['gpus'], key=lambda g: g['mem_free_mb'])
                        if best['mem_free_mb'] < 4000:
                            job.append_log(proj_path, f"⚠ Low GPU memory: {best['mem_free_mb']} MB free on GPU {best['index']}")
                        else:
                            job.append_log(proj_path, f"✓ Recommended: GPU {best['index']} ({best['mem_free_mb']} MB free)")
            else:
                job.append_log(proj_path, "✗ No GPU detected (nvidia-smi failed)")
            
            if phase == 'pre':
                job.append_log(proj_path, "="*70)
                job.append_log(proj_path, "")
        except Exception:
            pass

    def _log_crash_diagnostics(self, project: str, job_id: str):
        """Write detailed GPU diagnostics after a segmentation fault (exit 139)."""
        import subprocess
        
        try:
            proj_path = get_ws().workspace_dir / project
            job = JobRecord.load(proj_path, job_id)
            if not job:
                return
            
            job.append_log(proj_path, "")
            job.append_log(proj_path, "⚠"*35)
            job.append_log(proj_path, "⚠ SEGMENTATION FAULT DETECTED (exit code 139)")
            job.append_log(proj_path, "⚠"*35)
            job.append_log(proj_path, "")
            job.append_log(proj_path, "Running GPU diagnostics...")
            job.append_log(proj_path, "")
            
            # Detailed nvidia-smi output
            try:
                detailed = subprocess.run(
                    ['nvidia-smi', '-q'],
                    capture_output=True, text=True, timeout=10
                )
                if detailed.returncode == 0:
                    # Only log first 100 lines to avoid huge logs
                    lines = detailed.stdout.splitlines()[:100]
                    job.append_log(proj_path, "[nvidia-smi -q] GPU Details:")
                    for line in lines:
                        job.append_log(proj_path, line)
                    if len(detailed.stdout.splitlines()) > 100:
                        job.append_log(proj_path, "... (output truncated)")
            except Exception as e:
                job.append_log(proj_path, f"Could not get detailed GPU info: {str(e)}")
            
            job.append_log(proj_path, "")
            job.append_log(proj_path, "Common causes of segfault:")
            job.append_log(proj_path, "  1. Invalid command parameters (missing values, wrong format)")
            job.append_log(proj_path, "  2. Corrupted input files (gain reference, MRC files)")
            job.append_log(proj_path, "  3. GPU out of memory (check VRAM usage above)")
            job.append_log(proj_path, "  4. CUDA library incompatibility (check driver vs binary)")
            job.append_log(proj_path, "  5. Binary corruption (try re-downloading)")
            job.append_log(proj_path, "")
            
        except Exception:
            pass

    def all_runs(self) -> list:
        """Return all run records as dicts, newest first."""
        return [rj.to_dict() for rj in sorted(
            self._runs.values(), key=lambda r: r.t0 or 0, reverse=True)]

    def output(self, rid: str, start: int = 0) -> dict:
        """Return output lines for a run from position start."""
        rj = self._runs.get(rid)
        if not rj:
            return {"lines": [], "status": "not_found", "done": True}
        lines = rj.stdout[start:] + rj.stderr[start:]
        return {"lines": lines, "status": rj.status.value, "done": rj.status not in (JobStatus.RUNNING, JobStatus.QUEUED),
                "exit_code": rj.exit_code, "duration": rj.duration}

    async def cancel(self, rid: str) -> bool:
        """Cancel a running job by rid."""
        proc = self._procs.get(rid)
        rj = self._runs.get(rid)
        if proc:
            try:
                proc.terminate()
                await asyncio.sleep(0.3)
                if proc.returncode is None:
                    proc.kill()
            except Exception:
                pass
        if rj:
            rj.status = JobStatus.CANCELLED
            rj.t1 = time.time()
            if rj.project and rj.job_id:
                update_job(rj.project, rj.job_id, status="cancelled",
                           finished_at=datetime.now().isoformat(timespec="seconds"))
        return True

    async def run(self, cmd, cwd=".", env=None, on_line=None, project="", job_id=""):
        self._check(cmd)
        shell_cmd = ' '.join(line.rstrip('\\').strip() for line in cmd.splitlines() if line.strip())
        # Translate activation patterns to safe subprocess equivalents:
        #   conda activate ENV && CMD      →  conda run -n ENV bash -c 'CMD'
        #   source /path/script.sh && CMD  →  bash -c 'source /path/script.sh && CMD'
        #   module load MOD && CMD         →  kept as-is
        #   system cmd (no pattern)        →  run as-is
        import re as _re

        # Pattern 1: conda activate ENV && CMD
        _ca = _re.match(r'conda activate ([\w.\-]+)\s*&&\s*(.+)', shell_cmd)
        if _ca:
            _env_name = _ca.group(1).strip()
            _rest     = _ca.group(2).strip()
            _rest_esc = _rest.replace("'", "'\''")
            shell_cmd = f"conda run -n {_env_name} --no-capture-output bash -c '{_rest_esc}'"

        # Pattern 2: source /path/to/script.sh && CMD
        elif _re.match(r'source\s+\S+.*&&', shell_cmd):
            _esc = shell_cmd.replace("'", "'\''")
            shell_cmd = f"bash -c '{_esc}'"
        rid = self._rid()
        rj = RunningJob(id=rid, command=cmd, cwd=cwd, project=project, job_id=job_id)
        self._runs[rid] = rj
        rj.status = JobStatus.RUNNING
        rj.t0 = time.time()
        if project and job_id:
            update_job(project, job_id, status="running",
                       started_at=datetime.now().isoformat(timespec="seconds"))
        
        # === GPU PRE-CHECK ===
        is_gpu_job = project and job_id and self._is_gpu_job(shell_cmd)
        if is_gpu_job:
            gpu_pre = self._get_gpu_snapshot()
            self._log_gpu_info(project, job_id, gpu_pre, 'pre')
        
        try:
            proc = await asyncio.create_subprocess_shell(
                shell_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                cwd=cwd, env={**os.environ, **(env or {})})
            rj.pid = proc.pid
            self._procs[rid] = proc

            async def rd(stream, buf, pfx=""):
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    t = line.decode("utf-8", errors="replace").rstrip("\n")
                    buf.append(t)
                    if on_line:
                        await on_line(rid, pfx + t)
                    # Also append to job log file if job_id is set
                    if rj.job_id and rj.project:
                        try:
                            proj_path = get_ws().workspace_dir / rj.project
                            j = JobRecord.load(proj_path, rj.job_id)
                            if j:
                                j.append_log(proj_path, pfx + t)
                        except Exception:
                            pass

            await asyncio.gather(rd(proc.stdout, rj.stdout), rd(proc.stderr, rj.stderr, "[stderr] "))
            await proc.wait()
            rj.exit_code = proc.returncode
            rj.status = JobStatus.COMPLETED if proc.returncode == 0 else JobStatus.FAILED

            # === WarpTools crash restart (exit 134 = SIGABRT from dead worker socket) ===
            _is_warptools = 'WarpTools' in shell_cmd
            _max_restarts = 35  # one per tilt series at most
            _restart_n = 0
            while rj.exit_code == 134 and _is_warptools and _restart_n < _max_restarts:
                _restart_n += 1
                _msg = f'[info] WarpTools worker crash (exit 134) — auto-restart {_restart_n}/{_max_restarts}'
                rj.stdout.append(_msg)
                if on_line:
                    await on_line(rid, _msg)
                if rj.job_id and rj.project:
                    try:
                        _ppath = get_ws().workspace_dir / rj.project
                        _jrec  = JobRecord.load(_ppath, rj.job_id)
                        if _jrec: _jrec.append_log(_ppath, _msg)
                    except Exception:
                        pass
                await asyncio.sleep(3)  # let sockets close
                proc = await asyncio.create_subprocess_shell(
                    shell_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    cwd=cwd, env={**os.environ, **(env or {})})
                rj.pid = proc.pid
                self._procs[rid] = proc
                await asyncio.gather(
                    rd(proc.stdout, rj.stdout),
                    rd(proc.stderr, rj.stderr, '[stderr] '))
                await proc.wait()
                rj.exit_code = proc.returncode
                rj.status = JobStatus.COMPLETED if proc.returncode == 0 else JobStatus.FAILED

            # === GPU POST-CHECK ===
            if is_gpu_job:
                gpu_post = self._get_gpu_snapshot()
                self._log_gpu_info(project, job_id, gpu_post, 'post')

                # === CRASH DIAGNOSTICS ===
                if proc.returncode == 139:  # Segmentation fault
                    self._log_crash_diagnostics(project, job_id)
        
        except Exception as e:
            rj.status = JobStatus.FAILED
            rj.stderr.append(str(e))
        finally:
            rj.t1 = time.time()
            self._procs.pop(rid, None)
        if project and job_id:
            # Parse dashboard metrics on successful completion
            dashboard = {}
            if rj.exit_code == 0:
                try:
                    proj_path = get_ws().workspace_dir / project
                    job_rec = JobRecord.load(proj_path, job_id)
                    if job_rec:
                        dashboard = _parse_dashboard_data(job_rec, proj_path)
                except Exception:
                    pass
            update_job(project, job_id, status=rj.status.value, exit_code=rj.exit_code,
                       finished_at=datetime.now().isoformat(timespec="seconds"),
                       dashboard_data=dashboard)
            _auto_note(project,
                f"**{job_id}** {'Completed' if rj.exit_code==0 else 'Failed'} — exit {rj.exit_code}, {rj.duration:.1f}s")
        return rj

def check_star(path: str) -> dict:
    p = _safe(path)
    checks: list = []
    if not p.exists():
        return {"file": str(p), "status": "error", "checks": [{"name": "Exists", "status": "error", "msg": "File not found"}]}
    checks.append({"name": "Exists", "status": "ok", "msg": str(p)})
    try:
        sf = StarFile.read(p)
    except Exception as e:
        checks.append({"name": "Parse", "status": "error", "msg": str(e)})
        return {"file": p.name, "status": "error", "checks": checks}
    checks.append({"name": "Parse", "status": "ok", "msg": f"{len(sf.blocks)} block(s)"})
    for n, b in sf.blocks.items():
        if b.is_loop:
            checks.append({"name": f"Block {n}", "status": "ok" if b.rows else "warning",
                            "msg": f"{len(b.rows)} rows, {len(b.columns)} cols"})
    st = [c["status"] for c in checks]
    return {"file": p.name, "status": "error" if "error" in st else "warning" if "warning" in st else "ok",
            "checks": checks}


def check_tomogram(path):
    p = _safe(path)
    checks = []
    if not p.exists():
        return {"file": p.name, "status": "error",
                "checks": [{"name": "Exists", "status": "error", "msg": "Not found"}]}
    try:
        import mrcfile
        with mrcfile.open(str(p), mode="r", permissive=True) as m:
            checks.append({"name": "Read", "status": "ok", "msg": f"{m.data.shape} {m.data.dtype}"})
            checks.append({"name": "Voxel", "status": "ok", "msg": f"{float(m.voxel_size.x):.2f} Å"})
    except ImportError:
        checks.append({"name": "mrcfile", "status": "warning", "msg": "Not installed"})
    except Exception as e:
        checks.append({"name": "Read", "status": "error", "msg": str(e)})
    st = [c["status"] for c in checks]
    return {"file": p.name, "status": "error" if "error" in st else "warning" if "warning" in st else "ok",
            "checks": checks}


# ═══════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════

def suggest_box_size(diameter, pixel_size):
    d = diameter / pixel_size
    mn = int(math.ceil(d * 1.5))
    return {"diameter_px": round(d, 1), "min_box": mn,
            "suggestions": [b for b in GOOD_BOX_SIZES if b >= mn][:5]}


def build_command(template_id, params, project_folder=None):
    tpl = next((t for t in TEMPLATES if t["id"] == template_id), None)
    if not tpl:
        raise ValueError(f"Unknown template: {template_id}")
    
    # Select command based on mode parameter (for import jobs with command_symlink/command_copy)
    mode        = (params.get("mode") or "").lower()
    filter_mode = (params.get("filter_mode") or "all").lower()

    # If filter_mode=from_selection, generate a filtered import command
    if filter_mode == "from_selection":
        file_type   = "mdocs" if "mdoc" in template_id else "frames"
        import_mode = mode if mode in ("symlink", "copy") else "symlink"
        # archive_source/dest/selection_file are embedded directly in a Python string
        # literal, which itself sits inside a shell double-quoted `python3 -c "..."`
        # argument — two escaping layers. Rather than juggling both, reject the
        # handful of characters ("  `  $) that are special to the outer shell
        # double-quotes; real filesystem paths have no legitimate reason to contain
        # them, and Python-string-escape (\, ') alone can't make them safe here.
        def _pyesc(s):
            v = str(s).strip()
            if any(c in v for c in ('"', '`', '$')):
                raise ValueError(f"Path contains unsupported character (\", ` or $): {v!r}")
            return v.replace("\\", "\\\\").replace("'", "\\'")
        archive_source = _pyesc(params.get("archive_source", ""))
        dest           = _pyesc(params.get("dest", ""))
        selection_file = _pyesc(params.get("selection_file", ""))
        # NOTE: the dict literals below use doubled {{ }} on purpose — build_command's
        # own "protect {{...}} before stripping leftover {placeholders}" pass (below)
        # collapses them back to single braces, so the JSON payload's own { }
        # syntax survives the generic placeholder cleanup instead of being eaten by it.
        cmd = (
            "python3 -c \""
            "import urllib.request as _u, json as _j; "
            "_d=_j.dumps({{'source_dir':'" + archive_source + "','dest_dir':'" + dest + "',"
            "'selection_file':'" + selection_file + "',"
            "'mode':'" + import_mode + "','file_type':'" + file_type + "'"
            "}}).encode(); "
            "_r=_j.loads(_u.urlopen(_u.Request('http://localhost:8787/api/inspect/import_filtered',"
            "_d,{{'Content-Type':'application/json'}})).read()); "
            "print('Created:', _r.get('created'), 'Skipped:', _r.get('skipped'))\""
        )
    elif mode and f"command_{mode}" in tpl:
        # Generic mode dispatch: any "mode" option value with a matching
        # command_<mode> key (command_hardlink, command_symlink, command_copy,
        # command_batch, command_replace, ...) is used as-is.
        cmd = tpl[f"command_{mode}"]
    elif "command" in tpl:
        cmd = tpl["command"]
    else:
        # Fallback: try command_copy, then command_symlink, then error
        cmd = tpl.get("command_copy") or tpl.get("command_symlink")
        if not cmd:
            raise ValueError(f"Template {template_id} has no command field")
    if project_folder:
        cfg = ProjectConfig.load(get_ws().workspace_dir / project_folder)
        # Format tomo_dimensions as XxYxZ
        # If Z is 0, leave it as 0 (user must set manually)
        # But still provide X and Y from config
        # tomo_dims may have fewer than 3 entries (e.g. before setup, or MDOC
        # import which only supplies X/Y) — pad missing entries with 0.
        dims = (cfg.tomo_dims or []) + [0, 0, 0]
        tomo_dims_str = f"{dims[0]}x{dims[1]}x{dims[2]}"
        # Calculate exposure (dose per tilt) - check both warp_tilt_exposure and dose_per_tilt
        exposure_val = getattr(cfg, 'warp_tilt_exposure', 0) or getattr(cfg, 'dose_per_tilt', 0) or (
            cfg.total_dose / cfg.n_tilts if getattr(cfg, 'total_dose', 0) and getattr(cfg, 'n_tilts', 0) else 0
        )
        auto = {"voxel_size": str(cfg.bin_pixel_size), "diameter": str(cfg.particle_diameter),
                "box_size": str(cfg.box_size), "radius": str(cfg.mask_radius),
                "symmetry": str(cfg.symmetry), "voltage": str(cfg.voltage),
                "cs": str(cfg.spherical_aberration), "amp": str(cfg.amplitude_contrast),
                "suffix": cfg.tomo_suffix, "pixel_size": str(cfg.bin_pixel_size),
                "x": str(dims[0]), "y": str(dims[1]), "z": str(dims[2]),
                "tomo_dimensions": tomo_dims_str, "angpix_raw": str(cfg.raw_pixel_size),
                "exposure": str(exposure_val) if exposure_val else ""}
        for k, v in auto.items():
            if k not in params or not params[k]:
                params[k] = v
    
    # Handle boolean flags: convert True → "--flag_name ", False → ""
    # Keys converted here hold code-generated literal flag strings (not raw user
    # input), so they must NOT be shell-quoted below — quoting "--flag " would
    # glue the flag and its trailing space into a single shell token.
    literal_keys = set()
    for param in tpl.get("parameters", []):
        if param.get("type") == "select":
            # Select values are meant to come from the template's own fixed
            # `options` list (e.g. "-c -1", "--relion5-compat") — often
            # pre-formed "flag value" pairs, so shell-quoting them would
            # collapse that pair into one argv token and break the target
            # script's argument parsing. But /api/jobs/run accepts arbitrary
            # client-supplied `parameters`, so only skip quoting when the
            # submitted value actually IS one of the declared options —
            # anything else is untrusted and must still go through
            # shlex.quote() below to prevent shell injection.
            key = param["key"]
            options = param.get("options", [])
            if str(params.get(key, "")).strip() in [str(o) for o in options]:
                literal_keys.add(key)
        if param.get("type") == "boolean":
            key = param["key"]
            literal_keys.add(key)
            # "flag" lets a template override the CLI flag text (e.g. a script
            # expects --tophat-filter but the param key is "tophat"); fall back
            # to the key-derived flag when not given.
            flag = param.get("flag") or f"--{key}"
            # Check if parameter is set and truthy
            if key in params:
                # Convert string "true"/"false" to boolean
                val = params[key]
                if isinstance(val, str):
                    val = val.lower() in ("true", "1", "yes")
                elif val is None:
                    val = False
                params[key] = f"{flag} " if val else ""
            else:
                # Not provided, use default if exists
                default = param.get("default", "false")
                if isinstance(default, str):
                    val = default.lower() in ("true", "1", "yes")
                else:
                    val = bool(default)
                params[key] = f"{flag} " if val else ""

    # Special handling for optional parameters that need flag prefix
    # If gain_defects has a value, prepend " --gain_defects " flag
    if "gain_defects" in params and params["gain_defects"]:
        params["gain_defects"] = f" --gain_defects {shlex.quote(str(params['gain_defects']).strip())}"
        literal_keys.add("gain_defects")  # already safely quoted above

    # Shell-quote every substituted value so path/text parameters containing
    # spaces or shell metacharacters (;, &&, $(), backticks, ...) can't break
    # out of their argument position. Empty values stay empty (an optional
    # flag/placeholder that should simply disappear, not become a stray '').
    for k, v in params.items():
        v_str = str(v).strip()
        if k in literal_keys or v_str == "":
            cmd = cmd.replace(f"{{{k}}}", v_str)
        else:
            cmd = cmd.replace(f"{{{k}}}", shlex.quote(v_str))
    
    # CRITICAL FIX: Protect {{anything}} before removing {placeholders}
    # This handles find -exec {{}} and Python f-strings {{variable}}
    protected = []
    def protect(match):
        protected.append(match.group(1))
        return f'__PROTECTED_{len(protected)-1}__'
    
    cmd = re.sub(r'\{\{([^}]*)\}\}', protect, cmd)
    
    # Remove remaining single {placeholders}
    cmd = re.sub(r'\{[^}]+\}', '', cmd)
    
    # Restore protected {{}} as {} (for find -exec and f-strings)
    for i, content in enumerate(protected):
        cmd = cmd.replace(f'__PROTECTED_{i}__', f'{{{content}}}')
    
    # Clean up extra spaces
    cmd = re.sub(r'  +', ' ', cmd).strip()
    
    # Prepend conda/environment activation if needed
    if project_folder:
        # Map template_id to program name
        prog_name = None
        if "warp_" in template_id:
            prog_name = "warptools"
        elif "miss_align" in template_id or "missalign" in template_id:
            prog_name = "missalign"
        elif "pytom" in template_id or "tm_" in template_id:
            prog_name = "pytom"
        elif "slabify" in template_id:
            prog_name = "slabify"
        elif "isonet" in template_id:
            prog_name = "isonet"
        elif "ais_" in template_id:
            prog_name = "ais"
        elif "relion" in template_id:
            prog_name = "relion"
        
        # Get activation command from programs config
        if prog_name and cfg.programs and prog_name in cfg.programs:
            prog = cfg.programs[prog_name]
            activation_cmd = prog.get("cmd", "")
            
            # Only prepend if activation command exists and not already in command
            if activation_cmd and not cmd.startswith(activation_cmd.split("&&")[0].strip()):
                cmd = f"{activation_cmd} && {cmd}"
    
    return cmd


def list_bundled_scripts():
    try:
        from cryostarbase.scripts import list_scripts
        return list_scripts()
    except ImportError:
        return []

def convert_ang_to_pix(input_star: str, output_star: str,
                       x_dim: int, y_dim: int, z_dim: int,
                       pixel_size: float, suffix: str = "_pix") -> dict:
    """Convert particle coordinates in a STAR file from Angstroms to pixels.
    Handles PyTom coordinate convention: origin at center shifted to corner.
    """
    from pathlib import Path as _Path
    inp = _safe(input_star)
    out = _Path(output_star) if output_star else inp.parent / (inp.stem + suffix + inp.suffix)
    if not inp.exists():
        raise FileNotFoundError(f"Input STAR not found: {inp}")
    if pixel_size <= 0:
        raise ValueError("pixel_size must be > 0")

    lines = inp.read_text().splitlines(keepends=True)
    # Find coordinate column indices (_rlnCoordinateX/Y/Z)
    col_map: dict = {}
    in_loop = False
    col_idx = 0
    header_lines = []
    data_lines = []
    for line in lines:
        s = line.strip()
        if s == 'loop_':
            in_loop = True
            header_lines.append(line)
        elif in_loop and s.startswith('_rln'):
            name = s.split()[0]
            col_map[name] = col_idx
            col_idx += 1
            header_lines.append(line)
        elif in_loop and s and not s.startswith('#') and not s.startswith('_'):
            data_lines.append(line)
        else:
            header_lines.append(line)

    cx = col_map.get('_rlnCoordinateX')
    cy = col_map.get('_rlnCoordinateY')
    cz = col_map.get('_rlnCoordinateZ')
    if cx is None or cy is None or cz is None:
        raise ValueError("STAR file missing _rlnCoordinateX/Y/Z columns")

    half_x, half_y, half_z = x_dim / 2.0, y_dim / 2.0, z_dim / 2.0
    converted = []
    n = 0
    for line in data_lines:
        parts = line.split()
        if len(parts) > max(cx, cy, cz):
            try:
                # PyTom coords are in Angstrom centered at origin convert to px from corner
                parts[cx] = str(round(float(parts[cx]) / pixel_size + half_x, 4))
                parts[cy] = str(round(float(parts[cy]) / pixel_size + half_y, 4))
                parts[cz] = str(round(float(parts[cz]) / pixel_size + half_z, 4))
                n += 1
            except (ValueError, IndexError):
                pass
        converted.append(' '.join(parts) + '\n')

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(''.join(header_lines) + ''.join(converted))
    return {"output": str(out), "converted": n, "pixel_size": pixel_size}



def check_aretomo3_alignments(project_folder: str, aretomo_dir: str) -> dict:
    """Check AreTomo3 batch output for completeness and quality.
    
    Checks:
    1. XF file existence (one per mdoc)
    2. TLT file existence
    3. Z-shift plausibility (should be < 5% of tomogram Z dimension)
    4. XF file non-empty (non-degenerate alignments)
    
    Returns structured report dict.
    """
    import re as _re
    from pathlib import Path as _Path

    at_dir = _safe(aretomo_dir) if aretomo_dir else None
    proj_dir = get_ws().workspace_dir / project_folder

    # Try to find aretomo dir automatically if not given
    if not at_dir or not at_dir.exists():
        # Common locations: project dir, warptools dir, or any subdir with .xf files
        candidates = [
            proj_dir,
            proj_dir / "aretomo3",
            proj_dir / "AreTomo3",
        ]
        for c in candidates:
            if c.exists() and list(c.glob("*.xf")):
                at_dir = c
                break

    if not at_dir or not at_dir.exists():
        return {
            "status": "error",
            "message": f"AreTomo3 output directory not found: {aretomo_dir}",
            "checks": [], "summary": {}
        }

    checks = []
    xf_files = sorted(at_dir.glob("*.xf"))
    tlt_files = sorted(at_dir.glob("*.tlt"))
    mdoc_files = sorted(at_dir.glob("*.mdoc")) + sorted(at_dir.parent.glob("*.mdoc"))

    # Basic counts
    n_xf = len(xf_files)
    n_tlt = len(tlt_files)
    n_mdoc = len(mdoc_files)

    summary = {
        "directory": str(at_dir),
        "xf_files": n_xf,
        "tlt_files": n_tlt,
        "mdoc_files": n_mdoc,
    }

    # Check 1: XF completeness
    if n_mdoc > 0:
        missing = max(0, n_mdoc - n_xf)
        checks.append({
            "name": "XF completeness",
            "status": "ok" if missing == 0 else "warning" if missing <= 2 else "error",
            "msg": f"{n_xf}/{n_mdoc} XF files present" + (f" — {missing} missing" if missing else ""),
        })
    else:
        checks.append({
            "name": "XF files",
            "status": "ok" if n_xf > 0 else "warning",
            "msg": f"{n_xf} XF files found",
        })

    # Check 2: TLT completeness
    checks.append({
        "name": "TLT completeness",
        "status": "ok" if n_tlt >= n_xf else "warning" if n_tlt > 0 else "error",
        "msg": f"{n_tlt}/{n_xf} TLT files present",
    })

    # Check 3: XF file content (z-shift and degenerate alignments)
    z_shifts = []
    degenerate = []
    for xf in xf_files[:50]:  # check first 50
        try:
            lines = [l.strip() for l in xf.read_text().splitlines() if l.strip()]
            if not lines:
                degenerate.append(xf.name)
                continue
            # XF format: each line = 6 floats (matrix + shifts)
            # Last two values are X and Z shift in pixels
            shifts = []
            for line in lines:
                parts = line.split()
                if len(parts) >= 6:
                    try:
                        z_shift = abs(float(parts[5]))  # column 6 = Z shift
                        shifts.append(z_shift)
                    except ValueError:
                        pass
            if shifts:
                z_shifts.append({
                    "name": xf.name,
                    "max_z_shift": round(max(shifts), 1),
                    "mean_z_shift": round(sum(shifts)/len(shifts), 1),
                })
        except Exception:
            pass

    if z_shifts:
        max_z = max(z["max_z_shift"] for z in z_shifts)
        mean_z = round(sum(z["mean_z_shift"] for z in z_shifts) / len(z_shifts), 1)
        # Heuristic: z-shift > 50px is suspicious for most datasets
        z_status = "ok" if max_z < 30 else "warning" if max_z < 80 else "error"
        checks.append({
            "name": "Z-shift plausibility",
            "status": z_status,
            "msg": f"Max: {max_z}px, Mean: {mean_z}px across {len(z_shifts)} tomograms"
                   + (" — large shifts may indicate poor alignment" if max_z >= 30 else ""),
        })
        summary["max_z_shift_px"] = max_z
        summary["mean_z_shift_px"] = mean_z
        summary["z_shift_details"] = sorted(z_shifts, key=lambda x: -x["max_z_shift"])[:10]

    if degenerate:
        checks.append({
            "name": "Degenerate XF files",
            "status": "warning",
            "msg": f"{len(degenerate)} empty XF files: {', '.join(degenerate[:5])}",
        })

    # Check 4: Log file for errors
    log_files = list(at_dir.glob("*.log")) + list(at_dir.glob("aretomo*.txt"))
    error_count = 0
    for lf in log_files[:5]:
        try:
            text = lf.read_text(errors="replace")
            errors = len(_re.findall(r"(?:error|failed|abort|crash)", text, _re.IGNORECASE))
            error_count += errors
        except Exception:
            pass
    if log_files:
        checks.append({
            "name": "Log errors",
            "status": "ok" if error_count == 0 else "warning" if error_count < 5 else "error",
            "msg": f"{error_count} error mentions in {len(log_files)} log file(s)",
        })

    # Overall status
    statuses = [c["status"] for c in checks]
    overall = "error" if "error" in statuses else "warning" if "warning" in statuses else "ok"

    return {
        "status": overall,
        "directory": str(at_dir),
        "checks": checks,
        "summary": summary,
    }


def get_last_extract_particles(project_folder: str) -> Optional[int]:
    """Return particle count from the most recent successful extract job."""
    try:
        proj = get_ws().workspace_dir / project_folder
        jobs_dir = proj / "cryostarbase" / "jobs"
        if not jobs_dir.exists():
            return None
        extract_jobs = []
        for jf in jobs_dir.glob("*.json"):
            try:
                j = JobRecord.model_validate_json(jf.read_text())
                if j.job_type in ("extract_single", "extract_batch") and j.status == "completed":
                    extract_jobs.append(j)
            except Exception:
                pass
        if not extract_jobs:
            return None
        # Most recent by finished_at
        extract_jobs.sort(key=lambda j: j.finished_at or "", reverse=True)
        last = extract_jobs[0]
        dd = last.dashboard_data or {}
        return dd.get("particles") or dd.get("n_particles")
    except Exception:
        return None

runner = Runner()

def update_notebook_metadata(folder: str, updates: dict):
    """Update the Metadata and Processing Settings sections without appending.
    
    Args:
        folder: Project folder name
        updates: Dict with keys like 'voltage', 'binning_factor', 'tomo_dims', etc.
    """
    from datetime import datetime
    
    proj = resolve_project_dir(folder)
    notes_file = proj / "notes.md"
    if not notes_file.exists():
        return
    
    content = notes_file.read_text()
    cfg = ProjectConfig.load(proj)
    
    # Get current timestamp
    now = datetime.utcnow().isoformat()
    
    # Build updated Metadata section (IMMUTABLE fields)
    voltage = cfg.voltage or "*(not set)*"
    cs = f"{cfg.spherical_aberration} mm" if cfg.spherical_aberration else "*(not set)*"
    amp_con = cfg.amplitude_contrast or "*(not set)*"
    raw_px = f"{cfg.raw_pixel_size} Å/px" if cfg.raw_pixel_size else "*(not set)*"
    coll_date = cfg.collection_date or "*(not set)*"
    tomo_name = cfg.tomo_name or "*(auto-detect)*"
    inv_str = ", ".join(cfg.investigators) if cfg.investigators else "—"
    
    metadata_section = (
        "## 📋 Project Metadata\n"
        "*Core microscopy parameters (set once)*\n\n"
        "**Instrument:**\n"
        f"- Voltage: {voltage} kV\n"
        f"- Cs: {cs}\n"
        f"- Amplitude contrast: {amp_con}\n"
        f"- Raw pixel size: {raw_px}\n\n"
        "**Data Collection:**\n"
        f"- Collection date: {coll_date}\n"
        f"- Tomo name: {tomo_name}\n"
        f"- Investigators: {inv_str}\n"
    )
    
    # Build updated Processing Settings section (MUTABLE fields)
    dims_str = "×".join(map(str, cfg.tomo_dims)) if cfg.tomo_dims else "*(not set)*"
    if cfg.tomo_dims and len(cfg.tomo_dims) == 3 and cfg.tomo_dims[2]:
        dims_str += " vox"
    elif cfg.tomo_dims:
        dims_str += " vox *(Z not set)*"
    
    binning_str = f"{cfg.binning_factor}× → {cfg.bin_pixel_size} Å/px" if cfg.binning_factor and cfg.bin_pixel_size else "*(not set)*"
    prepro_tool = cfg.preprocessing_tool or "warptools"
    warp_dir = cfg.warptools_dir or "*(not set)*"
    proj_dir = str(proj)
    
    processing_section = (
        "## 🔧 Current Processing Settings\n"
        f"*Updated: {now.split('T')[0]}*\n\n"
        "**Tomogram:**\n"
        f"- Dimensions: {dims_str}\n"
        f"- Binning: {binning_str}\n"
        f"- Preprocessing tool: {prepro_tool}\n\n"
        "**Paths:**\n"
        f"- WarpTools: `{warp_dir}`\n"
        f"- Project: `{proj_dir}`\n"
    )
    
    # Replace sections (find between headers)
    import re
    
    # Replace Metadata section
    content = re.sub(
        r'## 📋 Project Metadata.*?(?=\n---\n)',
        metadata_section,
        content,
        flags=re.DOTALL
    )
    
    # Replace Processing Settings section
    content = re.sub(
        r'## 🔧 Current Processing Settings.*?(?=\n---\n)',
        processing_section,
        content,
        flags=re.DOTALL
    )
    
    notes_file.write_text(content)


def add_changelog_entry(folder: str, message: str):
    """Add an entry to the Changelog section.
    
    Args:
        folder: Project folder name
        message: Changelog message (without timestamp)
    """
    from datetime import datetime
    
    proj = resolve_project_dir(folder)
    notes_file = proj / "notes.md"
    if not notes_file.exists():
        return
    
    content = notes_file.read_text()
    now = datetime.utcnow().isoformat().split('T')[0]
    
    # Find Changelog section and insert after header
    import re
    changelog_pattern = r'(## 📜 Changelog\n\n)'
    
    new_entry = f"**{now}** - {message}\n"
    
    content = re.sub(
        changelog_pattern,
        r'\1' + new_entry,
        content
    )
    
    notes_file.write_text(content)

# ═══════════════════════════════════════════════════════════════
#  JOB QUEUE MANAGER
# ═══════════════════════════════════════════════════════════════

@dataclass
class QueueEntry:
    """A single entry in the job queue."""
    queue_id: str
    job_id: str
    project: str
    cmd: str
    cwd: str
    job_type: str
    job_title: str
    gpu_ids: list          # e.g. [0] or [0,1] or [] for CPU
    mode: str              # "gpu_aware" | "sequential"
    status: str            # "waiting" | "running" | "done" | "failed" | "cancelled"
    run_id: str            # Runner run_id once started
    added_at: str

    def to_dict(self) -> dict:
        return {
            "queue_id": self.queue_id,
            "job_id": self.job_id,
            "project": self.project,
            "job_type": self.job_type,
            "job_title": self.job_title,
            "gpu_ids": self.gpu_ids,
            "mode": self.mode,
            "status": self.status,
            "run_id": self.run_id,
            "added_at": self.added_at,
        }


class QueueManager:
    """Smart GPU-aware job queue for direct submission mode.

    - gpu_aware mode: jobs sharing a GPU run sequentially per GPU;
      jobs on different GPUs run in parallel.
    - sequential mode: job waits until ALL currently running/waiting
      jobs are finished (for hierarchical pipelines).
    """

    def __init__(self, runner: "Runner"):
        self._runner = runner
        self._entries: list[QueueEntry] = []
        self._n = 0
        self._gpu_locks: dict[int, asyncio.Lock] = {}
        self._seq_lock = asyncio.Lock()
        self._worker_task: asyncio.Task | None = None

    def _qid(self) -> str:
        self._n += 1
        return f"q_{self._n:04d}"

    def _gpu_lock(self, gpu_id: int) -> asyncio.Lock:
        if gpu_id not in self._gpu_locks:
            self._gpu_locks[gpu_id] = asyncio.Lock()
        return self._gpu_locks[gpu_id]

    def add(self, entry: QueueEntry) -> QueueEntry:
        entry.queue_id = self._qid()
        entry.status = "waiting"
        self._entries.append(entry)
        self._ensure_worker()
        return entry

    def remove(self, queue_id: str) -> bool:
        """Remove a waiting entry. Returns True if removed."""
        for e in self._entries:
            if e.queue_id == queue_id and e.status == "waiting":
                e.status = "cancelled"
                # Update the JobRecord too
                try:
                    update_job(e.project, e.job_id, status="cancelled",
                               finished_at=datetime.now().isoformat(timespec="seconds"))
                except Exception:
                    pass
                return True
        return False

    def list_entries(self) -> list[dict]:
        """Return all non-cancelled entries as dicts."""
        return [e.to_dict() for e in self._entries if e.status != "cancelled"]

    def _ensure_worker(self):
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.ensure_future(self._worker())

    async def _worker(self):
        """Process queue entries in order."""
        while True:
            # Find next waiting entry
            next_entry = None
            for e in self._entries:
                if e.status == "waiting":
                    next_entry = e
                    break

            if next_entry is None:
                # Queue empty — worker exits, will restart on next add()
                break

            await self._run_entry(next_entry)

    async def _run_entry(self, entry: QueueEntry):
        """Acquire appropriate locks and run the job."""
        if entry.mode == "sequential":
            # Wait for seq_lock — ensures no other job runs concurrently
            async with self._seq_lock:
                # Also wait for all GPU locks to be free
                locks = [self._gpu_lock(g) for g in self._gpu_locks]
                acquired = []
                try:
                    for lk in locks:
                        await lk.acquire()
                        acquired.append(lk)
                    await self._execute(entry)
                finally:
                    for lk in acquired:
                        lk.release()
        else:
            # gpu_aware: acquire locks only for this job's GPUs
            if entry.gpu_ids:
                locks = [self._gpu_lock(g) for g in sorted(set(entry.gpu_ids))]
                acquired = []
                try:
                    for lk in locks:
                        await lk.acquire()
                        acquired.append(lk)
                    await self._execute(entry)
                finally:
                    for lk in acquired:
                        lk.release()
            else:
                # CPU-only job — no GPU locking needed
                await self._execute(entry)

    async def _execute(self, entry: QueueEntry):
        """Actually run the job via Runner."""
        entry.status = "running"
        try:
            rj = await self._runner.run(
                entry.cmd, cwd=entry.cwd,
                project=entry.project, job_id=entry.job_id
            )
            entry.run_id = rj.id
            entry.status = "done" if rj.exit_code == 0 else "failed"
        except Exception:
            entry.status = "failed"


queue_manager = QueueManager(runner)


# ── GPU job whitelist: subcommands that use GPU even without explicit flag ──
_GPU_SUBCOMMANDS = {
    'fs_motion_and_ctf', 'fs_ctf', 'ts_ctf',
    'ts_reconstruct', 'ts_export_particles',
}
# ── Multi-GPU fixed jobs: GPU override not allowed ──
_FIXED_GPU_SUBCOMMANDS = {
    'train', 'predict',  # Miss Alignment uses --gpus + --reconstruction-devices
}

def _parse_job_resources(cmd: str, config_gpus: str = '') -> dict:
    """Parse GPU/resource info from a job command.

    Returns a dict with:
      gpu_ids, gpu_source, perdevice, total_workers,
      tool, subcommand, is_gpu_job, allows_gpu_override, resource_line
    """
    import re
    result = {
        'gpu_ids': [], 'gpu_source': 'none',
        'perdevice': None, 'total_workers': None,
        'tool': '', 'subcommand': '',
        'is_gpu_job': False, 'allows_gpu_override': False,
        'resource_line': 'CPU only',
        'has_fixed_gpus': False,
    }

    # ── Tool + subcommand ──
    # Normalize: collapse newlines/backslash continuations to spaces
    cmd_norm = ' '.join(line.rstrip('\\').strip() for line in cmd.splitlines() if line.strip())
    cmd_norm = ' '.join(cmd_norm.split())  # collapse remaining whitespace
    # Strip activation prefix (everything up to last &&)
    stripped = re.sub(r'^.*&&\s*', '', cmd_norm.strip())
    # Strip ENV=VAL prefixes (e.g. CUDA_VISIBLE_DEVICES=0,1 miss-alignment ...)
    stripped = re.sub(r'^(?:[A-Z_]+=\S+\s+)+', '', stripped)
    # Also use cmd_norm for all subsequent regex searches
    cmd = cmd_norm
    tokens = stripped.split()
    if tokens:
        result['tool'] = tokens[0]
        if len(tokens) > 1:
            result['subcommand'] = tokens[1]

    # ── perdevice ──
    m = re.search(r'--perdevice\s+(\d+)', cmd)
    if m:
        result['perdevice'] = int(m.group(1))

    # ── GPU IDs from command ──
    gpu_ids = _extract_gpu_ids(cmd)
    if gpu_ids:
        result['gpu_ids'] = gpu_ids
        result['gpu_source'] = 'command'
        result['is_gpu_job'] = True
        # Miss Alignment has both --gpus and --reconstruction-devices → fixed
        has_recon  = bool(re.search(r'--reconstruction-devices?', cmd, re.IGNORECASE))
        has_gpus   = bool(re.search(r'--gpus?\s+', cmd, re.IGNORECASE))
        has_train  = bool(re.search(r'--training-devices?\s+', cmd, re.IGNORECASE))
        # Miss Alignment: has reconstruction-devices + (gpus or training-devices)
        result['has_fixed_gpus'] = has_recon and (has_gpus or has_train)
        result['allows_gpu_override'] = not result['has_fixed_gpus']
    else:
        # No GPU flag — check whitelist
        sub = result['subcommand'].lower()
        if any(sub == s for s in _GPU_SUBCOMMANDS):
            result['is_gpu_job'] = True
            result['gpu_source'] = 'config_fallback'
            result['allows_gpu_override'] = True
            # Use config GPUs as default
            if config_gpus:
                ids = [int(x) for x in re.findall(r'\d+', config_gpus)]
                result['gpu_ids'] = sorted(set(ids))
        elif result['tool'] in ('AreTomo3', 'pytom_match_project.py', 'pytom',
                               'miss-alignment', 'miss_alignment'):
            result['is_gpu_job'] = True
            result['gpu_source'] = 'config_fallback'
            result['allows_gpu_override'] = True
            if config_gpus:
                ids = [int(x) for x in re.findall(r'\d+', config_gpus)]
                result['gpu_ids'] = sorted(set(ids))

    # ── total_workers ──
    if result['gpu_ids'] and result['perdevice']:
        result['total_workers'] = len(result['gpu_ids']) * result['perdevice']

    # ── resource_line ──
    if result['is_gpu_job']:
        gpu_label = 'GPU ' + ', '.join(str(g) for g in result['gpu_ids']) if result['gpu_ids'] else 'GPU (config)'
        parts = [gpu_label]
        if result['total_workers']:
            parts.append(f"{result['total_workers']} workers")
        elif result['perdevice'] and result['gpu_ids']:
            parts.append(f"{len(result['gpu_ids'])} GPU × {result['perdevice']}/GPU")
        src = '' if result['gpu_source'] == 'command' else ' (from project config)'
        result['resource_line'] = ' · '.join(parts) + src
    else:
        result['resource_line'] = 'CPU only'

    return result


def _extract_gpu_ids(cmd: str) -> list[int]:
    """Extract unique GPU IDs from a job command string.

    Handles patterns used by:
    - WarpTools:       --device_list 0 1
    - AreTomo3:        --Device 0 1
    - Miss Alignment:  --gpus 0,1  and  --reconstruction-devices 2,2,3,3
    - Generic:         --gpu 0
    """
    import re
    gpu_ids: set[int] = set()

    # Patterns: flag followed by space-separated or comma-separated integers
    patterns = [
        r'--device[_-]?list\s+([\d,\s]+)',
        r'--Device\s+([\d,\s]+)',
        r'--gpus?\s+([\d,\s]+)',
        r'--reconstruction-devices?\s+([\d,\s]+)',
        r'--training-devices?\s+([\d,\s]+)',
        r'--gpu\s+([\d,\s]+)',
    ]
    for pat in patterns:
        m = re.search(pat, cmd, re.IGNORECASE)
        if m:
            # Extract all integers from the matched group
            nums = re.findall(r'\d+', m.group(1))
            for n in nums:
                gpu_ids.add(int(n))

    return sorted(gpu_ids)