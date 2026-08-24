"""
Bundled pipeline scripts for CryoSTAR-Base pipeline workflow.

Each script is both:
  - A standalone CLI:  python -m cryostarbase.scripts.<name> [args]
  - An importable module with a main function

Scripts are installed with the package — no need to copy them around.
"""

from pathlib import Path

# Where the scripts live (for copying to project dirs if needed)
SCRIPTS_DIR = Path(__file__).parent


def script_path(name: str) -> Path:
    """Get absolute path to a bundled script."""
    p = SCRIPTS_DIR / name
    if not p.exists():
        raise FileNotFoundError(f"Bundled script not found: {name}")
    return p


def list_scripts() -> list[dict]:
    """List all bundled scripts with descriptions."""
    scripts = []
    for py in sorted(SCRIPTS_DIR.glob("*.py")):
        if py.name.startswith("_"):
            continue
        # Read first docstring line
        desc = ""
        try:
            content = py.read_text()
            for line in content.split("\n"):
                line = line.strip()
                if line.startswith('"""') or line.startswith("'''"):
                    desc = line.strip("\"'").strip()
                    break
        except Exception:
            pass
        scripts.append({
            "name": py.stem,
            "file": py.name,
            "path": str(py),
            "description": desc,
            "run_as": f"python -m cryostarbase.scripts.{py.stem}",
        })
    return scripts


def copy_scripts_to(target_dir: Path) -> list[str]:
    """Copy all scripts to a target project's scripts/ folder."""
    dest = target_dir / "scripts"
    dest.mkdir(exist_ok=True)
    copied = []
    for py in SCRIPTS_DIR.glob("*.py"):
        if py.name.startswith("_"):
            continue
        import shutil
        shutil.copy2(str(py), str(dest / py.name))
        copied.append(py.name)
    return copied