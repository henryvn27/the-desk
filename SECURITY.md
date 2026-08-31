# Security policy

## Supported version

Until the first tagged release, security fixes apply to the current `main` branch.

## Report a vulnerability

Use GitHub's private vulnerability-reporting or Security Advisory flow for this repository. Include the affected commit, impact, reproduction steps, and the smallest safe proof. Do not open a public issue for an unpatched vulnerability and do not send credentials, OAuth sessions, private source documents, or personal study data.

## Security boundaries

- Provider keys are stored in the Mac Keychain and are never synced through CloudKit.
- Python connector commands are typed and bounded; CloudKit never carries arbitrary executable code.
- Codex and NotebookLM runtimes are resolved through pinned or explicit absolute paths rather than an arbitrary executable from `PATH`.
- Manual AI-provider selection fails closed.
- Screen and audio capture require explicit user activation.
- Calendar and Reminder edits are limited to approved or linked identifiers.

This is an early local-first project, not a hosted multi-user service. A public build should be reviewed and signed by its builder before it is trusted with sensitive material.
