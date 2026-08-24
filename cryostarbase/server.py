"""FastAPI app — all routes."""

from pathlib import Path
from datetime import datetime
import asyncio
import subprocess
import json
import sys
import shlex
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, UploadFile, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from cryostarbase import core
from cryostarbase.models import (
    CreateProjectRequest, SetupDataRequest, RunJobRequest, RunRequest,
    NoteRequest, JobNoteRequest,
    ConvertCoordsRequest, TEMPLATES, GOOD_BOX_SIZES,
    TEMPLATE_CATEGORIES, ProjectConfig,
)

FRONTEND = Path(__file__).parent / "frontend"
# Bundled scripts shipped with the package
SCRIPTS_DIR = Path(__file__).parent / "scripts"


# Module-level cache for inspect_info — keyed by (path, mtime), auto-invalidates on file change
_inspect_info_cache: dict = {}


def create_app(workspace_dir: str = ".") -> FastAPI:
    core.set_workspace(Path(workspace_dir).resolve())
    app = FastAPI(title="CryoSTAR-Base", version="0.5.0")

    # ── Notion API proxy ──────────────────────────────────────────────────
    @app.post("/api/notion/search")
    async def notion_search(req: Request):
        """Proxy for Notion API search — avoids browser CORS restrictions."""
        from fastapi import HTTPException
        import urllib.request
        import urllib.error
        import json as _json
        body = await req.json()
        token = body.get("token", "").strip()
        query = body.get("query", "").strip()
        if not token or not query:
            raise HTTPException(400, "token and query are required")
        # Call Notion search API
        payload = _json.dumps({"query": query, "page_size": 15}).encode()
        request = urllib.request.Request(
            "https://api.notion.com/v1/search",
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as resp:
                data = _json.loads(resp.read())
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")
            raise HTTPException(e.code, f"Notion API error: {err[:200]}")
        except Exception as e:
            raise HTTPException(500, str(e))
        # Normalise results
        results = []
        for obj in data.get("results", []):
            otype = obj.get("object", "page")
            url   = obj.get("url", "")
            # Extract title
            title = "Untitled"
            if otype == "page":
                props = obj.get("properties", {})
                for k, v in props.items():
                    if v.get("type") == "title":
                        texts = v.get("title", [])
                        title = "".join(t.get("plain_text", "") for t in texts) or "Untitled"
                        break
            elif otype == "database":
                for t in obj.get("title", []):
                    title += t.get("plain_text", "")
                title = title.strip() or "Untitled"
            results.append({"type": otype, "title": title, "url": url})
        return {"results": results}

    @app.get("/api/health")
    async def health():
        import sys
        return {
            "status": "ok",
            "workspace": str(core.get_ws().workspace_dir),
            "scripts_dir": str(SCRIPTS_DIR.resolve()),
            "python_executable": sys.executable,
        }

    # ── Projects ──
    @app.get("/api/projects")
    async def list_projects():
        return {"projects": core.discover_projects()}

    @app.get("/api/projects/{f}/config")
    async def proj_cfg(f: str):
        return core.get_project_config(f)

    @app.post("/api/projects/{f}/config")
    async def upd_cfg(f: str, updates: dict):
        # If _merge_programs flag set, merge programs dict entry by entry
        if updates.pop("_merge_programs", False) and "programs" in updates:
            cfg = core.get_project_config(f)
            existing = cfg.get("programs", {})
            existing.update(updates["programs"])
            updates["programs"] = existing
        return core.update_project_config(f, updates)

    @app.post("/api/projects/create")
    async def create_proj(req: CreateProjectRequest):
        r = core.create_project(
            req.target_name, req.warptools_dir, req.tomo_name, req.investigators,
            req.processing_dir, req.preprocessing_name, req.preprocessing_path)
        if r.get("status") == "error":
            raise HTTPException(400, r["msg"])
        return r

    @app.post("/api/projects/{f}/setup")
    async def setup_proj(f: str, req: SetupDataRequest):
        try:
            result = core.setup_project_data(
                f, req.x_dim, req.y_dim, req.z_dim,
                req.raw_pixel_size, req.binning_factor)
            # Notebook is already updated in setup_project_data()
            return result
        except Exception as e:
            raise HTTPException(400, str(e))

    @app.post("/api/projects/{f}/create_preprocessing")
    async def create_preprocessing(f: str, req: dict):
        """Create preprocessing folder structure (warptools/ + aretomo3/)"""
        try:
            preprocessing_name = req.get("preprocessing_name", "").strip()
            preprocessing_path = req.get("preprocessing_path", "").strip()
            if not preprocessing_name:
                raise HTTPException(400, "preprocessing_name required")
            
            # Get project base path
            ws = core.get_ws().workspace_dir
            proj = ws / f
            if not proj.exists():
                raise HTTPException(404, f"Project {f} not found")
            
            # Determine parent directory
            if preprocessing_path:
                preproc_parent = Path(preprocessing_path).expanduser().resolve()
            else:
                preproc_parent = proj.parent
            
            # Create preprocessing root
            preproc_root = preproc_parent / preprocessing_name
            preproc_root.mkdir(parents=True, exist_ok=True)
            
            # Create warptools/ subtree
            wt = preproc_root / "warptools"
            wt.mkdir(exist_ok=True)
            (wt / "warp_tiltseries").mkdir(exist_ok=True)
            (wt / "warp_tiltseries" / "xml").mkdir(exist_ok=True)
            (wt / "warp_tiltseries" / "reconstruction").mkdir(exist_ok=True)
            
            # Create aretomo3/ subtree
            at = preproc_root / "aretomo3"
            at.mkdir(exist_ok=True)
            (at / "alignments").mkdir(exist_ok=True)

            # Persist warptools_dir to project config
            try:
                core.update_project_config(f, {
                    "warptools_dir": str(wt),
                })
            except Exception:
                pass  # Non-fatal

            return {
                "success": True,
                "warptools_dir": str(wt),
                "aretomo3_dir": str(at),
                "preprocessing_root": str(preproc_root)
            }
        except Exception as e:
            raise HTTPException(400, str(e))


    @app.post("/api/projects/{f}/connect")
    async def connect_project(f: str, req: dict):
        ws = core.get_ws().workspace_dir
        cfg = ProjectConfig.load(ws / f)
        entry = {
            "folder": req.get("folder",""),
            "description": req.get("description",""),
            "particle_count": req.get("particle_count",""),
            "date": req.get("date",""),
            "reason": req.get("reason",""),
        }
        cfg.connected_projects = [p for p in cfg.connected_projects if p.get("folder") != entry["folder"]]
        cfg.connected_projects.append(entry)
        cfg.save(ws / f)
        return {"connected_projects": cfg.connected_projects}

    @app.delete("/api/projects/{f}/connect/{target}")
    async def disconnect_project(f: str, target: str):
        ws = core.get_ws().workspace_dir
        cfg = ProjectConfig.load(ws / f)
        cfg.connected_projects = [p for p in cfg.connected_projects if p.get("folder") != target]
        cfg.save(ws / f)
        return {"connected_projects": cfg.connected_projects}

    @app.post("/api/projects/{f}/tab_status")
    async def update_tab_status(f: str, req: dict):
        """Update completion status for a tab. Called automatically on save."""
        ws = core.get_ws().workspace_dir
        cfg = ProjectConfig.load(ws / f)
        cfg.tab_status = {**cfg.tab_status, **req}
        cfg.save(ws / f)
        return {"tab_status": cfg.tab_status}

    @app.post("/api/projects/{f}/investigators")
    async def add_investigator(f: str, req: dict):
        name = (req.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "name required")
        ws = core.get_ws().workspace_dir
        cfg = ProjectConfig.load(ws / f)
        if name not in cfg.investigators:
            cfg.investigators.append(name)
            cfg.save(ws / f)
        return {"investigators": cfg.investigators}

    @app.delete("/api/projects/{f}/investigators/{name}")
    async def remove_investigator(f: str, name: str):
        ws = core.get_ws().workspace_dir
        cfg = ProjectConfig.load(ws / f)
        cfg.investigators = [i for i in cfg.investigators if i != name]
        cfg.save(ws / f)
        return {"investigators": cfg.investigators}

    # ── Jobs ──
    @app.get("/api/projects/{f}/jobs")
    async def proj_jobs(f: str):
        return {"jobs": core.list_jobs(f)}

    @app.get("/api/projects/{f}/next_job_id")
    async def proj_next_job_id(f: str):
        """Preview the next job ID without allocating it — for Job Builder display."""
        try:
            proj = core.resolve_project_dir(f)
            cfg = ProjectConfig.load(proj)
            return {"next_job_id": cfg.peek_next_job_id()}
        except Exception as e:
            return {"next_job_id": "J???", "error": str(e)}

    @app.get("/api/projects/{f}/jobs/{jid}")
    async def proj_job(f: str, jid: str):
        j = core.get_job(f, jid)
        if not j:
            raise HTTPException(404)
        return j

    @app.get("/api/projects/{f}/jobs/{jid}/log")
    async def proj_job_log(f: str, jid: str):
        """Return full log lines from the job's .log file."""
        from cryostarbase.models import JobRecord
        proj = core.get_ws().workspace_dir / f
        j = JobRecord.load(proj, jid)
        if not j:
            raise HTTPException(404, "Job not found")
        lines = j.read_log(proj)
        return {"job_id": jid, "lines": lines}

    @app.patch("/api/projects/{f}/jobs/{jid}")
    async def patch_job(f: str, jid: str, req: Request):
        """Update custom_title, tags, notes, or parent_jobs on a job."""
        from cryostarbase.models import JobRecord
        body = await req.json()
        proj = core.get_ws().workspace_dir / f
        j = JobRecord.load(proj, jid)
        if not j:
            raise HTTPException(404, "Job not found")
        if "custom_title" in body:
            j.custom_title = str(body["custom_title"])
        if "tags" in body:
            j.tags = [str(t).strip() for t in body["tags"] if str(t).strip()]
        if "notes" in body:
            j.notes = str(body["notes"])
        if "parent_jobs" in body:
            j.parent_jobs = [str(p) for p in body["parent_jobs"]]
        j.save(proj)
        return {"status": "ok", "job_id": jid}

    @app.post("/api/projects/{f}/jobs/{jid}/note")
    async def job_note(f: str, jid: str, req: JobNoteRequest):
        return core.add_job_note(f, jid, req.notes)

    @app.post("/api/jobs/run")
    async def run_job(req: RunJobRequest):
        try:
            # CRITICAL: Always use build_command to ensure conda activation and autofill
            cmd = core.build_command(req.job_type, req.parameters, req.project)
            # Only use custom command if no job_type (for truly custom jobs)
            if req.command and not req.job_type:
                cmd = req.command
            
            jr = core.create_job(req.project, req.job_type, req.title or req.job_type,
                                 cmd, req.parameters, req.notes)
            rj = await core.runner.run(cmd, cwd=str(core.get_ws().workspace_dir / req.project),
                                       project=req.project, job_id=jr.job_id)
            return {"job_id": jr.job_id, "run_id": rj.id, "status": rj.status.value,
                    "exit_code": rj.exit_code, "duration": rj.duration}
        except PermissionError as e:
            raise HTTPException(403, str(e))
        except Exception as e:
            raise HTTPException(500, str(e))

    # ── Notes ──
    @app.get("/api/projects/{f}/notes")
    async def get_notes(f: str):
        return core.read_notes(f)

    @app.post("/api/notes")
    async def add_note(req: NoteRequest):
        return core.append_note(req.project, req.text)

    # ── Workflows ──
    @app.get("/api/projects/{f}/workflows")
    async def list_wf(f: str):
        return {"workflows": core.list_workflows(f)}

    @app.get("/api/projects/{f}/workflows/{wid}")
    async def get_wf(f: str, wid: str):
        wf = core.get_workflow(f, wid)
        if not wf:
            raise HTTPException(404, "Workflow not found")
        return wf

    @app.post("/api/projects/{f}/workflows")
    async def create_wf(f: str, req: Request):
        body = await req.json()
        try:
            return core.create_workflow(
                f,
                name=body.get("name", "Untitled workflow"),
                description=body.get("description", ""),
                steps=body.get("steps", []),
            )
        except Exception as e:
            raise HTTPException(400, str(e))

    @app.patch("/api/projects/{f}/workflows/{wid}")
    async def update_wf(f: str, wid: str, req: Request):
        body = await req.json()
        result = core.update_workflow(f, wid, body)
        if "error" in result:
            raise HTTPException(404, result["error"])
        return result

    @app.delete("/api/projects/{f}/workflows/{wid}")
    async def delete_wf(f: str, wid: str):
        result = core.delete_workflow(f, wid)
        if "error" in result:
            raise HTTPException(404, result["error"])
        return result

    @app.post("/api/projects/{f}/workflows/{wid}/run")
    async def run_wf(f: str, wid: str, req: Request):
        body = await req.json()
        overrides = body.get("param_overrides", {})
        result = await core.run_workflow(f, wid, overrides)
        if "error" in result:
            raise HTTPException(400, result["error"])
        return result

    # ── Files ──
    @app.get("/api/files/browse")
    async def browse(path: str = "."):
        try:
            return core.ls(path)
        except core.SecurityError as e:
            raise HTTPException(403, str(e))
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.post("/api/files/upload")
    async def upload_file(file: UploadFile, dest_dir: str = Form(...)):
        """Receive a dropped file and save it to dest_dir on the server (confined to the workspace)."""
        import shutil
        try:
            dest = core._safe(dest_dir)
        except core.SecurityError as e:
            raise HTTPException(403, str(e))
        dest.mkdir(parents=True, exist_ok=True)
        dest_file = dest / (file.filename or "upload")
        with open(dest_file, "wb") as f:
            shutil.copyfileobj(file.file, f)
        return {"path": str(dest_file), "name": file.filename}

    @app.get("/api/files/image")
    async def serve_image(path: str):
        """Serve a PNG/PDF image file from the filesystem for the TM Analysis viewer."""
        from pathlib import Path
        p = Path(path)
        if not p.exists():
            raise HTTPException(404, f"File not found: {path}")
        if p.suffix.lower() not in {'.png','.jpg','.jpeg','.pdf','.svg'}:
            raise HTTPException(400, "Not an image file")
        return FileResponse(str(p), media_type={
            '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
            '.pdf':'application/pdf','.svg':'image/svg+xml'
        }.get(p.suffix.lower(),'application/octet-stream'))

    @app.get("/api/files/browse_free")
    async def browse_free(path: str = "/"):
        """Unrestricted filesystem browse — for the finder panel.
        Returns dirs + common science file types only. Never reads file contents."""
        import os
        from pathlib import Path
        ALLOWED_EXT = {'.star','.mrc','.rec','.json','.txt','.log','.md',
                       '.py','.sh','.xml','.tlt','.toml','.yaml','.yml','.settings',
                       '.tif','.tiff','.eer','.mdoc','.xf','.dm4','.dm3'}
        try:
            p = Path(path).resolve()
            if not p.exists():
                raise HTTPException(404, str(p))
            items = []
            for e in sorted(p.iterdir()):
                if e.name.startswith('._'):
                    continue  # skip Apple Double files
                try:
                    # Use lstat for the entry itself, stat for the target (follows symlinks)
                    is_link = e.is_symlink()
                    is_dir  = e.is_dir()   # follows symlinks
                    is_file = e.is_file()  # follows symlinks
                    ext = e.suffix.lower()
                    if not (is_dir or ext in ALLOWED_EXT):
                        continue
                    # Get size — use stat() to follow symlink to actual file size
                    size = None
                    try:
                        size = e.stat().st_size if is_file else None
                    except OSError:
                        size = None  # broken symlink — still show it
                    items.append({
                        "name": e.name,
                        "path": str(e),
                        "is_dir": is_dir,
                        "size": size,
                        "ext": ext if is_file or is_link else None,
                        "is_link": is_link,
                        "is_pytom": is_dir and e.name.endswith("_base"),
                    })
                except (PermissionError, OSError):
                    continue
            return {
                "path": str(p),
                "parent": str(p.parent) if p != p.parent else None,
                "items": items,
            }
        except PermissionError:
            raise HTTPException(403, "Permission denied")

    # ── Data Server (SMB/NFS) config + browsing ───────────────────────────────
    _DS_CONFIG = Path.home() / ".cryostar_base_config.json"

    def _ds_load() -> dict:
        try:
            return json.loads(_DS_CONFIG.read_text()) if _DS_CONFIG.exists() else {}
        except Exception:
            return {}

    def _ds_save(data: dict) -> None:
        existing = _ds_load()
        existing.update(data)
        _DS_CONFIG.write_text(json.dumps(existing, indent=2))

    def _smb_to_gvfs(smb_url: str):
        """Convert smb://SERVER/SHARE/subpath to GVFS mount path."""
        import re, os
        m = re.match(r'smb://([^/]+)/([^/]+)(.*)', smb_url.rstrip('/'))
        if not m:
            return None
        server, share, subpath = m.group(1), m.group(2), m.group(3)
        uid = os.getuid()
        return f"/run/user/{uid}/gvfs/smb-share:server={server},share={share}{subpath}"

    @app.get("/api/data_server")
    async def data_server_get():
        """Return current data server config + mount status."""
        cfg = _ds_load()
        url = cfg.get("data_server_url", "")
        gvfs = _smb_to_gvfs(url) if url else None
        mounted = bool(gvfs and Path(gvfs).exists())
        return {"url": url, "gvfs_path": gvfs or "", "mounted": mounted}

    @app.post("/api/data_server")
    async def data_server_set(req: dict):
        """Save data server SMB URL."""
        url = req.get("url", "").strip()
        if url and not url.startswith("smb://"):
            raise HTTPException(400, "URL must start with smb://")
        _ds_save({"data_server_url": url})
        gvfs = _smb_to_gvfs(url) if url else None
        mounted = bool(gvfs and Path(gvfs).exists())
        return {"ok": True, "url": url, "gvfs_path": gvfs or "", "mounted": mounted}

    @app.get("/api/files/browse_server")
    async def browse_server(path: str = ""):
        """Browse the configured data server (SMB/GVFS) — unrestricted.
        Without path: starts at GVFS root of configured SMB URL.
        With path: must be an absolute GVFS path."""
        import os
        cfg = _ds_load()
        url = cfg.get("data_server_url", "")
        if not url:
            return {"error": "no_server_configured", "items": [], "path": "", "abs": ""}
        gvfs_root = _smb_to_gvfs(url)
        if not gvfs_root:
            return {"error": "invalid_smb_url", "items": [], "path": "", "abs": ""}
        # Resolve target path
        target = Path(path) if path else Path(gvfs_root)
        target_resolved = target.resolve()
        gvfs_root_resolved = Path(gvfs_root).resolve()
        if target_resolved != gvfs_root_resolved and not target_resolved.is_relative_to(gvfs_root_resolved):
            target = Path(gvfs_root)   # safety: stay within server share
        if not target.exists():
            return {"error": "not_mounted",
                    "message": f"Server not accessible. Mount first: gio mount {url}",
                    "items": [], "path": str(target), "abs": str(target)}
        ALLOWED_EXT = {'.star','.mrc','.rec','.json','.txt','.log','.md',
                       '.py','.sh','.xml','.tlt','.toml','.yaml','.yml','.settings',
                       '.tif','.tiff','.eer','.mdoc','.xf','.dm4','.dm3'}
        items = []
        try:
            for e in sorted(target.iterdir()):
                if e.name.startswith('._'):
                    continue
                try:
                    is_dir = e.is_dir()
                    is_file = e.is_file()
                    ext = e.suffix.lower()
                    if not (is_dir or ext in ALLOWED_EXT):
                        continue
                    size = None
                    try:
                        size = e.stat().st_size if is_file else None
                    except OSError:
                        pass
                    items.append({
                        "name": e.name,
                        "path": str(e),   # always absolute
                        "is_dir": is_dir,
                        "size": size,
                        "ext": ext if is_file else None,
                        "is_link": e.is_symlink(),
                    })
                except (PermissionError, OSError):
                    continue
        except PermissionError:
            return {"error": "permission_denied", "items": [], "path": str(target), "abs": str(target)}
        parent = str(target.parent) if str(target) != gvfs_root else None
        return {
            "path": str(target),
            "abs":  str(target),
            "parent": parent,
            "gvfs_root": gvfs_root,
            "items": items,
        }

    @app.get("/api/files/read")
    async def read(path: str):
        try:
            return core.read_file(path)
        except core.SecurityError as e:
            raise HTTPException(403, str(e))
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    # ── Templates ──
    @app.get("/api/templates")
    async def templates():
        return {"templates": TEMPLATES, "categories": TEMPLATE_CATEGORIES}

    @app.get("/api/scripts/templates")
    async def templates_compat():
        return {"templates": TEMPLATES, "categories": TEMPLATE_CATEGORIES}

    # ── Raw run ──
    @app.post("/api/scripts/run")
    async def run_raw(req: RunRequest):
        try:
            # Create a JobRecord so the run appears in the jobs list
            project = getattr(req, 'project', '') or ''
            job_id  = ''
            if project:
                try:
                    jr = core.create_job(project, 'other',
                                         req.command.split()[0].split('/')[-1],
                                         req.command, parameters={})
                    job_id = jr.job_id
                except Exception:
                    pass
            rj = await core.runner.run(req.command, req.working_dir, req.env,
                                       project=project, job_id=job_id)
            if rj is None:
                raise HTTPException(500, "Runner returned no job record")
            return rj.to_dict(include_output=True)
        except core.SecurityError as e:
            raise HTTPException(403, f"Command not allowed: {e}")
        except PermissionError as e:
            raise HTTPException(403, str(e))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"{type(e).__name__}: {e}")

    @app.get("/api/scripts/runs")
    async def list_runs():
        return {"runs": core.runner.all_runs()}

    @app.get("/api/scripts/runs/{rid}/output")
    async def run_output(rid: str, start: int = 0):
        return core.runner.output(rid, start)

    @app.post("/api/scripts/runs/{rid}/cancel")
    async def cancel_run(rid: str):
        return {"cancelled": await core.runner.cancel(rid)}

    @app.websocket("/api/scripts/ws/run")
    async def ws_run(websocket: WebSocket):
        await websocket.accept()
        try:
            data = await websocket.receive_json()
            cwd = data.get("working_dir", ".")
            proj = data.get("project", "")
            jid = data.get("job_id", "")
            
            job_type = data.get("job_type", "custom")
            job_params = data.get("parameters", {})
            # Always use the command built by the frontend (updPrev)
            # build_command() is not used here — activation cmd and params
            # are assembled client-side in templates.js updPrev()
            cmd = data.get("command", "")

            async def on_line(rid, line):
                try:
                    await websocket.send_json({
                        "type": "stderr" if line.startswith("[stderr]") else "stdout",
                        "line": line, "run_id": rid})
                except Exception:
                    pass

            # Create JobRecord before running so it appears in sidebar
            job_title = data.get("job_title", "") or job_type
            if proj and not jid:
                try:
                    jr = core.create_job(proj, job_type, job_title, cmd, job_params)
                    jid = jr.job_id
                    print(f"[WS DEBUG] Created job {jid}", file=sys.stderr)
                except Exception as e:
                    import traceback; traceback.print_exc()
                    await websocket.send_json({"type": "stderr", "line": f"[warn] JobRecord not created: {e}"})
            await websocket.send_json({"type": "start", "command": cmd, "job_id": jid})
            # Run as independent asyncio Task — job survives WebSocket disconnect
            import asyncio as _aio
            task = _aio.ensure_future(
                core.runner.run(cmd, cwd, on_line=on_line, project=proj, job_id=jid))
            try:
                rj = await _aio.shield(task)
                await websocket.send_json({
                    "type": "done", "run_id": rj.id, "job_id": jid,
                    "exit_code": rj.exit_code, "status": rj.status.value,
                    "duration": rj.duration})
            except WebSocketDisconnect:
                pass  # Job keeps running in background
            except _aio.CancelledError:
                pass
        except WebSocketDisconnect:
            pass

    # ── Job Queue ──
    @app.post("/api/queue/add")
    async def queue_add(req: dict):
        """Add a job to the internal queue."""
        try:
            proj      = req.get("project", "")
            job_type  = req.get("job_type", "custom")
            job_title = req.get("job_title", job_type)
            job_params= req.get("parameters", {})
            cwd       = req.get("working_dir", ".")
            mode      = req.get("mode", "gpu_aware")  # gpu_aware | sequential

            # Build command same way as ws_run
            if job_type and job_type != "custom":
                cmd = core.build_command(job_type, job_params, proj)
            else:
                cmd = req.get("command", "")
            if not cmd:
                raise HTTPException(400, "No command")

            # Auto-detect GPU IDs from command (ignore frontend gpu_ids)
            gpu_ids = core._extract_gpu_ids(cmd)

            # Create JobRecord immediately so it shows in sidebar
            jr = core.create_job(proj, job_type, job_title, cmd, job_params)

            entry = core.QueueEntry(
                queue_id="", job_id=jr.job_id, project=proj,
                cmd=cmd, cwd=cwd, job_type=job_type, job_title=job_title,
                gpu_ids=gpu_ids, mode=mode, status="waiting",
                run_id="", added_at=datetime.now().isoformat(timespec="seconds")
            )
            entry = core.queue_manager.add(entry)
            return {"queue_id": entry.queue_id, "job_id": jr.job_id,
                    "position": len([e for e in core.queue_manager._entries if e.status=="waiting"])}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, str(e))

    @app.post("/api/queue/detect_gpus")
    async def queue_detect_gpus(req: dict):
        """Parse GPU/resource info from command for queue modal display."""
        cmd     = req.get("command", "")
        project = req.get("project", "")
        config_gpus = ""
        if project:
            try:
                cfg = core.ProjectConfig.load(core.get_ws().workspace_dir / project)
                config_gpus = cfg.compute_gpus or ""
            except Exception:
                pass
        res = core._parse_job_resources(cmd, config_gpus)
        return {
            "gpu_ids":             res["gpu_ids"],
            "gpu_source":          res["gpu_source"],
            "resource_line":       res["resource_line"],
            "allows_gpu_override": res["allows_gpu_override"],
            "has_fixed_gpus":      res["has_fixed_gpus"],
        }

    @app.get("/api/queue")
    async def queue_list():
        """List all active queue entries."""
        return {"entries": core.queue_manager.list_entries()}

    @app.delete("/api/queue/{queue_id}")
    async def queue_remove(queue_id: str):
        """Remove a waiting entry from the queue."""
        removed = core.queue_manager.remove(queue_id)
        return {"removed": removed}

    @app.post("/api/queue/{queue_id}/cancel")
    async def queue_cancel(queue_id: str):
        """Cancel a running queue entry."""
        for e in core.queue_manager._entries:
            if e.queue_id == queue_id and e.status == "running" and e.run_id:
                await core.runner.cancel(e.run_id)
                e.status = "cancelled"
                return {"cancelled": True}
        return {"cancelled": False}

    # ── RELION ──
    @app.get("/api/relion/analyze_star")
    async def relion_analyze_star(path: str):
        """Analyze a STAR file: particle count, 2D/3D type, suggested K."""
        try:
            return core.analyze_star_file(path)
        except core.SecurityError as e:
            raise HTTPException(403, str(e))
        except Exception as e:
            raise HTTPException(500, str(e))

    @app.get("/api/relion/crowther")
    async def relion_crowther(pixel_size: float, diameter: float):
        """Crowther criterion: healpix order, angular sampling, Nyquist."""
        return core.crowther_healpix_order(pixel_size, diameter)

    @app.post("/api/projects/{f}/relion_dir")
    async def make_relion_dir(f: str, req: Request):
        """Create a relion_sta subdirectory for RELION processing."""
        body = await req.json()
        subdir = body.get("subdir", "").strip().strip("/")
        if not subdir:
            raise HTTPException(400, "subdir required")
        try:
            return core.create_relion_dir(f, subdir)
        except Exception as e:
            raise HTTPException(500, str(e))

    # ── py2rely Dashboard ──
    @app.post("/api/dashboard/start")
    async def dashboard_start(req: Request):
        body = await req.json()
        relion_dir = body.get("relion_dir", "").strip()
        py2rely_cmd = body.get("py2rely_cmd", "py2rely ui").strip()
        port = int(body.get("port", 3000))
        if not relion_dir:
            raise HTTPException(400, "relion_dir required")
        # start_py2rely_dashboard does a blocking time.sleep() liveness check —
        # run it off the event loop so it doesn't stall concurrent requests
        # (job-log WebSocket streaming, other API calls) for its duration.
        return await asyncio.to_thread(core.start_py2rely_dashboard, relion_dir, py2rely_cmd, port)

    @app.post("/api/dashboard/stop")
    async def dashboard_stop():
        return core.stop_py2rely_dashboard()

    @app.get("/api/dashboard/status")
    async def dashboard_status():
        return core.get_py2rely_status()

    @app.get("/api/projects/{f}/relion_sta_dirs")
    async def relion_sta_dirs(f: str):
        return core.list_relion_sta_dirs(f)

    @app.get("/api/projects/{f}/scan_preprocessing")
    async def scan_preprocessing(f: str):
        """Scan _preprocessing/ for raw data and return auto-fill suggestions."""
        return core.scan_preprocessing(f)

    @app.get("/api/projects/{f}/warp/status")
    async def warp_status(f: str):
        """Check which WarpTools preprocessing steps are done based on output files."""
        import os
        try:
            proj_dir = core.resolve_project_dir(f)
            warp_dir = proj_dir / "warp_tiltseries"
            fs_dir   = proj_dir / "warp_frameseries"

            def count_ext(d, ext):
                if not d.exists(): return 0
                return sum(1 for p in d.iterdir() if p.suffix == ext)

            tomostar_dir = proj_dir / "tomostar"
            recon_dir    = warp_dir / "reconstruction"

            return {
                "create_settings_fs":  (proj_dir / "warp_frameseries.settings").exists(),
                "create_settings_ts":  (proj_dir / "warp_tiltseries.settings").exists(),
                "fs_motion_ctf":       count_ext(fs_dir, ".xml") > 0,
                "filter_quality":      any([(fs_dir / "histograms").exists(),
                                          bool(list(fs_dir.glob("*.png"))) if fs_dir.exists() else False]),
                "ts_import":           count_ext(tomostar_dir, ".tomostar") > 0,
                "ts_align":            count_ext(warp_dir, ".xf") > 0 or count_ext(warp_dir, ".tlt") > 0,
                "ts_defocus_hand":     count_ext(warp_dir, ".xml") > 0,
                "ts_ctf":              count_ext(warp_dir, ".xml") > 0,
                "ts_reconstruct":      recon_dir.exists() and count_ext(recon_dir, ".mrc") > 0,
                "tomostar_count":      count_ext(tomostar_dir, ".tomostar"),
                "recon_count":         count_ext(recon_dir, ".mrc") if recon_dir.exists() else 0,
            }
        except Exception as e:
            return {"error": str(e)}

    # ── Convert ──
    @app.post("/api/convert/ang-to-pix")
    async def conv(req: ConvertCoordsRequest):
        try:
            return core.convert_ang_to_pix(req.input_star, req.output_star,
                                           req.x_dim, req.y_dim, req.z_dim, req.pixel_size, req.suffix)
        except Exception as e:
            raise HTTPException(500, str(e))

    # ── Checks ──
    @app.get("/api/check/star")
    async def chk_s(path: str):
        try:
            return core.check_star(path)
        except core.SecurityError as e:
            raise HTTPException(403, str(e))

    @app.get("/api/check/star/columns")
    async def chk_sc(path: str):
        try:
            return core.star_columns(path)
        except core.SecurityError as e:
            raise HTTPException(403, str(e))

    @app.get("/api/check/tomogram")
    async def chk_t(path: str):
        try:
            return core.check_tomogram(path)
        except core.SecurityError as e:
            raise HTTPException(403, str(e))

    @app.get("/api/tools/box-size")
    async def box(diameter: float, pixel_size: float):
        return core.suggest_box_size(diameter, pixel_size)

    # ── Computing detect ──
    @app.get("/api/computing/detect")
    async def computing_detect():
        """Auto-detect local machine specs for the Computing tab."""
        import platform, socket
        result = {"hostname": socket.gethostname(), "os": platform.platform(),
                  "gpus": "", "cpu_cores": 0, "ram_gb": 0}
        try:
            import psutil
            result["ram_gb"] = round(psutil.virtual_memory().total / 1e9)
            result["cpu_cores"] = psutil.cpu_count(logical=False) or psutil.cpu_count()
        except ImportError:
            pass
        try:
            import subprocess
            r = subprocess.run(["nvidia-smi","--query-gpu=name,memory.total",
                                "--format=csv,noheader"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                gpus = [l.strip() for l in r.stdout.strip().splitlines() if l.strip()]
                result["gpus"] = "; ".join(gpus)
        except Exception:
            pass
        return result

    @app.post("/api/computing/ssh_test")
    async def computing_ssh_test(req: dict):
        """Test SSH key connection to a remote host."""
        import subprocess, shlex
        host = req.get("host", "").strip()
        user = req.get("user", "").strip()
        port = str(req.get("port", "22")).strip() or "22"
        key  = req.get("key", "").strip()
        if not host or not user:
            return {"ok": False, "error": "host and user required"}
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
               "-o", "StrictHostKeyChecking=no",
               "-p", port]
        if key:
            cmd += ["-i", key]
        cmd += [f"{user}@{host}", "echo OK && uname -n && nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -2 || true"]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
            if r.returncode == 0:
                info = r.stdout.strip().replace("\n", " · ")
                return {"ok": True, "info": info}
            else:
                err = r.stderr.strip().splitlines()[0] if r.stderr.strip() else "connection failed"
                return {"ok": False, "error": err}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "timeout (8s)"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── System Environments (conda envs + modules + known binaries scan) ──
    @app.get("/api/system/environments")
    async def system_environments():
        """Scan conda environments, HPC modules, and known binaries for Setup tab."""
        import subprocess as _sp
        import json as _j
        conda_envs = []
        modules = []
        binaries = {}   # {tool_id: full_path}
        source_scripts = {}  # {tool_id: script_path} from shell aliases
        conda_base = ""

        # Conda base path
        try:
            r = _sp.run(["conda","info","--base"],
                capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                conda_base = r.stdout.strip()
        except Exception:
            pass

        # Conda envs
        try:
            r = _sp.run(["conda","env","list","--json"],
                capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                data = _j.loads(r.stdout)
                conda_envs = [
                    Path(p).name for p in data.get("envs",[])
                    if Path(p).name not in ("base","")
                ]
        except Exception:
            pass

        # HPC modules (may not exist on workstations)
        try:
            r = _sp.run(
                ["bash","-c","module avail 2>&1 | grep -oE '[a-zA-Z0-9_.-]+/[0-9][a-zA-Z0-9._-]*'"],
                capture_output=True, text=True, timeout=8)
            if r.returncode == 0:
                modules = sorted(set(l for l in r.stdout.strip().split("\n") if l))
        except Exception:
            pass

        # Known binaries — search via `which`
        KNOWN_BINARIES = {
            "warptools": ["WarpTools"],
            "aretomo3":  ["AreTomo3", "AreTomo"],
            "imod":      ["imod", "3dmod"],
            "chimerax":  ["chimerax", "ChimeraX"],
            "relion":    ["relion"],
            "slabify":   ["slabify"],
            "isonet":    ["isonet.py", "isonet2"],
            "ais":       ["ais"],
        }
        for tool_id, cmds in KNOWN_BINARIES.items():
            for cmd in cmds:
                try:
                    r = _sp.run(["which", cmd],
                        capture_output=True, text=True, timeout=3)
                    if r.returncode == 0 and r.stdout.strip():
                        binaries[tool_id] = r.stdout.strip()
                        break
                except Exception:
                    pass

        # Known aliases → source scripts (read from bash interactively)
        KNOWN_ALIASES = {
            "relion":   ["activate_relion"],
            "imod":     ["activate_imod"],
        }
        try:
            alias_cmds = " ; ".join(
                f"type -a {a} 2>/dev/null && echo ALIAS_{tid}_{a}"
                for tid, aliases in KNOWN_ALIASES.items()
                for a in aliases
            )
            r = _sp.run(["bash","-i","-c", alias_cmds],
                capture_output=True, text=True, timeout=8)
            output = (r.stdout or "") + (r.stderr or "")
            import re as _re
            for tid, aliases in KNOWN_ALIASES.items():
                for alias in aliases:
                    # Find "alias activate_relion='source /path/script.sh'"
                    m = _re.search(r"source\s+(\S+\.sh)", output)
                    if m and tid not in source_scripts:
                        path = m.group(1).replace("$HOME", str(Path.home()))
                        source_scripts[tid] = path
        except Exception:
            pass

        return {
            "conda_envs": conda_envs,
            "modules": modules,
            "binaries": binaries,
            "source_scripts": source_scripts,
            "conda_base": conda_base,
        }

    # ── Resolve shell alias → script path ──
    @app.post("/api/system/resolve_alias")
    async def resolve_alias(req: dict):
        """Resolve a shell alias (e.g. activate_relion) to its underlying script path.
        Runs bash interactively to read .bashrc aliases, then extracts the path."""
        import subprocess as _sp
        alias = req.get("alias","").strip()
        if not alias:
            return {"error": "No alias provided"}
        try:
            # Run bash interactively to resolve the alias
            # type -a shows all definitions including aliases and functions
            r = _sp.run(
                ["bash","-i","-c", f"type -a {shlex.quote(alias)} 2>&1"],
                capture_output=True, text=True, timeout=8,
                env={**__import__("os").environ}
            )
            output = (r.stdout or "") + (r.stderr or "")
            # Parse: "activate_relion is aliased to `source /path/to/script.sh'"
            import re as _re
            # Match: source /path/to/script
            m = _re.search(r"source\s+(\S+\.sh)", output)
            if m:
                script = m.group(1).replace("$HOME", str(Path.home()))
                script = script.replace("~", str(Path.home()))
                return {"script_path": script, "raw": output.strip()}
            # Match: is /path/to/binary
            m2 = _re.search(r"is\s+(/[^\s]+)", output)
            if m2:
                return {"script_path": m2.group(1), "raw": output.strip()}
            return {"error": "Could not parse alias", "raw": output.strip()}
        except Exception as e:
            return {"error": str(e)}

    # ── System Resources (live GPU/CPU/RAM polling) ──
    @app.get("/api/system/resources")
    async def system_resources():
        """Live GPU/CPU/RAM status for the pbar resource display.
        Called every 5s by the frontend when a project is open.
        """
        return core.get_system_resources()

    # ── Job Dashboard data ──
    @app.get("/api/projects/{f}/jobs/{jid}/dashboard")
    async def job_dashboard(f: str, jid: str):
        """Return parsed dashboard metrics for a completed job.
        Re-parses on-demand so it works for older jobs that pre-date dashboard_data.
        """
        proj = core.get_ws().workspace_dir / f
        job = core.JobRecord.load(proj, jid)
        if not job:
            raise HTTPException(404, "Job not found")
        # Return stored data if available, otherwise re-parse
        if job.dashboard_data:
            return job.dashboard_data
        data = core._parse_dashboard_data(job, proj)
        if data:
            core.update_job(f, jid, dashboard_data=data)
        return data

    # ── Auto-save job title ──
    @app.patch("/api/projects/{f}/jobs/{jid}/title")
    async def update_job_title(f: str, jid: str, body: dict):
        """Auto-save job custom title as user types."""
        title = str(body.get("title", "")).strip()
        updated = core.update_job(f, jid, custom_title=title)
        return updated

    # ── Parameter clipboard (copy/paste between jobs) ──
    # Note: clipboard is server-side per-project so it survives page refresh
    _param_clipboard: dict = {}  # project → {params, job_type, job_id}

    @app.post("/api/projects/{f}/jobs/{jid}/copy_params")
    async def copy_job_params(f: str, jid: str):
        """Copy job parameters to server-side clipboard."""
        proj = core.get_ws().workspace_dir / f
        job = core.JobRecord.load(proj, jid)
        if not job:
            raise HTTPException(404, "Job not found")
        _param_clipboard[f] = {
            "params": job.parameters,
            "job_type": job.job_type,
            "job_id": jid,
            "title": job.display_title(),
        }
        return {"ok": True, "job_type": job.job_type, "param_count": len(job.parameters)}

    @app.get("/api/projects/{f}/clipboard")
    async def get_clipboard(f: str):
        """Get current parameter clipboard for a project."""
        return _param_clipboard.get(f, {})

    # ── AreTomo3 alignment checker ──
    @app.get("/api/projects/{f}/aretomo3/check")
    async def aretomo3_check(f: str, aretomo_dir: str = ""):
        """Check AreTomo3 output completeness and alignment quality."""
        return core.check_aretomo3_alignments(f, aretomo_dir)

    # ── Pbar: particle count from last extract job ──
    @app.get("/api/projects/{f}/particles/count")
    async def particle_count(f: str):
        """Return particle count from most recent completed extract job."""
        n = core.get_last_extract_particles(f)
        return {"count": n}


    # ── Pretilt MDOC Correction (Hamid Rahmani) ──────────────────────────────

    @app.post("/api/preliproc/run_pretilt")
    async def preliproc_run_pretilt(req: dict):
        """Run pretilt correction on MDOCs. Credit: Hamid Rahmani."""
        import asyncio
        from cryostarbase.scripts.preproc_imod.pretilt import run_pretilt
        from pathlib import Path
        mdocs_dir        = req.get("mdocs_dir", "")
        pretilt_raw      = float(req.get("pretilt_angle") or 0)   # user value, stored as-is
        pretilt_for_script = -(pretilt_raw)                        # negated — what script needs
        output_dir       = req.get("output_dir", "").strip()
        project          = req.get("project", "")
        if not mdocs_dir or pretilt_raw == 0:
            raise HTTPException(400, "mdocs_dir and pretilt_angle required")
        if not output_dir:
            output_dir = str(Path(mdocs_dir).parent / "mdocs_pretilt")
        lines = []
        def log(msg): lines.append(str(msg))
        loop = asyncio.get_event_loop()
        count = await loop.run_in_executor(
            None, lambda: run_pretilt(mdocs_dir, pretilt_for_script, output_dir, log))
        if project:
            try:
                core.update_project_config(project, {
                    "mdocs_pretilt_dir": output_dir,
                    "pretilt_angle": pretilt_raw    # store original, not negated
                })
            except Exception: pass
        return {"status": "ok", "processed": count, "output_dir": output_dir, "log": lines}

    # Credit: Hamid Rahmani — github.com/hamid13r/warp_lamella_adapters (pretilt, remove_skipped)

    @app.post("/api/preliproc/pretilt_mdocs")
    async def preliproc_pretilt_mdocs(req: dict):
        """Correct tilt angles in MDOCs for lamella pretilt. Credit: Hamid Rahmani."""
        import asyncio
        from cryostarbase.scripts.preproc_imod.pretilt import run_pretilt_correction
        from pathlib import Path
        mdocs_dir          = req.get("mdocs_dir", "")
        pretilt_raw        = float(req.get("pretilt_angle") or 0)   # user value, stored as-is
        pretilt_for_script = -(pretilt_raw)                          # negated — what script needs
        output_dir         = req.get("output_dir", "") or None
        project            = req.get("project", "")
        if not mdocs_dir:
            raise HTTPException(400, "mdocs_dir required")
        lines = []
        def log(msg): lines.append(str(msg))
        def _run():
            out = run_pretilt_correction(
                mdocs_dir=Path(mdocs_dir),
                pretilt_angle=pretilt_for_script,
                output_dir=Path(output_dir) if output_dir else None,
                log=log,
            )
            if project and out:
                try:
                    core.update_project_config(project, {
                        "mdocs_pretilt_dir": str(out),
                        "pretilt_angle": pretilt_raw,  # store original, not negated
                    })
                except Exception:
                    pass
            return out
        loop = asyncio.get_event_loop()
        out_dir = await loop.run_in_executor(None, _run)
        return {"status": "ok", "output_dir": str(out_dir) if out_dir else "", "log": lines}

    @app.post("/api/preliproc/run_remove_skipped")
    async def preliproc_run_remove_skipped(req: dict):
        """Set UseTilt=False for bad views in WarpTools XMLs. Credit: Hamid Rahmani."""
        import asyncio
        from cryostarbase.scripts.preproc_imod.remove_skipped import run_remove_skipped
        xml_dir       = req.get("xml_dir", "")
        tiltstack_dir = req.get("tiltstack_dir", "")
        backup_dir    = req.get("backup_dir", "")
        if not xml_dir or not tiltstack_dir or not backup_dir:
            raise HTTPException(400, "xml_dir, tiltstack_dir and backup_dir required")
        lines = []
        def log(msg): lines.append(str(msg))
        def _run():
            return run_remove_skipped(
                xml_dir=xml_dir, tiltstack_dir=tiltstack_dir, backup_dir=backup_dir,
                xml_pattern=req.get("xml_pattern", "*.xml"),
                all_true=bool(req.get("all_true", False)),
                n_tilts=int(req.get("n_tilts") or 0),
                max_tilt=float(req.get("max_tilt") or 0),
                log=log,
            )
        loop = asyncio.get_event_loop()
        counts = await loop.run_in_executor(None, _run)
        return {"status": "ok", "counts": counts, "log": lines}

    @app.post("/api/preliproc/apply_manual_exclusions")
    async def preliproc_apply_manual_exclusions(req: dict):
        """Apply inspect_bad_tilts.json to WarpTools XMLs. Credit: Hamid Rahmani."""
        import asyncio, json
        from cryostarbase.scripts.preproc_imod.remove_skipped import apply_manual_exclusions_to_xml
        project    = req.get("project", "")
        xml_dir    = req.get("xml_dir", "")
        backup_dir = req.get("backup_dir", "")
        if not project or not xml_dir or not backup_dir:
            raise HTTPException(400, "project, xml_dir and backup_dir required")
        proj_path = core.get_ws().workspace_dir / project
        bad_tilts_file = proj_path / "inspect_bad_tilts.json"
        bad_tilts_raw = json.loads(bad_tilts_file.read_text()) if bad_tilts_file.exists() else {}
        # inspect.js stores 0-based slice indices; apply_manual_exclusions_to_xml expects 1-based
        # keys may be filenames (TS_NAME.mrc) — strip extension
        bad_tilts = {
            k.removesuffix(".mrc").removesuffix(".mrcs").removesuffix(".st"): [i + 1 for i in v]
            for k, v in bad_tilts_raw.items() if v
        }
        lines = []
        loop = asyncio.get_event_loop()
        counts = await loop.run_in_executor(
            None, lambda: apply_manual_exclusions_to_xml(xml_dir, bad_tilts, backup_dir,
                                                          lambda m: lines.append(str(m)))
        )
        return {"status": "ok", "counts": counts, "log": lines}

    # ── Inspect Data endpoints ──────────────────────────────────────────────────


    @app.get("/api/inspect/list")
    async def inspect_list(folder: str):
        """List MRC/MRCS files in a folder.
        Reads MRC header (header_only — microseconds per file) to include n_slices.
        Uses run_in_executor — non-blocking even on GVFS/SMB."""
        import asyncio as _asyncio
        import mrcfile as _mrcfile
        def _list_sync(folder: str):
            p = Path(folder)
            if not p.exists():
                return {"files": [], "error": "Folder not found"}
            files = []
            for f in sorted(p.iterdir()):
                if f.suffix.lower() in ('.mrc', '.mrcs', '.st'):
                    n_slices = None
                    try:
                        with _mrcfile.open(str(f), mode="r",
                                           permissive=True, header_only=True) as mrc:
                            nz = int(mrc.header.nz)
                            n_slices = nz if nz > 0 else None
                    except Exception:
                        pass
                    files.append({"name": f.name, "path": str(f),
                                  "n_slices": n_slices})
            return {"files": files}
        try:
            loop = _asyncio.get_event_loop()
            return await loop.run_in_executor(None, _list_sync, folder)
        except Exception as e:
            return {"files": [], "error": str(e)}

    @app.get("/api/inspect/info")
    async def inspect_info(path: str):
        """Return MRC file metadata: n_slices, dims, percentiles for contrast.
        Uses mrcfile.mmap() + single middle slice + run_in_executor — non-blocking.
        Results cached in-memory by (path, mtime) — fast on repeated calls."""
        import asyncio as _asyncio
        import os as _os
        def _read_info_sync(path: str):
            import mrcfile as _mrcfile
            import numpy as _np
            # Check cache first
            try:
                mtime = _os.stat(path).st_mtime
            except OSError:
                mtime = None
            cache_key = (path, mtime)
            cached = _inspect_info_cache.get(cache_key)
            if cached:
                return cached
            with _mrcfile.mmap(path, mode="r", permissive=True) as mrc:
                data = mrc.data
                if data is None:
                    return {"error": "No data in MRC file"}
                if data.ndim == 2:
                    n_slices, ny, nx = 1, data.shape[0], data.shape[1]
                    sample = data.ravel().astype(_np.float32)
                else:
                    n_slices, ny, nx = data.shape[0], data.shape[1], data.shape[2]
                    sample = data[n_slices // 2].ravel().astype(_np.float32)
                p2  = float(_np.percentile(sample, 2))
                p98 = float(_np.percentile(sample, 98))
            result = {"n_slices": int(n_slices), "nx": int(nx), "ny": int(ny),
                      "p2": round(p2, 2), "p98": round(p98, 2)}
            # Cache with mtime key — auto-invalidates when file changes
            if mtime is not None:
                _inspect_info_cache[cache_key] = result
                # Limit cache size to 200 entries
                if len(_inspect_info_cache) > 200:
                    oldest = next(iter(_inspect_info_cache))
                    del _inspect_info_cache[oldest]
            return result
        try:
            loop = _asyncio.get_event_loop()
            return await loop.run_in_executor(None, _read_info_sync, path)
        except Exception as e:
            return {"error": str(e)}

    @app.get("/api/mrc/dims")
    async def mrc_dims(path: str):
        """Return MRC header dimensions and voxel size. Used by Tomo tab 'Read from MRC' button."""
        try:
            dims, voxel_size = core._read_mrc_header(Path(path))
            if not dims:
                return {"error": f"Could not read MRC header: {path}"}
            nx, ny, nz = dims
            return {"nx": nx, "ny": ny, "nz": nz, "voxel_size": voxel_size}
        except Exception as e:
            return {"error": str(e)}

    @app.get("/api/inspect/slice")
    async def inspect_slice(path: str, index: int = 0,
                             cmin: float = None, cmax: float = None):
        """Return a single MRC slice as JPEG.
        Uses mrcfile.mmap() + downscale to max 1536px + Cache-Control max-age=120 + run_in_executor."""
        import asyncio as _asyncio
        def _read_slice_sync(path: str, index: int, cmin, cmax):
            import mrcfile as _mrcfile
            import numpy as _np
            from PIL import Image as _PIL
            from io import BytesIO
            with _mrcfile.mmap(path, mode="r", permissive=True) as mrc:
                data = mrc.data
                if data is None:
                    raise ValueError("No data in MRC file")
                slc = (data if data.ndim == 2 else data[index]).astype(_np.float32)
            lo = float(cmin) if cmin is not None else float(_np.percentile(slc, 2))
            hi = float(cmax) if cmax is not None else float(_np.percentile(slc, 98))
            if hi <= lo:
                hi = lo + 1.0
            slc = _np.clip((slc - lo) / (hi - lo), 0, 1)
            img = _PIL.fromarray((slc * 255).astype(_np.uint8), mode="L")
            # Downscale to max 1536px — drastically reduces JPEG size, no visible quality loss
            max_w = 1536
            if img.width > max_w:
                scale = max_w / img.width
                img = img.resize((max_w, int(img.height * scale)), _PIL.LANCZOS)
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=85)
            buf.seek(0)
            return buf
        try:
            from fastapi.responses import StreamingResponse
            loop = _asyncio.get_event_loop()
            buf = await loop.run_in_executor(None, _read_slice_sync, path, index, cmin, cmax)
            return StreamingResponse(buf, media_type="image/jpeg",
                headers={"Cache-Control": "max-age=120"})
        except Exception as e:
            from fastapi.responses import JSONResponse as _JR
            return _JR({"error": str(e)}, status_code=500)

    @app.get("/api/inspect/bad_tilts")
    async def inspect_get_bad_tilts(project: str):
        """Load bad tilts from inspect_bad_tilts.json."""
        import json as _json
        bad_file = core.get_ws().workspace_dir / project / "inspect_bad_tilts.json"
        if not bad_file.exists():
            return {"bad_tilts": {}}
        return {"bad_tilts": _json.loads(bad_file.read_text())}

    @app.post("/api/inspect/bad_tilts")
    async def inspect_save_bad_tilts(req: dict):
        """Save bad tilts to inspect_bad_tilts.json."""
        import json as _json
        project  = req.get("project", "")
        bad_file = core.get_ws().workspace_dir / project / "inspect_bad_tilts.json"
        bad_file.write_text(_json.dumps(req.get("bad_tilts", {}), indent=2))
        return {"ok": True}

    # ── Inspect Tomograms endpoints ────────────────────────────────────────────

    @app.get("/api/inspect/tomograms")
    async def inspect_tomograms(folder: str):
        """List MRC tomogram files in reconstruction folder."""
        p = Path(folder)
        if not p.exists():
            return {"files": [], "error": "Folder not found"}
        files = []
        for f in sorted(p.iterdir()):
            if f.suffix.lower() in ('.mrc', '.mrcs') and not f.name.startswith('.'):
                files.append({"name": f.name, "path": str(f)})
        return {"files": files}

    @app.get("/api/inspect/xml_status")
    async def inspect_xml_status(xml_dir: str, excl_dir: str):
        """Return which XMLs are in xml_dir vs excl_dir."""
        import json as _json
        xp = Path(xml_dir)
        ep = Path(excl_dir)
        included = [f.stem for f in xp.glob("*.xml")] if xp.exists() else []
        excluded  = [f.stem for f in ep.glob("*.xml")] if ep.exists() else []
        return {"included": included, "excluded": excluded}


    @app.post("/api/inspect/launch_trame")
    async def inspect_launch_trame(req: dict):
        """Launch tomo_web_viewer.py (Trame) as a detached subprocess on a configurable port.
        Opens in a new browser tab via the URL returned."""
        import subprocess as _sp
        folder      = req.get("folder", "")
        viewer_path = req.get("viewer_path") or str(SCRIPTS_DIR / "tomo_web_viewer.py")
        port        = int(req.get("port", 8788))
        if not folder:
            from fastapi import HTTPException as _HE
            raise _HE(400, "folder is required")
        cmd = ["python", viewer_path, "--folder", folder, "--port", str(port)]
        try:
            proc = _sp.Popen(cmd, start_new_session=True)
            return {"ok": True, "pid": proc.pid,
                    "url": f"http://localhost:{port}",
                    "cmd": " ".join(cmd)}
        except FileNotFoundError:
            return {"ok": False,
                    "error": f"Could not find: {viewer_path}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.post("/api/inspect/apply_exclusions")
    async def inspect_apply_exclusions(req: dict):
        """Move XML files between xml_dir and excl_dir based on selection."""
        import shutil as _sh
        xml_dir  = Path(req.get("xml_dir", ""))
        excl_dir = Path(req.get("excl_dir", ""))
        include  = set(req.get("include", []))   # stems to keep in xml_dir
        exclude  = set(req.get("exclude", []))   # stems to move to excl_dir
        excl_dir.mkdir(parents=True, exist_ok=True)
        moved_out, moved_back, errors = [], [], []
        # Move excluded XMLs out
        for stem in exclude:
            src = xml_dir / f"{stem}.xml"
            dst = excl_dir / f"{stem}.xml"
            if src.exists():
                try: _sh.move(str(src), str(dst)); moved_out.append(stem)
                except Exception as e: errors.append(f"{stem}: {e}")
        # Move included XMLs back
        for stem in include:
            src = excl_dir / f"{stem}.xml"
            dst = xml_dir / f"{stem}.xml"
            if src.exists():
                try: _sh.move(str(src), str(dst)); moved_back.append(stem)
                except Exception as e: errors.append(f"{stem}: {e}")
        return {"moved_out": moved_out, "moved_back": moved_back, "errors": errors}

    @app.post("/api/inspect/restore_all")
    async def inspect_restore_all(req: dict):
        """Move all XMLs from excl_dir back to xml_dir."""
        import shutil as _sh
        xml_dir  = Path(req.get("xml_dir", ""))
        excl_dir = Path(req.get("excl_dir", ""))
        if not excl_dir.exists():
            return {"restored": [], "errors": []}
        restored, errors = [], []
        for f in excl_dir.glob("*.xml"):
            dst = xml_dir / f.name
            try: _sh.move(str(f), str(dst)); restored.append(f.stem)
            except Exception as e: errors.append(f"{f.stem}: {e}")
        return {"restored": restored, "errors": errors}

    # Semaphore: max 1 GIF generated at a time — prevents thread pool overload
    if not hasattr(app, '_gif_semaphore'):
        import asyncio as _aio
        app._gif_semaphore = _aio.Semaphore(1)

    @app.get("/api/inspect/tomo_gif")
    async def inspect_tomo_gif(path: str):
        """Generate animated GIF from MRC tomogram — cached on disk next to MRC.
        Uses run_in_executor + semaphore to avoid blocking the FastAPI event loop."""
        import asyncio as _asyncio
        from pathlib import Path as _Path
        from fastapi.responses import FileResponse, JSONResponse as _JR

        mrc_path = _Path(path)
        gif_path = mrc_path.with_suffix('.preview.gif')

        # Return cached GIF immediately without blocking
        if gif_path.exists() and gif_path.stat().st_mtime >= mrc_path.stat().st_mtime:
            return FileResponse(str(gif_path), media_type='image/gif')

        def _generate_gif_sync(path_str: str, gif_str: str) -> str:
            """CPU-intensive GIF generation — runs in thread pool."""
            import mrcfile as _mrcfile, numpy as _np
            from PIL import Image as _PIL
            mrc_p = _Path(path_str)
            gif_p = _Path(gif_str)
            with _mrcfile.mmap(path_str, mode='r', permissive=True) as mrc:
                data = mrc.data
                if data is None or data.ndim < 3:
                    raise ValueError("Not a 3D volume")
                n = data.shape[0]
                mid = data[n // 2].astype(_np.float32)
                lo = float(_np.percentile(mid, 2))
                hi = float(_np.percentile(mid, 98))
                if hi <= lo: hi = lo + 1.0
                step = max(1, n // 120)
                grey_pal = []
                for v in range(256): grey_pal.extend([v, v, v])
                frames = []
                for i in range(0, n, step):
                    slc = data[i].astype(_np.float32)
                    slc = _np.clip((slc - lo) / (hi - lo), 0, 1)
                    img_l = _PIL.fromarray((slc * 255).astype(_np.uint8), mode='L')
                    if img_l.width > 768:
                        img_l = img_l.resize((768, int(img_l.height * 768 / img_l.width)), _PIL.LANCZOS)
                    img_p = img_l.convert('P')
                    img_p.putpalette(grey_pal)
                    frames.append(img_p)
            frames[0].save(str(gif_p), save_all=True, append_images=frames[1:],
                           loop=1, duration=60, optimize=False)
            return str(gif_p)

        try:
            loop = _asyncio.get_event_loop()
            # Semaphore ensures only 1 GIF is generated at a time
            async with app._gif_semaphore:
                await loop.run_in_executor(None, _generate_gif_sync, str(mrc_path), str(gif_path))
            return FileResponse(str(gif_path), media_type='image/gif')
        except Exception as e:
            return _JR({"error": str(e)}, status_code=500)

    @app.get("/api/inspect/tomo_gif_status")
    async def inspect_tomo_gif_status(path: str):
        """Check if GIF already exists for a tomogram."""
        from pathlib import Path as _Path
        gif_path = _Path(path).with_suffix('.preview.gif')
        return {"exists": gif_path.exists(), "gif_path": str(gif_path)}

    @app.get("/api/inspect/selection_path")
    async def inspect_selection_path(project: str):
        """Return suggested path for selected_stacks.txt based on project config.
        Priority: 1) saved selection_file, 2) warptools_dir/selected_stacks.txt"""
        try:
            proj = core.get_ws().workspace_dir / project
            cfg  = ProjectConfig.load(proj)
            # Prefer previously saved selection_file path
            if getattr(cfg, "selection_file", None):
                return {"path": str(cfg.selection_file)}
            # Fallback: derive from warptools_dir
            if cfg.warptools_dir:
                return {"path": str(Path(cfg.warptools_dir) / "selected_stacks.txt")}
        except Exception:
            pass
        return {"path": ""}

    @app.post("/api/inspect/save_selection")
    async def inspect_save_selection(req: dict):
        """Save selected stack stems to a txt file."""
        path    = req.get("path", "")
        stems   = req.get("stems", [])
        project = req.get("project", "")
        p = Path(path)
        # If path is a directory or has no .txt suffix, append filename
        if p.is_dir() or not path.endswith(".txt"):
            p = p / "selected_stacks.txt"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(chr(10).join(stems) + chr(10))
        # Save path to project config for TPL_AUTOFILL
        if project:
            try:
                proj_path = core.get_ws().workspace_dir / project
                cfg = ProjectConfig.load(proj_path)
                cfg.selection_file = str(p)
                cfg.save(proj_path)
            except Exception:
                pass
        return {"path": str(p), "count": len(stems)}

    @app.post("/api/inspect/import_filtered")
    async def inspect_import_filtered(req: dict):
        """Create symlinks/copies of frames or MDOCs matching selected stems.
        Frames: file stem CONTAINS stack_stem + underscore next char
        MDOCs:  file stem CONTAINS stack_stem + dot next char (.mrc.mdoc)
        """
        source_dir    = req.get("source_dir", "")
        dest_dir      = req.get("dest_dir", "")
        selection_file = req.get("selection_file", "")
        mode          = req.get("mode", "symlink")
        file_type     = req.get("file_type", "frames")  # frames or mdocs
        import os as _os, shutil as _sh
        # Read selection
        sel_path = Path(selection_file)
        if not sel_path.exists():
            return {"error": f"Selection file not found: {selection_file}"}
        stems = set(l.strip() for l in sel_path.read_text().splitlines() if l.strip())
        src = Path(source_dir)
        dst = Path(dest_dir)
        dst.mkdir(parents=True, exist_ok=True)
        if file_type == "frames":
            extensions = {'.tif', '.tiff', '.eer', '.mrc'}
        else:
            extensions = {'.mdoc'}
        created, skipped = 0, 0
        for f in sorted(src.iterdir()):
            if f.suffix.lower() not in extensions: continue
            if f.name.startswith('.'): continue
            # Match: file name contains stem followed by _ (frames) or . (mdocs)
            matched = False
            for stem in stems:
                if file_type == "frames":
                    if ('_'+stem+'_') in ('_'+f.stem) or f.stem.startswith(stem+'_'):
                        matched = True; break
                else:
                    # MDOC: stem is contained followed by . e.g. ts_001.mrc.mdoc
                    if f.name.startswith(stem+'.'):
                        matched = True; break
            if not matched: skipped += 1; continue
            link = dst / f.name
            if link.exists() or link.is_symlink(): link.unlink()
            try:
                if mode == "symlink": link.symlink_to(f.resolve())
                else: _sh.copy2(str(f), str(link))
                created += 1
            except Exception as e: pass
        return {"created": created, "skipped": skipped, "dest_dir": str(dst)}

    @app.post("/api/inspect/export_selection")
    async def inspect_export_selection(req: dict):
        """Create symlinks (or copies) of selected tilt stacks in output_dir."""
        import os as _os
        folder     = req.get("folder", "")
        selected   = set(req.get("selected", []))
        output_dir = req.get("output_dir", "")
        mode       = req.get("mode", "symlink")  # symlink or copy
        src_dir    = Path(folder)
        dst_dir    = Path(output_dir)
        dst_dir.mkdir(parents=True, exist_ok=True)
        created, skipped, errors = 0, 0, []
        for fname in selected:
            src = src_dir / fname
            dst = dst_dir / fname
            if not src.exists(): continue
            if dst.exists() or dst.is_symlink():
                dst.unlink()
            try:
                if mode == "symlink":
                    dst.symlink_to(src.resolve())
                else:
                    import shutil as _sh
                    _sh.copy2(str(src), str(dst))
                created += 1
            except Exception as e:
                errors.append(f"{fname}: {e}")
        skipped = len(req.get("all_files", [])) - len(selected)
        return {"created": created, "skipped": skipped,
                "output_dir": str(dst_dir), "errors": errors}

    # ── Frontend ──
    @app.get("/")
    async def index():
        return FileResponse(
            FRONTEND / "index.html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        )

    # Serve static files with no-cache for JS/HTML to prevent stale deploys
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import Response

    class NoCacheJSMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            response = await call_next(request)
            path = request.url.path
            if path.endswith(".js") or path.endswith(".css"):
                response.headers["Cache-Control"] = "no-cache, must-revalidate"
                response.headers["Pragma"] = "no-cache"
            return response

    # ══════════════════════════════════════════════════════════════
    #  CONDA ENVIRONMENT MANAGEMENT
    # ══════════════════════════════════════════════════════════════
    
    @app.post("/api/environments/scan")
    async def scan_conda_environments():
        """
        Scan conda environments and detect installed cryo-EM tools.
        Enhanced version: detects activation commands and available binaries.
        
        Returns:
        {
            "conda_base": "/opt/anaconda3",
            "tools": {
                "pytom": {
                    "found_in_envs": ["pytom_tm"],
                    "activation_cmd": "conda activate pytom_tm",
                    "activation_type": "conda",
                    "available_binaries": ["pytom_match_pick.py", "pytom_create_template.py"],
                    "system_wide": false
                },
                "relion": {
                    "found_in_envs": ["relion-5.0"],
                    "activation_cmd": "activate_relion",
                    "activation_type": "custom_script",
                    "available_binaries": ["relion", "relion_refine"],
                    "system_wide": true
                },
                ...
            }
        }
        """
        try:
            # Step 1: Get conda base path
            conda_base = ""
            conda_available = False
            
            try:
                result = subprocess.run(
                    ["conda", "info", "--base"],
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=10
                )
                conda_base = result.stdout.strip()
                conda_available = True
            except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
                # Conda not available - will check for module load / system-wide only
                conda_available = False
            
            # Step 2: List all environments (if conda available)
            env_paths = []
            if conda_available:
                try:
                    result = subprocess.run(
                        ["conda", "env", "list", "--json"],
                        capture_output=True,
                        text=True,
                        check=True,
                        timeout=10
                    )
                    env_data = json.loads(result.stdout)
                    env_paths = env_data.get("envs", [])
                except Exception as e:
                    pass  # Continue without conda envs
            
            # Tool detection signatures (CASE SENSITIVE!)
            tool_signatures = {
                "pytom": ["pytom_match_pick.py", "pytom_create_template.py", "pytom_create_mask.py"],
                "relion": ["relion_refine", "relion_tomo_reconstruct_particle", "relion"],
                "warptools": ["WarpTools"],  # CAPITAL W and T!
                "aretomo": ["AreTomo3"],     # CAPITAL A and T!
                "imod": ["3dmod", "imod"]
            }
            
            # Step 3: Detect tools in each conda environment
            tools = {
                "pytom": {"found_in_envs": [], "activation_cmd": "", "activation_type": "", "available_binaries": [], "system_wide": False},
                "relion": {"found_in_envs": [], "activation_cmd": "", "activation_type": "", "available_binaries": [], "system_wide": False},
                "warptools": {"found_in_envs": [], "activation_cmd": "", "activation_type": "", "available_binaries": [], "system_wide": False},
                "aretomo": {"found_in_envs": [], "activation_cmd": "", "activation_type": "", "available_binaries": [], "system_wide": False},
                "imod": {"found_in_envs": [], "activation_cmd": "", "activation_type": "", "available_binaries": [], "system_wide": False}
            }
            
            # Check conda environments
            for env_path in env_paths:
                env_name = Path(env_path).name
                
                # Skip base conda meta-environment
                if env_name in ["conda", ""]:
                    continue
                
                bin_dir = Path(env_path) / "bin"
                if not bin_dir.exists():
                    continue
                
                # Check for each tool's signature binaries
                for tool, signatures in tool_signatures.items():
                    found_binaries = []
                    for binary in signatures:
                        if (bin_dir / binary).exists():
                            found_binaries.append(binary)
                    
                    if found_binaries:
                        tools[tool]["found_in_envs"].append(env_name)
                        # Add unique binaries
                        for binary in found_binaries:
                            if binary not in tools[tool]["available_binaries"]:
                                tools[tool]["available_binaries"].append(binary)
            
            # Step 4: Check for custom activation scripts (e.g., activate_relion)
            custom_activation_scripts = {
                "relion": ["activate_relion", "relion_activate"],
                "warptools": ["activate_warp"],
                "imod": ["activate_imod"]
            }
            
            for tool, script_names in custom_activation_scripts.items():
                for script_name in script_names:
                    try:
                        result = subprocess.run(
                            ["which", script_name],
                            capture_output=True,
                            text=True,
                            timeout=5
                        )
                        if result.returncode == 0:
                            # Custom script found!
                            tools[tool]["activation_cmd"] = script_name
                            tools[tool]["activation_type"] = "custom_script"
                            break
                    except:
                        pass
            
            # Step 5: Check system-wide installations
            for tool, signatures in tool_signatures.items():
                for binary in signatures:
                    try:
                        result = subprocess.run(
                            ["which", binary],
                            capture_output=True,
                            text=True,
                            timeout=5
                        )
                        if result.returncode == 0:
                            tools[tool]["system_wide"] = True
                            binary_path = result.stdout.strip()
                            # Add to available binaries if not already there
                            if binary not in tools[tool]["available_binaries"]:
                                tools[tool]["available_binaries"].append(binary)
                    except:
                        pass
            
            # Step 6: Set default activation commands
            for tool, info in tools.items():
                # Skip if already set by custom script detection
                if info["activation_cmd"]:
                    continue
                
                # If found in conda env, set conda activate
                if info["found_in_envs"]:
                    # Use first found environment as default
                    default_env = info["found_in_envs"][0]
                    info["activation_cmd"] = f"conda activate {default_env}"
                    info["activation_type"] = "conda"
                
                # If system-wide only, set to module load (user can override)
                elif info["system_wide"]:
                    info["activation_cmd"] = f"module load {tool}"
                    info["activation_type"] = "module"
            
            return {
                "success": True,
                "conda_base": conda_base,
                "conda_available": conda_available,
                "tools": tools
            }
        
        except Exception as e:
            return {"error": f"Unexpected error during environment scan: {str(e)}"}

    @app.post("/api/projects/{f}/notebook/update")
    async def update_notebook(f: str, req: dict):
        """Update notebook metadata and add changelog entries."""
        try:
            changes = req.get("changes", [])
            
            # Update metadata sections
            core.update_notebook_metadata(f, {})
            
            # Add changelog entries
            for change in changes:
                core.add_changelog_entry(f, change)
            
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(400, str(e))
        
    app.add_middleware(NoCacheJSMiddleware)
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")
    return app