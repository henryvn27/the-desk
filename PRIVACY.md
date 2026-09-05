# Privacy model

The Electron V1 rebuild currently stores classes, tasks, notes and study-session records in a local SQLite database. Its separate development identity does not open the prototype's data. The local outbox records pending changes; remote sync is not implemented.

Lens captures one still image only after the explicit Capture this screen action and only with screen permission. The image remains in interaction memory and is cleared when Lens closes. After a provider is configured, Ask sends the question and active-task context to OpenAI. The captured image is included only when the student checks the explicit share option. Follow-up history remains bounded and local to the Lens interaction. No microphone or screen permission is granted automatically. Opening an HTTPS resource sends the user to their normal browser.

The V1 product contract requires explicit screen-capture activation, progressive connector permissions, inspectable memory, export/deletion, and no parent surveillance or academic submission. Those requirements are release gates, not claims that all are implemented.

Report privacy concerns through a private repository security advisory. Never include private academic content or credentials in public reports.
