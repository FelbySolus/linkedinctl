from __future__ import annotations

import json
from pathlib import Path

from .snapshot import empty_snapshot, normalize_snapshot, utc_now_iso
from .types import JsonDict


class ProfileStateStore:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        self.state_dir = self.workspace_root / "state"
        self.state_dir.mkdir(parents=True, exist_ok=True)

        self.snapshot_path = self.state_dir / "profile.snapshot.json"
        self.operations_log_path = self.state_dir / "operations.log.jsonl"
        self.last_plan_path = self.state_dir / "last-plan.json"
        self.audit_dir = self.state_dir / "audits"
        self.audit_dir.mkdir(parents=True, exist_ok=True)

    def load_snapshot(self, *, target_profile: str = "self") -> JsonDict:
        if not self.snapshot_path.exists():
            return empty_snapshot(target_profile)

        try:
            payload = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return empty_snapshot(target_profile)

        return normalize_snapshot(payload, target_profile=target_profile)

    def save_snapshot(self, snapshot: JsonDict) -> None:
        normalized = normalize_snapshot(snapshot, target_profile=str(snapshot.get("target_profile") or "self"))
        normalized["updated_at"] = utc_now_iso()
        self.snapshot_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def save_last_plan(self, plan_payload: JsonDict) -> None:
        self.last_plan_path.write_text(json.dumps(plan_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def save_audit_report(self, report_payload: JsonDict) -> Path:
        stamp = utc_now_iso().replace(":", "-")
        path = self.audit_dir / f"{stamp}.json"
        path.write_text(json.dumps(report_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path

    def append_operation_log(self, row: JsonDict) -> None:
        payload = dict(row)
        payload.setdefault("timestamp", utc_now_iso())
        with self.operations_log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")

    def load_applied_idempotency_keys(self) -> set[str]:
        if not self.operations_log_path.exists():
            return set()

        keys: set[str] = set()
        for line in self.operations_log_path.read_text(encoding="utf-8").splitlines():
            text = line.strip()
            if not text:
                continue
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                continue
            key = str(payload.get("idempotency_key") or "").strip()
            status = str(payload.get("status") or "").strip()
            if key and status == "applied":
                keys.add(key)
        return keys

    def readiness(self) -> JsonDict:
        return {
            "ok": True,
            "workspace_root": str(self.workspace_root),
            "state_dir": str(self.state_dir),
            "snapshot_exists": self.snapshot_path.exists(),
            "operations_log_exists": self.operations_log_path.exists(),
            "last_plan_exists": self.last_plan_path.exists(),
        }
