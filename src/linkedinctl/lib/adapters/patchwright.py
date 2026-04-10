from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ..errors import AdapterExecutionError
from ..runtime_paths import DEFAULT_USER_DATA_DIR
from ..types import JsonDict


@dataclass(frozen=True)
class PatchwrightConfig:
    workspace_root: Path
    headless: bool = True
    timeout_ms: int = 30000
    retain_run_artifacts: bool = False
    user_data_dir: str = DEFAULT_USER_DATA_DIR
    target_profile_url: str = ""
    locale: str = "en-US"
    node_bin: str = "node"
    npm_bin: str = "npm"


class PatchwrightAdapter:
    def __init__(self, config: PatchwrightConfig) -> None:
        self.config = config
        self.runner = self.config.workspace_root / "browser" / "dist" / "main.js"

    def readiness(self) -> JsonDict:
        payload = self._base_payload()
        return self._exec("readiness", payload)

    def pull_profile(self) -> JsonDict:
        payload = self._base_payload()
        return self._exec("pull", payload)

    def login(self, *, login_wait_ms: int = 300000) -> JsonDict:
        payload = self._base_payload()
        payload["login_wait_ms"] = int(login_wait_ms)
        return self._exec("login", payload)

    def apply_operation(self, operation: JsonDict) -> JsonDict:
        payload = self._base_payload()
        payload["operation"] = operation
        return self._exec("apply-operation", payload)

    def _base_payload(self) -> JsonDict:
        payload: JsonDict = {
            "workspace_root": str(self.config.workspace_root),
            "headless": self.config.headless,
            "timeout_ms": self.config.timeout_ms,
            "retain_run_artifacts": self.config.retain_run_artifacts,
            "user_data_dir": self.config.user_data_dir,
            "locale": self.config.locale,
        }
        if self.config.target_profile_url:
            payload["target_profile_url"] = self.config.target_profile_url
        return payload

    def _exec(self, command: str, payload: JsonDict) -> JsonDict:
        self._ensure_runner_built()
        if not self.runner.exists():
            raise AdapterExecutionError(f"Patchwright runner not found after build: {self.runner}")

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False))
            tmp_path = Path(handle.name)

        process = subprocess.run(
            [
                self.config.node_bin,
                str(self.runner),
                "--command",
                command,
                "--payload-file",
                str(tmp_path),
            ],
            cwd=str(self.config.workspace_root),
            text=True,
            capture_output=True,
            timeout=max(30, int(self.config.timeout_ms / 1000) + 30),
        )
        tmp_path.unlink(missing_ok=True)

        stdout = (process.stdout or "").strip()
        stderr = (process.stderr or "").strip()
        if not stdout:
            raise AdapterExecutionError(
                f"Patchwright adapter returned no stdout for command {command}.",
            )

        try:
            payload_out = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise AdapterExecutionError(
                f"Patchwright adapter returned non-JSON output for {command}: {stdout[:500]}",
            ) from exc

        if process.returncode != 0:
            raise AdapterExecutionError(
                f"Patchwright command {command} failed with code {process.returncode}: {payload_out.get('error') or stderr or 'unknown'}"
            )

        if not isinstance(payload_out, dict):
            raise AdapterExecutionError(f"Patchwright command {command} returned invalid payload shape.")

        return payload_out

    def _ensure_runner_built(self) -> None:
        browser_src = self.config.workspace_root / "browser" / "src"
        tsconfig = self.config.workspace_root / "tsconfig.browser.json"
        package_json = self.config.workspace_root / "package.json"

        needs_build = not self.runner.exists()
        if not needs_build:
            runner_mtime = self.runner.stat().st_mtime
            watched_files: list[Path] = [tsconfig, package_json]
            watched_files.extend(browser_src.rglob("*.ts"))
            needs_build = any(path.exists() and path.stat().st_mtime > runner_mtime for path in watched_files)

        if not needs_build:
            return

        build = subprocess.run(
            [self.config.npm_bin, "run", "build"],
            cwd=str(self.config.workspace_root),
            text=True,
            capture_output=True,
            timeout=120,
        )
        if build.returncode != 0:
            stdout = (build.stdout or "").strip()
            stderr = (build.stderr or "").strip()
            raise AdapterExecutionError(
                "Failed to compile TypeScript browser runner: "
                f"{stderr or stdout or 'unknown npm build error'}"
            )
