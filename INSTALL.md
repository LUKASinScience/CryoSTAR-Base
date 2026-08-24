# CryoSTAR-Base — Installation Guide

**CryoSTAR-Base v0.5.0 — by Lukas W. Bauer und Claude**

---

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Python | ≥ 3.9 | Check with `python3 --version` |
| pip | any recent | bundled with Python |
| Git | any | to clone the repository |

> **macOS:** Python 3 is available via [Homebrew](https://brew.sh): `brew install python`  
> **Linux (HPC):** Use `module load python/3.11` or equivalent  
> **Windows:** Use [Python.org installer](https://www.python.org/downloads/) or WSL2

---

## Step 1 — Get the code

Clone the repository into a folder of your choice — this is where the **app code** lives, separate from your data:

```bash
# Example: clone into your home directory
cd ~
git clone https://github.com/LUKASinScience/CryoSTAR-Base.git
cd CryoSTAR-Base
```

Or if you received a zip archive:

```bash
unzip cryostarbase.zip
cd cryostarbase
```

---

## Step 2 — Delete old environment (if upgrading)

If you have an existing environment from a previous install, remove it first:

**venv:**
```bash
rm -rf ~/cryostarbase_env
```

**conda / mamba:**
```bash
conda env remove -n cryostarbase_env
```

> **Why?** Upgrading Python or dependencies can leave a broken environment. Starting fresh avoids conflicts.

---

## Step 3 — Create a fresh virtual environment

Create the environment **outside** the project folder with a clear name, so you can activate it from anywhere:

**Option A — venv (built-in, no extra tools needed):**
```bash
# Creates ~/cryostarbase_env — works from any directory
python3 -m venv ~/cryostarbase_env
```

**Option B — conda / mamba (recommended on HPC):**
```bash
conda create -n cryostarbase_env python=3.11
# or with mamba (faster):
mamba create -n cryostarbase_env python=3.11
```

> The environment name `cryostarbase_env` makes it easy to identify and activate from any folder.

---

## Step 4 — Activate the environment

**venv — macOS / Linux:**
```bash
source ~/cryostarbase_env/bin/activate
```

**venv — Windows (PowerShell):**
```powershell
~\cryostarbase_env\Scripts\Activate.ps1
```

**conda / mamba:**
```bash
conda activate cryostarbase_env
```

Your prompt will show `(cryostarbase_env)`. You can now activate it from **any directory** — you never need to `cd` into the project folder first.

---

## Step 5 — Install CryoSTAR-Base

With the environment active:

```bash
pip install -e .
```

The `-e` flag installs in **editable mode** — the app always uses the latest code from the folder, so you never need to reinstall after pulling updates.

To also enable reading `.mrc` files directly:

```bash
pip install -e ".[mrc]"
```

**Expected output (last few lines):**
```
Successfully installed cryostarbase-0.5.0 fastapi-... uvicorn-... pydantic-...
```

---

## Step 6 — Verify the installation

```bash
cryostarbase --help
```

You should see:

```
usage: cryostarbase [-h] [-d WORKSPACE_DIR] [-p PORT] [--host HOST] [--reload]

CryoSTAR-Base v0.5.0 — Cryo-ET project management & STA pipeline GUI
...
```

If you see `command not found`, make sure the environment is activated (Step 4).

---

## Step 7 — Start the app

```bash
cryostarbase
```

Or with options:

```bash
# Start with a specific browse directory
cryostarbase -d /path_example/data

# Use a different port (e.g. if 8787 is busy)
cryostarbase -p 8888

# Allow access from other computers on your network
cryostarbase --host 0.0.0.0
```

Then open **http://127.0.0.1:8787** in your browser.

**Example output:**
```
  CryoSTAR-Base v0.5.0  —  by Lukas W. Bauer und Claude
  ────────────────────────────────────────────
  Browse dir :  /path_example/data
  URL        :  http://127.0.0.1:8787
  Projects   :  0 in browse dir
  ─────────────────────────────────────────────
  Open http://127.0.0.1:8787 in your browser to start.
  Press Ctrl+C to stop the server.
```

Stop the server with `Ctrl+C`.

---

## Step 8 — (Optional) Permanent shortcut

So you can run `cryostarbase` from **any terminal without activating the environment** first:

**venv — macOS / Linux — add to `~/.zshrc` or `~/.bashrc`:**
```bash
echo 'alias cryostarbase="$HOME/cryostarbase_env/bin/cryostarbase"' >> ~/.zshrc
source ~/.zshrc
```

**conda — add to `~/.zshrc` or `~/.bashrc`:**
```bash
echo 'alias cryostarbase="conda run -n cryostarbase_env cryostarbase"' >> ~/.zshrc
source ~/.zshrc
```

**Verify:**
```bash
cryostarbase --help   # works from any directory, any terminal
```

---

## Where things live

```
~/cryostarbase/           ← app code (clone it here, never edit this for data)
  cryostarbase/           ← the Python package
    frontend/
      index.html        ← copy updated index.html here after updates!
    cli.py
    server.py
    core.py
    models.py

~/.cryostar_base_projects.json   ← project registry (auto-created, tracks all projects)

/path_example/data/projects/    ← your actual data (set this in New Project → Processing Directory)
  ribosomes_pytom_tm/
  GAPDH_pytom_tm/
```

~/cryostarbase_env/        ← Python environment (venv, lives in home dir)

> **Important:** Projects can live **anywhere** on your system — on a scratch drive, network mount, or any folder. Use the **Processing Directory** field when creating a new project to choose where it goes. The app remembers all your projects across sessions via `~/.cryostar_base_projects.json`.

---

## Updating CryoSTAR-Base

Pull the latest code and copy updated files:

```bash
cd ~/cryostarbase
git pull

# Activate environment
source .venv/bin/activate

# Re-install to pick up any new dependencies or entry points
pip install -e .
```

No need to delete `.venv` unless there's a major Python version change.

After updating, copy the new `index.html` into the frontend folder:

```bash
cp index.html cryostarbase/frontend/index.html
```

---

## HPC / Cluster installation

On a cluster, install in your home directory and use a SLURM-compatible port:

```bash
# Load Python module
module load python/3.11

# Clone and install
cd ~
git clone https://github.com/LUKASinScience/CryoSTAR-Base.git
cd CryoSTAR-Base
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

# Start on a login node (or in an interactive job)
cryostarbase --host 0.0.0.0 -p 8787

# Access via SSH tunnel from your laptop:
# ssh -L 8787:login-node:8787 username@cluster
# Then open http://127.0.0.1:8787 in your browser
```

---

## Troubleshooting

**`command not found: cryostarbase`**
→ Environment is not activated. Run `source .venv/bin/activate` first.

**`pip: command not found`**
→ Use `pip3` instead of `pip`, or `python3 -m pip install -e .`

**`Port 8787 already in use`**
→ Use `cryostarbase -p 8888` (or any free port).

**App opens but shows no projects**
→ Projects are shown from the browse directory. Click `+ New Project` and set the **Processing Directory** to where you want your project data to live. Previously created projects are tracked in `~/.cryostar_base_projects.json`.

**`RuntimeError: Form data requires "python-multipart"`**
→ Run: `pip install python-multipart`
→ Or reinstall with: `pip install -e .` (it's now included in dependencies)

**`ModuleNotFoundError: No module named 'mrcfile'`**
→ Install the optional MRC dependency: `pip install ".[mrc]"`

**Browser shows old version after update**
→ Hard-refresh: `Cmd+Shift+R` (macOS) or `Ctrl+Shift+R` (Windows/Linux). Make sure `index.html` was copied to `cryostarbase/frontend/`.

---

*CryoSTAR-Base — built by Lukas W. Bauer und Claude — 2026*
