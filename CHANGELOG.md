# Changelog

## 0.5.0 — Initial Release

Web-based project management and analysis pipeline for cryo-electron tomography, integrating AreTomo3, WarpTools, PyTom template matching, and RELION subtomogram averaging into a unified workflow.

- Multi-project workspace with per-project `cryostarbase.json` config and automatic parameter flow into every job
- Job Builder with color-coded categories, live command preview, and auto-fill from project config
- MDOC autofill for microscope/session metadata
- Job Queue with GPU-aware scheduling
- Lab Notebook with auto-documented history and Markdown/PDF export
- Data server (network share) browsing alongside the local filesystem
- Miss Alignment self-supervised alignment refinement
- RELION STA calculators (T, K, angular sampling) and general-purpose unit/STAR/MRC validation calculators
