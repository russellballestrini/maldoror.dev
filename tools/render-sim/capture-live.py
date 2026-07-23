#!/usr/bin/env python3
"""Capture a real Ghostty-shaped Maldoror SSH session for faithful replay.

The capture stops before sending ``q`` so terminal cleanup (alternate-screen and
OSC-4 restoration) cannot replace the game frame being audited.
"""

from __future__ import annotations

import argparse
import fcntl
import os
import pty
import select
import signal
import struct
import termios
import time


SYNC_START = b"\x1b[?2026h"
SYNC_END = b"\x1b[?2026l"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("--cols", type=int, default=160)
    parser.add_argument("--rows", type=int, default=46)
    parser.add_argument("--settle", type=float, default=3.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--keys", default="", help="movement/actions sent one second after the first game frame")
    parser.add_argument("--user", default="ajax")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-ghostty"
        os.execvp(
            "ssh",
            [
                "ssh",
                "-tt",
                "-p",
                "2222",
                "-o",
                "BatchMode=yes",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "UserKnownHostsFile=/tmp/maldoror-codex-known-hosts",
                f"{args.user}@127.0.0.1",
            ],
        )

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))
    started_at = time.monotonic()
    game_at: float | None = None
    game_at_bytes: int | None = None
    keys_sent = not bool(args.keys)
    keys_at_bytes: int | None = None
    detector = bytearray()
    captured = 0

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "wb") as output:
        while time.monotonic() - started_at < args.timeout:
            readable, _, _ = select.select([fd], [], [], 0.1)
            if readable:
                try:
                    chunk = os.read(fd, 1 << 20)
                except OSError:
                    break
                if not chunk:
                    break
                output.write(chunk)
                captured += len(chunk)
                detector.extend(chunk)
                if len(detector) > 4096:
                    del detector[:-4096]
                if game_at is None and b"Mode: " in detector:
                    game_at = time.monotonic()
                    game_at_bytes = captured

            if game_at is not None:
                elapsed = time.monotonic() - game_at
                if not keys_sent and elapsed >= 1.0:
                    keys_at_bytes = captured
                    os.write(fd, args.keys.encode("utf-8"))
                    keys_sent = True
                if elapsed >= args.settle:
                    break

    # Cleanup happens after the audited byte stream is closed.
    try:
        os.write(fd, b"q")
    except OSError:
        pass
    cleanup_deadline = time.monotonic() + 3.0
    reaped = False
    while time.monotonic() < cleanup_deadline:
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            done = pid
        if done:
            reaped = True
            break
        readable, _, _ = select.select([fd], [], [], 0.1)
        if readable:
            try:
                os.read(fd, 1 << 20)
            except OSError:
                break

    if not reaped:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            reaped = True
        if not reaped:
            wait_deadline = time.monotonic() + 2.0
            while time.monotonic() < wait_deadline:
                try:
                    done, _ = os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    done = pid
                if done:
                    reaped = True
                    break
                time.sleep(0.05)
        if not reaped:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)

    try:
        os.close(fd)
    except OSError:
        pass

    if game_at is None:
        raise SystemExit(f"no game frame detected within {args.timeout:.0f}s ({captured} bytes captured)")
    # "Mode: " occurs near the beginning of the first synchronized world
    # frame, not at its end. Split the audit at the first complete frame so a
    # large I-frame is never mislabeled as steady-state transport.
    with open(args.output, "rb") as captured_stream:
        raw = captured_stream.read()
    first_frame_start = raw.find(SYNC_START)
    first_frame_end = raw.find(SYNC_END, first_frame_start + len(SYNC_START))
    if first_frame_start >= 0 and first_frame_end >= 0:
        first_frame_end += len(SYNC_END)
        startup_and_first = first_frame_end
        steady_bytes = captured - first_frame_end
        synchronized_frames = raw.count(SYNC_START)
    else:
        startup_and_first = game_at_bytes or captured
        steady_bytes = captured - startup_and_first
        synchronized_frames = 0
    movement_suffix = ""
    if keys_at_bytes is not None:
        movement_suffix = f", {captured - keys_at_bytes} bytes after movement input"
    print(
        f"captured {captured} bytes at {args.cols}x{args.rows} "
        f"({startup_and_first} startup/first-frame, {steady_bytes} steady bytes, "
        f"{synchronized_frames} synchronized frames{movement_suffix}) "
        f"to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
