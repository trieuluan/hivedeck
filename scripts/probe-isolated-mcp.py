#!/usr/bin/env python3
"""Smoke test verifying two isolated HiveDeck backend instances + MCP /mcp."""

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def log(msg: str) -> None:
    print(f"{datetime.now().astimezone().isoformat(timespec='seconds')} {msg}", flush=True)


def alloc_free_ports(count: int) -> list[int]:
    ports: list[int] = []
    while len(ports) < count:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        if port not in ports:
            ports.append(port)
    return ports


def build_server(target_dir: Path) -> Path:
    env = os.environ.copy()
    env.setdefault("SQLX_OFFLINE", "true")
    env["CARGO_TARGET_DIR"] = str(target_dir)
    log(f"building server binary into {target_dir}")
    subprocess.run(
        ["cargo", "build", "--bin", "server"],
        cwd=REPO_ROOT,
        env=env,
        check=True,
    )
    binary = target_dir / "debug" / ("server.exe" if os.name == "nt" else "server")
    if not binary.exists():
        raise FileNotFoundError(f"built server binary missing at {binary}")
    return binary


def call_list_issues(port: int) -> tuple[bool, str]:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "list_issues",
            "arguments": {"project_id": "00000000-0000-0000-0000-000000000001"},
        },
    }
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/mcp",
        json.dumps(payload).encode(),
        {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            body = json.load(resp)
        if body.get("error") or body.get("result", {}).get("isError"):
            return False, f"rpc-error: {body}"
        return True, "ok"
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return False, f"{type(err).__name__}: {err}"


def read_port_discovery(tmp_dir: Path) -> dict:
    port_file = tmp_dir / "hivedeck" / "hivedeck.port"
    if not port_file.exists():
        raise AssertionError(f"missing port discovery file: {port_file}")
    return json.loads(port_file.read_text())


def start_instance(
    name: str,
    binary: Path,
    sandbox: Path,
    backend_port: int,
    proxy_port: int,
    processes: dict[str, subprocess.Popen],
) -> tuple[Path, Path, Path]:
    home_dir = sandbox / f"home-{name}"
    tmp_dir = sandbox / f"tmp-{name}"
    asset_dir = sandbox / f"assets-{name}"
    for directory in (home_dir, tmp_dir, asset_dir):
        directory.mkdir(parents=True, exist_ok=True)

    env = {
        "HOME": str(home_dir),
        "TMPDIR": str(tmp_dir),
        "HIVEDECK_ASSET_DIR": str(asset_dir),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
        "BACKEND_PORT": str(backend_port),
        "PREVIEW_PROXY_PORT": str(proxy_port),
        "HOST": "127.0.0.1",
        "DISABLE_WORKTREE_CLEANUP": "1",
        "VK_DISABLE_BROWSER_OPEN": "1",
        "RUST_LOG": "info",
    }
    log_path = sandbox / f"{name}.log"
    with open(log_path, "ab") as log_file:
        proc = subprocess.Popen(
            [str(binary)],
            cwd=sandbox,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
    processes[name] = proc
    log(f"start {name} pid={proc.pid} port={backend_port} proxy={proxy_port}")

    for _ in range(120):
        if proc.poll() is not None:
            tail = log_path.read_text(errors="replace")[-1000:]
            raise RuntimeError(
                f"{name} exited early ({proc.returncode}); log tail:\n{tail}"
            )
        ok, _ = call_list_issues(backend_port)
        if ok:
            info = read_port_discovery(tmp_dir)
            assert info["main_port"] == backend_port, info
            assert info.get("preview_proxy_port") == proxy_port, info
            log(f"{name} ready discovery={info}")
            return home_dir, tmp_dir, asset_dir
        time.sleep(0.5)

    tail = log_path.read_text(errors="replace")[-1000:]
    raise RuntimeError(f"{name} startup timed out; log tail:\n{tail}")


def stop_instance(name: str, processes: dict[str, subprocess.Popen]) -> None:
    proc = processes.pop(name, None)
    if proc is None:
        return
    if proc.poll() is None:
        log(f"stop {name} pid={proc.pid}")
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    log(f"{name} exited={proc.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-bin", type=Path, help="Prebuilt server binary path")
    parser.add_argument(
        "--target-dir",
        type=Path,
        default=Path(
            os.environ.get("CARGO_TARGET_DIR")
            or (REPO_ROOT / ".target-isolated" / "probe")
        ),
        help="Cargo target directory used when building server",
    )
    args = parser.parse_args()

    built_bin = args.server_bin or build_server(args.target_dir)
    ports = alloc_free_ports(4)
    port_a, proxy_a, port_b, proxy_b = ports
    log(f"allocated 4 free ports: {ports}")

    processes: dict[str, subprocess.Popen] = {}
    with tempfile.TemporaryDirectory(prefix="hivedeck-probe-") as tmp:
        sandbox = Path(tmp)
        bin_a = sandbox / built_bin.name.replace("server", "server-a", 1)
        bin_b = sandbox / built_bin.name.replace("server", "server-b", 1)
        shutil.copy2(built_bin, bin_a)
        shutil.copy2(built_bin, bin_b)

        try:
            _, tmp_a, assets_a = start_instance(
                "a", bin_a, sandbox, port_a, proxy_a, processes
            )
            ok_a, status_a = call_list_issues(port_a)
            assert ok_a, f"before B: expected A ok, got {status_a}"
            log(f"before B: A={status_a}")

            _, tmp_b, assets_b = start_instance(
                "b", bin_b, sandbox, port_b, proxy_b, processes
            )

            db_a = assets_a / "db.v2.sqlite"
            db_b = assets_b / "db.v2.sqlite"
            assert db_a.exists() and db_b.exists(), "DB files missing"
            assert not os.path.samefile(db_a, db_b), "DB files collided"

            pf_a = tmp_a / "hivedeck" / "hivedeck.port"
            pf_b = tmp_b / "hivedeck" / "hivedeck.port"
            assert not os.path.samefile(pf_a, pf_b), "port files collided"
            log("verified distinct DB and port discovery files")

            ok_a, status_a = call_list_issues(port_a)
            ok_b, status_b = call_list_issues(port_b)
            assert ok_a and ok_b, f"both running failed: A={status_a} B={status_b}"
            log(f"both running: A={status_a} B={status_b}")

            stop_instance("b", processes)
            ok_a, status_a = call_list_issues(port_a)
            ok_b, status_b = call_list_issues(port_b)
            assert ok_a and not ok_b, f"after stop B: A={status_a} B={status_b}"
            log(f"after stop B: A={status_a} B={status_b}")

            start_instance("b", bin_b, sandbox, port_b, proxy_b, processes)
            ok_a, status_a = call_list_issues(port_a)
            ok_b, status_b = call_list_issues(port_b)
            assert ok_a and ok_b, f"after restart B: A={status_a} B={status_b}"
            log(f"after restart B: A={status_a} B={status_b}")

            stop_instance("b", processes)
            stop_instance("a", processes)
            ok_a, status_a = call_list_issues(port_a)
            assert not ok_a, f"after stop A: expected failure, got {status_a}"
            log(f"after stop A: A={status_a}")

            start_instance("a", bin_a, sandbox, port_a, proxy_a, processes)
            ok_a, status_a = call_list_issues(port_a)
            assert ok_a, f"after restart A: expected ok, got {status_a}"
            log(f"after restart A: A={status_a}")
        finally:
            for name in list(processes):
                stop_instance(name, processes)

    log("probe passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
