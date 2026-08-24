"""Shared helpers for cryostarbase.scripts CLI tools.
Stdlib-only — no import of the cryostarbase package itself, so scripts
that import this stay independently runnable in any environment.
"""

import os
import subprocess


def submit_sbatch(script_path: str) -> bool:
    """Submit a generated SLURM script via sbatch. Prints the result and
    returns True on success. Uses an argv list (not os.system) so the
    script path is never interpreted by a shell."""
    try:
        result = subprocess.run(["sbatch", script_path], capture_output=True, text=True)
    except FileNotFoundError:
        print("  ✗ sbatch not found — is SLURM installed on this machine?")
        return False
    if result.returncode == 0:
        print(f"  ✓ {result.stdout.strip()}")
        return True
    print(f"  ✗ sbatch failed: {result.stderr.strip()}")
    return False


def write_pytom_slurm_script(
    script_path: str,
    job_name: str,
    results_dir: str,
    partition: str,
    time_limit: str,
    memory: str,
    echo_label: str,
    command_body: str,
) -> None:
    """Write a SLURM sbatch script for a PyTom job (template matching or
    candidate extraction) — shared by tm_loop.py and extract_loop.py, which
    only differ in job naming and the command they run."""
    script_content = f"""#!/bin/bash
#SBATCH --job-name={job_name}
#SBATCH --output={results_dir}/{job_name}_%j.out
#SBATCH --error={results_dir}/{job_name}_%j.err
#SBATCH --ntasks=1
#SBATCH --partition={partition}
#SBATCH --gres=gpu:1
#SBATCH --time={time_limit}
#SBATCH --mem={memory}

echo "{echo_label} (Job $SLURM_JOB_ID)"
echo "Node: $(hostname), GPU: $CUDA_VISIBLE_DEVICES"

{command_body}

echo "Exit code: $?"
"""
    with open(script_path, "w") as f:
        f.write(script_content)
    os.chmod(script_path, 0o755)
