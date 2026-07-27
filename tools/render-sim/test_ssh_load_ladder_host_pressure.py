#!/usr/bin/env python3
"""Deterministic checks for the real-SSH ladder's host qualification gate."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType
from typing import Any


def load_ladder() -> ModuleType:
    path = Path(__file__).with_name("ssh-load-ladder.py")
    spec = importlib.util.spec_from_file_location("maldoror_ssh_load_ladder", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


LADDER = load_ladder()


def sample(
    epoch_ms: int,
    *,
    cpu_some: float = 2.0,
    memory_full: float = 0.2,
    io_full: float = 0.3,
    load_per_cpu: float = 0.5,
    available_mib: float = 4096.0,
    swap_pages_in: int = 100,
    swap_pages_out: int = 200,
) -> dict[str, Any]:
    def pressure(some: float, full: float) -> dict[str, Any]:
        return {
            "some": {"avg10": some, "avg60": some, "avg300": some, "total": 0},
            "full": {"avg10": full, "avg60": full, "avg300": full, "total": 0},
        }

    return {
        "epochMs": epoch_ms,
        "pressure": {
            "cpu": pressure(cpu_some, 0.0),
            "memory": pressure(memory_full, memory_full),
            "io": pressure(io_full, io_full),
        },
        "load": {
            "one": load_per_cpu * 8,
            "five": 0.0,
            "fifteen": 0.0,
            "runnable": 1,
            "processes": 100,
            "logicalCpus": 8,
            "onePerLogicalCpu": load_per_cpu,
        },
        "memory": {"availableMiB": available_mib, "swapUsedMiB": 512.0},
        "vmstat": {
            "swapPagesIn": swap_pages_in,
            "swapPagesOut": swap_pages_out,
        },
    }


class HostPressureQualificationTest(unittest.TestCase):
    def test_accepts_a_low_pressure_window(self) -> None:
        report = LADDER.summarize_host_pressure(
            [sample(1_000), sample(11_000, swap_pages_in=110)],
            dict(LADDER.DEFAULT_HOST_THRESHOLDS),
        )

        self.assertTrue(report["qualifiedNormal"])
        self.assertEqual(report["violations"], [])
        self.assertLess(report["observed"]["swapIoMiBPerSecondMax"], 1.0)

    def test_rejects_each_contaminating_pressure_signal(self) -> None:
        report = LADDER.summarize_host_pressure(
            [
                sample(1_000),
                sample(
                    2_000,
                    cpu_some=21.0,
                    memory_full=2.0,
                    io_full=1.5,
                    load_per_cpu=1.2,
                    available_mib=1024.0,
                    swap_pages_in=10_000,
                    swap_pages_out=10_000,
                ),
            ],
            dict(LADDER.DEFAULT_HOST_THRESHOLDS),
        )

        self.assertFalse(report["qualifiedNormal"])
        self.assertEqual(
            {violation["metric"] for violation in report["violations"]},
            set(LADDER.DEFAULT_HOST_THRESHOLDS),
        )

    def test_live_snapshot_has_the_required_kernel_evidence(self) -> None:
        snapshot = LADDER.host_pressure_snapshot()

        self.assertGreater(snapshot["load"]["logicalCpus"], 0)
        self.assertIn("full", snapshot["pressure"]["memory"])
        self.assertIn("full", snapshot["pressure"]["io"])
        self.assertGreater(snapshot["memory"]["availableMiB"], 0)
        self.assertGreaterEqual(snapshot["vmstat"]["swapPagesIn"], 0)


if __name__ == "__main__":
    unittest.main()
