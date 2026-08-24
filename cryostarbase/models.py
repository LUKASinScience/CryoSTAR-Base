"""Data models for CryoSTAR-Base.

Written together by Lukas W. Bauer und Claude — 2026.
"""

from pathlib import Path
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime

# ═══════════════════════════════════════════
#  ENUMS
# ═══════════════════════════════════════════

class JobStatus(str, Enum):
    QUEUED     = "queued"
    RUNNING    = "running"
    COMPLETED  = "completed"
    FAILED     = "failed"
    CANCELLED  = "cancelled"

# ═══════════════════════════════════════════
#  WORKSPACE + PROJECT CONFIG
# ═══════════════════════════════════════════

PROJECT_SUFFIX = "_base"

class WorkspaceConfig(BaseModel):
    workspace_dir: Path = Field(default_factory=lambda: Path.cwd())
    allowed_extensions: list[str] = Field(default=[
        ".star", ".mrc", ".rec", ".txt", ".log", ".json", ".md",
        ".sh", ".py", ".toml", ".yaml", ".yml", ".csv",
        ".tlt", ".mdoc", ".defocus", ".com", ".xml",
    ])
    max_read_bytes: int = 50_000_000

PROGRAM_DEFS: list[dict] = [
    # check_strategies: [{cmd, hint}] tried in order — first success wins.
    #   IMPORTANT: never use "| head -1" — it makes exit_code always 0 (false positives).
    #   Use "which" as reliable fallback — exit_code 0 = found, non-zero = not found.
    #   hint: substring REQUIRED in stdout/stderr — empty hint means exit_code alone decides.
    {"id": "warptools", "label": "WarpTools",     "color": "#a78bfa",
     "default_type": "conda",
     "check_strategies": [
         {"cmd": "which WarpTools",    "hint": "warptools"},
         {"cmd": "WarpTools 2>&1",     "hint": "warptools"},
     ]},
    {"id": "missalign", "label": "Miss Alignment","color": "#a78bfa",
     "default_type": "conda",
     "check_strategies": [
         {"cmd": "which miss-alignment",        "hint": "miss"},
         {"cmd": "miss-alignment --help 2>&1",  "hint": "miss"},
     ],
     "extra_fields": [{"key": "config", "label": "config.yaml path",
                       "placeholder": "/path/to/miss-alignment/config.yaml"}]},
    {"id": "pytom",     "label": "PyTom",          "color": "#22c55e",
     "default_type": "conda",
     "check_strategies": [
         {"cmd": "which pytom_match_template.py",             "hint": "pytom"},
         {"cmd": "pytom_match_template.py --help 2>&1",       "hint": "pytom"},
     ]},
    {"id": "relion",    "label": "RELION",          "color": "#3b82f6",
     "default_type": "system",
     "check_strategies": [
         {"cmd": "which relion",         "hint": "relion"},
         {"cmd": "relion --version 2>&1","hint": "relion"},
     ]},
    {"id": "imod",      "label": "IMOD",            "color": "#f59e0b",
     "default_type": "system",
     "check_strategies": [
         {"cmd": "which imod",           "hint": "imod"},
         {"cmd": "which 3dmod",          "hint": "3dmod"},
     ]},
    {"id": "aretomo3",  "label": "AreTomo3",        "color": "#f59e0b",
     "default_type": "system",
     "check_strategies": [
         {"cmd": "which AreTomo3",       "hint": "aretomo"},
         {"cmd": "AreTomo3 2>&1",        "hint": "aretomo"},
     ],
     "extra_fields": [{"key": "binary", "label": "Binary path",
                       "placeholder": "AreTomo3  or  /opt/AreTomo3/AreTomo3"}]},
    {"id": "slabify",   "label": "Slabify",         "color": "#22c55e",
     "default_type": "conda",
     "check_strategies": [
         {"cmd": "which slabify",        "hint": "slabify"},
         {"cmd": "slabify --help 2>&1",  "hint": "slabify"},
     ]},
    {"id": "chimerax",  "label": "ChimeraX",        "color": "#06b6d4",
     "default_type": "system",
     "check_strategies": [
         {"cmd": "which chimerax",           "hint": "chimerax"},
         {"cmd": "chimerax --version 2>&1",  "hint": "chimerax"},
     ]},
    {"id": "isonet",    "label": "IsoNet",          "color": "#06b6d4",
     "default_type": "conda",
     "check_strategies": [
         {"cmd": "which isonet.py",      "hint": "isonet"},
         {"cmd": "which isonet2",        "hint": "isonet"},
     ]},
    {"id": "ais",       "label": "Ais",             "color": "#0891b2",
     "default_type": "conda",
     "check_strategies": [
         {"cmd": "python -c \"import ais; print(ais.__file__)\"", "hint": "ais"},
         {"cmd": "which ais",                                        "hint": "ais"},
     ]},
]

class ProgramEntry(BaseModel):
    """Configuration for a single external program/tool."""
    type: str = "conda"          # "conda" | "module" | "system"
    env: str = ""                # conda env name OR module name/version
    cmd: str = ""                # activation command — auto-generated or custom
    version: str = ""            # version string for display
    source_script: str = ""      # system: path to shell script to source
                                 #   e.g. /opt/relion/activate_relion.sh
    binary: str = ""             # system: path or name of executable binary
                                 #   e.g. /home/user/AreTomo3/AreTomo3
                                 #   e.g. chimerax (if in PATH)
    extra: dict = Field(default_factory=dict)  # program-specific: {"config": "..."}

    def build_cmd(self) -> str:
        """Auto-generate activation command. Returns empty string if not configured."""
        if self.type == "conda" and self.env:
            return f"conda activate {self.env}"
        if self.type == "module" and self.env:
            return f"module load {self.env}"
        if self.type == "system":
            # Build from source_script and/or binary
            if self.source_script and self.binary:
                return f"source {self.source_script}"  # binary used separately
            if self.source_script:
                return f"source {self.source_script}"
            if self.binary:
                return self.binary  # binary is the activation/command itself
        return self.cmd

class ProjectConfig(BaseModel):
    project_name: str = ""
    project_dir: Path = Field(default_factory=lambda: Path.cwd())
    created_at: str = ""

    # People
    investigators: list[str] = []

    # Source
    warptools_dir: str = ""

    # Pre-processing paths & defaults
    warp_frames_dir: str = "frames"
    warp_mdocs_dir: str = "mdocs"
    warp_gain_path: str = ""
    warp_gain_flip_y: bool = True
    warp_frameseries_settings: str = "warp_frameseries.settings"
    warp_tiltseries_settings: str = "warp_tiltseries.settings"
    warp_tomo_dimensions: str = ""
    warp_tilt_exposure: float = 0.0
    warp_m_grid: str = "1x1x8"
    warp_c_grid: str = "2x2x1"
    warp_c_range_max: int = 7
    warp_c_defocus_max: int = 8
    warp_initial_axis: float = 85.0  # FIXED: Changed from int to float (MDOC sends 86.9)
    warp_patch_size: int = 2000
    warp_min_intensity: float = 0.3
    tomo_name: str = ""

    # Inspect Data — selection file path (saved from Inspect Data tab)
    selection_file: str = ""              # path to selected_stacks.txt

    # Data collection — set in step 2
    raw_pixel_size: float = 0.0          # angstrom at detector
    binning_factor: float = 1.0          # binning applied
    bin_pixel_size: float = 0.0          # = raw_pixel_size * binning_factor (binned, for ts_reconstruct/ts_etomo)
    tomo_dims: list[Optional[int]] = []  # [X, Y, Z] in voxels
    # Note: Z may be None/0 until set by user — never auto-filled from MDOC
    tomo_suffix: str = ""
    collection_date: str = ""
    collection_investigators: list[str] = []
    voltage: int = 0
    spherical_aberration: float = 2.7
    amplitude_contrast: float = 0.07

    # Microscope & optics
    microscope: str = ""                  # e.g. "Titan Krios G4"
    camera: str = ""                      # e.g. "Falcon 4i"
    magnification: int = 0               # e.g. 105000
    energy_filter_slit: float = 0.0      # eV
    c2_aperture: float = 0.0             # µm

    # Data collection parameters
    collection_software: str = ""        # e.g. "TOM5", "SerialEM"
    collection_software_version: str = ""
    tilt_scheme: str = ""                # e.g. "Dose symmetric"
    tilt_min: float = 0.0                # degrees
    tilt_max: float = 0.0                # degrees
    tilt_step: float = 0.0               # degrees
    start_angle: float = 0.0             # degrees
    pre_tilt: float = 0.0                # degrees
    n_tilts: int = 0                     # auto-calculated
    total_dose: float = 0.0              # e⁻/Å²
    dose_per_tilt: float = 0.0           # auto-calculated
    flux: float = 0.0                    # e⁻/Å²/s
    frames_per_tilt: int = 0
    cds_mode: str = ""                   # correlated double sampling mode

    # Defocus
    defocus_min: float = 0.0             # µm
    defocus_max: float = 0.0             # µm

    # Sample
    sample_type: str = ""                # e.g. "Lamella", "Plunge-frozen"
    lamella_thickness: float = 0.0       # nm

    at3_work_dir: str = ""               # AreTomo3 working directory (preprocessing_root/aretomo3/)
    at3_input_dir: str = ""              # AreTomo3 input dir with frames + MDOCs together

    # Sample
    sample_description: str = ""
    sample_prep_date: str = ""
    sample_protocols: str = ""           # free text, comma-sep or multiline
    sample_investigators: list[str] = []

    # Particle — set later
    particle_diameter: float = 0.0
    box_size: int = 0  # Legacy single value
    box_sizes_by_binning: dict[str, int] = {}  # NEW: box sizes per binning (e.g., {"1": 200, "4": 64})
    mask_radius: float = 0.0
    symmetry: int = 1
    particle_investigators: list[str] = []

    # Pre-processing tool selection
    preprocessing_tool: str = "warptools"   # "warptools" | "aretomo3" | "imod"
    use_no_flip: bool = False
    warptools_version: str = ""
    aretomo_version: str = ""
    warptools_settings: str = "warp_tiltseries.settings"
    
    # AreTomo3 specific settings
    aretomo3_alignz: int = 600  # Volume Z height for alignment (must be < tomo_dims[2] / VolZ)
    imod_dir: str = ""                   # preprocessing/imod/
    mdocs_pretilt_dir: str = ""          # preprocessing/mdocs_pretilt/
    pretilt_angle: float = 0.0           # pretilt correction angle in degrees

    # Tab completion status (for green/yellow indicators)
    tab_status: dict = {}   # {tab_id: "complete"|"partial"|"empty"}

    # Initial reference
    reference_method: str = ""           # "pdb_molmap" | "manual_picking" | ""
    reference_pdb_id: str = ""
    reference_molmap_resolution: float = 0.0
    reference_picking_tool: str = ""
    reference_picking_resolution: float = 0.0
    reference_handedness: str = ""       # "normal" | "inverted" | ""
    reference_notes: str = ""

    # Computing
    compute_gpus: str = ""
    compute_host: str = ""               # workstation name / cluster name
    compute_type: str = ""               # "workstation" | "cluster" | ""
    compute_scheduler: str = ""          # "none" | "SLURM" | "PBS" | "LSF" | "SGE"
    compute_execution_mode: str = ""     # "direct" | "slurm" | "" (not yet configured)
    compute_slurm_partition: str = ""    # e.g. "gpu"
    compute_slurm_reservation: str = ""  # e.g. "schurgrp_199" — leave empty if none
    compute_slurm_time: str = "24:00:00"
    compute_slurm_mem: str = "64G"
    compute_slurm_cpus: int = 1
    compute_notes: str = ""
    compute_investigators: list[str] = []

    # Programs (set in ⬡ Setup tab) — keyed by program id e.g. "warptools", "missalign"
    programs: dict[str, "ProgramEntry"] = Field(default_factory=dict)

    # Global conda base path — used to build activation scripts
    conda_base_path: str = ""   # e.g. "/opt/anaconda3" or "/opt/miniforge3"

    # Template check state (checklist)
    tm_check_state: dict = {}

    # Connected projects (cross-project particle references)
    connected_projects: list[dict] = []  # [{folder, description, particle_count, date, reason}]

    # Shared preprocessing — other projects using the same warptools_dir
    shared_preprocessing_projects: list[str] = []  # [folder_name, ...]

    # Files (set as created)
    template_file: Optional[str] = None
    mask_file: Optional[str] = None
    results_dir: Optional[str] = None

    # Job counter
    next_job_num: int = 1

    def save(self, project_dir: "Path | str | None" = None):
        """Write to <project_dir>/cryostarbase.json. Pass the path the config
        was actually loaded from (or the project's current folder) explicitly
        whenever you have it — falling back to self.project_dir (below) writes
        to wherever this config *thinks* it lives, which goes stale the moment
        a project folder or the host username changes."""
        target = Path(project_dir) if project_dir is not None else Path(self.project_dir)
        p = target / "cryostarbase.json"
        json_data = self.model_dump_json(indent=2)
        print(f"[ProjectConfig.save] Saving to: {p}")
        print(f"[ProjectConfig.save] Data (first 500 chars): {json_data[:500]}...")
        p.write_text(json_data)
        print(f"[ProjectConfig.save] ✓ Saved successfully")

    @classmethod
    def safe_load(cls, project_dir: Path) -> 'Optional[ProjectConfig]':
        """Load config without raising — returns None if corrupt. For discovery only."""
        try:
            return cls.load(project_dir)
        except Exception:
            return None

    @classmethod
    def load(cls, project_dir: Path) -> "ProjectConfig":
        cfg_file = project_dir / "cryostarbase.json"
        print(f"[ProjectConfig.load] Loading from: {cfg_file}")
        if cfg_file.exists():
            try:
                cfg = cls.model_validate_json(cfg_file.read_text())
                print(f"[ProjectConfig.load] ✓ Loaded - voltage: {cfg.voltage}, magnification: {cfg.magnification}")
                return cfg
            except Exception as e:
                # CRITICAL: never fall back to defaults if file exists but is corrupt!
                # Falling back would reset next_job_num=1 and overwrite existing jobs on next save()
                print(f"[ProjectConfig.load] ✗ ERROR parsing JSON: {e}")
                raise RuntimeError(f"Config file exists but could not be parsed: {cfg_file}\nError: {e}\nDo NOT overwrite — fix the JSON manually.") from e
        else:
            print(f"[ProjectConfig.load] File not found, creating defaults")
        name = project_dir.name.replace(PROJECT_SUFFIX, "")
        return cls(project_name=name, project_dir=project_dir)

    def allocate_job_id(self) -> str:
        """Allocate next job ID by scanning actual job files — robust against GVFS/SMB caching."""
        proj = Path(self.project_dir)
        jobs_dir = proj / "cryostarbase" / "jobs"
        existing_nums = []
        if jobs_dir.exists():
            for f in jobs_dir.glob("J*.json"):
                try:
                    existing_nums.append(int(f.stem[1:]))
                except ValueError:
                    pass
        next_num = max(max(existing_nums, default=0) + 1, self.next_job_num)
        self.next_job_num = next_num + 1
        self.save()
        return f"J{next_num:03d}"

    def peek_next_job_id(self) -> str:
        """Preview the next job ID without allocating it — for Job Builder display."""
        proj = Path(self.project_dir)
        jobs_dir = proj / "cryostarbase" / "jobs"
        existing_nums = []
        if jobs_dir.exists():
            for f in jobs_dir.glob("J*.json"):
                try:
                    existing_nums.append(int(f.stem[1:]))
                except ValueError:
                    pass
        next_num = max(max(existing_nums, default=0) + 1, self.next_job_num)
        return f"J{next_num:03d}"

# Resolve forward reference
ProjectConfig.model_rebuild()

# ═══════════════════════════════════════════
#  JOB RECORD
# ═══════════════════════════════════════════

class JobRecord(BaseModel):
    job_id: str = ""
    job_type: str = ""
    title: str = ""
    command: str = ""
    parameters: dict[str, Any] = {}
    working_dir: str = "."
    status: str = "queued"
    created_at: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    exit_code: Optional[int] = None
    output_files: list[str] = []
    notes: str = ""
    # CryoSPARC-inspired additions
    tags: list[str] = []                # free-text tags e.g. ["test", "bin8", "final"]
    parent_jobs: list[str] = []         # job_ids this job depends on / was built from
    log_lines: list[str] = []          # captured stdout/stderr lines
    doc_url: str = ""                   # link to documentation for this job type
    custom_title: str = ""             # user-editable title (overrides auto title)
    dashboard_data: dict[str, Any] = {}  # parsed output metrics for job dashboard

    def display_title(self) -> str:
        return self.custom_title or self.title or f"{self.job_type} ({self.job_id})"

    def log_path(self, project_dir: Path) -> Path:
        return project_dir / "cryostarbase" / "jobs" / f"{self.job_id}.log"

    def save(self, project_dir: Path):
        d = project_dir / "cryostarbase" / "jobs"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{self.job_id}.json").write_text(self.model_dump_json(indent=2))

    def append_log(self, project_dir: Path, line: str):
        """Append a log line to the job's .log file."""
        lp = self.log_path(project_dir)
        with open(lp, "a") as f:
            f.write(line + "\n")

    def read_log(self, project_dir: Path) -> list[str]:
        """Read all log lines from the job's .log file."""
        lp = self.log_path(project_dir)
        if lp.exists():
            return lp.read_text().splitlines()
        return self.log_lines  # fallback to embedded

    @classmethod
    def load(cls, project_dir: Path, job_id: str) -> Optional["JobRecord"]:
        p = project_dir / "cryostarbase" / "jobs" / f"{job_id}.json"
        if p.exists():
            return cls.model_validate_json(p.read_text())
        return None

# ═══════════════════════════════════════════
#  WORKFLOW
# ═══════════════════════════════════════════

class WorkflowStep(BaseModel):
    """One step in a workflow — maps to a job template."""
    step_num: int
    label: str                        # display name e.g. "Import"
    job_types: list[str]              # e.g. ["link_reconstruction","copy_xmls","extract_xml"]
    parameters: dict[str, Any] = {}  # pre-filled params (can be overridden at run time)
    compute: str = "cpu"              # "cpu" | "gpu"
    color: str = "#3b82f6"
    wait_for_exit_zero: bool = True   # stop pipeline if previous step fails

class WorkflowRecord(BaseModel):
    """A saved workflow definition for a project."""
    workflow_id: str = ""
    name: str = ""
    description: str = ""
    steps: list[WorkflowStep] = []
    created_at: str = ""
    last_run_at: Optional[str] = None
    last_run_status: str = ""         # "" | "running" | "completed" | "failed" | "cancelled"
    last_run_job_ids: list[str] = []  # job_ids created in last run, in order

    def save(self, project_dir: Path):
        d = project_dir / "cryostarbase" / "workflows"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{self.workflow_id}.json").write_text(self.model_dump_json(indent=2))

    @classmethod
    def load(cls, project_dir: Path, workflow_id: str) -> Optional["WorkflowRecord"]:
        p = project_dir / "cryostarbase" / "workflows" / f"{workflow_id}.json"
        if p.exists():
            return cls.model_validate_json(p.read_text())
        return None

# ═══════════════════════════════════════════
#  REQUEST MODELS
# ═══════════════════════════════════════════

class CreateProjectRequest(BaseModel):
    """Step 1: identity + source."""
    target_name: str
    warptools_dir: str = ""          # existing preprocessing warptools/ path — if given, use directly
    tomo_name: str = ""
    investigators: list[str] = []
    processing_dir: str = ""         # where to create the project folder
    preprocessing_name: str = ""     # if warptools_dir empty: name for new preprocessing root folder
    preprocessing_path: str = ""     # if warptools_dir empty: parent path for new preprocessing root

class SetupDataRequest(BaseModel):
    """Step 2: data collection parameters."""
    x_dim: int
    y_dim: int
    z_dim: int = 0          # optional — can be left blank in wizard
    raw_pixel_size: float
    binning_factor: float

class RunRequest(BaseModel):
    command: str
    working_dir: str = "."
    env: Optional[dict] = None
    project: str = ""

class RunJobRequest(BaseModel):
    project: str
    job_type: str
    title: str = ""
    parameters: dict[str, Any] = {}
    command: Optional[str] = None
    notes: str = ""

class NoteRequest(BaseModel):
    project: str
    text: str

class JobNoteRequest(BaseModel):
    notes: str

class ConvertCoordsRequest(BaseModel):
    project: str
    input_star: str
    output_star: str
    x_dim: int
    y_dim: int
    z_dim: int
    pixel_size: float
    suffix: str = "_11.06Apx"

# ═══════════════════════════════════════════
#  TEMPLATES
# ═══════════════════════════════════════════

TEMPLATE_CATEGORIES = [
    {"id": "import",       "name": "Import Data",              "color": "#f59e0b", "order": 0},
    {"id": "aretomo3",     "name": "AreTomo3 Pre-Processing",  "color": "#38bdf8", "order": 2},
    {"id": "warp_preproc", "name": "WarpTools Pre-Processing", "color": "#a78bfa", "order": 2},
    {"id": "pytom",        "name": "PyTOM Scripts",            "color": "#22c55e", "order": 3},
    {"id": "warp_export",  "name": "WarpTools Export",         "color": "#a78bfa", "order": 4},
    {"id": "miss_align",   "name": "Miss Alignment",           "color": "#a78bfa", "order": 5, "badge": "EXPERIMENTAL"},
    {"id": "relion",       "name": "RELION",                   "color": "#3b82f6", "order": 6},
    {"id": "mtools",       "name": "M / MTools",               "color": "#a78bfa", "order": 7},
    {"id": "convert",      "name": "Convert",                  "color": "#888780", "order": 8},
    {"id": "other",        "name": "Other Scripts",            "color": "#888780", "order": 9},
]

# Documentation URLs for job types (shown as embedded links in job detail)
JOB_DOC_URLS: dict[str, str] = {
    "tm_single":            "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#2-matching-the-template-in-a-tomogram",
    "tm_batch":             "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#2-matching-the-template-in-a-tomogram",
    "extract_single":       "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#3-extracting-particles",
    "extract_batch":        "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#3-extracting-particles",
    "create_template":      "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#1-creating-a-template-and-mask",
    "create_mask":          "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#1-creating-a-template-and-mask",
    "mtools_create_population":  "https://warpem.github.io/warp/reference/mtools/api/mtools/#create_population",
    "mtools_create_source":      "https://warpem.github.io/warp/reference/mtools/api/mtools/#create_source",
    "mtools_create_species":     "https://warpem.github.io/warp/reference/mtools/api/mtools/#create_species",
    "mcore_refine":              "https://warpem.github.io/warp/reference/mtools/api/mcore/",
    "mcore_ctf_refine":          "https://warpem.github.io/warp/reference/mtools/api/mcore/",
    "warp_create_settings_fs":   "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#create-warp-settings-files",
    "warp_create_settings_ts":   "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#create-warp-settings-files",
    "warp_fs_motion_ctf":        "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#frame-series-motion-and-ctf-estimation",
    "warp_filter_quality":       "https://warpem.github.io/warp/reference/warptools/api/general/",
    "warp_ts_import":            "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#tilt-series-import",
    "warp_ts_etomo":             "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#tilt-series-alignment",
    "warp_ts_import_alignments": "https://warpem.github.io/warp/reference/warptools/custom_tilt_series_alignments/",
    "miss_alignment_train":      "https://github.com/warpem/miss-alignment",
    "warp_ts_defocus_hand":      "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#tilt-series-check-defocus-handedness",
    "warp_ts_ctf":               "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#tilt-series-ctf-estimation",
    "warp_ts_reconstruct":       "https://warpem.github.io/warp/user_guide/warptools/quick_start_warptools_tilt_series/#tilt-series-reconstruct-tomograms",
    "warp_export_particles":"https://warpem.github.io/user_guide/warptools/quick_start_warptools_tilt_series/#export-particles",
    "warp_export_slurm":    "https://warpem.github.io/user_guide/warptools/quick_start_warptools_tilt_series/#export-particles",
    "pytom2warp_convert":   "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#4-merging-annotations-for-export-to-other-software",
    "merge_stars":          "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#4-merging-annotations-for-export-to-other-software",
    "extract_xml":          "https://github.com/builab/subtomo_scripts/tree/main/pytom_tm",
    "slabify":              "https://github.com/CellArchLab/slabify-et",
    "star_score_match":            "https://sbc-utrecht.github.io/pytom-match-pick/Usage/#4-preparing-for-relion",
    "link_reconstruction":            "https://github.com/SBC-Utrecht/PyTom",
    "tm_analysis":            "https://github.com/SBC-Utrecht/PyTom",
    "relion_class3d":          "https://relion.readthedocs.io/en/release-5.0/STA_tutorial/Class3D.html",
    "relion_initial_model":    "https://relion.readthedocs.io/en/release-5.0/Reference/InitialModel.html",
    "aretomo3_mdoc_fix":       "https://github.com/czimaginginstitute/AreTomo3",
    "aretomo3_batch":          "https://github.com/czimaginginstitute/AreTomo3",
    "aretomo3_collect":        "https://warpem.github.io/warp/reference/warptools/custom_tilt_series_alignments/",
}

TEMPLATES = [
    # ── Import Data (blue) ──
    {
        "id": "link_reconstruction", "compute": "cpu",
        "name": "Link Reconstruction",
        "description": "Link tomogram reconstruction directory into _pytom/ for PyTom. Hardlink: works on server (same volume), no extra space. Symlink: local filesystem only, fails on most servers.",
        "category": "import",
        "command_hardlink": "mkdir -p $(dirname {link_name}) && ln {source} {link_name}",
        "command_symlink":  "mkdir -p $(dirname {link_name}) && ln -s {source} {link_name}",
        "parameters": [
            {"key": "mode", "label": "Link mode", "type": "pill_toggle",
             "options": ["hardlink", "symlink"], "default": "hardlink",
             "help": "Hardlink: works on server when source and dest are on the same volume. Symlink: local filesystem only (fails on some servers)."},
            {"key": "source",    "label": "Source reconstruction dir (absolute path)", "type": "path", "required": True,
             "from_project": "pytom_tomo_dir",
             "help": "Full path to warptools_dir/warp_tiltseries/reconstruction"},
            {"key": "link_name", "label": "Link target path", "type": "path", "default": "_pytom/reconstruction",
             "help": "Relative path inside project — keep as _pytom/reconstruction"},
        ],
    },
    {
        "id": "copy_xmls", "compute": "cpu",
        "name": "Copy Warp XMLs",
        "description": "Copy .xml files from WarpTools into project _pytom/xml/ directory",
        "category": "import",
        "command": "cp {source}/*.xml _pytom/xml/",
        "parameters": [
            {"key": "source", "label": "Source XML directory (absolute path)", "type": "path", "required": True,
             "help": "Full path to warptools_dir/warp_tiltseries/ (where .xml files live)"},
        ],
    },
    {
        "id": "extract_xml", "compute": "cpu",
        "name": "Extract Warp XML Info",
        "description": "Extract tilt angles, dose, and defocus from WarpTools XML files for PyTom. No Warp installation needed — uses Python stdlib only, run in cryostarbase_env or pytom_tm. MUST run BEFORE TM Batch. Batch: select the _pytom/xml/ directory. Single: select one .xml file.",
        "category": "pytom",
        "command_batch":  "python -m cryostarbase.scripts.extract_warp_xml {no_flip} --xml-dir {xml_dir}",
        "command_single": "python -m cryostarbase.scripts.extract_warp_xml {no_flip} {xml_file}",
        "command": "python -m cryostarbase.scripts.extract_warp_xml {no_flip} --xml-dir {xml_dir}",
        "parameters": [
            {"key": "mode",     "label": "Mode",
             "type": "select", "options": ["batch", "single"], "default": "batch",
             "help": "Batch: process all XMLs in a directory. Single: process one XML file."},
            {"key": "xml_dir",  "label": "XML directory", "type": "path", "default": "_pytom/xml", "from_project": "pytom_xml_dir",
             "help": "Directory containing XML files (batch mode — processes all *.xml)"},
            {"key": "xml_file", "label": "XML file",      "type": "path", "default": "",
             "help": "Single XML file to process (single mode)"},
            {"key": "no_flip",  "label": "Angle handling",
             "type": "select", "options": ["--no-flip", ""], "default": "--no-flip",
             "help": "--no-flip for WarpTools / linux Warp"},
        ],
    },
    {
        "id": "slabify", "compute": "cpu",
        "name": "Slabify Tomogram Masks",
        "description": "Generate lamella boundary masks for all tomograms using slabify-et. Input: WarpTools reconstruction dir. Output: _pytom/slabified/. Masks are used by PyTom template matching (--tomo-mask-dir).",
        "category": "slabify",
        "command": "python -m cryostarbase.scripts.slabify_loop -i {input_dir} -o {output_dir}",
        "parameters": [
            {"key": "input_dir",  "label": "Reconstruction dir", "type": "path", "required": True,
             "from_project": "pytom_tomo_dir",
             "help": "warp_tiltseries/reconstruction/ — auto-filled from WarpTools dir"},
            {"key": "output_dir", "label": "Output mask dir",    "type": "path", "required": True,
             "from_project": "pytom_slabified_dir",
             "help": "_pytom/slabified/ — auto-filled from project dir. Used by PyTom --tomo-mask-dir"},
        ],
    },

    
    
    
    
    
    

{
        "id": "import_frames_warp", "compute": "cpu",
        "name": "Import Frames (WarpTools)",
        "description": "Import raw frame files (.tif/.eer) into WarpTools frames/ directory. Hardlink (recommended for server): zero extra space, requires source and dest on same volume. Symlink: local filesystem only, fails on most servers. Copy (rsync): works everywhere, uses disk space.",
        "category": "import",
        "command_hardlink": "mkdir -p {dest} && find {archive_source} -maxdepth 1 \\( -name '*.tif' -o -name '*.eer' -o -name '*.mrc' \\) -exec ln {{}} {dest}/ \\;",
        "command_symlink": "mkdir -p {dest} && find {archive_source} -maxdepth 1 \\( -name '*.tif' -o -name '*.eer' -o -name '*.mrc' \\) -exec ln -sf {{}} {dest}/ \\;",
        "command_copy": "mkdir -p {dest} && rsync -av --inplace --ignore-existing {archive_source}/ {dest}/",
        "command_filtered": "python3 -c \"import sys; exec(open(sys.argv[1]).read())\" {__filter_script} {archive_source} {dest} {selection_file} {mode} frames",
        "parameters": [
            {"key": "mode", "label": "Import mode", "type": "pill_toggle",
             "options": ["hardlink", "symlink", "copy"], "default": "hardlink",
             "help": "Hardlink: zero extra space, works when source and dest are on the same server volume. Symlink: no extra space, local filesystem only (fails on some servers). Copy: rsync, works everywhere, uses disk space."},
            {"key": "filter_mode", "label": "Filter files", "type": "pill_toggle",
             "options": ["all", "from_selection"], "default": "all",
             "help": "All: import all frames. From selection: only import stacks listed in selection file (saved from Inspect Data tab)."},
            {"key": "selection_file", "label": "Selection file (selected_stacks.txt)", "type": "path",
             "help": "Path to selected_stacks.txt saved from Inspect Data tab. Only used when Filter = from_selection.",
             "autofill": True},
            {"key": "archive_source", "label": "Source frames directory (archive path) *", "type": "path", "required": True,
             "help": "Full path to frames directory on archive — e.g. /mnt/isilon/.../tomo/ containing .tif or .eer files"},
            {"key": "dest", "label": "Destination directory", "type": "path",
             "default": "warptools/frames",
             "help": "Relative to preprocessing root — e.g. warptools/frames"},
        ],
    },
    {
        "id": "import_mdocs_warp", "compute": "cpu",
        "name": "Import MDOCs (WarpTools)",
        "description": "Import .mdoc metadata files into WarpTools mdocs/ directory. Always copies — MDOCs must be editable locally (Fix MDOC Paths step).",
        "category": "import",
        "command": "mkdir -p {dest} && find {archive_source} -maxdepth 1 -name '*.mdoc' -exec rsync --inplace {} {dest}/ \\;",
        "parameters": [
            {"key": "filter_mode", "label": "Filter files", "type": "pill_toggle",
             "options": ["all", "from_selection"], "default": "all",
             "help": "All: import all MDOCs. From selection: only import MDOCs for stacks in selection file."},
            {"key": "selection_file", "label": "Selection file (selected_stacks.txt)", "type": "path",
             "help": "Path to selected_stacks.txt saved from Inspect Data tab. Only used when Filter = from_selection.",
             "autofill": True},
            {"key": "archive_source", "label": "Source MDOCs directory (archive path) *", "type": "path", "required": True,
             "help": "Full path to directory containing .mdoc files on archive — usually same as frames directory"},
            {"key": "dest", "label": "Destination directory", "type": "path",
             "default": "warptools/mdocs",
             "help": "Relative to preprocessing root — e.g. warptools/mdocs"},
        ],
    },
    {
        "id": "import_frames_aretomo3", "compute": "cpu",
        "name": "Import Frames (AreTomo3)",
        "description": "Import raw frames into AreTomo3 input directory. AreTomo3 requires .tif/.eer and .mdoc files in the SAME folder. Hardlink (recommended for server): zero extra space, requires source and dest on same volume. Symlink: local filesystem only. Copy (rsync): works everywhere.",
        "category": "import",
        "command_hardlink": "mkdir -p {dest} && find {archive_source} -maxdepth 1 \\( -name '*.tif' -o -name '*.eer' -o -name '*.mrc' \\) -exec ln {{}} {dest}/ \\;",
        "command_symlink": "mkdir -p {dest} && find {archive_source} -maxdepth 1 \\( -name '*.tif' -o -name '*.eer' -o -name '*.mrc' \\) -exec ln -sf {{}} {dest}/ \\;",
        "command_copy": "mkdir -p {dest} && rsync -av --inplace --ignore-existing {archive_source}/ {dest}/",
        "parameters": [
            {"key": "mode", "label": "Import mode", "type": "pill_toggle",
             "options": ["hardlink", "symlink", "copy"], "default": "hardlink",
             "help": "Hardlink: zero extra space, works when source and dest are on the same server volume. Symlink: no extra space, local filesystem only (fails on some servers). Copy: rsync, works everywhere, uses disk space."},
            {"key": "archive_source", "label": "Source frames directory (archive path) *", "type": "path", "required": True,
             "help": "Full path to directory containing .tif/.eer frames on archive"},
            {"key": "dest", "label": "Destination directory", "type": "path",
             "default": "aretomo3/raw_data_frames",
             "help": "Relative to preprocessing root — frames and MDOCs will both land here"},
        ],
    },
    {
        "id": "import_mdocs_aretomo3", "compute": "cpu",
        "name": "Import MDOCs (AreTomo3)",
        "description": "Copy .mdoc files into the same AreTomo3 directory as the frames. MDOCs must be editable (Fix MDOC Paths) — always uses Copy. Run AFTER Import Frames (AreTomo3).",
        "category": "import",
        "command": "mkdir -p {dest} && find {archive_source} -maxdepth 1 -name '*.mdoc' -exec cp {{}} {dest}/ \\;",
        "parameters": [
            {"key": "archive_source", "label": "Source MDOCs directory (archive path) *", "type": "path", "required": True,
             "help": "Full path to directory containing .mdoc files — usually same path as frames archive"},
            {"key": "dest", "label": "Destination directory", "type": "path",
             "default": "aretomo3/raw_data_frames",
             "help": "Same folder as frames — must match the dest used in Import Frames (AreTomo3)"},
        ],
    },

    {
        "id": "import_gainref", "compute": "cpu",
        "name": "Import Gain Reference",
        "description": "Copy gain reference file (.mrc/.dm4) into preprocessing directory. Both WarpTools and AreTomo3 can use the same gain reference.",
        "category": "import",
        "command": "mkdir -p {dest} && cp {archive_source} {dest}/gain_reference.mrc",
        "parameters": [
            {"key": "archive_source", "label": "Gain reference file (archive path) *", "type": "path", "required": True,
             "help": "Full path to .mrc or .dm4 gain reference file on archive storage"},
            {"key": "dest", "label": "Destination directory", "type": "path",
             "default": ".",
             "help": "Preprocessing root — gainref is shared by WarpTools and AreTomo3"},
        ],
    },
    {
        "id": "import_tomoscout_bad_tilts", "compute": "cpu",
        "name": "Import TomoScout Bad Tilts",
        "description": "Import a bad tilts JSON file from TomoScout into the project folder as inspect_bad_tilts.json. After import, the bad tilts appear in the Inspect Data tab viewer and can be applied to WarpTools XMLs via the 'Remove Bad Tilts (Inspect)' job. Replace: overwrites any existing markings. Merge: combines TomoScout markings with existing manual markings (union — no tilt is lost).",
        "category": "import",
        "command_replace": "cp {source_json} {dest_json}",
        "command_merge": "python3 -c \"import json,os; a=json.load(open('{source_json}')); b=json.load(open('{dest_json}')) if os.path.exists('{dest_json}') else {{}}; merged={{k: sorted(set(a.get(k,[])+b.get(k,[]))) for k in set(list(a)+list(b))}}; json.dump(merged, open('{dest_json}','w'), indent=2); print('Merged: '+str(sum(len(v) for v in merged.values()))+' bad tilts across '+str(len(merged))+' tilt series')\"",
        "parameters": [
            {"key": "mode", "label": "Import mode", "type": "pill_toggle",
             "options": ["replace", "merge"], "default": "replace",
             "help": "Replace: overwrite existing inspect_bad_tilts.json. Merge: combine TomoScout markings with existing manual markings (union)."},
            {"key": "source_json", "label": "TomoScout bad tilts JSON *", "type": "path", "required": True,
             "help": "Path to the inspect_bad_tilts.json produced by TomoScout"},
            {"key": "dest_json", "label": "Destination (project bad tilts)", "type": "path", "required": True,
             "from_project": "bad_tilts_json_path",
             "help": "Auto-filled: project_dir/inspect_bad_tilts.json. This is where Inspect Data tab and Remove Bad Tilts job read from."},
        ],
    },
    {
        "id": "pretilt_mdocs", "compute": "cpu",
        "name": "Pretilt MDOC Correction",
        "description": "Correct tilt angles in MDOC files for lamella data with stage pretilt. Creates mdocs_pretilt/ folder next to MDOCs folder. Run BEFORE WarpTools ts_import. Credit: Hamid Rahmani (github.com/hamid13r/warp_lamella_adapters)",
        "category": "import",
        "parameters": [
            {"key": "mdocs_dir",     "label": "MDOCs folder",         "type": "path",   "required": True,  "from_project": "warp_mdocs_dir", "help": "Folder containing original .mdoc files"},
            {"key": "pretilt_angle_neg", "label": "FIB Lamella pretilt (°)", "type": "number", "required": True,  "from_project": "pretilt_angle",  "help": "Enter your stage milling angle — e.g. 9 for 9° pretilt, -11 for -11°. CryoSTAR-Base inverts the sign automatically in the command."},
            {"key": "output_dir",    "label": "Output folder",        "type": "path",   "required": True,  "from_project": "mdocs_pretilt_dir", "default": "mdocs_pretilt", "help": "Output folder for corrected MDOCs. Default: mdocs_pretilt/ next to MDOCs folder."},
        ],
        "command": "python -m cryostarbase.scripts.preproc_imod.pretilt {mdocs_dir} --pretilt {pretilt_angle_neg} --output {output_dir}",
    },
    # ── PyTOM Scripts (green) ──
    {
        "id": "create_template", "compute": "cpu",
        "name": "Create Template",
        "description": "Generate PyTom template from SPA/STA map. REQUIRED: use --invert so protein density is BLACK. Verify in ChimeraX with 'volume scale #1 factor -1' if unsure about contrast.",
        "category": "pytom",
        "command": (
            "pytom_create_template.py "
            "-i {input_map} -o {output} "
            "--output-voxel-size-angstrom {voxel_size} "
            "{center} -b {box_size} {invert}"
        ),
        "parameters": [
            {"key": "input_map",  "label": "Input map (.mrc)",      "type": "path",   "required": True, "from_job_types": [],
             "help": "SPA or STA map from CryoSPARC / RELION / EMDB. Protein will be WHITE — use --invert to make it BLACK for PyTom."},
            {"key": "output",     "label": "Output template name",   "type": "path",   "default": "_pytom/template/template.mrc"},
            {"key": "voxel_size", "label": "Bin pixel size / Voxel size (Å)", "type": "number", "default": "", "from_project": "bin_pixel_size", "help": "= bin_pixel_size from project (raw_px × binning)"},
            {"key": "box_size",   "label": "Box size (pixels)",      "type": "number", "default": "32"},
            {"key": "invert",     "label": "Invert contrast (REQUIRED for CryoSPARC/RELION/EMDB maps)",
             "type": "select", "options": ["--invert", ""], "default": "--invert",
             "help": "REQUIRED: PyTom needs BLACK protein signal. Maps from CryoSPARC/RELION/EMDB have WHITE protein — always use --invert. Verify in ChimeraX: volume scale #1 factor -1"},
            {"key": "center",     "label": "Center density in box",
             "type": "select", "options": ["--center", ""], "default": "--center",
             "help": "Centers the density in the box — recommended. Check with relion_image_handler --com"},
        ],
    },
    {
        "id": "create_mask", "compute": "cpu",
        "name": "Create Mask",
        "description": "Create spherical mask for template matching",
        "category": "pytom",
        "command": "pytom_create_mask.py -b {box_size} -r {radius} -s {sigma} --voxel-size {voxel_size} -o {output}",
        "parameters": [
            {"key": "box_size",   "label": "Box size (px)",  "type": "number", "default": "32"},
            {"key": "radius",     "label": "Radius (px)",    "type": "number", "default": "7"},
            {"key": "sigma",      "label": "Soft edge (s)",  "type": "number", "default": "1"},
            {"key": "voxel_size", "label": "Bin pixel size / Voxel size (Å)", "type": "number", "default": "", "from_project": "bin_pixel_size", "help": "= bin_pixel_size from project"},
            {"key": "output",     "label": "Output name",    "type": "path",   "default": "_pytom/mask/mask.mrc"},
        ],
    },
    {
        "id": "tm_single", "compute": "gpu",
        "name": "TM (single tomogram)",
        "description": "Template matching on one tomogram — test parameters before batch. Uses geometry-aware PSF weighting with per-tilt CTF and dose. Angular sampling is auto-calculated via the Crowther criterion from particle diameter and target resolution. After TM, if too many false positives are found, use tm_find_thresh (github.com/CellArchLab/cryoet-scripts/blob/main/tm/tm_find_thresh) to automatically estimate the score cutoff from the distribution — it finds where the linear high-score region transitions to background.",
        "category": "pytom",
        "command": (
            "pytom_match_template.py "
            "-v {tomogram} -t {template} -m {mask} "
            "-d {results_dir} -a {tlt_file} "
            "--particle-diameter {diameter} "
            "--voxel-size-angstrom {voxel_size} "
            "--z-axis-rotational-symmetry {symmetry} "
            "--tomogram-mask {tomo_mask} "
            "--defocus {defocus_file} "
            "--voltage {voltage} --spherical-aberration {cs} "
            "--dose-accumulation {dose_file} "
            "--amplitude-contrast {amp} "
            "--tomogram-ctf-model phase-flip --per-tilt-weighting -g {gpu}"
        ),
        "parameters": [
            {"key": "tomogram",     "label": "Tomogram",         "type": "text", "required": True},
            {"key": "template",     "label": "Template",         "type": "text", "required": True, "from_job_types": ["create_template"]},
            {"key": "mask",         "label": "Mask",             "type": "path", "required": True, "from_job_types": ["create_mask"]},
            {"key": "results_dir",  "label": "Results dir",      "type": "path", "default": "trial/"},
            {"key": "tlt_file",     "label": "Tilt file (.tlt)", "type": "path", "required": True},
            {"key": "diameter",     "label": "Diameter (A)",     "type": "number", "default": "", "from_project": "particle_diameter"},
            {"key": "voxel_size",   "label": "Bin pixel size / Voxel size (Å)", "type": "number", "default": "", "from_project": "bin_pixel_size", "help": "= bin_pixel_size from project"},
            {"key": "symmetry",     "label": "Z symmetry",       "type": "number", "default": "", "from_project": "symmetry"},
            {"key": "tomo_mask",    "label": "Tomo mask",        "type": "path", "required": True},
            {"key": "defocus_file", "label": "Defocus file",     "type": "path", "required": True},
            {"key": "voltage",      "label": "Voltage (kV)",     "type": "number", "default": "", "from_project": "voltage"},
            {"key": "cs",           "label": "Cs (mm)",          "type": "number", "default": "", "from_project": "spherical_aberration"},
            {"key": "dose_file",    "label": "Dose file",        "type": "path", "required": True},
            {"key": "amp",          "label": "Amp contrast",     "type": "number", "default": "", "from_project": "amplitude_contrast"},
            {"key": "gpu",          "label": "GPU ID",           "type": "text",   "default": "", "from_project": "compute_gpus"},
        ],
    },
    {
        "id": "tm_batch", "compute": "gpu",
        "name": "TM Batch",
        "description": "Run template matching on all tomograms — direct (workstation) or SLURM. PREREQUISITE: run Extract Warp XML Info first to create .tlt/.dose/.defocus files in xml_dir. Uses PSF-weighted CTF correction with per-tilt defocus and dose weighting.",
        "category": "pytom",
        "command_direct": (
            "python -m cryostarbase.scripts.tm_loop "
            "--tomo-dir {tomo_dir} --xml-dir {xml_dir} "
            "--results-dir {results_dir} --template {template} --mask {mask} "
            "--tomo-mask-dir {tomo_mask_dir} --suffix {suffix} "
            "--diameter {diameter} --voxel-size {voxel_size} "
            "--symmetry {symmetry} --voltage {voltage} --cs {cs} --amp {amp} "
            "--gpu {gpu} --direct"
        ),
        "command_slurm": (
            "python -m cryostarbase.scripts.tm_loop "
            "--tomo-dir {tomo_dir} --xml-dir {xml_dir} "
            "--results-dir {results_dir} --template {template} --mask {mask} "
            "--tomo-mask-dir {tomo_mask_dir} --suffix {suffix} "
            "--diameter {diameter} --voxel-size {voxel_size} "
            "--symmetry {symmetry} --voltage {voltage} --cs {cs} --amp {amp} "
            "--gpu {gpu} --partition {partition} --time-limit {time_limit} --memory {memory} --submit"
        ),
        "command": (
            "python -m cryostarbase.scripts.tm_loop "
            "--tomo-dir {tomo_dir} --xml-dir {xml_dir} "
            "--results-dir {results_dir} --template {template} --mask {mask} "
            "--tomo-mask-dir {tomo_mask_dir} --suffix {suffix} "
            "--diameter {diameter} --voxel-size {voxel_size} "
            "--symmetry {symmetry} --voltage {voltage} --cs {cs} --amp {amp} "
            "--gpu {gpu} --partition {partition} --time-limit {time_limit} --memory {memory} "
            "{submit_mode}"
        ),
        "parameters": [
            {"key": "tomo_dir",      "label": "Tomogram dir",   "type": "path", "default": "_pytom/reconstruction", "from_project": "pytom_tomo_dir"},
            {"key": "xml_dir",       "label": "XML dir",        "type": "path", "default": "", "from_project": "pytom_xml_dir", "help": "Run Extract Warp XML Info first to create .tlt/.dose/.defocus files here"},
            {"key": "results_dir",   "label": "Results dir",    "type": "path", "default": "", "from_project": "pytom_results_dir"},
            {"key": "template",      "label": "Template (.mrc file)", "type": "path", "default": "", "from_job_types": ["create_template"]},
            {"key": "mask",          "label": "Mask (.mrc file)",           "type": "path", "default": "", "from_job_types": ["create_mask"]},
            {"key": "tomo_mask_dir", "label": "Tomo mask dir",  "type": "path", "default": "", "from_project": "pytom_slabified_dir"},
            {"key": "suffix",        "label": "Tomo suffix",    "type": "text", "default": "", "from_project": "tomo_suffix", "help": "WarpTools uses 2 decimal places: e.g. _10.71Apx (not _10.712Apx). Leave empty if unsure."},
            {"key": "diameter",      "label": "Diameter (A)",   "type": "number", "default": "", "from_project": "particle_diameter"},
            {"key": "voxel_size",    "label": "Bin pixel size / Voxel size (Å)", "type": "number", "default": "", "from_project": "bin_pixel_size", "help": "= bin_pixel_size from project"},
            {"key": "symmetry",      "label": "Symmetry",       "type": "number", "default": "", "from_project": "symmetry"},
            {"key": "voltage",       "label": "Voltage (kV)",   "type": "number", "default": "", "from_project": "voltage"},
            {"key": "cs",            "label": "Cs (mm)",        "type": "number", "default": "", "from_project": "spherical_aberration"},
            {"key": "amp",           "label": "Amp contrast",   "type": "number", "default": "", "from_project": "amplitude_contrast"},
            {"key": "gpu",           "label": "GPU ID(s)",      "type": "text",   "default": "", "from_project": "compute_gpus"},
            {"key": "partition",     "label": "SLURM partition", "type": "text",   "default": "", "from_project": "compute_slurm_partition"},
            {"key": "time_limit",    "label": "SLURM time",     "type": "text",   "default": "", "from_project": "compute_slurm_time"},
            {"key": "memory",        "label": "SLURM memory",   "type": "text",   "default": "", "from_project": "compute_slurm_mem"},
            {"key": "submit_mode",   "label": "Submission mode",
             "type": "select", "options": ["--direct", "--submit", ""], "default": "--direct",
             "help": "--direct: run on workstation; --submit: SLURM sbatch; empty: generate scripts only"},
        ],
    },
    {
        "id": "extract_single", "compute": "cpu",
        "name": "Extract Candidates",
        "description": "Extract particle candidates from one TM result (_job.json). Output folder must match TM output folder. Extract ~1/3 more than expected. Tophat filter removes FIB contamination, ice, gold beads.",
        "category": "pytom",
        "command": (
            "pytom_extract_candidates.py "
            "-j {job_file} -n {n_particles} {cutoff} {tophat} {tomo_mask_arg} {relion5}"
        ),
        "parameters": [
            {"key": "job_file",     "label": "Job file (_job.json)", "type": "path",   "required": True},
            {"key": "n_particles",  "label": "Max particles",        "type": "number", "default": "3000"},
            {"key": "cutoff",       "label": "Cutoff",
             "type": "select", "options": ["", "-c -1", "-c 0.3", "-c 0.2"], "default": "",
             "help": "empty = auto cutoff (recommended with tophat); -c -1 = top N; -c 0.3 = threshold"},
            {"key": "tophat",       "label": "Tophat filter",
             "type": "boolean", "flag": "--tophat-filter", "default": True,
             "help": "Remove FIB contamination, ice, gold beads by filtering for sharp correlation peaks."},
            {"key": "tomo_mask_arg","label": "Tomo mask (.mrc file)", "type": "path",   "default": "",
             "help": "Optional: if empty, uses mask from job file"},
            {"key": "relion5",      "label": "RELION5 compat",
             "type": "select", "options": ["--relion5-compat", ""], "default": "--relion5-compat"},
        ]    },
    {
        "id": "extract_batch", "compute": "cpu",
        "name": "Extract Batch",
        "description": "Extract particle candidates from all TM results. Results folder must match the TM output folder. Tophat filter removes FIB contamination, ice, and gold beads (recommended for lamellae).",
        "category": "pytom",
        "command_direct": (
            "python -m cryostarbase.scripts.extract_loop "
            "--results-dir {results_dir} --tomo-mask-dir {tomo_mask_dir} "
            "-n {n_particles} {cutoff} {tophat} {relion5} --workers {workers} --direct"
        ),
        "command_slurm": (
            "python -m cryostarbase.scripts.extract_loop "
            "--results-dir {results_dir} --tomo-mask-dir {tomo_mask_dir} "
            "-n {n_particles} {cutoff} {tophat} {relion5} "
            "--partition {partition} --time-limit {time_limit} --memory {memory} --submit"
        ),
        "command": (
            "python -m cryostarbase.scripts.extract_loop "
            "--results-dir {results_dir} --tomo-mask-dir {tomo_mask_dir} "
            "-n {n_particles} {cutoff} {tophat} {relion5} {submit_mode}"
        ),
        "parameters": [
            {"key": "results_dir",   "label": "TM results dir",   "type": "path",   "default": "", "from_project": "pytom_results_dir"},
            {"key": "tomo_mask_dir", "label": "Tomo mask dir",     "type": "path",   "default": "", "from_project": "pytom_slabified_dir"},
            {"key": "n_particles",   "label": "Max particles",     "type": "number", "default": "3000"},
            {"key": "cutoff",        "label": "Cutoff",
             "type": "select", "options": ["", "-c -1", "-c 0.3"], "default": "",
             "help": "empty = auto cutoff (recommended with tophat); -c -1 = top N; -c 0.3 = manual threshold"},
            {"key": "tophat",        "label": "Tophat filter",
             "type": "boolean", "flag": "--tophat-filter", "default": True,
             "help": "Remove FIB contamination, ice, gold beads by filtering for sharp correlation peaks. Recommended for lamellae."},
            {"key": "relion5",       "label": "RELION5 compat",
             "type": "select", "options": ["--relion5-compat", "--no-relion5"], "default": "--relion5-compat",
             "help": "--relion5-compat: RELION5 STAR format (default). --no-relion5: legacy RELION4 format."},
            {"key": "workers",       "label": "Parallel workers",  "type": "number", "default": 4,
             "help": "Number of tomograms to extract in parallel (direct mode only). 1 = serial."},
            {"key": "partition",     "label": "SLURM partition",   "type": "text",   "default": "", "from_project": "compute_slurm_partition"},
            {"key": "time_limit",    "label": "SLURM time",        "type": "text",   "default": "", "from_project": "compute_slurm_time"},
            {"key": "memory",        "label": "SLURM memory",      "type": "text",   "default": "", "from_project": "compute_slurm_mem"},
            {"key": "submit_mode",   "label": "Submission mode",
             "type": "select", "options": ["--direct", "--submit", ""], "default": "--direct",
             "help": "--direct: run on workstation; --submit: SLURM sbatch; empty: generate scripts only"},
        ]    },
    {
        "id": "merge_stars", "compute": "cpu",
        "name": "Merge Star Files",
        "description": "Merge per-tomogram star files into one",
        "category": "pytom",
        "command": "pytom_merge_stars.py -i {results_dir}/*_particles.star -o {output}",
        "parameters": [
            {"key": "results_dir", "label": "TM results dir", "type": "path", "required": True, "from_project": "pytom_results_dir"},
            {"key": "output",      "label": "Output star",    "type": "path", "default": "_pytom/results/merged.star",
             "help": "Path relative to project dir — e.g. _pytom/results/merged_bin4.star"},
        ],
    },
    {
        "id": "convert_coords",
        "name": "Convert Ang to Pixel",
        "description": "Convert coordinates for Warp extraction",
        "category": "pytom",
        "command": (
            "python -m cryostarbase.scripts.ang_to_pix "
            "{input} {output} --x_dim {x} --y_dim {y} --z_dim {z} "
            "--pixel_size {pixel_size} --suffix {suffix} -y"
        ),
        "parameters": [
            {"key": "input",      "label": "Input star",     "type": "path",   "required": True, "from_job_types": ["merge_stars", "extract_batch", "extract_single"]},
            {"key": "output",     "label": "Output star",    "type": "path",   "required": True,
             "default": "_pytom/results/converted.star",
             "help": "Path relative to project dir — e.g. _pytom/results/converted.star"},
            {"key": "x",          "label": "Tomo X (vox)",   "type": "number", "required": True, "from_project": "tomo_x"},
            {"key": "y",          "label": "Tomo Y (vox)",   "type": "number", "required": True, "from_project": "tomo_y"},
            {"key": "z",          "label": "Tomo Z (vox)",   "type": "number", "required": True, "from_project": "tomo_z"},
            {"key": "pixel_size", "label": "Pixel size (A)", "type": "number", "default": "", "from_project": "bin_pixel_size"},
            {"key": "suffix",     "label": "Tomo suffix",    "type": "text",   "default": "", "from_project": "tomo_suffix"},
        ],
    },
    # ── M / MTools (purple) ──────────────────────────────────────────────────
    {"id": "mtools_create_population", "compute": "cpu", "name": "MTools: Create Population",
     "description": "Create a new M population directory. All future species and sources will be stored here. Run once per project.",
     "category": "mtools",
     "command": "MTools create_population -d {directory} -n {name}",
     "parameters": [
         {"key": "directory", "label": "Population directory", "type": "text", "required": True,
          "help": "Path to new directory where the population will be stored — must have enough space for half-maps"},
         {"key": "name",      "label": "Population name",      "type": "text", "required": True},
     ]},
    {"id": "mtools_create_source", "compute": "cpu", "name": "MTools: Create Source",
     "description": "Add a tilt series data source to an existing population. Points M to the WarpTools settings file for your tilt series.",
     "category": "mtools",
     "command": "MTools create_source -p {population} -s {settings} -n {name}",
     "parameters": [
         {"key": "population", "label": "Population file (.population)", "type": "path", "required": True,
          "help": "Path to the .population file created by create_population"},
         {"key": "settings",   "label": "WarpTools settings file",      "type": "path", "required": True,
          "help": "Path to warp_tiltseries.settings from Pre-Processing Step 2"},
         {"key": "name",       "label": "Source name",                  "type": "text", "default": "tiltseries"},
     ]},
    {"id": "mtools_create_species", "compute": "cpu", "name": "MTools: Create Species",
     "description": "Add a particle species to the population. Requires converged RELION half-maps, mask, and particle STAR file.",
     "category": "mtools",
     "command": "MTools create_species -p {population} -n {name} -d {diameter} --half1 {half1} --half2 {half2} -m {mask} --particles_relion {star_file}",
     "parameters": [
         {"key": "population", "label": "Population file",           "type": "path",   "required": True},
         {"key": "name",       "label": "Species name",              "type": "text",   "required": True},
         {"key": "diameter",   "label": "Particle diameter (Å)",     "type": "number", "required": True,
          "help": "Molecule diameter in Angstrom — used to define the refinement region"},
         {"key": "half1",      "label": "Half-map 1",                "type": "path",   "required": True,
          "help": "Path to first half-map from RELION refinement"},
         {"key": "half2",      "label": "Half-map 2",                "type": "path",   "required": True},
         {"key": "mask",       "label": "Mask file",                 "type": "path",   "required": True,
          "help": "Tight binary mask — M will automatically expand and smooth it"},
         {"key": "star_file",  "label": "RELION _data.star",         "type": "path",   "required": True,
          "help": "Path to run_it*_data.star from converged RELION 3D refinement"},
     ]},
        {"id": "mcore_sanity_check", "compute": "cpu", "name": "M Sanity Check",
     "description": "Run MCore with --iter 0 (no refinements) to verify that population, source, and species are correctly set up before starting real refinement. Always run this first after setting up M.",
     "category": "mtools",
     "command": "MCore --population {population} --perdevice_refine {perdevice} --iter 0",
     "parameters": [
         {"key": "population", "label": "Population file (.population)", "type": "path", "required": True,
          "help": "Path to the .population file created by MTools create_population"},
         {"key": "perdevice", "label": "Particles per GPU", "type": "number", "default": "4",
          "help": "Number of particles processed per GPU at once. Start with 4, increase if GPU memory allows."},
     ]},
    {"id": "mcore_refine", "compute": "gpu", "name": "M Refinement",
     "description": "Run MCore image warp + particle pose refinement. Conservative strategy per community recommendation: use 1x1 image_warp and refine_particles only. Repeat until resolution improvement is less than 0.2Å.",
     "category": "mtools",
     "command": ("MCore --population {population} "
              "--refine_particleposes "
              "--refine_imagewarp {image_warp} "
              "{refine_stageangles}"
              "{refine_defocus}"
              "--perdevice_refine {perdevice} "
              "--iter {iter}"),
     "parameters": [
         {"key": "population",        "label": "Population (.population)", "type": "path",    "required": True},
         {"key": "image_warp",        "label": "Image warp grid",          "type": "text",    "default": "1x1",
          "help": "Round 1: 1x1. Round 2: 3x3. Final: 6x6. Appel 2026 used 3x3 for intermediate rounds, 6x6 final."},
         {"key": "refine_stageangles","label": "Refine stage angles",      "type": "boolean", "default": "false",
          "help": "Enable from round 2+. Flag: --refine_stageangles"},
         {"key": "refine_defocus",    "label": "Refine defocus",           "type": "boolean", "default": "false",
          "help": "Refine per-tilt defocus. Enable after warp has converged. Flag: --refine_defocus"},
         {"key": "perdevice",         "label": "Particles per GPU",        "type": "number",  "default": "4"},
         {"key": "iter",              "label": "Sub-iterations",           "type": "number",  "default": "3"},
     ]},
    {"id": "mcore_ctf_refine", "compute": "gpu", "name": "MCore: CTF Refinement",
     "description": "Refine defocus after reaching sufficient resolution (~5.5Å or better). Run only once after image warp refinement has converged.",
     "category": "mtools",
     "command": "MCore --population {population} --ctf_defocus --iter {iter}",
     "parameters": [
         {"key": "population", "label": "Population file",     "type": "path",   "required": True},
         {"key": "iter",       "label": "Sub-iterations",      "type": "number", "default": "3"},
     ]},
    # ── WarpTools Pre-Processing (light-blue) ────────────────────────────────
    {"id": "warp_create_settings_fs", "compute": "cpu", "name": "Create Frame Series Settings",
     "description": "Create warp_frameseries.settings file. Defines frames directory, pixel size, exposure and gain reference. Run before fs_motion_and_ctf.",
     "category": "warp_preproc",
     "command": ("WarpTools create_settings --folder_data {frames_dir} "
             "--folder_processing warp_frameseries --output {output_settings} "
             "--extension \"{extension}\" --angpix {angpix_raw} --exposure {exposure} "
             "{gain_flip_y}{gain_flip_x}{gain_transpose}"
             "--gain_path {gain_path}{gain_defects}"
     ),
     "parameters": [
         {"key": "frames_dir",      "label": "Frames directory",          "type": "path",   "default": "frames"},
         {"key": "output_settings", "label": "Settings output",           "type": "path",   "default": "warp_frameseries.settings"},
         {"key": "extension",       "label": "File pattern",              "type": "text",   "default": "*.tif"},
         {"key": "angpix_raw",      "label": "Pixel size (Å)",            "type": "number", "required": True, "autofill": True,
          "help": "RAW unbinned pixel size at the detector"},
         {"key": "exposure",        "label": "Exposure per tilt (e/Å²)",  "type": "number", "required": True, "autofill": True,
          "help": "Total dose / number of tilts"},
         {"key": "gain_flip_y",    "label": "Flip Y (--gain_flip_y)",    "type": "boolean", "default": "true",
          "help": "Flip Y axis of the gain reference. Required for Falcon 4i / K3 on Titan Krios. Standard for most modern cameras."},
         {"key": "gain_flip_x",    "label": "Flip X (--gain_flip_x)",    "type": "boolean", "default": "false",
          "help": "Flip X axis of the gain reference. K2 cameras — rarely needed."},
         {"key": "gain_transpose", "label": "Transpose gain (--gain_transpose)", "type": "boolean", "default": "false",
          "help": "Transpose the gain reference. K2 with 270° tilt axis rotation."},
         {"key": "gain_path",      "label": "Gain reference (.mrc)",     "type": "path",    "required": True,
          "help": "Path to the gain reference .mrc file"},
         {"key": "gain_defects",   "label": "Defect file (optional)",    "type": "path",
          "help": "Pixel defect mask (.mrc or .txt). Optional but recommended for K3."},
     ]},
    {"id": "warp_create_settings_ts", "compute": "cpu", "name": "Create Tilt Series Settings",
     "description": "Create warp_tiltseries.settings file. Defines tomostar directory, tomo dimensions, pixel size. Run after ts_import.",
     "category": "warp_preproc",
     "command": ("WarpTools create_settings --output {output_settings} "
             "--folder_processing warp_tiltseries --folder_data tomostar "
             "--extension \"*.tomostar\" --angpix {angpix_raw} --exposure {exposure} "
             "--tomo_dimensions {tomo_dimensions} "
             "{gain_flip_y}{gain_flip_x}{gain_transpose}"
             "--gain_path {gain_path}{gain_defects}"
     ),
     "parameters": [
         {"key": "output_settings",  "label": "Settings output",           "type": "path",   "default": "warp_tiltseries.settings"},
         {"key": "angpix_raw",       "label": "Pixel size (Å)",            "type": "number", "required": True, "autofill": True,
          "help": "RAW unbinned pixel size at the detector"},
         {"key": "exposure",         "label": "Exposure per tilt (e/Å²)", "type": "number", "required": True, "autofill": True,
          "help": "Dose per tilt angle"},
         {"key": "gain_flip_y",    "label": "Flip Y (--gain_flip_y)",    "type": "boolean", "default": "true",
          "help": "Flip Y axis of the gain reference. Required for Falcon 4i / K3 on Titan Krios."},
         {"key": "gain_flip_x",    "label": "Flip X (--gain_flip_x)",    "type": "boolean", "default": "false",
          "help": "Flip X axis of the gain reference. K2 cameras — rarely needed."},
         {"key": "gain_transpose", "label": "Transpose gain (--gain_transpose)", "type": "boolean", "default": "false",
          "help": "Transpose the gain reference. K2 with 270° tilt axis rotation."},
         {"key": "gain_path",      "label": "Gain reference (.mrc)",     "type": "path",    "required": True},
         {"key": "gain_defects",   "label": "Defect file (optional)",    "type": "path",
          "help": "Pixel defect mask (.mrc or .txt). Optional but recommended for K3."},
         {"key": "tomo_dimensions",  "label": "Tomo dimensions (XxYxZ)",   "type": "text",   "required": True, "autofill": True,
          "help": "Unbinned voxels e.g. 4092x5760x2500. Tilt axis along Y."},
     ]},
    {"id": "warp_fs_motion_ctf", "compute": "gpu", "name": "Frame Series: Motion & CTF",
     "description": "Estimate beam-induced motion and CTF for all frame series. GPU job. Produces averaged frames and CTF estimates used by ts_import.",
     "category": "warp_preproc",
     "command": "WarpTools fs_motion_and_ctf --settings {settings} --m_grid {m_grid} --c_grid {c_grid} --c_range_max {c_range_max} --c_defocus_max {c_defocus_max} --c_use_sum --out_averages --out_average_halves --device_list {device_list} --perdevice {perdevice}",
     "parameters": [
         {"key": "settings",      "label": "Frame series settings",    "type": "path",   "default": "warp_frameseries.settings"},
         {"key": "m_grid",        "label": "Motion grid",              "type": "text",   "default": "1x1x8",
          "help": "1x1xNFrames — spatial×spatial×temporal"},
         {"key": "c_grid",        "label": "CTF grid",                 "type": "text",   "default": "2x2x1"},
         {"key": "c_range_max",   "label": "CTF range max (Å)",        "type": "number", "default": "7"},
         {"key": "c_defocus_max", "label": "Defocus max (μm)",         "type": "number", "default": "8"},
         {"key": "device_list",   "label": "GPU device list",          "type": "text",   "default": "0 1", "from_project": "compute_gpus",
          "help": "Space-separated GPU IDs. Auto-filled from project Computing tab settings."},
         {"key": "perdevice",     "label": "Processes per GPU",        "type": "number", "default": "2",
          "help": "Parallel processes per GPU. 2 is safe for 32GB VRAM with K3 frames (~4GB/process peak)."},
     ]},
    {"id": "warp_filter_quality", "compute": "cpu", "name": "Filter Quality (Histograms)",
     "description": "Plot histograms of 2D processing metrics (motion, CTF, resolution). Run after fs_motion_and_ctf to assess data quality and identify bad frames/tilt series.",
     "category": "warp_preproc",
     "command": "WarpTools filter_quality --settings {settings} --histograms",
     "parameters": [
         {"key": "settings", "label": "Frame series settings", "type": "path", "default": "warp_frameseries.settings"},
     ]},
    {"id": "warp_ts_import", "compute": "cpu", "name": "Tilt Series: Import",
     "description": "Import tilt series from MDOC files. Creates .tomostar files in tomostar/. Uses averaged frames from warp_frameseries/. For FIB-lamella with pretilt: use --tilt_offset to correct tilt angles (or pre-process MDOCs with pretilt_mdocs first).",
     "category": "warp_preproc",
     "command": "WarpTools ts_import --mdocs {mdocs_dir} --frameseries warp_frameseries --tilt_exposure {tilt_exposure} --min_intensity {min_intensity} --dont_invert{tilt_offset_arg} --output tomostar",
     "parameters": [
         {"key": "mdocs_dir",       "label": "MDOCs directory",         "type": "path",   "default": "mdocs",
          "help": "Folder with .mdoc files. For pretilt-corrected MDOCs use mdocs_pretilt/ (auto-filled if pretilt step was run)."},
         {"key": "tilt_exposure",   "label": "Tilt exposure (e/Å²)",   "type": "number", "required": True},
         {"key": "tilt_offset_arg", "label": "Pretilt offset (°)",      "type": "text",   "default": "",
          "help": "Optional: pass ' --tilt_offset {angle}' to subtract pretilt angle from all tilts. Leave empty if MDOCs are already corrected."},
         {"key": "min_intensity",   "label": "Min intensity fraction",  "type": "number", "default": "0.3",
          "help": "Exclude frames below this fraction of median intensity"},
     ]},
    {"id": "warp_ts_etomo", "compute": "cpu", "name": "Tilt Series: Alignment (eTomo patches)",
     "description": "Patch-based tilt series alignment using IMOD eTomo. Produces .xf/.tlt files. Requires IMOD loaded. Alternative: use ts_import_alignments with AreTomo3 results.",
     "category": "warp_preproc",
     "command": "WarpTools ts_etomo_patches --settings {settings} --angpix {angpix} --patch_size {patch_size} --initial_axis {initial_axis} --device_list {device_list} --perdevice {perdevice}",
     "parameters": [
         {"key": "settings",     "label": "Tilt series settings",    "type": "path",   "default": "warp_tiltseries.settings"},
         {"key": "angpix",       "label": "Alignment pixel size (Å)","type": "number", "required": True,
          "help": "Binned pixel size for alignment, e.g. 11.056 for bin8"},
         {"key": "patch_size",   "label": "Patch size (Å)",          "type": "number", "default": "2000"},
         {"key": "initial_axis", "label": "Initial tilt axis (°)",   "type": "number", "default": "85"},
         {"key": "device_list",  "label": "GPU device list",         "type": "text",   "default": "0 1", "from_project": "compute_gpus",
          "help": "Space-separated GPU IDs. Auto-filled from project compute settings."},
         {"key": "perdevice",    "label": "Processes per GPU",       "type": "number", "default": "2",
          "help": "Parallel processes per GPU. 2 is safe for most systems."},
     ]},
    {"id": "warp_ts_import_alignments", "compute": "cpu", "name": "Tilt Series: Import Alignments",
     "description": "Import tilt series alignment results into WarpTools. Expects a folder with ONE SUB-FOLDER per tilt series containing .xf and .tlt files. For ts_etomo_patches: use warp_tiltseries/tiltstack/. For the IMOD pipeline: use import_alignments/ (after imod_collect_etomo). For AreTomo3: use get_aretomo3_alignments.py first.",
     "category": "warp_preproc",
     "command": "WarpTools ts_import_alignments --settings {settings} --alignments {alignments_dir} --alignment_angpix {alignment_angpix} --min_fov {min_fov}",
     "parameters": [
         {"key": "settings",         "label": "Tilt series settings",        "type": "path",   "default": "warp_tiltseries.settings"},
         {"key": "alignments_dir",   "label": "Alignments folder",           "type": "path",   "required": True,
          "help": "Folder with one sub-folder per TS containing TS_NAME.xf + TS_NAME.tlt. ts_etomo_patches → warp_tiltseries/tiltstack/. IMOD pipeline → import_alignments/ (after collect)."},
         {"key": "alignment_angpix", "label": "Alignment pixel size (Å)",    "type": "number", "required": True,
          "help": "Pixel size used during alignment (e.g. 10.71 for bin10). Must match the angpix passed to ts_etomo_patches or ts_stack."},
         {"key": "min_fov",          "label": "Min FOV fraction",            "type": "number", "default": "0",
          "help": "Default 0 = full field of view. Only increase if you have edge artifacts."},
     ]},
    {"id": "warp_remove_skipped", "compute": "cpu",
     "name": "Remove Skipped Views (eTomo)",
     "description": "Reads taSolution.log from eTomo/batchruntomo and sets UseTilt=False for any tilt that eTomo could not align. Run after ts_import_alignments and before ts_ctf. tiltstack-dir: ts_etomo_patches → warp_tiltseries/tiltstack/. Use 'Remove Bad Tilts (Inspect)' to additionally apply manual markings from the Inspect Data tab. Credit: Hamid Rahmani.",
     "category": "warp_preproc",
     "parameters": [
         {"key": "xml_dir",      "label": "WarpTools XML dir",    "type": "path", "required": True,
          "from_project": "warptools_tiltseries_dir",
          "help": "warp_tiltseries/ folder containing WarpTools .xml files"},
         {"key": "tiltstack_dir","label": "Tiltstack dir",        "type": "path", "required": True,
          "from_project": "imod_dir",
          "help": "Folder with one sub-folder per TS containing taSolution.log. Usually warp_tiltseries/tiltstack/ (ts_etomo_patches output)."},
         {"key": "backup_name",  "label": "Backup folder name",   "type": "path", "required": True,
          "from_project": "warptools_xml_backup_dir",
          "help": "New directory name for XML backups (e.g. xml_backup_20260622_all_tilts). Must not already exist — acts as a safety lock."},
         {"key": "all_true",     "label": "Reactivate all tilts (undo exclusions)", "type": "boolean", "flag": "--all-true", "required": False,
          "help": "Sets all UseTilt=True — use to reset before Miss Alignment (which needs all tilts active), or to undo a previous removal run. Ignores taSolution.log."},
         {"key": "n_tilts",      "label": "Keep only N lowest-exposure tilts", "type": "number", "default": "0", "required": False,
          "help": "Keep only N tilts acquired closest to 0° (lowest accumulated dose). 0 = standard mode: use eTomo taSolution.log."},
         {"key": "max_tilt",     "label": "Exclude tilts beyond ±X°",         "type": "number", "default": "0", "required": False,
          "help": "Sets UseTilt=False for all tilts beyond this angle. 0 = no limit. Useful for FIB-lamella where high-tilt images lose quality."},
     ],
     "command": "python -m cryostarbase.scripts.preproc_imod.remove_skipped --xml-dir {xml_dir} --imod-dir {tiltstack_dir} --backup-dir {backup_name} {all_true} --n-tilts {n_tilts} --max-tilt {max_tilt}",
    },
    {"id": "warp_remove_bad_tilts", "compute": "cpu",
     "name": "Remove Bad Tilts (Inspect)",
     "description": "Applies manual bad tilt markings from the Inspect Data tab to WarpTools XMLs. Sets UseTilt=False for tilts you marked with B or the range selector. Run after visually inspecting tilt stacks in the Inspect Data tab. Reads inspect_bad_tilts.json from the project folder — auto-filled from project. Can be combined with Remove Skipped Views (eTomo): run either or both. Credit: Hamid Rahmani.",
     "category": "warp_preproc",
     "parameters": [
         {"key": "xml_dir",         "label": "WarpTools XML dir",    "type": "path", "required": True,
          "from_project": "warptools_tiltseries_dir",
          "help": "warp_tiltseries/ folder containing WarpTools .xml files"},
         {"key": "bad_tilts_json",  "label": "Bad tilts JSON",       "type": "path", "required": True,
          "from_project": "bad_tilts_json_path",
          "help": "Path to inspect_bad_tilts.json — auto-filled from project folder. Mark bad tilts in Inspect Data tab first."},
         {"key": "backup_name",     "label": "Backup folder name",   "type": "path", "required": True,
          "from_project": "warptools_xml_backup_dir",
          "help": "New directory name for XML backups. Must not already exist — acts as a safety lock."},
     ],
     "command": "python -m cryostarbase.scripts.preproc_imod.remove_skipped apply-bad-tilts --xml-dir {xml_dir} --bad-tilts {bad_tilts_json} --backup-dir {backup_name}",
    },
    {"id": "warp_ts_defocus_hand", "compute": "cpu", "name": "Tilt Series: Defocus Handedness",
     "description": "Automatically determine and apply defocus handedness correction. Run once after alignment. Uses --set_auto to apply without manual confirmation. If the result is ambiguous, consider using the independent defocusgrad script (github.com/CellArchLab/cryoet-scripts/tree/main/defocusgrad) which estimates handedness from the defocus gradient across the tilt series — independent of WarpTools. The paper by Appel et al. 2026 (doi:10.64898/2026.04.10.717634) uses both tools in combination.",
     "category": "warp_preproc",
     "command": "WarpTools ts_defocus_hand --settings {settings} --set_auto",
     "parameters": [
         {"key": "settings", "label": "Tilt series settings", "type": "path", "default": "warp_tiltseries.settings"},
     ]},
    {"id": "warp_ts_ctf", "compute": "cpu", "name": "Tilt Series: CTF Estimation",
     "description": "Estimate CTF for each tilt image. Run after alignment and defocus handedness check.",
     "category": "warp_preproc",
     "command": "WarpTools ts_ctf --settings {settings} --range_high {range_high} --defocus_max {defocus_max} --device_list {device_list} --perdevice {perdevice}",
     "parameters": [
         {"key": "settings",    "label": "Tilt series settings", "type": "path",   "default": "warp_tiltseries.settings"},
         {"key": "range_high",  "label": "CTF range high (Å)",   "type": "number", "default": "7"},
         {"key": "defocus_max", "label": "Defocus max (μm)",     "type": "number", "default": "8"},
         {"key": "device_list", "label": "GPU device list",      "type": "text",   "default": "0 1", "from_project": "compute_gpus",
          "help": "Space-separated GPU IDs. Auto-filled from project compute settings."},
         {"key": "perdevice",   "label": "Processes per GPU",    "type": "number", "default": "3",
          "help": "Parallel processes per GPU. CTF is lightweight — 3 per GPU is safe."},
     ]},
    {"id": "warp_ts_reconstruct", "compute": "gpu", "name": "Tilt Series: Reconstruct Tomograms",
     "description": "Reconstruct full tomograms from aligned, CTF-corrected tilt series. GPU job. Output: warp_tiltseries/reconstruction/. Produces half-maps for denoising.",
     "category": "warp_preproc",
     "command": "export WARP_FORCE_MRC_FLOAT32=1 && WarpTools ts_reconstruct --settings {settings} --angpix {angpix} --dont_invert --halfmap_frames{output_processing} --device_list {device_list} --perdevice {perdevice}",
     "parameters": [
         {"key": "settings", "label": "Tilt series settings",          "type": "path",   "default": "warp_tiltseries.settings"},
         {"key": "angpix",   "label": "Reconstruction pixel size (Å)", "type": "number", "required": True,
          "help": "Output tomogram pixel size, e.g. 11.056 for bin8"},
         {"key": "use_output_processing", "label": "Custom output directory", "type": "boolean",
          "flag": "",
          "help": "Save reconstruction to a different folder — useful after Miss Alignment or M refinement to keep results separate from the default warp_tiltseries/reconstruction/"},
         {"key": "output_processing_dir", "label": "Output directory name", "type": "path",
          "default": "warp_tiltseries/reconstruction_refined",
          "help": "Path relative to WarpTools directory, e.g. warp_tiltseries/reconstruction_postM. Only used when Custom output directory is enabled."},
         {"key": "device_list", "label": "GPU device list",      "type": "text",   "default": "0 1", "from_project": "compute_gpus",
          "help": "Space-separated GPU IDs. Auto-filled from project compute settings."},
         {"key": "perdevice",   "label": "Processes per GPU",    "type": "number", "default": "2",
          "help": "Parallel processes per GPU. Reconstruction is VRAM-heavy — 2 per GPU for 32GB."},
     ]},
    # ── WarpTools Export (purple) ──
    {
        "id": "warp_export_particles", "compute": "gpu",
        "name": "Export Particles (ts_export_particles)",
        "description": "WarpTools ts_export_particles — extract particles from tilt series after PyTom TM. Supports 2D series (for RELION STA) or 3D volumes. Handles unbinning by setting output_angpix < coords_angpix. Box must be doubled when unbinning.",
        "category": "warp_export",
        "command": (
            "WarpTools ts_export_particles "
            "--settings {settings} "
            "--input_star {input_star} "
            "--coords_angpix {coords_angpix} "
            "--output_star {output_star} "
            "--output_angpix {output_angpix} "
            "--output_processing {output_processing} "
            "--box {box} "
            "--diameter {diameter} "
            "--relative_output_paths "
            "--device_list {device_list} "
            "--perdevice {perdevice} "
            "{mode}"
        ),
        "parameters": [
            {"key": "settings",          "label": "WarpTools settings file",      "type": "path",   "default": "warp_tiltseries.settings",
             "help": "Path to warp_tiltseries.settings — usually in your WarpTools directory"},
            {"key": "input_star",        "label": "Input STAR (converted coords)", "type": "path",   "required": True, "from_job_types": ["pytom2warp_convert"],
             "help": "Output of Convert PyTom STAR step — pixel coords, _rlnMicrographName as .tomostar"},
            {"key": "coords_angpix",     "label": "Coords pixel size (Å/px)",      "type": "number", "required": True,
             "help": "Pixel size of the input coordinates — the binned tomogram pixel size (e.g. 11.056 for bin8)"},
            {"key": "output_star",       "label": "Output STAR file",              "type": "path",   "required": True,
             "help": "Path for output STAR — e.g. _sta/bin8/particles.star (inside project folder)"},
            {"key": "output_angpix",     "label": "Output pixel size (Å/px)",      "type": "number", "required": True,
             "help": "For same binning: same as coords_angpix. For unbinning ÷2: half of coords_angpix. E.g. bin8→bin4: 11.056→5.528"},
            {"key": "output_processing", "label": "Output processing dir",         "type": "text",   "required": True,
             "help": "Dir for particle images in WarpTools dir — e.g. ./warp_tiltseries/particles_bin8 (keep outside project, large files)"},
            {"key": "box",               "label": "Box size (px)",                 "type": "number", "required": True,
             "help": "Box size in pixels at OUTPUT resolution. If unbinning ×2, double the box. ~1.5× particle diameter / output_angpix"},
            {"key": "diameter",          "label": "Particle diameter (Å)",         "type": "number", "required": True,
             "help": "Impacts the CTF estimation region. Use actual particle diameter in Å"},
            {"key": "mode",              "label": "Output type",
             "type": "select", "options": ["--2d", "--3d"], "default": "--2d",
             "help": "--2d: CTF-corrected 2D image series (recommended for RELION-5 STA). --3d: 3D sub-volumes"},
            {"key": "device_list", "label": "GPU device list",   "type": "text",   "default": "0 1", "from_project": "compute_gpus",
             "help": "Space-separated GPU IDs. Auto-filled from project compute settings."},
            {"key": "perdevice",   "label": "Processes per GPU", "type": "number", "default": "2",
             "help": "Parallel processes per GPU. 2 per GPU is safe for particle export."},
        ],
    },
    {
        "id": "warp_export_slurm", "compute": "gpu",
        "name": "Export Particles SLURM script",
        "description": "Generate a SLURM batch script for WarpTools ts_export_particles. Sets GPU, memory, thread environment variables, and module loads. Saves the script to the scripts/ folder.",
        "category": "warp_export",
        "command": (
            "python -m cryostarbase.scripts.warp_export_slurm "
            "--settings {settings} "
            "--input_star {input_star} "
            "--coords_angpix {coords_angpix} "
            "--output_star {output_star} "
            "--output_angpix {output_angpix} "
            "--output_processing {output_processing} "
            "--box {box} --diameter {diameter} "
            "--mode {mode} "
            "--partition {partition} --mem {mem} --time {time} "
            "--warptools_module {warptools_module} "
            "{submit}"
        ),
        "parameters": [
            {"key": "settings",           "label": "WarpTools settings file",      "type": "path",   "default": "warp_tiltseries.settings"},
            {"key": "input_star",         "label": "Input STAR (converted coords)", "type": "path",   "required": True, "from_job_types": ["pytom2warp_convert"]},
            {"key": "coords_angpix",      "label": "Coords pixel size (Å/px)",      "type": "number", "required": True},
            {"key": "output_star",        "label": "Output STAR file",              "type": "path",   "required": True},
            {"key": "output_angpix",      "label": "Output pixel size (Å/px)",      "type": "number", "required": True},
            {"key": "output_processing",  "label": "Output processing dir",         "type": "text",   "required": True},
            {"key": "box",                "label": "Box size (px)",                 "type": "number", "required": True},
            {"key": "diameter",           "label": "Particle diameter (Å)",         "type": "number", "required": True},
            {"key": "mode",               "label": "Output type",
             "type": "select", "options": ["--2d", "--3d"], "default": "--2d"},
            {"key": "partition",          "label": "SLURM partition",               "type": "text",   "default": "gpu"},
            {"key": "mem",                "label": "Memory",                        "type": "text",   "default": "80G"},
            {"key": "time",               "label": "Time limit",                    "type": "text",   "default": "7-00:00:00"},
            {"key": "warptools_module",   "label": "WarpTools module name",         "type": "text",   "default": "warptools/2.0.0dev29",
             "help": "Module to load via ml/module load"},
            {"key": "submit",             "label": "Submit to SLURM?",
             "type": "select", "options": ["--submit", ""], "default": ""},
        ],
    },
    {
        "id": "pytom2warp_convert", "compute": "cpu", "category_override": "convert",
        "name": "Convert PyTom STAR",
        "description": "Fix coordinate system bug: convert PyTom centered-Angstrom coords to pixel coords for WarpTools extraction. Runs pytom2warp_converter_beta.py.",
        "category": "convert",
        "command": (
            "python pytom2warp_converter_beta.py "
            "{input_star} {output_star} "
            "--x_dim {x_dim} --y_dim {y_dim} --z_dim {z_dim} "
            "--pixel_size {pixel_size} --suffix {suffix} -y"
        ),
        "parameters": [
            {"key": "input_star",  "label": "Input STAR (from PyTom)",  "type": "path",   "required": True, "from_job_types": ["merge_stars", "extract_batch"],
             "help": "The merged or per-tomo STAR file from pytom_extract_candidates"},
            {"key": "output_star", "label": "Output STAR",              "type": "path",   "default": "_pytom/results/converted.star",
             "help": "Path relative to project dir — e.g. _pytom/results/converted.star"},
            {"key": "x_dim",       "label": "Tomo X (vox)",             "type": "number", "required": True, "from_project": "tomo_x"},
            {"key": "y_dim",       "label": "Tomo Y (vox)",             "type": "number", "required": True, "from_project": "tomo_y"},
            {"key": "z_dim",       "label": "Tomo Z (vox)",             "type": "number", "required": True, "from_project": "tomo_z"},
            {"key": "pixel_size",  "label": "Pixel Size (Å/px)",        "type": "number", "required": True, "from_project": "bin_pixel_size",
             "help": "Actual pixel size of the binned tomogram"},
            {"key": "suffix",      "label": "Suffix to remove from _rlnTomoName", "type": "text", "default": "", "from_project": "tomo_suffix",
             "help": "e.g. _11.06Apx — removed before .tomostar is appended"},
        ],
    },
    {
        "id": "star_score_match", "compute": "cpu",
        "name": "Match Scores to Warp STAR",
        "description": "After WarpTools extraction, transfer LCCmax/CutOff/SearchStd scores from the PyTom STAR back into the Warp-extracted STAR file. Auto-detects file types. Runs star_score_matcher_beta.py.",
        "category": "convert",
        "command": "python star_score_matcher_beta.py {pytom_star} {warp_star}",
        "parameters": [
            {"key": "pytom_star", "label": "PyTom converted STAR",   "type": "text", "required": True,
             "help": "Output of the Convert PyTom STAR step (contains _rlnLCCmax)"},
            {"key": "warp_star",  "label": "Warp extracted STAR",    "type": "text", "required": True,
             "help": "STAR file produced by WarpTools particle extraction (contains _rlnTomoParticleName)"},
        ],
    },
    {
        "id": "tm_analysis", "compute": "cpu",
        "name": "TM Quality Analysis",
        "description": "Generate 6 diagnostic figures: SNR distribution, per-tomogram quality, orientation coverage (Mollweide), spatial distribution, and best/worst tomogram ranking. Requires starfile, matplotlib, numpy, scipy, pandas. Runs tm_analysis_beta.py.",
        "category": "warp_export",
        "command": "python tm_analysis_beta.py {input_star} {output_prefix}",
        "parameters": [
            {"key": "input_star",     "label": "Input STAR file",     "type": "path", "required": True, "from_job_types": ["star_score_match", "warp_export_particles"],
             "help": "Converted or Warp-scored STAR file with _rlnLCCmax and _rlnSearchStd columns"},
            {"key": "output_prefix",  "label": "Output prefix",       "type": "text", "default": "tm_analysis",
             "help": "Prefix for saved figures: {prefix}_1_overview.png, _2_cutoff.png, etc."},
        ],
    },
    # ── Other Scripts (orange) ──
    {
        "id": "xml_backup",
        "name": "Backup Warp XMLs",
        "description": "Backup original WarpTools XML files (tilt angles, dose, defocus) from the warp_tiltseries folder. Files are copied unchanged. Use before any reprocessing that modifies XMLs.",
        "category": "other",
        "command": "mkdir -p {dest_dir}/{backup_name} && cp {source_dir}/*.xml {dest_dir}/{backup_name}/ && echo Backup done: $(ls {dest_dir}/{backup_name}/*.xml | wc -l) xml files",
        "parameters": [
            {"key": "source_dir",  "label": "Source XML directory (WarpTools)", "type": "path", "required": True,
             "help": "Full path to the warp_tiltseries folder — auto-filled from project WarpTools dir"},
            {"key": "dest_dir",    "label": "Backup destination directory",     "type": "path", "required": True,
             "help": "Where to store the backup — auto-filled from project WarpTools dir"},
            {"key": "backup_name", "label": "Backup folder name", "type": "text", "default": "xml_backup_20260330",
             "help": "Full name for the backup folder — include date manually, e.g. xml_backup_20260330_beforeCTF"},
        ],
    },
    {
        "id": "mod2star",
        "name": "IMOD .mod → STAR (mod2star)",
        "description": "Convert IMOD .mod manual pick files to a RELION-compatible STAR file. Uses model2point (IMOD) to extract coordinates, then merges into particles_all.star.",
        "category": "convert",
        "command": "python -m cryostarbase.scripts.mod2star --mods_folder {mods_folder} --suffix {suffix} --output {output_star_file} --csv_folder {csv_folder}",
        "parameters": [
            {"key": "mods_folder",     "label": "Folder with .mod files",    "type": "path",   "required": True,  "default": ".",
             "help": "Directory containing the .mod files from IMOD manual picking"},
            {"key": "suffix",          "label": "Tomo suffix to remove",      "type": "text",   "required": True,  "default": "",
             "help": "Suffix stripped from CSV filename to build .tomostar name (e.g. _10.71Apx). Auto-filled from project tomo suffix."},
            {"key": "output_star_file","label": "Output STAR file",           "type": "path",   "required": True,  "default": "particles_all.star"},
            {"key": "csv_folder",      "label": "CSV intermediate folder",    "type": "text",   "required": False, "default": "csv",
             "help": "Folder for intermediate CSV files (created automatically)"},
        ],
    },
    
    # ══════════════════════════════════════════════════════════
    # ── Miss Alignment (EXPERIMENTAL) ──
    # ══════════════════════════════════════════════════════════
    {
        "id": "miss_alignment_train",
        "name": "Miss Alignment Training",
        "description": (
            "Self-supervised deep learning alignment refinement. "
            "Run AFTER ts_reconstruct (requires reconstructed tomograms). "
            "This job optionally backs up XML files, updates XML volume/image dimensions "
            "(required by miss-alignment), then runs training. "
            "After training, continue with Steps 7-9 (defocus handedness, CTF, reconstruct)."
        ),
        "category": "miss_align",
        "compute": "gpu",
        "command": (
            "{missalign_python} {missalign_script} "
            "--xml_dir {xml_dir} "
            "--stack_x {stack_x} --stack_y {stack_y} "
            "--vol_x {vol_x} --vol_y {vol_y} --vol_z {vol_z} "
            "--pixel_size {pixel_size} "
            "--backup {backup_enabled} "
            "--backup_dir {backup_dir}/{backup_name} "
            "--batch_size {tilt_series_batch_size} && "
            "TORCH_NCCL_ENABLE_MONITORING=0 "
            "CUDA_VISIBLE_DEVICES={all_gpus} OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 "
            "{missalign_bin} "
            "--config-file {xml_dir}/miss_alignment_config.yaml "
            "--training-devices {train_gpus} "
            "--reconstruction-devices {recon_gpus} "
            "--dataloaders-per-trainer {dataloaders} "
            "--start-at-iteration {start_iter} "
            "--prepare-stacks {pixel_size} "
            "--pool-size {pool_size} "
            "{preprocess}"
        ),
        "parameters": [
            {"key": "missalign_python", "label": "Miss Alignment Python *", "type": "text", "required": True,
             "default": "",
             "help": "Auto-filled: /path/miniforge3/envs/miss-alignment/bin/python. Requires conda_base_path set in Setup tab."},
            {"key": "missalign_bin", "label": "Miss Alignment binary *", "type": "text", "required": True,
             "default": "miss-alignment",
             "help": "Auto-filled: /path/miniforge3/envs/miss-alignment/bin/miss-alignment"},
            {"key": "missalign_script", "label": "Setup script path", "type": "text",
             "default": "",
             "help": "Auto-filled: absolute path to miss_alignment_setup.py"},
            {"key": "xml_dir", "label": "Warp tilt series directory *", "type": "path", "required": True,
             "default": "warp_tiltseries",
             "help": "Absolute path to warp_tiltseries/ directory. Auto-filled from project. Config.yaml will be generated here."},
            {"key": "backup_enabled", "label": "Backup XMLs before training", "type": "select",
             "options": ["true", "false"], "default": "true",
             "help": "Backup XML files before training (recommended). Miss Alignment modifies XMLs during training."},
            {"key": "backup_dir", "label": "Backup destination directory", "type": "path",
             "default": "warp_tiltseries",
             "help": "Where to store the backup folder."},
            {"key": "backup_name", "label": "Backup folder name", "type": "text",
             "default": "xml_backup_pre_miss_alignment",
             "help": "Name for the backup folder inside the destination directory."},
            {"key": "stack_x", "label": "Stack shape X *", "type": "number", "required": True,
             "default": 4096,
             "help": "X dimension of original tilt series images (e.g. 4096)."},
            {"key": "stack_y", "label": "Stack shape Y *", "type": "number", "required": True,
             "default": 4096,
             "help": "Y dimension of original tilt series images (e.g. 4096)."},
            {"key": "vol_x", "label": "Volume shape X *", "type": "number", "required": True,
             "default": 4096,
             "help": "X dimension of reconstructed volume."},
            {"key": "vol_y", "label": "Volume shape Y *", "type": "number", "required": True,
             "default": 4096,
             "help": "Y dimension of reconstructed volume."},
            {"key": "vol_z", "label": "Volume shape Z *", "type": "number", "required": True,
             "default": 1500,
             "help": "Z dimension of reconstructed volume. Should tightly fit your sample to avoid training on empty regions."},
            {"key": "pixel_size", "label": "Pixel size (A) *", "type": "number", "required": True,
             "default": 1.724,
             "help": "Original pixel size in Angstroms from data collection."},
            {"key": "tilt_series_batch_size", "label": "Tilt series batch size", "type": "number",
             "default": 32,
             "help": "Patches reconstructed simultaneously. Auto-filled from GPU VRAM: ≥40GB=64, ≥30GB=32, <30GB=16."},
            {"key": "pool_size", "label": "Pool size", "type": "number",
             "default": 1200,
             "help": "Subtomogram pool size. Must be >= 2 × batch_size × dataloaders. Auto-filled from GPU VRAM. For 32GB: 1200, for 24GB: 1000."},
            {"key": "preprocess", "label": "Run preprocessing (--preprocess)", "type": "boolean",
             "default": False,
             "help": "Run cross-correlation based alignment BEFORE training iterations. Strongly recommended for FIB-lamellae with stage pretilt (e.g. ±9°). Estimates and corrects pretilt using cross-correlation — improves alignment quality and speeds up convergence. Enable for first run; can skip when resuming."},
            {"key": "train_gpus", "label": "Training GPUs *", "type": "text", "required": True,
             "default": "0",
             "help": "GPU ID(s) for training. With 2 GPUs use only GPU 0 to leave GPU 1 free for reconstruction."},
            {"key": "recon_gpus", "label": "Reconstruction GPUs *", "type": "text", "required": True,
             "default": "1,1,1,1,1,1",
             "help": "GPU ID(s) for reconstruction workers. With 2 GPUs use GPU 1 with 6 workers (3 per GPU). Repeat ID for parallel workers."},
            {"key": "all_gpus", "label": "All GPUs (CUDA_VISIBLE_DEVICES)", "type": "text",
             "default": "0,1",
             "help": "All unique GPU IDs — union of training + reconstruction GPUs."},
            {"key": "dataloaders", "label": "Dataloaders per trainer", "type": "number",
             "default": 8,
             "help": "Number of data loading workers per trainer."},
            {"key": "start_iter", "label": "Start at iteration", "type": "number",
             "default": "0",
             "help": "Starting iteration. Use 0 for new training, or set to resume from checkpoint."},
        ],
    },
    
    # ══════════════════════════════════════════════════════════
    # ── RELION ──
    # ══════════════════════════════════════════════════════════
    {
        "id": "relion_handler",
        "name": "RELION Image Handler",
        "description": "Rescale MRC maps using relion_image_handler. RELION must be loaded — set the module load command in the project Setup tab.",
        "category": "other",
        "command": (
            "{relion_module} relion_image_handler --i {input} --o {output} "
            "--angpix {angpix} --rescale_angpix {target} --new_box {box}"
        ),
        "parameters": [
            {"key": "relion_module", "label": "RELION module load command", "type": "text", "default": "",
             "help": "e.g. 'module load relion/5.0.1 &&' — auto-filled from project Setup if set. Leave empty if relion is already in PATH."},
            {"key": "input",  "label": "Input MRC",     "type": "path",   "required": True},
            {"key": "output", "label": "Output MRC",    "type": "path",   "required": True},
            {"key": "angpix", "label": "Current A/pix", "type": "number", "required": True},
            {"key": "target", "label": "Target A/pix",  "type": "number", "required": True},
            {"key": "box",    "label": "New box size",  "type": "number", "required": True},
        ],
    },
    {
        "id": "relion_initial_model",
        "name": "RELION Initial Model",
        "description": (
            "Generate an unbiased de-novo 3D reference from manually picked particles. "
            "In the RELION GUI this job is called 'Initial Model' (Jobs menu → Initial Model). "
            "Internally RELION runs relion_refine --denovo_3dref. "
            "Run on 50–200 hand-picked particles from 1–3 tomograms before template matching. "
            "Used to determine particle handedness and produce a template free of bias."
        ),
        "category": "relion",
        "group": "Average",       "compute": "gpu",
        "command": (
            "cd {relion_dir} && {relion_module} && "
            "mpirun -n {mpi} relion_refine_mpi "
            "--denovo_3dref "
            "--i {input_star} "
            "--o InitialModel/ "
            "--sym {sym} "
            "--iter {iterations} "
            "--j {threads} "
            "--K {K} "
            "--grad "
            "{extra_args}"
        ),
        "parameters": [
            {"key": "relion_module",  "label": "RELION module load command *", "type": "text", "required": True,
             "help": "e.g. 'module load relion/5.0.1' — from project Setup tab. In RELION GUI: Jobs → Initial Model."},
            {"key": "relion_dir",     "label": "RELION working dir *", "type": "path", "required": True,
             "help": "Folder where RELION will write output — usually relion_sta/"},
            {"key": "input_star",     "label": "Input STAR (manually picked) *", "type": "path", "required": True,
             "help": "STAR file from manual picking in 3dmod / Surforama + WarpTools extraction"},
            {"key": "K",              "label": "Number of classes", "type": "number", "default": "1",
             "help": "1 for initial model generation. Increase only if you suspect multiple conformations."},
            {"key": "sym",            "label": "Symmetry", "type": "text", "default": "C1",
             "help": "Always C1 for initial model — apply symmetry only after confirming handedness"},
            {"key": "iterations",     "label": "Iterations", "type": "number", "default": "200",
             "help": "200 is standard for stochastic gradient descent initial model"},
            {"key": "mpi",            "label": "MPI processes", "type": "number", "default": "1"},
            {"key": "threads",        "label": "Threads", "type": "number", "default": "4"},
            {"key": "extra_args",     "label": "Additional arguments", "type": "text", "default": "",
             "help": "e.g. --dont_check_norm"},
        ],
    },
    {
        "id": "relion_class3d",
        "name": "RELION 3D Classification",
        "description": (
            "First round 3D classification in RELION after PyTom template matching. "
            "T=0.5 + lowpass 150Å for junk removal (beads, carbon, ice). "
            "K auto-suggested from particle count. Angular sampling from Crowther criterion. "
            "RELION works in the relion_sta subfolder — set it from WarpTools output_star path. "
            "No --sigma_ang for first round — add in round 2+"
        ),
        "category": "relion",
        "group": "Classification",       "compute": "gpu",
        "command": (
            "cd {relion_dir} && {relion_module} && {tomo_cmd} "
            "mpirun -n {mpi} relion_refine_mpi "
            "--i {input_star} "
            "--ref {reference} "
            "--ini_high {lowpass} --K {K} --T {T} --sym {sym} "
            "--healpix_order {healpix_order} --offset_range {offset_range} --offset_step {offset_step} "
            "--iter {iterations} --j {threads} "
            "--dont_combine_weights_via_disc --pool {pool} "
            "{extra_args} "
            "--o run"
        ),
        "parameters": [
            {"key": "relion_module",  "label": "RELION module load *", "type": "text", "required": True,
             "help": "e.g. 'module load relion/5.0.1' — from project Setup tab"},
            {"key": "tomo_cmd",       "label": "RELION Tomo launch", "type": "text", "default": "relion --tomo &",
             "help": "Launch RELION in Tomo mode — needed for 2D stacks (RELION5). Use 'relion --tomo &' or leave blank for command-line only."},
            {"key": "relion_dir",     "label": "RELION working dir *", "type": "path", "required": True,
             "help": "e.g. relion_sta/relion_flower_normalres_pytom_TM_bin8 — auto-derived from WarpTools output_star"},
            {"key": "input_star",     "label": "Input STAR file *", "type": "path", "required": True,
             "from_job_types": ["warp_export_particles"],
             "help": "particles_*.star from WarpTools export — relative to RELION working dir (use ../../ prefix)"},
            {"key": "reference",      "label": "Reference map (.mrc) *", "type": "path", "required": True,
             "help": "Template or initial reference map — relative to RELION working dir"},
            {"key": "K",              "label": "Number of classes (K) *", "type": "number", "required": True,
             "help": "Auto-suggested: sqrt(N/200). For first classification: 4-10 classes to separate junk from real signal"},
            {"key": "lowpass",        "label": "Initial lowpass filter (Å)", "type": "number", "default": "150",
             "help": "150 Å for first classification (junk removal). Lower = higher resolution. Linked to T-value: T=0.5 → 150Å"},
            {"key": "T",              "label": "Regularisation T", "type": "number", "default": "0.5",
             "help": "T=0.5 + 150Å lowpass for bin8 first round (junk removal). Increase T as you lower binning and lowpass. Context: T is situational — T=0.5 with alignment (our workflow) is optimal when orientations are unknown and signal is weak after TM. T=4 without alignment is used for fast False Positive removal when orientations are already known (e.g. after M-refinement). T=0.5 for occupancy analysis on weak/transient binders. Ref: Appel et al. 2026 cryo-ET workflow."},
            {"key": "sym",            "label": "Symmetry", "type": "text", "default": "C1",
             "help": "C1 for first classification — apply symmetry only after confirming particle orientation"},
            {"key": "healpix_order",  "label": "Angular sampling *", "type": "healpix", "default": "5",
             "help": "HEALPix order = angular sampling fineness (HEALPix = sphere tessellation, NOT related to helical reconstruction). Order 5 = 3.7°, Order 6 = 1.8°. Use Crowther criterion to calculate. 'Helical reconstruction' in RELION is always set to No for STA."},
            {"key": "offset_range",   "label": "Offset search range (px)", "type": "number", "default": "2",
             "help": "2 px for bin8 (11 Å/px). Scale with binning: bin4 → 4, bin2 → 8"},
            {"key": "offset_step",    "label": "Offset search step (px)", "type": "number", "default": "1"},
            {"key": "iterations",     "label": "Number of iterations", "type": "number", "default": "25"},
            {"key": "mpi",            "label": "MPI processes", "type": "number", "default": "5"},
            {"key": "threads",        "label": "Threads per process", "type": "number", "default": "4"},
            {"key": "pool",           "label": "--pool", "type": "number", "default": "10",
             "help": "Number of particles pooled per thread. 10 is a good default."},
            {"key": "extra_args",     "label": "Additional arguments", "type": "text", "default": "",
             "help": "e.g. --dont_check_norm (if particles not normalised). No --sigma_ang for first round."},
        ],
    },
    # ── RELION STA — Classification & Cleaning ──────────────────────────────────
    {
        "id": "relion_class3d_align",
        "name": "Class3D — Fast Align",
        "description": (
            "3D Classification with alignment (1 class, local search only). "
            "Use AFTER WarpTools export and BEFORE classification without alignment. "
            "Aligns all particles quickly using their TM orientations as starting point. "
            "K=1, local search, GPU required. "
            "Input: particles.star from WarpTools ts_export_particles. "
            "Reference: initial model or TM template map. "
            "ini_high: start at 50 A, later set to ~Nyquist*1.5 of previous step. "
            "Limit E-step to Nyquist at current binning: raw_px * binning * 2."
        ),
        "category": "relion",
        "group": "Classification",       "compute": "gpu",
        "command": (
            "cd {relion_dir} && {relion_module} && "
            "mpirun -n {mpi} relion_refine_mpi "
            "--i {input_star} "
            "--ref {reference} "
            "--ini_high {ini_high} "
            "--K 1 "
            "--T {T} "
            "--sym {sym} "
            "--iter {iterations} "
            "--ctf "
            "--flatten_solvent "
            "--zero_mask "
            "--particle_diameter {mask_diameter} "
            "--healpix_order {healpix_order} "
            "--offset_range {offset_range} "
            "--offset_step {offset_step} "
            "--auto_local_healpix_order {local_order} "
            "--dont_combine_weights_via_disc "
            "--pool {pool} "
            "--j {threads} "
            "--gpu "
            "{extra_args} "
            "--o Class3D/align/run"
        ),
        "parameters": [
            {"key": "relion_module",  "label": "RELION module load *",  "type": "text",   "required": True,
             "help": "e.g. 'module load relion/5.0.1 &&' — from project Setup tab"},
            {"key": "relion_dir",     "label": "RELION working dir *",  "type": "path",   "required": True,
             "help": "Project directory where RELION writes output, e.g. relion_sta/"},
            {"key": "input_star",     "label": "Input STAR (particles) *", "type": "path", "required": True,
             "from_job_types": ["warp_export_particles"],
             "help": "particles.star from WarpTools ts_export_particles — relative path from relion_dir"},
            {"key": "reference",      "label": "Reference map (.mrc) *", "type": "path",  "required": True,
             "help": "Initial model or TM template map. Relative to relion_dir."},
            {"key": "ini_high",       "label": "Initial lowpass filter (A)", "type": "number", "default": "50",
             "help": "50 A for first alignment. For subsequent rounds: set to ~Nyquist*1.5 of previous step."},
            {"key": "mask_diameter",  "label": "Mask diameter (A) *",   "type": "number", "required": True,
             "help": "IMPORTANT: Must match --diameter used in WarpTools ts_export_particles — do NOT change independently. Defines angular sampling via Crowther criterion. Use RELION tab Crowther Calculator to verify. For reference: box_px * angpix * binning * 0.9 (e.g. 84px * 1.91A * 4 * 0.9 = ~570 A)."},
            {"key": "T",              "label": "Regularisation T",       "type": "number", "default": "0.5",
             "help": "T=0.5 for first alignment with unknown orientations. Try 0.5, 1, 2 in parallel."},
            {"key": "sym",            "label": "Symmetry",               "type": "text",   "default": "C1",
             "help": "Use C1 initially. Apply symmetry only after confirming handedness."},
            {"key": "iterations",     "label": "Iterations",             "type": "number", "default": "25"},
            {"key": "healpix_order",  "label": "Global angular sampling", "type": "healpix", "default": "4",
             "help": "Starting global order before local search kicks in. Order 4 = 7.5 deg."},
            {"key": "local_order",    "label": "Local angular sampling", "type": "healpix", "default": "5",
             "help": "Local search resolution. Order 5 = 3.7 deg, Order 6 = 1.8 deg."},
            {"key": "offset_range",   "label": "Offset search range (px)", "type": "number", "default": "2",
             "help": "2 px at bin8. Particles are already centred from TM — keep small."},
            {"key": "offset_step",    "label": "Offset search step (px)",  "type": "number", "default": "1"},
            {"key": "mpi",            "label": "MPI processes",            "type": "number", "default": "5"},
            {"key": "threads",        "label": "Threads per process",      "type": "number", "default": "4"},
            {"key": "pool",           "label": "--pool",                   "type": "number", "default": "10"},
            {"key": "extra_args",     "label": "Additional arguments",     "type": "text",   "default": "",
             "help": "e.g. --dont_check_norm --ctf_intact_first_peak"},
        ],
    },
    {
        "id": "relion_class3d_noalign",
        "name": "Class3D — Classify (no align)",
        "description": (
            "3D Classification WITHOUT alignment (N classes, CPU). "
            "Run AFTER Fast Align or M-refinement to separate good particles from false positives. "
            "K=4-6, T=2-4, no alignment, no GPU needed. "
            "Input: *_data.star from the iteration you liked in Fast Align, e.g. Class3D/align/run_it020_data.star. "
            "Reference: map from that same iteration, e.g. Class3D/align/run_it020_class001.mrc. "
            "ini_high: set slightly above the resolution reached in Fast Align step. "
            "Ref: Appel et al. 2026 use T=4 without alignment for fast FP removal after M-refinement."
        ),
        "category": "relion",
        "group": "Classification",       "compute": "cpu",
        "command": (
            "cd {relion_dir} && {relion_module} && "
            "mpirun -n {mpi} relion_refine_mpi "
            "--i {input_star} "
            "--ref {reference} "
            "--ini_high {ini_high} "
            "--K {K} "
            "--T {T} "
            "--sym {sym} "
            "--iter {iterations} "
            "--ctf "
            "--flatten_solvent "
            "--zero_mask "
            "--particle_diameter {mask_diameter} "
            "--skip_align "
            "--dont_combine_weights_via_disc "
            "--pool {pool} "
            "--j {threads} "
            "{extra_args} "
            "--o Class3D/classify/run"
        ),
        "parameters": [
            {"key": "relion_module",  "label": "RELION module load *",  "type": "text",   "required": True,
             "help": "e.g. 'module load relion/5.0.1 &&'"},
            {"key": "relion_dir",     "label": "RELION working dir *",  "type": "path",   "required": True},
            {"key": "input_star",     "label": "Input STAR (_data.star) *", "type": "path", "required": True,
             "help": "run_itXXX_data.star from the best iteration of Fast Align or Refine3D. E.g. Class3D/align/run_it020_data.star"},
            {"key": "reference",      "label": "Reference map (.mrc) *", "type": "path",  "required": True,
             "help": "run_itXXX_class001.mrc from the same iteration as input_star"},
            {"key": "ini_high",       "label": "Initial lowpass filter (A)", "type": "number", "default": "25",
             "help": "Set slightly above the resolution reached in Fast Align. E.g. if Fast Align gave 22 A, set to 25 A."},
            {"key": "K",              "label": "Number of classes (K) *", "type": "number", "required": True,
             "help": "4-6 classes for false positive removal. More classes = finer sorting but needs more particles per class."},
            {"key": "mask_diameter",  "label": "Mask diameter (A) *",   "type": "number", "required": True,
             "help": "Must match --diameter from WarpTools ts_export_particles. Same value as Fast Align job."},
            {"key": "T",              "label": "Regularisation T",       "type": "number", "default": "4",
             "help": "T=4 for no-alignment classification. High T enforces prior strongly. Try 2 and 4 in parallel."},
            {"key": "sym",            "label": "Symmetry",               "type": "text",   "default": "C1"},
            {"key": "iterations",     "label": "Iterations",             "type": "number", "default": "25"},
            {"key": "mpi",            "label": "MPI processes",          "type": "number", "default": "5"},
            {"key": "threads",        "label": "Threads per process",    "type": "number", "default": "4"},
            {"key": "pool",           "label": "--pool",                 "type": "number", "default": "10"},
            {"key": "extra_args",     "label": "Additional arguments",   "type": "text",   "default": "",
             "help": "e.g. --dont_check_norm"},
        ],
    },
    {
        "id": "relion_select",
        "name": "Subset Selection",
        "description": (
            "Select particles from specific classes after 3D classification. "
            "Run LOCALLY (not via queue) — opens RELION display GUI to select classes visually. "
            "Input: *_optimiser.star from the iteration you want to select from. "
            "E.g. Class3D/classify/run_it025_optimiser.star. "
            "Output: Select/jobXXX/particles.star with selected particles only."
        ),
        "category": "relion",
        "group": "Selection",       "compute": "cpu",
        "command": (
            "cd {relion_dir} && {relion_module} && "
            "relion_select "
            "--i {input_optimiser} "
            "--o Select/ "
            "--fn_data {output_star} "
            "--reextract_data_star {input_optimiser} "
            "{extra_args}"
        ),
        "parameters": [
            {"key": "relion_module",    "label": "RELION module load *",      "type": "text",   "required": True},
            {"key": "relion_dir",       "label": "RELION working dir *",      "type": "path",   "required": True},
            {"key": "input_optimiser",  "label": "Input optimiser.star *",    "type": "path",   "required": True,
             "help": "run_itXXX_optimiser.star from Class3D job at desired iteration. E.g. Class3D/classify/run_it019_optimiser.star"},
            {"key": "output_star",      "label": "Output STAR filename",      "type": "path",   "default": "particles_selected.star",
             "help": "Name for the output particles STAR file. Will be written to Select/jobXXX/"},
            {"key": "extra_args",       "label": "Additional arguments",      "type": "text",   "default": "",
             "help": "Note: Run locally, not via queue. RELION opens a display GUI for visual class selection."},
        ],
    },
    # ── RELION STA — Mask & Refinement ───────────────────────────────────────────
    {
        "id": "relion_mask_create",
        "name": "Mask Create",
        "description": (
            "Create a soft-edged solvent mask from a reference map for post-processing and refinement. "
            "Input: reference map (.mrc) from Refine3D or Reconstruct Particle. "
            "ini_threshold: initial binarisation threshold (try 0.01-0.05). "
            "extend_inimask: extend binary mask by N pixels before softening. "
            "width_soft_edge: soft edge width in pixels (typically 3-6)."
        ),
        "category": "relion",
        "group": "Mask & Refine",       "compute": "cpu",
        "command": (
            "cd {relion_dir} && {relion_module} && "
            "relion_mask_create "
            "--i {reference} "
            "--o {output_mask} "
            "--ini_threshold {ini_threshold} "
            "--extend_inimask {extend_inimask} "
            "--width_soft_edge {width_soft_edge} "
            "--j {threads} "
            "{extra_args}"
        ),
        "parameters": [
            {"key": "relion_module",    "label": "RELION module load *",      "type": "text",   "required": True},
            {"key": "relion_dir",       "label": "RELION working dir *",      "type": "path",   "required": True},
            {"key": "reference",        "label": "Input reference map (.mrc) *", "type": "path", "required": True,
             "help": "Map from Refine3D or Reconstruct Particle. Use a well-resolved map. Relative to relion_dir."},
            {"key": "output_mask",      "label": "Output mask (.mrc) *",      "type": "path",   "default": "MaskCreate/mask.mrc"},
            {"key": "ini_threshold",    "label": "Initial threshold",         "type": "number", "default": "0.02",
             "help": "Binarisation threshold. Try 0.01-0.05. Lower = larger mask. Check result in ChimeraX before post-processing."},
            {"key": "extend_inimask",   "label": "Extend mask (px)",          "type": "number", "default": "3",
             "help": "Extend binary mask by N pixels before applying soft edge. Typical: 2-5."},
            {"key": "width_soft_edge",  "label": "Soft edge width (px)",      "type": "number", "default": "6",
             "help": "Width of cosine soft edge in pixels. Typical: 3-8. Larger = softer transition."},
            {"key": "threads",          "label": "Threads",                   "type": "number", "default": "4"},
            {"key": "extra_args",       "label": "Additional arguments",      "type": "text",   "default": ""},
        ],
    },
    {
        "id": "relion_refine3d",
        "name": "Refine3D — Auto-Refine",
        "description": (
            "3D auto-refinement (gold-standard FSC) to high resolution. "
            "GPU required. Run after selecting good particles from classification. "
            "Input: particles.star from Subset Selection. "
            "Reference: best class map from classification or reconstructed average. "
            "ini_high: set to ~Nyquist at current binning (raw_px * binning * 2). "
            "Use --auto_local_sampling to let RELION increase angular sampling automatically. "
            "Output: Refine3D/jobXXX/run_half1_class001_unfil.mrc and run_half2_class001_unfil.mrc (for postprocess)."
        ),
        "category": "relion",
        "group": "Mask & Refine",       "compute": "gpu",
        "command": (
            "cd {relion_dir} && {relion_module} && "
            "mpirun -n {mpi} relion_refine_mpi "
            "--auto_refine "
            "--split_random_halves "
            "--i {input_star} "
            "--ref {reference} "
            "--ini_high {ini_high} "
            "--sym {sym} "
            "--particle_diameter {mask_diameter} "
            "--flatten_solvent "
            "--zero_mask "
            "--ctf "
            "--ctf_corrected_ref "
            "--solvent_correct_fsc "
            "--healpix_order {healpix_order} "
            "--auto_local_healpix_order {local_order} "
            "--offset_range {offset_range} "
            "--offset_step {offset_step} "
            "--low_resol_join_halves {low_resol_join} "
            "--dont_combine_weights_via_disc "
            "--pool {pool} "
            "--j {threads} "
            "--gpu "
            "{sigma_ang_flag} "
            "{extra_args} "
            "--o Refine3D/run"
        ),
        "parameters": [
            {"key": "relion_module",  "label": "RELION module load *",        "type": "text",   "required": True},
            {"key": "relion_dir",     "label": "RELION working dir *",        "type": "path",   "required": True},
            {"key": "input_star",     "label": "Input STAR (particles) *",    "type": "path",   "required": True,
             "help": "particles.star from Subset Selection (Select/jobXXX/particles.star)"},
            {"key": "reference",      "label": "Reference map (.mrc) *",      "type": "path",   "required": True,
             "help": "Best class map from Class3D. Relative to relion_dir."},
            {"key": "ini_high",       "label": "Initial lowpass filter (A)",  "type": "number", "default": "20",
             "help": "Set to ~Nyquist at current binning: raw_px * binning * 2. E.g. 1.91 * 4 * 2 = 15 A."},
            {"key": "mask_diameter",  "label": "Mask diameter (A) *",         "type": "number", "required": True,
             "help": "Must match --diameter from WarpTools ts_export_particles. Same value as all Class3D jobs."},
            {"key": "sym",            "label": "Symmetry",                    "type": "text",   "default": "C1"},
            {"key": "healpix_order",  "label": "Initial angular sampling", "type": "healpix", "default": "4",
             "help": "Starting order. RELION increases automatically via --auto_local_healpix_order."},
            {"key": "local_order",    "label": "Auto-local angular sampling", "type": "healpix", "default": "5",
             "help": "RELION will increase angular sampling up to this order automatically."},
            {"key": "offset_range",   "label": "Offset search range (px)",   "type": "number", "default": "5",
             "help": "Larger than in Class3D since refinement allows more freedom. Scale with binning."},
            {"key": "offset_step",    "label": "Offset search step (px)",    "type": "number", "default": "1"},
            {"key": "low_resol_join", "label": "Low-res join halves (\u00c5)",    "type": "number", "default": "40",
             "help": "Combine half-datasets below this resolution. Default 40 A is standard."},
            {"key": "mpi",            "label": "MPI processes",              "type": "number", "default": "5"},
            {"key": "threads",        "label": "Threads per process",        "type": "number", "default": "4"},
            {"key": "pool",           "label": "--pool",                     "type": "number", "default": "10"},
            {"key": "sigma_ang_flag", "label": "sigma_ang — Gaussian prior (recommended for STA)", "type": "text", "default": "",
             "help": "Soft Gaussian prior on angular changes. Critical for STA (missing wedge creates false maxima without it). Leave empty for Round 1. Round 2: --sigma_ang 5 (loose, ~5 deg uncertainty). Round 3: --sigma_ang 3 (standard, good starting angles from TM). Round 4+: --sigma_ang 1 (tight polishing). WARNING: Only use once you have a decent map (~20-30 A) — tight sigma_ang locks into wrong angles if starting orientations are poor. Local search (--auto_local_healpix_order) answers WHERE to look. sigma_ang answers HOW MUCH to trust new vs current orientation. Both together: strongest constraint, best for STA. Ref: RELION.md; progressive workflow: no sigma → 5 → 3 → 1."},
            {"key": "extra_args",     "label": "Additional arguments",       "type": "text",   "default": "",
             "help": "e.g. --solvent_mask MaskCreate/mask.mrc (if mask available)"},
        ],
    },
    {
        "id": "relion_postprocess",
        "name": "Post-Processing",
        "description": (
            "Post-processing after Refine3D: apply solvent mask, compute gold-standard FSC, "
            "and apply B-factor sharpening. "
            "Input half-maps: run_half1_class001_unfil.mrc and run_half2_class001_unfil.mrc from Refine3D. "
            "Input mask: output of Mask Create job. "
            "Output: sharpened map + PDF with FSC curves and Guinier plots."
        ),
        "category": "relion",
        "group": "Mask & Refine",       "compute": "cpu",
        "command": (
            "cd {relion_dir} && {relion_module} && "
            "relion_postprocess "
            "--i {half1_map} "
            "--i2 {half2_map} "
            "--mask {solvent_mask} "
            "--angpix {angpix} "
            "{bfac_flag} "
            "--filter_edge_width {filter_edge} "
            "{extra_args} "
            "--o PostProcess/postprocess"
        ),
        "parameters": [
            {"key": "relion_module",  "label": "RELION module load *",       "type": "text",   "required": True},
            {"key": "relion_dir",     "label": "RELION working dir *",       "type": "path",   "required": True},
            {"key": "half1_map",      "label": "Half-map 1 (.mrc) *",        "type": "path",   "required": True,
             "help": "Refine3D/jobXXX/run_half1_class001_unfil.mrc — unfiltered half-map from Refine3D"},
            {"key": "half2_map",      "label": "Half-map 2 (.mrc) *",        "type": "path",   "required": True,
             "help": "Refine3D/jobXXX/run_half2_class001_unfil.mrc — unfiltered half-map from Refine3D"},
            {"key": "solvent_mask",   "label": "Solvent mask (.mrc) *",      "type": "path",   "required": True,
             "help": "MaskCreate/mask.mrc from Mask Create job"},
            {"key": "angpix",         "label": "Pixel size (A/px) *",        "type": "number", "required": True,
             "help": "Pixel size of the half-maps: raw_px * binning. Auto-filled from project."},
            {"key": "bfac_flag",      "label": "B-factor mode",              "type": "text",   "default": "--auto_bfac",
             "help": "Use --auto_bfac for automatic B-factor estimation (recommended). Or --adhoc_bfac -50 for manual."},
            {"key": "filter_edge",    "label": "Filter edge width (px)",     "type": "number", "default": "2",
             "help": "Width of cosine edge applied at FSC resolution. Default 2 is standard."},
            {"key": "extra_args",     "label": "Additional arguments",       "type": "text",   "default": "",
             "help": "e.g. --mtf mtf_falcon4_300kV.star (MTF file for your detector, improves sharpening)"},
        ],
    },
    # ── IsoNet (missing wedge + denoising) ───────────────────────────────────────
    {
        "id": "isonet_denoise",
        "name": "IsoNet — Denoise + Missing Wedge",
        "description": (
            "IsoNet deep learning pipeline for cryo-ET tomogram enhancement. "
            "Runs the full pipeline: deconv → make_mask → extract → refine → predict. "
            "Reduces missing wedge artifacts and shot noise in reconstructed tomograms. "
            "Use for visual inspection and manual particle picking — NOT for quantitative STA analysis. "
            "Run AFTER WarpTools ts_reconstruct and BEFORE PyTom template matching. "
            "NOTE: This is IsoNet (Liu et al. 2022), NOT IsoNet2. "
            "GPU required. Needs >=5 tomograms for training. "
            "A tomograms.star must be prepared manually before running this command "
            "(see IsoNet section in the STA Guide for script). "
            "Ref: Liu et al. 2022, Nat Commun doi:10.1038/s41467-022-33957-8"
        ),
        "category": "other",
        "compute": "gpu",
        "command": (
            "cd {working_dir} && {module_load} && "
            "isonet.py deconv tomograms.star --snrfalloff {snrfalloff} --deconv_folder deconv && "
            "isonet.py make_mask tomograms.star --mask_folder mask "
            "--density_percentage {density_pct} --std_percentage {std_pct} && "
            "isonet.py extract tomograms.star && "
            "isonet.py refine subtomo.star --gpuID {gpu_id} --iterations {iterations} "
            "--noise_start_iter 10,15,20,25 --noise_level 0.05,0.1,0.15,0.2 "
            "--result_dir {result_dir} && "
            "isonet.py predict tomograms.star ./{result_dir}/{model_name} --gpuID {gpu_id}"
        ),
        "parameters": [
            {"key": "module_load",  "label": "Module load command *",    "type": "text",   "required": True,
             "help": "e.g. 'module load isonet' — loads IsoNet into PATH. Check your cluster's module list."},
            {"key": "working_dir",  "label": "Working directory *",      "type": "path",   "required": True,
             "help": "Directory containing tomograms.star. Usually a dedicated isonet/ subfolder."},
            {"key": "snrfalloff",   "label": "SNR falloff",              "type": "number", "default": "0.7",
             "help": "CTF deconvolution filter falloff. 0.7 is a safe default for most datasets."},
            {"key": "density_pct",  "label": "Density percentage (%)",   "type": "number", "default": "50",
             "help": "Top X% of densities included in the mask region. 50 is standard."},
            {"key": "std_pct",      "label": "Std percentage (%)",       "type": "number", "default": "50",
             "help": "Std threshold for mask. 50 is standard."},
            {"key": "iterations",   "label": "Refinement iterations",    "type": "number", "default": "50",
             "help": "50 is standard. More iterations = better denoising but longer runtime."},
            {"key": "gpu_id",       "label": "GPU ID",                   "type": "text",   "default": "0",
             "help": "GPU index to use, e.g. 0 or 0,1 for multi-GPU"},
            {"key": "result_dir",   "label": "Results directory name",   "type": "path",   "default": "results",
             "help": "IsoNet writes the trained model here."},
            {"key": "model_name",   "label": "Model filename",           "type": "path",   "default": "model_iter00.h5",
             "help": "Trained model file written by the refine step. "
                     "Check results/ after refine to confirm the exact filename."},
        ],
    },
    # ── STAR file tools ───────────────────────────────────────────────────────────
    {
        "id": "star_recenter",
        "name": "STAR — Recenter Particles",
        "description": (
            "Recenter particles in a RELION 3.1+ STAR file by applying a 3D shift in the "
            "local reference frame of each particle. "
            "Use when center of mass differs between datasets, or when merging datasets. "
            "Requires: recenter_3d.py (Alister Burt, gist.github.com/alisterburt). "
            "Dependencies: pandas scipy starfile typer einops (pip install). "
            "WARNING: Recenter only at the same binning level — "
            "avoid recentering at bin8 then re-extracting at bin4 without checking."
        ),
        "category": "other",
        "command": (
            "{python_cmd} recenter_3d.py "
            "--input {input_star} "
            "--shift {shift_x} {shift_y} {shift_z} "
            "--output {output_star}"
        ),
        "parameters": [
            {"key": "python_cmd",   "label": "Python command",          "type": "text",   "default": "python3",
             "help": "e.g. python3, or uv run if using uv"},
            {"key": "input_star",   "label": "Input STAR file *",       "type": "path",   "required": True,
             "help": "RELION 3.1+ style particles.star with rlnOriginX/Y/ZAngst columns"},
            {"key": "shift_x",      "label": "Shift X (Å)",             "type": "number", "default": "0"},
            {"key": "shift_y",      "label": "Shift Y (Å)",             "type": "number", "default": "0"},
            {"key": "shift_z",      "label": "Shift Z (Å)",             "type": "number", "default": "0",
             "help": "Shift applied in the LOCAL reference frame of each particle. "
                     "Use relion_image_handler --stats to check center of mass before and after."},
            {"key": "output_star",  "label": "Output STAR file",        "type": "path",   "default": "particles_recentered.star"},
        ],
    },
    {
        "id": "custom",
        "name": "Custom Command",
        "description": "Run any allowed command",
        "category": "other",
        "command": "{command}",
        "parameters": [
            {"key": "command", "label": "Command", "type": "text", "required": True},
        ],
    },
    # ── AreTomo3 (purple) ──
    {
        "id": "aretomo3_mdoc_fix",
        "name": "Fix MDOC Paths",
        "description": (
            "Update SubFramePath entries in all .mdoc files so AreTomo3 can find the frame movies. "
            "Run this from within the folder that contains your .mdoc files. "
            "Uses aretomo3_mdoc_path.py from cryostarbase/scripts/."
        ),
        "category": "aretomo3",
        "compute": "cpu",
        "command": "python -m cryostarbase.scripts.aretomo3_mdoc_path --mdocs_dir {raw_data_dir} --frames_dir {raw_data_dir}",
        "parameters": [
            {"key": "raw_data_dir", "label": "Frames + MDOCs directory *", "type": "path", "required": True,
             "placeholder": "/absolute/path/to/aretomo3/raw_data_frames",
             "help": "ABSOLUTE path to the folder containing both symlinked frames (.tif/.eer) AND copied .mdoc files. Use the Browse button — do not type a relative path."},
        ],
    },
    {
        "id": "aretomo3_batch",
        "name": "AreTomo3 Batch Alignment",
        "description": (
            "Run AreTomo3 on all .mdoc files in a directory. "
            "Performs motion correction, tilt-series alignment, and tomogram reconstruction in one step. "
            "Outputs .xf/.tlt files in _Imod/ subfolders for import into WarpTools. "
            "Direct execution or SLURM — set execution mode in the Computing tab. "
            "Uses aretomo3_batch.py from cryostarbase/scripts/."
        ),
        "category": "aretomo3",
        "compute": "gpu",
        "command": "python -m cryostarbase.scripts.aretomo3_batch --mdocs_dir {raw_data_dir} --aretomo3 {aretomo3_cmd} --gain {gain_ref} --outdir {output_dir} --angpix {pixel_size} --volz {vol_z} --alignz {align_z} --atbin {atbin} --kv {kv} --cs {cs} --corr_ctf {corr_ctf}",
        "parameters": [
            {"key": "raw_data_dir",  "label": "MDOC + frames directory", "type": "path", "required": False,
             "help": "Auto-filled: preprocessing_root/aretomo3/raw_data_frames/ — folder containing .mdoc files and frame movies"},
            {"key": "aretomo3_cmd",  "label": "AreTomo3 binary / command *", "type": "text", "required": True,
             "help": "e.g. AreTomo3 (if in PATH) or /full/path/to/AreTomo3. Set in Setup tab → Programs."},
            {"key": "gain_ref",      "label": "Gain reference filename *", "type": "path", "required": True,
             "help": "Filename only (not path) — must be in the same folder as the frames"},
            {"key": "output_dir",    "label": "Output directory", "type": "path", "default": "aretomo3_results",
             "help": "Will be created if it does not exist"},
            {"key": "pixel_size",    "label": "Raw pixel size (Å/px) *", "type": "number", "required": True,
             "help": "Pixel size of the raw movies — same as WarpTools --angpix"},
            {"key": "vol_z",         "label": "Volume Z thickness (Å)", "type": "number", "default": "2500",
             "help": "Z extent of reconstructed tomogram in Å. Adjust to sample thickness."},
            {"key": "align_z",       "label": "AlignZ (Å)", "type": "number", "default": "1000",
             "help": "Z extent used for alignment — ~sample thickness. Increase for thicker samples."},
            {"key": "atbin",         "label": "Binning factor", "type": "number", "default": "8",
             "help": "⚠ Must match WarpTools binning used for ts_import_alignments"},
            {"key": "kv",            "label": "Voltage (kV)", "type": "number", "default": "300"},
            {"key": "cs",            "label": "Cs (mm)", "type": "number", "default": "2.7"},
            {"key": "corr_ctf",      "label": "CTF correction",
             "type": "select", "options": ["1", "0"], "default": "1",
             "help": "1 = enable local CTF correction (recommended). 0 = disable."},
        ],
    },
    {
        "id": "aretomo3_collect",
        "name": "Collect AreTomo3 Alignments",
        "description": (
            "Scan AreTomo3 output folder for _Imod/ subfolders and copy all .xf and .tlt alignment files "
            "into a single flat folder ready for WarpTools ts_import_alignments. "
            "Uses get_aretomo3_alignments.py from cryostarbase/scripts/."
        ),
        "category": "aretomo3",
        "compute": "cpu",
        "command": "python -m cryostarbase.scripts.get_aretomo3_alignments --source {aretomo3_output_dir} --dest {alignments_dir}",
        "parameters": [
            {"key": "aretomo3_output_dir","label": "AreTomo3 output directory *", "type": "path", "required": True,
             "help": "Folder containing the _Imod/ subfolders produced by AreTomo3"},
            {"key": "alignments_dir",     "label": "Output alignments folder", "type": "path",
             "default": "import_alignments",
             "help": "Destination for the collected .xf/.tlt files — pass this to WarpTools ts_import_alignments --alignments"},
        ],
    },
]

GOOD_BOX_SIZES = [
    24, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 84, 96, 100, 104,
    112, 120, 128, 132, 140, 168, 180, 192, 196, 208, 216, 220, 224, 240,
    256, 260, 288, 300, 320, 352, 360, 384, 416, 440, 448, 480, 512,
]