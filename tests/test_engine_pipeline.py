from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import subprocess
from unittest.mock import patch

from linkedinctl.lib.engine import LinkedInProfileEngine


class EnginePipelineTest(unittest.TestCase):
    def test_apply_marks_failure_when_auto_commit_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            engine = LinkedInProfileEngine(workspace_root=str(workspace))
            spec = {
                "version": "1",
                "target_profile": "self",
                "operations": [
                    {
                        "op": "set_headline",
                        "value": "Developer",
                        "idempotency_key": "headline-v1-abc",
                    }
                ],
            }

            with patch(
                "linkedinctl.lib.engine.safe_auto_commit",
                return_value={
                    "ok": False,
                    "committed": False,
                    "reason": "git_commit_failed",
                },
            ):
                result = engine.apply(spec)

            self.assertFalse(result["ok"])
            self.assertIn("auto_commit_failed", str(result.get("reason", "")))
            self.assertIn("commit", result)
            self.assertFalse(result["commit"]["ok"])

    def test_apply_auto_commit_in_git_repo(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True, text=True)
            subprocess.run(
                ["git", "config", "user.email", "linkedinctl-tests@example.com"],
                cwd=workspace,
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "linkedinctl-tests"],
                cwd=workspace,
                check=True,
                capture_output=True,
                text=True,
            )

            engine = LinkedInProfileEngine(workspace_root=str(workspace))
            spec = {
                "version": "1",
                "target_profile": "self",
                "operations": [
                    {
                        "op": "set_headline",
                        "value": "Developer",
                        "idempotency_key": "headline-v1-git-test",
                    }
                ],
            }

            result = engine.apply(spec)

            self.assertTrue(result["ok"])
            self.assertIn("commit", result)
            self.assertTrue(result["commit"]["ok"])
            self.assertTrue(result["commit"]["committed"])
            staged_files = set(result["commit"]["staged_files"])
            self.assertIn("state/profile.snapshot.json", staged_files)
            self.assertIn("state/operations.log.jsonl", staged_files)


if __name__ == "__main__":
    unittest.main()
