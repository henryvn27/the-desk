export type ConnectionSurface =
  | "full-sync"
  | "browser-assisted"
  | "browser-context"
  | "manual-fallback"
  | "experimental";

export type ConnectionState = "available" | "not-connected" | "unavailable";

export type ConnectionCapability = {
  id: string;
  name: string;
  surface: ConnectionSurface;
  state: ConnectionState;
  summary: string;
  fallback: string;
};

const capabilities: ConnectionCapability[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    surface: "full-sync",
    state: "not-connected",
    summary: "Official calendar sync is declared, but no account is connected.",
    fallback: "Use Capture or add a task manually.",
  },
  {
    id: "gmail",
    name: "Gmail",
    surface: "full-sync",
    state: "not-connected",
    summary: "Progressive school-mail monitoring is planned; inbox access is off.",
    fallback: "Paste a message into Capture. Desk never sends mail automatically.",
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    surface: "browser-assisted",
    state: "unavailable",
    summary: "No Classroom API or browser extension is connected in this build.",
    fallback: "Open Classroom yourself and use Capture for visible work.",
  },
  {
    id: "google-drive",
    name: "Google Drive / Docs",
    surface: "full-sync",
    state: "not-connected",
    summary: "Official Drive access is declared, but no account is connected.",
    fallback: "Import supported text files or paste the relevant content.",
  },
  {
    id: "khan-academy",
    name: "Khan Academy",
    surface: "browser-context",
    state: "unavailable",
    summary: "No browser page adapter is connected in this build.",
    fallback: "Save the page URL or capture visible instructions manually.",
  },
  {
    id: "quizlet",
    name: "Quizlet",
    surface: "browser-context",
    state: "unavailable",
    summary: "No browser page adapter is connected in this build.",
    fallback: "Save the page URL or capture visible study material manually.",
  },
  {
    id: "generic-web",
    name: "Generic websites",
    surface: "manual-fallback",
    state: "available",
    summary: "Desk can keep a user-provided HTTPS resource with a task.",
    fallback: "Ask Desk to open the saved resource during a session.",
  },
  {
    id: "gemini-notebook",
    name: "Gemini Notebook / NotebookLM",
    surface: "experimental",
    state: "unavailable",
    summary: "This replaceable experimental surface is not connected.",
    fallback: "Keep source text in Desk or use supported local capture.",
  },
];

export function connectionCapabilities(): ConnectionCapability[] {
  return capabilities.map((capability) => ({ ...capability }));
}
