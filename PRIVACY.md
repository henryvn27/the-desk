# Privacy model

The Desk is designed as a local-first personal study app. The Mac is the only AI execution host. This document describes the intended source behavior; a self-built copy can be changed by its builder.

## Stored locally

- Provider credentials stay in the Mac Keychain.
- Original source files, extracted text, local search indexes, provider-run records, and temporary screen captures stay on the Mac unless the user chooses a connector or private iCloud sync.
- One-time Study Buddy screenshots are not retained by default.
- Logs should never contain credentials or full source documents.

## Private iCloud sync

The iPhone and iPad companion use the user's private CloudKit database for typed capture jobs, approved artifact metadata, and bounded assets. Provider keys and Codex sessions are not placed in CloudKit. A build without the matching signed CloudKit entitlement remains local and queues companion work instead of crashing.

## AI providers

The Desk sends only the passages needed for the selected task to the chosen AI provider. The result identifies the provider and model. Class citations, connector citations, web citations, and uncited model knowledge are kept distinct. A manual provider choice fails closed instead of silently switching.

Each external provider processes data under its own terms. Do not connect a provider if its data policy is inappropriate for the material being studied.

## Connectors

- Apple Reminders and Calendar access is limited to user-approved or explicitly linked items.
- Google Classroom and Wispr Flow are read-only boundaries in the current source; live adapters require separate configuration.
- NotebookLM is optional, unofficial, and non-canonical. Sources are mirrored only when the user asks.
- Khan Academy support stores links and manual check-ins; it does not scrape learner activity or automate answers.

## Capture permissions

Screen, camera, microphone, speech recognition, calendar, and reminder access are requested only for the feature the user starts. Study Buddy never captures a screen before explicit activation and never clicks, types, or submits work.

## Reporting a concern

Please use a private GitHub Security Advisory for a security or privacy issue. Do not include real credentials, private study material, or sensitive screenshots in a public issue.
