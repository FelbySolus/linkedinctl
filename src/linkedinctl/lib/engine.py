from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .adapters import PatchwrightAdapter, PatchwrightConfig
from .contracts import validate_spec
from .errors import AdapterExecutionError, PipelineGuardError, SpecValidationError
from .gitops import safe_auto_commit
from .runtime_paths import DEFAULT_USER_DATA_DIR
from .store import ProfileStateStore
from .types import JsonDict

LIVE_SUPPORTED_OPERATIONS = {
    "set_headline",
    "set_about",
    "set_profile_photo",
    "set_cover_photo",
}


class LinkedInProfileEngine:
    def __init__(self, workspace_root: str) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        self.store = ProfileStateStore(workspace_root=self.workspace_root)

    def readiness(
        self,
        *,
        live: bool = False,
        headless: bool = True,
        timeout_ms: int = 30000,
        retain_run_artifacts: bool = False,
        user_data_dir: str = DEFAULT_USER_DATA_DIR,
        target_profile_url: str = "",
        locale: str = "en-US",
        node_bin: str = "node",
        npm_bin: str = "npm",
    ) -> JsonDict:
        payload = self.store.readiness()
        payload["pipeline_policy"] = self._pipeline_policy()
        if not live:
            payload["live_enabled"] = False
            return payload

        adapter = self._build_adapter(
            headless=headless,
            timeout_ms=timeout_ms,
            retain_run_artifacts=retain_run_artifacts,
            user_data_dir=user_data_dir,
            target_profile_url=target_profile_url,
            locale=locale,
            node_bin=node_bin,
            npm_bin=npm_bin,
        )
        try:
            live_payload = adapter.readiness()
            return {
                **payload,
                "live_enabled": True,
                "live": live_payload,
            }
        except AdapterExecutionError as exc:
            return {
                **payload,
                "ok": False,
                "live_enabled": True,
                "reason": "live_adapter_error",
                "error": str(exc),
            }

    def login(
        self,
        *,
        headless: bool = False,
        timeout_ms: int = 30000,
        retain_run_artifacts: bool = False,
        user_data_dir: str = DEFAULT_USER_DATA_DIR,
        target_profile_url: str = "",
        locale: str = "en-US",
        node_bin: str = "node",
        npm_bin: str = "npm",
        login_wait_ms: int = 300000,
    ) -> JsonDict:
        adapter = self._build_adapter(
            headless=headless,
            timeout_ms=timeout_ms,
            retain_run_artifacts=retain_run_artifacts,
            user_data_dir=user_data_dir,
            target_profile_url=target_profile_url,
            locale=locale,
            node_bin=node_bin,
            npm_bin=npm_bin,
        )
        return adapter.login(login_wait_ms=login_wait_ms)

    def pull(
        self,
        *,
        target_profile: str = "self",
        live: bool = False,
        headless: bool = True,
        timeout_ms: int = 30000,
        retain_run_artifacts: bool = False,
        user_data_dir: str = DEFAULT_USER_DATA_DIR,
        target_profile_url: str = "",
        locale: str = "en-US",
        node_bin: str = "node",
        npm_bin: str = "npm",
    ) -> JsonDict:
        snapshot = self.store.load_snapshot(target_profile=target_profile)

        if not live:
            return {
                "ok": True,
                "target_profile": target_profile,
                "snapshot": snapshot,
            }

        adapter = self._build_adapter(
            headless=headless,
            timeout_ms=timeout_ms,
            retain_run_artifacts=retain_run_artifacts,
            user_data_dir=user_data_dir,
            target_profile_url=target_profile_url,
            locale=locale,
            node_bin=node_bin,
            npm_bin=npm_bin,
        )
        live_payload = adapter.pull_profile()
        snapshot = self._merge_live_snapshot(snapshot, live_payload, target_profile=target_profile)
        self.store.save_snapshot(snapshot)
        return {
            "ok": True,
            "target_profile": target_profile,
            "snapshot": snapshot,
            "live": {
                "profile_url": live_payload.get("profile_url"),
                "run": live_payload.get("run"),
            },
        }

    def plan(self, spec: JsonDict) -> JsonDict:
        normalized_spec = validate_spec(spec)
        target_profile = str(normalized_spec["target_profile"])
        before = self.store.load_snapshot(target_profile=target_profile)
        after = copy.deepcopy(before)

        prior_keys = self.store.load_applied_idempotency_keys()
        op_results = self._run_operations(
            after,
            normalized_spec["operations"],
            prior_keys=prior_keys,
            apply_mode=False,
            live_adapter=None,
        )
        payload = {
            "ok": True,
            "mode": "plan",
            "target_profile": target_profile,
            "operation_count": len(normalized_spec["operations"]),
            "results": op_results,
            "diff": self._diff_summary(before, after),
        }
        self.store.save_last_plan(payload)
        return payload

    def apply(
        self,
        spec: JsonDict,
        *,
        live: bool = False,
        headless: bool = True,
        timeout_ms: int = 30000,
        retain_run_artifacts: bool = False,
        user_data_dir: str = DEFAULT_USER_DATA_DIR,
        target_profile_url: str = "",
        locale: str = "en-US",
        node_bin: str = "node",
        npm_bin: str = "npm",
    ) -> JsonDict:
        normalized_spec = validate_spec(spec)
        target_profile = str(normalized_spec["target_profile"])
        pipeline = dict(normalized_spec.get("pipeline") or {})
        self._enforce_pipeline_policy(normalized_spec["operations"], live=live, strict_mode=bool(pipeline.get("strict_mode", True)))
        before = self.store.load_snapshot(target_profile=target_profile)
        after = copy.deepcopy(before)

        live_adapter: PatchwrightAdapter | None = None
        if live:
            live_adapter = self._build_adapter(
                headless=headless,
                timeout_ms=timeout_ms,
                retain_run_artifacts=retain_run_artifacts,
                user_data_dir=user_data_dir,
                target_profile_url=target_profile_url,
                locale=locale,
                node_bin=node_bin,
                npm_bin=npm_bin,
            )

        prior_keys = self.store.load_applied_idempotency_keys()
        op_results = self._run_operations(
            after,
            normalized_spec["operations"],
            prior_keys=prior_keys,
            apply_mode=True,
            live_adapter=live_adapter,
        )

        changed = before != after
        if changed:
            self.store.save_snapshot(after)

        for row in op_results:
            self.store.append_operation_log(
                {
                    "target_profile": target_profile,
                    "op": row.get("op"),
                    "index": row.get("index"),
                    "idempotency_key": row.get("idempotency_key"),
                    "status": row.get("status"),
                    "changed": bool(row.get("changed")),
                    "reason": row.get("reason", ""),
                }
            )

        counts = {
            "applied": sum(1 for row in op_results if row["status"] == "applied"),
            "skipped": sum(1 for row in op_results if row["status"] == "skipped"),
            "failed": sum(1 for row in op_results if row["status"] == "failed"),
        }
        ok = counts["failed"] == 0
        failure_reasons: list[str] = []
        if not ok:
            failure_reasons.append("operation_failed")

        payload: JsonDict = {
            "ok": ok,
            "mode": "apply",
            "target_profile": target_profile,
            "operation_count": len(normalized_spec["operations"]),
            "counts": counts,
            "state_changed": changed,
            "results": op_results,
            "diff": self._diff_summary(before, after),
            "live_enabled": live,
            "pipeline": {
                "strict_mode": bool(pipeline.get("strict_mode", True)),
                "auto_audit": bool(pipeline.get("auto_audit", True)),
                "auto_commit": bool(pipeline.get("auto_commit", True)),
            },
        }

        audit_path: Path | None = None
        if bool(pipeline.get("auto_audit", True)):
            try:
                report = self._build_audit_report(
                    target_profile=target_profile,
                    normalized_spec=normalized_spec,
                    results=op_results,
                    counts=counts,
                    diff=payload["diff"],
                    live=live,
                    state_changed=changed,
                )
                audit_path = self.store.save_audit_report(report)
                payload["audit"] = {
                    "ok": True,
                    "path": str(audit_path),
                    "snapshot_sha256": report["snapshot_sha256"],
                }
            except Exception as exc:
                payload["audit"] = {
                    "ok": False,
                    "reason": "audit_write_failed",
                    "error": str(exc),
                }
                ok = False
                failure_reasons.append("audit_failed")

        if bool(pipeline.get("auto_commit", True)) and counts["failed"] == 0:
            commit_files: list[Path] = [self.store.operations_log_path]
            if changed:
                commit_files.append(self.store.snapshot_path)
            if audit_path is not None:
                commit_files.append(audit_path)
            commit_message = str(pipeline.get("commit_message") or "").strip() or self._default_commit_message(
                target_profile=target_profile,
                counts=counts,
                state_changed=changed,
            )
            payload["commit"] = safe_auto_commit(
                workspace_root=self.workspace_root,
                files=commit_files,
                commit_message=commit_message,
            )
            if not bool(payload["commit"].get("ok")):
                ok = False
                failure_reasons.append("auto_commit_failed")
        else:
            payload["commit"] = {
                "ok": True,
                "committed": False,
                "reason": "auto_commit_disabled_or_failed_apply",
            }
            if bool(pipeline.get("auto_commit", True)) and counts["failed"] > 0:
                failure_reasons.append("auto_commit_skipped_due_failed_operations")

        payload["ok"] = ok
        if failure_reasons:
            payload["reason"] = ", ".join(failure_reasons)

        return payload

    def verify(
        self,
        *,
        target_profile: str = "self",
        live: bool = False,
        headless: bool = True,
        timeout_ms: int = 30000,
        retain_run_artifacts: bool = False,
        user_data_dir: str = DEFAULT_USER_DATA_DIR,
        target_profile_url: str = "",
        locale: str = "en-US",
        node_bin: str = "node",
        npm_bin: str = "npm",
    ) -> JsonDict:
        snapshot = self.store.load_snapshot(target_profile=target_profile)
        live_probe: JsonDict | None = None

        if live:
            adapter = self._build_adapter(
                headless=headless,
                timeout_ms=timeout_ms,
                retain_run_artifacts=retain_run_artifacts,
                user_data_dir=user_data_dir,
                target_profile_url=target_profile_url,
                locale=locale,
                node_bin=node_bin,
                npm_bin=npm_bin,
            )
            live_payload = adapter.pull_profile()
            live_probe = {
                "profile_url": live_payload.get("profile_url"),
                "headline": live_payload.get("headline"),
                "about": live_payload.get("about"),
                "run": live_payload.get("run"),
            }
            snapshot = self._merge_live_snapshot(snapshot, live_payload, target_profile=target_profile)
            self.store.save_snapshot(snapshot)

        canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        warnings: list[str] = []
        if not snapshot.get("headline"):
            warnings.append("headline_is_empty")
        if not snapshot.get("about"):
            warnings.append("about_is_empty")

        payload: JsonDict = {
            "ok": True,
            "target_profile": target_profile,
            "snapshot_sha256": digest,
            "warnings": warnings,
            "snapshot": snapshot,
            "live_enabled": live,
        }
        if live_probe is not None:
            payload["live"] = live_probe
        return payload

    def _build_adapter(
        self,
        *,
        headless: bool,
        timeout_ms: int,
        retain_run_artifacts: bool,
        user_data_dir: str,
        target_profile_url: str,
        locale: str,
        node_bin: str,
        npm_bin: str,
    ) -> PatchwrightAdapter:
        return PatchwrightAdapter(
            PatchwrightConfig(
                workspace_root=self.workspace_root,
                headless=headless,
                timeout_ms=timeout_ms,
                retain_run_artifacts=retain_run_artifacts,
                user_data_dir=user_data_dir,
                target_profile_url=target_profile_url,
                locale=locale,
                node_bin=node_bin,
                npm_bin=npm_bin,
            )
        )

    def _run_operations(
        self,
        snapshot: JsonDict,
        operations: list[JsonDict],
        *,
        prior_keys: set[str],
        apply_mode: bool,
        live_adapter: PatchwrightAdapter | None,
    ) -> list[JsonDict]:
        results: list[JsonDict] = []
        for index, operation in enumerate(operations):
            op = str(operation.get("op") or "")
            idem = str(operation.get("idempotency_key") or "").strip() or None

            if idem and idem in prior_keys:
                results.append(
                    {
                        "index": index,
                        "op": op,
                        "idempotency_key": idem,
                        "status": "skipped",
                        "changed": False,
                        "reason": "idempotent_replay",
                    }
                )
                continue

            live_result: JsonDict | None = None
            try:
                if live_adapter is not None and op in LIVE_SUPPORTED_OPERATIONS:
                    live_result = live_adapter.apply_operation(operation)

                changed, reason = self._apply_operation(snapshot, operation)
                effective_change = changed or bool((live_result or {}).get("changed"))
                status = "applied" if effective_change else "skipped"
                if effective_change and idem and apply_mode:
                    prior_keys.add(idem)

                row: JsonDict = {
                    "index": index,
                    "op": op,
                    "idempotency_key": idem,
                    "status": status,
                    "changed": effective_change,
                    "reason": reason,
                }
                if live_result is not None:
                    row["live"] = {
                        "ok": bool(live_result.get("ok")),
                        "run": live_result.get("run"),
                        "details": live_result.get("details"),
                    }
                results.append(row)
            except (SpecValidationError, AdapterExecutionError) as exc:
                results.append(
                    {
                        "index": index,
                        "op": op,
                        "idempotency_key": idem,
                        "status": "failed",
                        "changed": False,
                        "reason": str(exc),
                    }
                )
        return results

    def _pipeline_policy(self) -> JsonDict:
        return {
            "strict_mode": True,
            "reject_unknown_fields": True,
            "required_per_operation_fields": ["op", "idempotency_key", "<required op fields>"],
            "allowed_live_operations": sorted(LIVE_SUPPORTED_OPERATIONS),
            "process": ["profile plan", "profile apply"],
            "auto_audit": True,
            "auto_commit": True,
        }

    def _enforce_pipeline_policy(self, operations: list[JsonDict], *, live: bool, strict_mode: bool) -> None:
        if not strict_mode:
            raise PipelineGuardError("Strict pipeline mode cannot be disabled.")
        if live:
            blocked = [str(op.get("op") or "") for op in operations if str(op.get("op") or "") not in LIVE_SUPPORTED_OPERATIONS]
            if blocked:
                raise PipelineGuardError(
                    f"Live pipeline blocked unsupported ops: {sorted(set(blocked))}. "
                    f"Allowed live ops: {sorted(LIVE_SUPPORTED_OPERATIONS)}."
                )

    def _build_audit_report(
        self,
        *,
        target_profile: str,
        normalized_spec: JsonDict,
        results: list[JsonDict],
        counts: dict[str, int],
        diff: JsonDict,
        live: bool,
        state_changed: bool,
    ) -> JsonDict:
        snapshot = self.store.load_snapshot(target_profile=target_profile)
        snapshot_canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        spec_canonical = json.dumps(normalized_spec, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return {
            "ok": True,
            "timestamp": snapshot.get("updated_at"),
            "target_profile": target_profile,
            "live_enabled": live,
            "state_changed": state_changed,
            "snapshot_sha256": hashlib.sha256(snapshot_canonical.encode("utf-8")).hexdigest(),
            "spec_sha256": hashlib.sha256(spec_canonical.encode("utf-8")).hexdigest(),
            "counts": counts,
            "diff": diff,
            "results": results,
            "policy": self._pipeline_policy(),
        }

    def _default_commit_message(self, *, target_profile: str, counts: dict[str, int], state_changed: bool) -> str:
        verb = "update" if state_changed else "audit"
        return (
            f"linkedinctl({verb}): profile={target_profile} "
            f"applied={counts['applied']} skipped={counts['skipped']} failed={counts['failed']}"
        )

    def _apply_operation(self, snapshot: JsonDict, operation: JsonDict) -> tuple[bool, str]:
        op = str(operation["op"])

        if op == "set_headline":
            return self._set_text_field(snapshot, "headline", str(operation["value"]), reason="headline_updated")

        if op == "set_about":
            return self._set_text_field(snapshot, "about", str(operation["value"]), reason="about_updated")

        if op == "set_profile_photo":
            return self._set_profile_photo(snapshot, str(operation["file"]))

        if op == "set_cover_photo":
            return self._set_cover_photo(snapshot, str(operation["file"]))

        if op == "add_skill":
            return self._add_skill(snapshot, str(operation["name"]))

        if op == "remove_skill":
            return self._remove_skill(snapshot, str(operation["name"]))

        if op == "reorder_skill":
            return self._reorder_skill(snapshot, str(operation["name"]), int(operation["index"]))

        if op == "add_experience":
            return self._add_experience(snapshot, operation["experience"])

        if op == "update_experience":
            return self._update_experience(snapshot, operation["id"], operation["patch"])

        if op == "remove_experience":
            return self._remove_experience(snapshot, operation["id"])

        raise SpecValidationError(f"Unsupported operation {op!r}")

    def _set_text_field(self, snapshot: JsonDict, field: str, value: str, *, reason: str) -> tuple[bool, str]:
        clean = value.strip()
        if str(snapshot.get(field) or "") == clean:
            return False, "no_change"
        snapshot[field] = clean
        return True, reason

    def _set_profile_photo(self, snapshot: JsonDict, file_path: str) -> tuple[bool, str]:
        clean = file_path.strip()
        if not clean:
            raise SpecValidationError("set_profile_photo.file must be non-empty.")
        if str(snapshot.get("profile_photo_path") or "") == clean:
            return False, "no_change"
        snapshot["profile_photo_path"] = clean
        return True, "profile_photo_updated"

    def _set_cover_photo(self, snapshot: JsonDict, file_path: str) -> tuple[bool, str]:
        clean = file_path.strip()
        if not clean:
            raise SpecValidationError("set_cover_photo.file must be non-empty.")
        if str(snapshot.get("cover_photo_path") or "") == clean:
            return False, "no_change"
        snapshot["cover_photo_path"] = clean
        return True, "cover_photo_updated"

    def _add_skill(self, snapshot: JsonDict, name: str) -> tuple[bool, str]:
        clean = name.strip()
        if not clean:
            raise SpecValidationError("add_skill requires a non-empty name.")
        skills = list(snapshot.get("skills") or [])
        if any(str(skill).casefold() == clean.casefold() for skill in skills):
            return False, "skill_exists"
        skills.append(clean)
        snapshot["skills"] = skills
        return True, "skill_added"

    def _remove_skill(self, snapshot: JsonDict, name: str) -> tuple[bool, str]:
        clean = name.strip()
        skills = list(snapshot.get("skills") or [])
        kept = [skill for skill in skills if str(skill).casefold() != clean.casefold()]
        if len(kept) == len(skills):
            return False, "skill_not_found"
        snapshot["skills"] = kept
        return True, "skill_removed"

    def _reorder_skill(self, snapshot: JsonDict, name: str, index: int) -> tuple[bool, str]:
        clean = name.strip()
        skills = list(snapshot.get("skills") or [])
        current_index = next((i for i, skill in enumerate(skills) if str(skill).casefold() == clean.casefold()), None)
        if current_index is None:
            return False, "skill_not_found"

        target_index = max(0, min(index, len(skills) - 1))
        if current_index == target_index:
            return False, "already_in_position"

        moved = skills.pop(current_index)
        skills.insert(target_index, moved)
        snapshot["skills"] = skills
        return True, "skill_reordered"

    def _add_experience(self, snapshot: JsonDict, experience: JsonDict) -> tuple[bool, str]:
        if not isinstance(experience, dict):
            raise SpecValidationError("add_experience.experience must be an object.")

        experiences = list(snapshot.get("experiences") or [])
        exp = {
            "id": str(experience.get("id") or self._derive_experience_id(experience)),
            "title": str(experience.get("title") or "").strip(),
            "company": str(experience.get("company") or "").strip(),
            "start": str(experience.get("start") or "").strip(),
            "end": str(experience.get("end") or "").strip(),
            "description": str(experience.get("description") or "").strip(),
        }
        if not exp["title"] or not exp["company"]:
            raise SpecValidationError("add_experience requires title and company.")
        if any(str(item.get("id") or "") == exp["id"] for item in experiences):
            return False, "experience_exists"

        experiences.append(exp)
        snapshot["experiences"] = experiences
        return True, "experience_added"

    def _update_experience(self, snapshot: JsonDict, exp_id: object, patch: JsonDict) -> tuple[bool, str]:
        if not isinstance(patch, dict) or not patch:
            raise SpecValidationError("update_experience.patch must be a non-empty object.")

        target_id = str(exp_id)
        experiences = list(snapshot.get("experiences") or [])
        for index, row in enumerate(experiences):
            if str(row.get("id") or "") != target_id:
                continue

            updated = dict(row)
            for key in ("title", "company", "start", "end", "description"):
                if key in patch:
                    updated[key] = str(patch[key]).strip()

            if updated == row:
                return False, "no_change"
            experiences[index] = updated
            snapshot["experiences"] = experiences
            return True, "experience_updated"

        return False, "experience_not_found"

    def _remove_experience(self, snapshot: JsonDict, exp_id: object) -> tuple[bool, str]:
        target_id = str(exp_id)
        experiences = list(snapshot.get("experiences") or [])
        kept = [row for row in experiences if str(row.get("id") or "") != target_id]
        if len(kept) == len(experiences):
            return False, "experience_not_found"
        snapshot["experiences"] = kept
        return True, "experience_removed"

    def _derive_experience_id(self, experience: JsonDict) -> str:
        seed = "|".join(
            [
                str(experience.get("title") or "").strip(),
                str(experience.get("company") or "").strip(),
                str(experience.get("start") or "").strip(),
            ]
        )
        if not seed.strip("|"):
            raise SpecValidationError("Cannot derive experience id from empty experience payload.")
        return "exp-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]

    def _merge_live_snapshot(self, snapshot: JsonDict, live_payload: JsonDict, *, target_profile: str) -> JsonDict:
        merged = copy.deepcopy(snapshot)
        merged["target_profile"] = target_profile

        headline = str(live_payload.get("headline") or "").strip()
        about = str(live_payload.get("about") or "").strip()

        if headline:
            merged["headline"] = headline
        if about:
            merged["about"] = about
        return merged

    def _diff_summary(self, before: JsonDict, after: JsonDict) -> JsonDict:
        before_skills = [str(skill) for skill in before.get("skills") or []]
        after_skills = [str(skill) for skill in after.get("skills") or []]

        before_skill_keys = {skill.casefold() for skill in before_skills}
        after_skill_keys = {skill.casefold() for skill in after_skills}

        before_exp = {str(item.get("id") or ""): item for item in before.get("experiences") or [] if isinstance(item, dict)}
        after_exp = {str(item.get("id") or ""): item for item in after.get("experiences") or [] if isinstance(item, dict)}

        exp_added = sorted([exp_id for exp_id in after_exp if exp_id not in before_exp])
        exp_removed = sorted([exp_id for exp_id in before_exp if exp_id not in after_exp])
        exp_updated = sorted(
            [
                exp_id
                for exp_id in after_exp
                if exp_id in before_exp and json.dumps(after_exp[exp_id], sort_keys=True) != json.dumps(before_exp[exp_id], sort_keys=True)
            ]
        )

        return {
            "headline_changed": str(before.get("headline") or "") != str(after.get("headline") or ""),
            "about_changed": str(before.get("about") or "") != str(after.get("about") or ""),
            "profile_photo_changed": str(before.get("profile_photo_path") or "") != str(after.get("profile_photo_path") or ""),
            "cover_photo_changed": str(before.get("cover_photo_path") or "") != str(after.get("cover_photo_path") or ""),
            "skills_added": [skill for skill in after_skills if skill.casefold() not in before_skill_keys],
            "skills_removed": [skill for skill in before_skills if skill.casefold() not in after_skill_keys],
            "experiences_added": exp_added,
            "experiences_removed": exp_removed,
            "experiences_updated": exp_updated,
        }
