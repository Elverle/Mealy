---
plans_dir: docs/planning
wiki_dir: docs/wiki

# Git behaviour of /feature-dev's closing phase (optional; these are the defaults)
git:
  auto_commit: true      # true: commit without asking for confirmation
  commit_per_wp: true    # true: also one commit per work package, on a green gate only
  branch_prefix: feature/ # dedicated branch: <branch_prefix><feature-number>-<slug>
  version_bump: ask       # ask | patch | minor | none — before the feature commit

# Platform-specific model configuration (optional)
# Override the default orchestrator, implementer and reviewer models per target platform.
# `reviewer` (used by /feature-review) falls back to `orchestrator` when omitted.
models:
  claude:
    orchestrator: opus
    implementer: sonnet
    reviewer: opus
---

Layout di planning di Mealy: indice e piani feature sotto `docs/planning/`, wiki di progetto sotto `docs/wiki/`. La strategia di esecuzione (mappatura epic → feature e ordine) è in `docs/planning/execution-strategy.md`.
