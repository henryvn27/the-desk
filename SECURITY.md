# Security policy

Report vulnerabilities through GitHub private vulnerability reporting or a private Security Advisory. Include the commit, impact, and smallest safe reproduction. Do not publish credentials or personal academic content.

The V1 renderer is sandboxed with context isolation and no Node integration. Main validates IPC sender/frame and Zod command payloads. External resources open only as HTTPS links in the system browser. Local storage migrations are explicit and reject unknown future versions.

This branch is not release-audited. OAuth, sync, provider credentials, extension permissions and all newly added privileged capabilities require review before release. No security or privacy release gate is currently marked passed.
