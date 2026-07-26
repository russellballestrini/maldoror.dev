#!/usr/bin/env python3
"""Measure 5/10/20 real-SSH presences against the isolated acceptance server.

The clients are actual OpenSSH processes behind fixed-size pseudo-terminals.
Every client continuously drains and parses synchronized terminal frames, so
the measurement covers ssh2, SessionProxy, worker IPC, the renderer, terminal
codec, and OutputPump rather than calling an internal rendering shortcut.
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import json
import math
import os
import pty
import re
import select
import signal
import struct
import termios
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


SYNC_START = b"\x1b[?2026h"
SYNC_END = b"\x1b[?2026l"
POSITION = re.compile(rb"Pos: \((-?\d+), (-?\d+)\)")
OSC_SEQUENCE = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)")
CSI_SEQUENCE = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
ESC_SEQUENCE = re.compile(rb"\x1b.")
COUNTER_FIELDS = (
    "total_dropped_frames",
    "total_drain_events",
    "total_bytes_written",
    "total_frames_written",
    "keyframes_accepted",
    "recovery_keyframes_accepted",
    "recovery_requests",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument(
        "--output",
        required=True,
        metavar="OUTPUT_DIRECTORY",
        help="directory that will receive metrics.json and partial-metrics.json",
    )
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument("--warmup-duration", type=float, default=5.0)
    parser.add_argument("--movement-interval", type=float, default=1.0)
    parser.add_argument("--ready-timeout", type=float, default=120.0)
    parser.add_argument("--churn-clients", type=int, default=2)
    parser.add_argument("--max-presences", type=int, choices=(5, 10, 20), default=20)
    parser.add_argument("--max-tree-rss-mib", type=float, default=1600.0)
    return parser.parse_args()


@dataclass
class Client:
    fixture_id: str
    username: str
    identity: str
    host: str
    port: int
    known_hosts: str
    cols: int = 160
    rows: int = 46
    pid: int | None = None
    fd: int | None = None
    alive: bool = False
    ready: bool = False
    mode_confirmed: bool = False
    origin_confirmed: bool = False
    total_bytes: int = 0
    frames: int = 0
    frame_ends: list[float] = field(default_factory=list)
    movement_response_ms: list[float] = field(default_factory=list)
    movement_positions: list[tuple[int, int]] = field(default_factory=list)
    pending_input: tuple[float, tuple[int, int]] | None = None
    current_position: tuple[int, int] | None = None
    positions: set[tuple[int, int]] = field(default_factory=set)
    detector: bytearray = field(default_factory=bytearray)
    frame_scan: bytearray = field(default_factory=bytearray)
    in_frame: bool = False
    next_input_at: float = 0.0
    input_direction: int = 1

    def start(self) -> None:
        if self.alive:
            raise RuntimeError(f"{self.fixture_id} is already running")
        pid, fd = pty.fork()
        if pid == 0:
            os.environ["TERM"] = "xterm-ghostty"
            command = [
                "ssh", "-tt", "-p", str(self.port),
                "-o", "BatchMode=yes",
                "-o", "StrictHostKeyChecking=no",
                "-o", f"UserKnownHostsFile={self.known_hosts}",
                "-o", "IdentitiesOnly=yes",
                "-i", self.identity,
                f"{self.username}@{self.host}",
            ]
            os.execvp("ssh", command)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", self.rows, self.cols, 0, 0))
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        self.pid = pid
        self.fd = fd
        self.alive = True
        self.ready = False
        self.mode_confirmed = False
        self.origin_confirmed = False
        self.detector.clear()
        self.frame_scan.clear()
        self.in_frame = False
        self.pending_input = None
        self.current_position = None
        self.next_input_at = time.monotonic() + 1.0

    def read_available(self, now: float) -> None:
        if not self.alive or self.fd is None:
            return
        while True:
            try:
                chunk = os.read(self.fd, 1 << 20)
            except BlockingIOError:
                return
            except OSError as error:
                if error.errno in (errno.EIO, errno.EBADF):
                    self.alive = False
                    return
                raise
            if not chunk:
                self.alive = False
                return
            self.total_bytes += len(chunk)
            self.detector.extend(chunk)
            detector_limit = 65_536 if self.ready else 1_048_576
            if len(self.detector) > detector_limit:
                del self.detector[:-detector_limit]
            visible = strip_terminal_control(bytes(self.detector))
            for match in POSITION.finditer(visible):
                position = (int(match.group(1)), int(match.group(2)))
                self.positions.add(position)
                if position == (0, 0):
                    self.origin_confirmed = True
            if b"Mode: OCTANT" in visible:
                self.mode_confirmed = True
            self.ready = self.mode_confirmed and self.origin_confirmed
            self.frame_scan.extend(chunk)
            self._consume_frames(now)

    def _consume_frames(self, now: float) -> None:
        while True:
            if not self.in_frame:
                start = self.frame_scan.find(SYNC_START)
                if start < 0:
                    if len(self.frame_scan) > len(SYNC_START):
                        del self.frame_scan[:-len(SYNC_START)]
                    return
                del self.frame_scan[:start + len(SYNC_START)]
                self.in_frame = True
            end = self.frame_scan.find(SYNC_END)
            if end < 0:
                return
            frame = bytes(self.frame_scan[:end])
            del self.frame_scan[:end + len(SYNC_END)]
            self.in_frame = False
            self.frames += 1
            self.frame_ends.append(now)
            visible = strip_terminal_control(frame)
            matches = list(POSITION.finditer(visible))
            if not matches:
                continue
            match = matches[-1]
            position = (int(match.group(1)), int(match.group(2)))
            self.current_position = position
            self.positions.add(position)
            if position == (0, 0):
                self.origin_confirmed = True
            if self.pending_input is not None:
                sent_at, starting_position = self.pending_input
                if position != starting_position:
                    self.movement_response_ms.append((now - sent_at) * 1000)
                    self.movement_positions.append(position)
                    self.pending_input = None

    def send_movement(self, now: float) -> bool:
        if not self.alive or self.fd is None:
            raise RuntimeError(f"{self.fixture_id} disconnected before movement")
        if self.current_position is None or self.pending_input is not None:
            return False
        key = b"d" if self.input_direction > 0 else b"a"
        os.write(self.fd, key)
        self.pending_input = (now, self.current_position)
        self.input_direction *= -1
        return True

    def close(self) -> None:
        if self.fd is not None:
            try:
                os.write(self.fd, b"q")
            except OSError:
                pass
        deadline = time.monotonic() + 2.0
        while self.pid is not None and time.monotonic() < deadline:
            try:
                done, _ = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                done = self.pid
            if done:
                self.pid = None
                break
            time.sleep(0.03)
        if self.pid is not None:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(self.pid, 0)
            except ChildProcessError:
                pass
            self.pid = None
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None
        self.alive = False


def runtime(port: int) -> dict[str, Any]:
    # The coordinator rejects a missing worker IPC response after five seconds.
    # Give that explicit 503 enough time to arrive instead of racing it with a
    # client-side socket timeout that loses the more useful server result.
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/runtime", timeout=7) as response:
        if response.status != 200:
            raise RuntimeError(f"runtime endpoint returned {response.status}")
        return json.load(response)


def runtime_while_pumping(port: int, clients: list[Client]) -> dict[str, Any]:
    """Sample worker runtime without ever stopping SSH PTY drainage."""
    result: list[dict[str, Any]] = []
    failures: list[BaseException] = []

    def sample() -> None:
        try:
            result.append(runtime(port))
        except BaseException as error:  # Re-raised on the harness thread below.
            failures.append(error)

    thread = threading.Thread(target=sample, name="maldoror-runtime-sample", daemon=True)
    thread.start()
    deadline = time.monotonic() + 10.0
    while thread.is_alive() and time.monotonic() < deadline:
        pump(clients, 0.02)
    thread.join(timeout=0.1)
    if thread.is_alive():
        raise TimeoutError("runtime sampler did not finish within 10 seconds")
    if failures:
        raise failures[0]
    if not result:
        raise RuntimeError("runtime sampler returned no result")
    return result[0]


def wait_ready(
    clients: list[Client],
    timeout: float,
    drain_clients: list[Client] | None = None,
) -> None:
    deadline = time.monotonic() + timeout
    draining = drain_clients if drain_clients is not None else clients
    while time.monotonic() < deadline:
        pump(draining, 0.1)
        failed = [client.fixture_id for client in clients if not client.alive]
        if failed:
            raise RuntimeError(f"SSH clients exited before readiness: {failed}")
        if all(client.ready and client.origin_confirmed for client in clients):
            return
    missing = [client.fixture_id for client in clients if not client.ready]
    raise RuntimeError(f"clients did not reach exact-origin OCTANT readiness: {missing}")


def wait_sessions(port: int, expected: int, timeout: float = 10.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        latest = runtime(port)
        if latest["active_sessions"] == expected:
            return latest
        time.sleep(0.1)
    raise RuntimeError(f"runtime sessions {latest.get('active_sessions')} != {expected}")


def pump(clients: list[Client], timeout: float) -> None:
    descriptors = [client.fd for client in clients if client.alive and client.fd is not None]
    if not descriptors:
        time.sleep(timeout)
        return
    readable, _, _ = select.select(descriptors, [], [], timeout)
    now = time.monotonic()
    by_fd = {client.fd: client for client in clients}
    for descriptor in readable:
        by_fd[descriptor].read_available(now)


def warmup_rung(
    clients: list[Client],
    additions: list[Client],
    duration: float,
    movement_interval: float,
) -> dict[str, Any]:
    baselines = {client.fixture_id: len(client.movement_response_ms) for client in clients}
    started = time.monotonic()
    for index, client in enumerate(clients):
        client.next_input_at = started + 0.25 + index * 0.02
    while time.monotonic() - started < duration:
        pump(clients, 0.02)
        now = time.monotonic()
        for client in clients:
            if not client.alive:
                raise RuntimeError(f"{client.fixture_id} disconnected during warmup")
            if now >= client.next_input_at and client.send_movement(now):
                client.next_input_at = now + movement_interval
    deadline = time.monotonic() + 10.0
    while any(client.pending_input is not None for client in clients) and time.monotonic() < deadline:
        pump(clients, 0.02)
    stalled = [client.fixture_id for client in clients if client.pending_input is not None]
    if stalled:
        raise RuntimeError(f"warmup response never became visible for clients: {stalled}")

    samples = {
        client.fixture_id: client.movement_response_ms[baselines[client.fixture_id]:]
        for client in clients
    }
    addition_ids = {client.fixture_id for client in additions}
    return {
        "presences": len(clients),
        "durationMs": round((time.monotonic() - started) * 1000, 3),
        "purpose": "retained cold post-login/cache-fill evidence excluded from steady-state percentile",
        "allVisibleResponseMs": distribution([
            value for values in samples.values() for value in values
        ]),
        "newPresenceVisibleResponseMs": distribution([
            value
            for fixture_id, values in samples.items()
            if fixture_id in addition_ids
            for value in values
        ]),
        "perClientFirstVisibleResponseMs": {
            fixture_id: round(values[0], 3)
            for fixture_id, values in samples.items()
            if values
        },
    }


def run_rung(
    clients: list[Client],
    stats_port: int,
    duration: float,
    movement_interval: float,
    max_tree_rss_mib: float,
) -> dict[str, Any]:
    before = runtime_while_pumping(stats_port, clients)
    if before["active_sessions"] != len(clients):
        raise RuntimeError(f"rung began with {before['active_sessions']} sessions, expected {len(clients)}")
    baselines = {
        client.fixture_id: {
            "bytes": client.total_bytes,
            "frames": len(client.frame_ends),
            "responses": len(client.movement_response_ms),
            "movement_positions": len(client.movement_positions),
        }
        for client in clients
    }
    root_pid = int(before["pid"])
    process_before = process_tree_snapshot(root_pid)
    process_peak = process_before
    worker_samples = [before["worker"]] if before.get("worker") else []
    runtime_sample_failures: list[dict[str, Any]] = []
    sampler_stop = threading.Event()
    started = time.monotonic()
    next_process_sample = started

    def sample_worker_runtime() -> None:
        # Worker statistics are diagnostic evidence, not part of SSH output
        # transport. Keep this probe off the PTY-draining loop so a slow IPC
        # response cannot manufacture backpressure or disconnects.
        if sampler_stop.wait(1.0):
            return
        while not sampler_stop.is_set():
            sample_started = time.monotonic()
            try:
                window = runtime(stats_port)
                if window.get("worker"):
                    worker_samples.append(window["worker"])
            except Exception as error:
                runtime_sample_failures.append({
                    "elapsedMs": round((time.monotonic() - started) * 1000, 3),
                    "type": type(error).__name__,
                    "message": str(error),
                })
            elapsed = time.monotonic() - sample_started
            if sampler_stop.wait(max(0.0, 2.0 - elapsed)):
                return

    sampler = threading.Thread(
        target=sample_worker_runtime,
        name=f"maldoror-worker-sampler-{len(clients)}",
        daemon=True,
    )
    sampler.start()
    for index, client in enumerate(clients):
        client.next_input_at = started + 0.5 + index * 0.02
    try:
        while time.monotonic() - started < duration:
            pump(clients, 0.02)
            now = time.monotonic()
            for client in clients:
                if not client.alive:
                    raise RuntimeError(f"{client.fixture_id} disconnected during rung {len(clients)}")
                if now >= client.next_input_at:
                    if client.send_movement(now):
                        client.next_input_at = now + movement_interval
            if now >= next_process_sample:
                sample = process_tree_snapshot(root_pid)
                if sample["rssMiB"] > process_peak["rssMiB"]:
                    process_peak = sample
                if sample["rssMiB"] > max_tree_rss_mib:
                    raise RuntimeError(
                        f"process tree exceeded {max_tree_rss_mib:.1f} MiB envelope: "
                        f"{sample['rssMiB']:.1f} MiB"
                    )
                next_process_sample = now + 0.5
    finally:
        sampler_stop.set()
        sampler.join(timeout=8.0)
        if sampler.is_alive():
            runtime_sample_failures.append({
                "elapsedMs": round((time.monotonic() - started) * 1000, 3),
                "type": "SamplerShutdownTimeout",
                "message": "background runtime sampler did not stop within eight seconds",
            })
    # Do not let the rung finish on an input that has not yet produced an
    # authoritative, visible position change. A pending movement can span a
    # slow render under load; counting the next unrelated frame made the old
    # metric look precise while never proving that movement happened.
    movement_deadline = time.monotonic() + 10.0
    while any(client.pending_input is not None for client in clients) and time.monotonic() < movement_deadline:
        pump(clients, 0.02)
    stalled = [client.fixture_id for client in clients if client.pending_input is not None]
    if stalled:
        raise RuntimeError(f"movement never became visible for clients: {stalled}")

    after = runtime_while_pumping(stats_port, clients)
    if after["active_sessions"] != len(clients):
        raise RuntimeError(f"rung ended with {after['active_sessions']} sessions, expected {len(clients)}")
    process_after = process_tree_snapshot(root_pid)
    if after.get("worker"):
        worker_samples.append(after["worker"])
    elapsed = time.monotonic() - started
    client_rows = []
    all_gaps: list[float] = []
    all_responses: list[float] = []
    for client in clients:
        baseline = baselines[client.fixture_id]
        frame_times = client.frame_ends[baseline["frames"]:]
        gaps = [(right - left) * 1000 for left, right in zip(frame_times, frame_times[1:])]
        responses = client.movement_response_ms[baseline["responses"]:]
        rung_positions = client.movement_positions[baseline["movement_positions"]:]
        if not responses or not rung_positions:
            raise RuntimeError(
                f"{client.fixture_id} produced no proven visible movement during rung {len(clients)}"
            )
        all_gaps.extend(gaps)
        all_responses.extend(responses)
        client_rows.append({
            "fixtureId": client.fixture_id,
            "bytes": client.total_bytes - baseline["bytes"],
            "frames": len(frame_times),
            "frameGapMs": distribution(gaps),
            "inputToVisibleResponseMs": distribution(responses),
            "positionsReachedThisRung": [list(value) for value in rung_positions],
            "positionsObserved": sorted([list(value) for value in client.positions]),
        })
    transport_before = before.get("transport", {})
    transport_after = after.get("transport", {})
    transport_delta = {
        field: int(transport_after.get(field, 0)) - int(transport_before.get(field, 0))
        for field in COUNTER_FIELDS
    }
    clock_ticks = os.sysconf("SC_CLK_TCK")
    cpu_ticks = process_after["cpuTicks"] - process_before["cpuTicks"]
    tree_cpu = max(0.0, cpu_ticks / clock_ticks / elapsed * 100)
    total_bytes = sum(row["bytes"] for row in client_rows)
    return {
        "presences": len(clients),
        "durationMs": round(elapsed * 1000, 3),
        "exactOriginReady": all(client.origin_confirmed for client in clients),
        "clientBytes": {
            "total": total_bytes,
            "perClient": distribution([float(row["bytes"]) for row in client_rows]),
            "perClientPerSecond": round(total_bytes / len(clients) / elapsed, 3),
        },
        "frameGapMs": distribution(all_gaps),
        "inputToVisibleResponseMs": distribution(all_responses),
        "runtime": after,
        "transportDelta": transport_delta,
        "transportPeakQueuedBytes": int(transport_after.get("peak_queued_bytes", 0)),
        "processTree": {
            "oneCoreCpuPercent": round(tree_cpu, 3),
            "rssStartMiB": process_before["rssMiB"],
            "rssEndMiB": process_after["rssMiB"],
            "peakRssMiB": process_peak["rssMiB"],
            "processesAtPeak": process_peak["processes"],
        },
        "worker": summarize_worker_samples(worker_samples),
        "runtimeSampleFailures": runtime_sample_failures,
        "clients": client_rows,
    }


def process_tree_snapshot(root_pid: int) -> dict[str, Any]:
    records: dict[int, dict[str, Any]] = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            stat = (entry / "stat").read_text()
            close = stat.rfind(")")
            command = stat[stat.find("(") + 1:close]
            fields = stat[close + 2:].split()
            records[pid] = {
                "pid": pid,
                "ppid": int(fields[1]),
                "command": command,
                "cpuTicks": int(fields[11]) + int(fields[12]),
                "rssPages": int((entry / "statm").read_text().split()[1]),
            }
        except (FileNotFoundError, ProcessLookupError, PermissionError, IndexError, ValueError):
            continue
    owned = {root_pid}
    changed = True
    while changed:
        changed = False
        for pid, record in records.items():
            if pid not in owned and record["ppid"] in owned:
                owned.add(pid)
                changed = True
    page_size = os.sysconf("SC_PAGE_SIZE")
    selected = [records[pid] for pid in sorted(owned) if pid in records]
    return {
        "cpuTicks": sum(record["cpuTicks"] for record in selected),
        "rssMiB": round(sum(record["rssPages"] for record in selected) * page_size / 1024 / 1024, 3),
        "processes": [
            {
                "pid": record["pid"],
                "ppid": record["ppid"],
                "command": record["command"],
                "rssMiB": round(record["rssPages"] * page_size / 1024 / 1024, 3),
            }
            for record in selected
        ],
    }


def distribution(values: list[float]) -> dict[str, float | int] | None:
    if not values:
        return None
    ordered = sorted(values)

    def percentile(fraction: float) -> float:
        index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * fraction) - 1))
        return ordered[index]

    return {
        "count": len(ordered),
        "min": round(ordered[0], 3),
        "p50": round(percentile(0.50), 3),
        "p95": round(percentile(0.95), 3),
        "p99": round(percentile(0.99), 3),
        "max": round(ordered[-1], 3),
        "mean": round(sum(ordered) / len(ordered), 3),
    }


def summarize_worker_samples(samples: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not samples:
        return None
    peak_rss = max(samples, key=lambda sample: float(sample["memory"]["rss_mib"]))
    peak_heap = max(samples, key=lambda sample: float(sample["memory"]["heap_used_mib"]))
    return {
        "samples": len(samples),
        "rssMiB": distribution([float(sample["memory"]["rss_mib"]) for sample in samples]),
        "heapUsedMiB": distribution([float(sample["memory"]["heap_used_mib"]) for sample in samples]),
        "externalMiB": distribution([float(sample["memory"]["external_mib"]) for sample in samples]),
        "arrayBuffersMiB": distribution([float(sample["memory"]["array_buffers_mib"]) for sample in samples]),
        "eventLoopUtilization": distribution([
            float(sample["event_loop"]["utilization"])
            for sample in samples if sample.get("event_loop")
        ]),
        "eventLoopDelayP99Ms": distribution([
            float(sample["event_loop"]["delay_p99_ms"])
            for sample in samples if sample.get("event_loop")
        ]),
        "eventLoopDelayMaxMs": distribution([
            float(sample["event_loop"]["delay_max_ms"])
            for sample in samples if sample.get("event_loop")
        ]),
        "peakRssSnapshot": peak_rss,
        "peakHeapSnapshot": peak_heap,
    }


def atomic_json(destination: Path, value: dict[str, Any]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, destination)


def strip_terminal_control(value: bytes) -> bytes:
    value = OSC_SEQUENCE.sub(b"", value)
    value = CSI_SEQUENCE.sub(b"", value)
    return ESC_SEQUENCE.sub(b"", value)


def main() -> int:
    args = parse_args()
    run_dir = Path(args.run_dir).resolve()
    config = json.loads((run_dir / "runtime-config.json").read_text())
    plan = json.loads((run_dir / "capture-plan.json").read_text())
    fixtures: list[dict[str, Any]] = []
    seen: set[str] = set()
    for capture in plan["captures"]:
        if capture["fixtureId"] in seen:
            continue
        seen.add(capture["fixtureId"])
        fixtures.append(capture)
    if len(fixtures) < 20:
        raise RuntimeError(f"load ladder needs 20 unique fixtures; found {len(fixtures)}")
    clients = [
        Client(
            fixture_id=fixture["fixtureId"],
            username=fixture["username"],
            identity=fixture["privateKeyPath"],
            host="127.0.0.1",
            port=int(config["sshPort"]),
            known_hosts=str(run_dir / "known-hosts"),
            cols=int(fixture["cols"]),
            rows=int(fixture["rows"]),
        )
        for fixture in fixtures[:20]
    ]
    active: list[Client] = []
    rungs: list[dict[str, Any]] = []
    warmups: list[dict[str, Any]] = []
    churn: dict[str, Any] | None = None
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    output = Path(args.output).resolve()
    try:
        targets = [target for target in (5, 10, 20) if target <= args.max_presences]
        for target in targets:
            additions = clients[len(active):target]
            for client in additions:
                client.start()
            active.extend(additions)
            wait_ready(active, args.ready_timeout)
            wait_sessions(int(config["statsPort"]), target)
            warmup = warmup_rung(
                active,
                additions,
                args.warmup_duration,
                args.movement_interval,
            )
            warmups.append(warmup)
            print(json.dumps({
                "event": "load_rung_warmup_complete",
                "presences": target,
                "newPresenceVisibleResponseP95Ms": (
                    warmup["newPresenceVisibleResponseMs"]["p95"]
                    if warmup["newPresenceVisibleResponseMs"] else None
                ),
            }), flush=True)
            print(json.dumps({"event": "load_rung_ready", "presences": target}), flush=True)
            rung = run_rung(
                active,
                int(config["statsPort"]),
                args.duration,
                args.movement_interval,
                args.max_tree_rss_mib,
            )
            rungs.append(rung)
            atomic_json(output / "partial-metrics.json", {
                "generatedAt": generated_at,
                "status": "in-progress",
                "warmups": warmups,
                "rungs": rungs,
            })
            print(json.dumps({
                "event": "load_rung_complete",
                "presences": target,
                "treePeakRssMiB": rung["processTree"]["peakRssMiB"],
                "frameP99Ms": rung["frameGapMs"]["p99"] if rung["frameGapMs"] else None,
                "visibleResponseP95Ms": rung["inputToVisibleResponseMs"]["p95"] if rung["inputToVisibleResponseMs"] else None,
                "droppedFrames": rung["transportDelta"]["total_dropped_frames"],
            }), flush=True)

        churn_count = min(max(1, args.churn_clients), len(active))
        reconnecting = active[:churn_count]
        for client in reconnecting:
            client.close()
        wait_sessions(int(config["statsPort"]), len(active) - churn_count)
        for client in reconnecting:
            client.start()
        # Keep every established PTY drained while the replacements render
        # their cold keyframes. Waiting on only the reconnecting pair fills the
        # other stdout windows and turns the harness itself into a keepalive
        # and backpressure failure.
        wait_ready(reconnecting, args.ready_timeout, active)
        final_runtime = wait_sessions(int(config["statsPort"]), len(active))
        churn = {
            "clients": churn_count,
            "reconnectedAtExactOrigin": all(client.origin_confirmed for client in reconnecting),
            "activeSessionsRestored": final_runtime["active_sessions"],
            "runtime": final_runtime,
        }
        if not churn["reconnectedAtExactOrigin"]:
            raise RuntimeError("reconnected clients did not return at exact origin")
    except Exception as error:
        atomic_json(output / "failure-metrics.json", {
            "generatedAt": generated_at,
            "status": "failed",
            "error": {
                "type": type(error).__name__,
                "message": str(error),
            },
            "warmups": warmups,
            "completedRungs": rungs,
            "clientsAtFailure": [{
                "fixtureId": client.fixture_id,
                "alive": client.alive,
                "ready": client.ready,
                "originConfirmed": client.origin_confirmed,
                "totalBytes": client.total_bytes,
                "frames": client.frames,
                "movementResponses": len(client.movement_response_ms),
                "currentPosition": client.current_position,
            } for client in active],
        })
        raise
    finally:
        for client in active:
            client.close()
    zero = wait_sessions(int(config["statsPort"]), 0)
    report = {
        "generatedAt": generated_at,
        "topology": "loopback OpenSSH PTYs -> ssh2 -> SessionProxy -> worker IPC -> regional renderer",
        "terminalDimensions": [160, 46],
        "rungDurationSeconds": args.duration,
        "rungWarmupSeconds": args.warmup_duration,
        "movementIntervalSeconds": args.movement_interval,
        "maxPresences": args.max_presences,
        "warmups": warmups,
        "rungs": rungs,
        "churn": churn,
        "cleanup": {"activeSessions": zero["active_sessions"]},
        "interpretation": {
            "realSshTransport": True,
            "allClientsContinuouslyDrained": True,
            "inputLatencyMeasure": "key write to synchronized authoritative-position acknowledgement",
            "actorMotionMeasure": "frame-gap distribution; avatar traversal remains on the scheduled smooth-render cadence",
            "cpuPercentMeasure": "coordinator plus descendant worker process CPU normalized to one core",
            "physicalGhostty": False,
            "productionDeployment": False,
            "steadyStatePercentilesExcludeRetainedWarmup": True,
        },
    }
    atomic_json(output / "metrics.json", report)
    print(json.dumps({
        "event": "load_ladder_complete",
        "output": str(output),
        "rungs": len(rungs),
        "cleanupActiveSessions": zero["active_sessions"],
    }), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
