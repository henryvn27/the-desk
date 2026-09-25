# The Desk agent workflow

## Canonical work ledger

- GitHub Issues and the [The Desk GitHub Project](https://github.com/users/henryvn27/projects/15) are the source of truth for active engineering work. Linear IDs and URLs are historical provenance only; resolve them through the private migration ID map when needed.
- Before starting, read this file and the repository's current architecture, hardening, verification, and release guidance. Check the active branch and worktree, the linked issue, Project status, and issue dependencies.
- Work one implementation issue at a time. Keep one active issue and no more than three next issues queued when the current hardening protocol calls for that limit.
- Claim work in the GitHub Project, confirm blockers are resolved, and use an issue-scoped branch or worktree. The existing `codex/desk-v1-electron` branch remains the V1 Electron lane when that scope is active; verify the remote ref before checking it out.

## Implementation and review

- Keep changes within the issue's scope and acceptance criteria. Preserve the local-first product boundary, existing release gates, and current branch protections.
- Push only coherent, verified commits. Open or update a pull request that links the issue and records the branch, exact commit SHA, checks, blockers, and residual risk.
- Keep the reviewer → implementation → reviewer loop. The reviewer must inspect the exact PR head and verification evidence; implementation agents do not approve their own changes where independent review is required.
- A green build or merged PR alone does not prove every acceptance criterion. Move work to Review / Verify, then close it only when the issue's criteria and required verification pass. Never claim deployed, submitted, or otherwise external behavior without matching evidence.
- Never force-push, push directly to protected `main`, bypass required reviews or checks, weaken tests, or claim Done without verification.
