"""start/stop/status of the reliontree viewer: fixed command, workspace-only projects, real subprocess."""
import shutil
import types
import urllib.request

import pytest

from cryostarbase import core

pytestmark = pytest.mark.skipif(core._reliontree_starter() is None and shutil.which("reliontree") is None,
                                reason="reliontree not installed")


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "get_ws", lambda: types.SimpleNamespace(workspace_dir=tmp_path))
    yield tmp_path
    core.stop_reliontree()


def _project(root, name="relion"):
    p = root / name
    p.mkdir()
    (p / "default_pipeline.star").write_text("data_pipeline_general\n_rlnPipeLineJobCounter 1\n")
    return p


def test_start_status_stop(workspace):
    proj = _project(workspace)
    res = core.start_reliontree(str(proj), port=18733)
    assert res.get("status") == "started", res
    assert res["mode"] == ("in-process" if core._reliontree_starter() else "subprocess")
    assert core.get_reliontree_status()["running"] is True
    with urllib.request.urlopen(res["url"], timeout=10) as r:
        assert r.status == 200
    core.stop_reliontree()
    assert core.get_reliontree_status()["running"] is False


def test_refuses_bad_requests(workspace, tmp_path_factory):
    outside = _project(tmp_path_factory.mktemp("elsewhere"))
    assert "inside the workspace" in core.start_reliontree(str(outside))["error"]
    plain = workspace / "plain"
    plain.mkdir()
    assert "not a RELION project" in core.start_reliontree(str(plain))["error"]
    proj = _project(workspace, "ok")
    assert "port" in core.start_reliontree(str(proj), port=80)["error"]


def test_missing_reliontree(workspace, monkeypatch):
    monkeypatch.setattr(core, "_reliontree_starter", lambda: None)
    monkeypatch.setattr(shutil, "which", lambda name: None)
    assert "not installed" in core.start_reliontree(str(_project(workspace)))["error"]


def test_subprocess_fallback_for_old_reliontree(workspace, monkeypatch):
    if shutil.which("reliontree") is None:
        pytest.skip("no reliontree executable")
    monkeypatch.setattr(core, "_reliontree_starter", lambda: None)
    res = core.start_reliontree(str(_project(workspace)), port=18734)
    assert res.get("mode") == "subprocess", res
    core.stop_reliontree()


def test_port_in_use_is_reported(workspace):
    import socket
    proj = _project(workspace)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        busy = s.getsockname()[1]
        if busy < 1024:
            pytest.skip("odd port")
        assert "error" in core.start_reliontree(str(proj), port=busy)
