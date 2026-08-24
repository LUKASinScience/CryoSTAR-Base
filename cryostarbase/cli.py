"""CryoSTAR-Base CLI — stable startup with port collision handling."""
import argparse
import socket
import sys
import os
import signal

def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False

def _kill_port(port: int) -> bool:
    """Try to kill whatever is using the port."""
    import subprocess
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True
        )
        pids = result.stdout.strip().split()
        for pid in pids:
            try:
                os.kill(int(pid), signal.SIGTERM)
            except Exception:
                pass
        return True
    except Exception:
        return False

def main():
    parser = argparse.ArgumentParser(description="CryoSTAR-Base")
    parser.add_argument("-d", "--dir",    default=".",  help="Workspace directory")
    parser.add_argument("-p", "--port",   default=8787, type=int)
    parser.add_argument("-H", "--host",   default="127.0.0.1")
    parser.add_argument("--kill-port",    action="store_true",
                        help="Kill existing process on port before starting")
    args = parser.parse_args()

    # Port collision handling
    if not _port_free(args.port):
        if args.kill_port:
            print(f"⚠ Port {args.port} in use — killing existing process…")
            _kill_port(args.port)
            import time; time.sleep(1)
        else:
            print(f"✗ Port {args.port} already in use.")
            print(f"  Run with --kill-port to automatically free it, or:")
            print(f"  kill $(lsof -t -i:{args.port})")
            # Try next available port
            for p in range(args.port + 1, args.port + 20):
                if _port_free(p):
                    print(f"  Auto-switching to port {p}")
                    args.port = p
                    break
            else:
                sys.exit(1)

    import uvicorn
    from cryostarbase.server import create_app

    app = create_app(workspace_dir=args.dir)

    from cryostarbase import core
    n = len(core.discover_projects())
    print(f"\n  CryoSTAR-Base v0.5.0  —  by Lukas W. Bauer und Claude")
    print(f"  {'─'*42}")
    print(f"  Browse dir :  {args.dir}")
    print(f"  URL        :  http://{args.host}:{args.port}")
    print(f"  Projects   :  {n} in browse dir")
    print(f"\n  {'─'*43}")
    print(f"  Open http://{args.host}:{args.port} in your browser to start.")
    print(f"  Press Ctrl+C to stop the server.\n")

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
    )