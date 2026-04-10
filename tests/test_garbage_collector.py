from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from linkedinctl.lib.garbage_collector import run_garbage_collection


class GarbageCollectorTest(unittest.TestCase):
    def test_removes_profile_cache_and_prunes_old_runs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            state_runs = workspace / "state" / "runs" / "pull"
            state_runs.mkdir(parents=True, exist_ok=True)

            run_old = state_runs / "2026-01-01T00-00-00-000Z-old001"
            run_new = state_runs / "2026-04-10T00-00-00-000Z-new001"
            run_old.mkdir(parents=True, exist_ok=True)
            run_new.mkdir(parents=True, exist_ok=True)
            (run_old / "meta.txt").write_text("old", encoding="utf-8")
            (run_new / "meta.txt").write_text("new", encoding="utf-8")

            profile_dir = workspace / "profile"
            cache_dir = profile_dir / "Default" / "Cache"
            cache_dir.mkdir(parents=True, exist_ok=True)
            (cache_dir / "cache.bin").write_text("cache", encoding="utf-8")

            report = run_garbage_collection(
                workspace_root=workspace,
                user_data_dir=str(profile_dir),
                keep_recent_runs=1,
                max_run_age_days=1,
            )

            self.assertTrue(report["ok"])
            self.assertFalse(cache_dir.exists())
            self.assertFalse(run_old.exists())
            self.assertTrue(run_new.exists())
            self.assertTrue((workspace / "state" / "gc" / "events.jsonl").exists())


if __name__ == "__main__":
    unittest.main()

