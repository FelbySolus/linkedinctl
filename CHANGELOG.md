# Changelog

## v0.0.1 - 2026-04-10

Initial public release of `linkedinctl`.

### Added
- Strict JSON contract validation with fail-closed behavior.
- Type-safe Python engine and Patchwright adapter.
- Headless live profile mutation support for:
  - `set_headline`
  - `set_about`
  - `set_profile_photo`
  - `set_cover_photo`
- Deterministic cover renderer with safe-zone text placement controls.
- Dedicated cover debug probe and maintenance skill docs.

### Security and Hygiene
- Personal runtime/session data removed from repository.
- Runtime artifacts and browser profile data excluded from VCS.
- State outputs routed to purgeable `state/` paths.

### Quality
- TypeScript build and Python unit tests passing.
- CLI surfaces validated (`readiness`, `pull`, `plan`, `apply`, `verify`).
