# Roadmap

## Current: Phase 1 (official Codex only)

- Centralized clone manager for Codex.
- Isolated auth/session/runtime per clone.
- TUI and CLI management.
- Safety hardening (validation, confinement, locking, rollback).

## Next: Phase 2 (provider extensibility)

Planned direction:

1. Provider abstraction layer
   - Runtime provider interface
   - Provider-specific credential strategy
   - Provider capability metadata
2. Provider-aware clone templates
   - Create clone against selected provider
   - Provider defaults in wizard
3. Provider diagnostics
   - Provider-specific health checks and auth detection
4. Migration plan
   - Existing Codex clones remain first-class
   - Non-breaking migration path for registry schema changes

Constraints:

- Keep current Codex flow stable as default.
- Preserve centralized clone storage and safety controls.
- Keep TUI screen model consistent across providers.
