from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .lib.contracts import load_spec
from .lib.banner_render import (
    DEFAULT_HEIGHT,
    DEFAULT_WIDTH,
    CoverRenderSpec,
    render_cover,
)
from .lib.engine import LinkedInProfileEngine
from .lib.errors import LinkedInCtlError
from .lib.runtime_paths import DEFAULT_USER_DATA_DIR, resolve_user_data_dir
from .lib.types import JsonDict


def _emit(as_json: bool, payload: JsonDict, *, exit_code: int = 0) -> int:
    if as_json:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")
    else:
        for key, value in payload.items():
            sys.stdout.write(f"{key}: {value}\n")
    if exit_code == 0 and payload.get("ok") is False:
        return 2
    return exit_code


def _add_browser_args(parser: argparse.ArgumentParser, *, include_live: bool, default_headless: bool) -> None:
    if include_live:
        parser.add_argument("--live", action="store_true")

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--headless", dest="headless", action="store_true", default=default_headless)
    mode.add_argument("--headed", dest="headless", action="store_false")

    artifacts = parser.add_mutually_exclusive_group()
    artifacts.add_argument("--keep-run-artifacts", dest="retain_run_artifacts", action="store_true")
    artifacts.add_argument("--purge-run-artifacts", dest="retain_run_artifacts", action="store_false")
    parser.set_defaults(retain_run_artifacts=False)

    parser.add_argument("--timeout-ms", type=int, default=30000)
    parser.add_argument("--user-data-dir", default=DEFAULT_USER_DATA_DIR)
    parser.add_argument("--target-profile-url", default="")
    parser.add_argument("--locale", default="en-US")
    parser.add_argument("--node-bin", default="node")
    parser.add_argument("--npm-bin", default="npm")


def _browser_kwargs(args: argparse.Namespace) -> JsonDict:
    return {
        "headless": bool(args.headless),
        "timeout_ms": int(args.timeout_ms),
        "retain_run_artifacts": bool(args.retain_run_artifacts),
        "user_data_dir": resolve_user_data_dir(str(args.user_data_dir)),
        "target_profile_url": str(args.target_profile_url),
        "locale": str(args.locale),
        "node_bin": str(args.node_bin),
        "npm_bin": str(args.npm_bin),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LinkedIn JSON automation CLI")
    parser.add_argument("--workspace-root", default=str(Path.cwd()))

    sub = parser.add_subparsers(dest="command", required=True)

    readiness = sub.add_parser("readiness", help="Check local state and optional live adapter readiness.")
    _add_browser_args(readiness, include_live=True, default_headless=True)
    readiness.add_argument("--json", action="store_true")

    auth = sub.add_parser("auth", help="Authentication and session setup")
    auth_sub = auth.add_subparsers(dest="auth_command", required=True)

    login = auth_sub.add_parser("login", help="Open LinkedIn login flow and persist browser session")
    _add_browser_args(login, include_live=False, default_headless=False)
    login.add_argument("--login-wait-ms", type=int, default=300000)
    login.add_argument("--json", action="store_true")

    profile = sub.add_parser("profile", help="Profile operations")
    profile_sub = profile.add_subparsers(dest="profile_command", required=True)

    pull = profile_sub.add_parser("pull", help="Read current profile snapshot")
    pull.add_argument("--target-profile", default="self")
    pull.add_argument("--output", default="")
    _add_browser_args(pull, include_live=True, default_headless=True)
    pull.add_argument("--json", action="store_true")

    plan = profile_sub.add_parser("plan", help="Preview a JSON spec without persisting profile changes")
    plan.add_argument("--spec", type=Path, required=True)
    plan.add_argument("--json", action="store_true")

    apply_cmd = profile_sub.add_parser("apply", help="Apply a JSON spec to profile snapshot and optional live surface")
    apply_cmd.add_argument("--spec", type=Path, required=True)
    _add_browser_args(apply_cmd, include_live=True, default_headless=True)
    apply_cmd.add_argument("--json", action="store_true")

    verify = profile_sub.add_parser("verify", help="Re-read and hash current snapshot")
    verify.add_argument("--target-profile", default="self")
    _add_browser_args(verify, include_live=True, default_headless=True)
    verify.add_argument("--json", action="store_true")

    assets = sub.add_parser("assets", help="Asset generation helpers")
    assets_sub = assets.add_subparsers(dest="assets_command", required=True)

    render = assets_sub.add_parser("render-cover", help="Render a controlled LinkedIn cover image.")
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--title", required=True)
    render.add_argument("--subtitle", default="")
    render.add_argument("--bg-color", default="#000000")
    render.add_argument("--text-color", default="#FFFFFF")
    render.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    render.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    render.add_argument("--safe-zone-left", type=int, default=320)
    render.add_argument("--title-x", type=int, default=360)
    render.add_argument("--title-y", type=int, default=118)
    render.add_argument("--title-size", type=int, default=56)
    render.add_argument("--subtitle-x", type=int, default=360)
    render.add_argument("--subtitle-y", type=int, default=202)
    render.add_argument("--subtitle-size", type=int, default=24)
    render.add_argument("--max-text-width", type=int, default=1120)
    render.add_argument("--font-path", default="")
    render.add_argument("--json", action="store_true")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    engine = LinkedInProfileEngine(workspace_root=args.workspace_root)

    try:
        if args.command == "readiness":
            payload = engine.readiness(live=bool(args.live), **_browser_kwargs(args))
            return _emit(args.json, payload)

        if args.command == "auth" and args.auth_command == "login":
            payload = engine.login(login_wait_ms=int(args.login_wait_ms), **_browser_kwargs(args))
            return _emit(args.json, payload)

        if args.command == "profile":
            if args.profile_command == "pull":
                payload = engine.pull(
                    target_profile=args.target_profile,
                    live=bool(args.live),
                    **_browser_kwargs(args),
                )
                output_path = str(args.output or "").strip()
                if output_path:
                    out = Path(output_path)
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_text(json.dumps(payload["snapshot"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    payload["output"] = str(out)
                return _emit(args.json, payload)

            if args.profile_command == "plan":
                spec = load_spec(args.spec)
                return _emit(args.json, engine.plan(spec))

            if args.profile_command == "apply":
                spec = load_spec(args.spec)
                payload = engine.apply(spec, live=bool(args.live), **_browser_kwargs(args))
                return _emit(args.json, payload)

            if args.profile_command == "verify":
                payload = engine.verify(
                    target_profile=args.target_profile,
                    live=bool(args.live),
                    **_browser_kwargs(args),
                )
                return _emit(args.json, payload)

        if args.command == "assets" and args.assets_command == "render-cover":
            payload = render_cover(
                CoverRenderSpec(
                    output=Path(args.output),
                    title=str(args.title),
                    subtitle=str(args.subtitle),
                    bg_color=str(args.bg_color),
                    text_color=str(args.text_color),
                    width=int(args.width),
                    height=int(args.height),
                    safe_zone_left=int(args.safe_zone_left),
                    title_x=int(args.title_x),
                    title_y=int(args.title_y),
                    title_size=int(args.title_size),
                    subtitle_x=int(args.subtitle_x),
                    subtitle_y=int(args.subtitle_y),
                    subtitle_size=int(args.subtitle_size),
                    max_text_width=int(args.max_text_width),
                    font_path=str(args.font_path),
                )
            )
            return _emit(args.json, payload)

        raise LinkedInCtlError(f"Unhandled command: {args.command}")
    except Exception as exc:
        if getattr(args, "json", False):
            return _emit(True, {"ok": False, "error": str(exc)}, exit_code=2)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
