export const MAX_SELECTION_TEXT = 20_000;
export const MAX_VISIBLE_TEXT = 40_000;
export const MAX_TITLE = 300;

export interface CapturedPage {
  url: string;
  title: string;
  selectionText: string;
  visibleText: string;
}

export interface CaptureSource {
  url: string;
  title: string;
  selectionText?: string;
  visibleText?: string;
}

/** Normalize page text without attempting to interpret or execute it. */
export function boundedText(value: string, maxLength: number): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

export function captureDocumentSnapshot(source: CaptureSource): CapturedPage {
  return {
    url: source.url.trim(),
    title: boundedText(source.title, MAX_TITLE),
    selectionText: boundedText(source.selectionText ?? "", MAX_SELECTION_TEXT),
    visibleText: boundedText(source.visibleText ?? "", MAX_VISIBLE_TEXT),
  };
}

/**
 * This fixed function is injected for one user-requested capture through
 * activeTab. It reads only the current URL, title, selection, and rendered
 * body text. Keep it self-contained: Chrome serializes the function body when
 * executeScript runs it in the page.
 */
export function capturePage(): CapturedPage {
  const bound = (value: string, maxLength: number): string =>
    value
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);

  const selectionText = (() => {
    try {
      return window.getSelection()?.toString() ?? "";
    } catch {
      return "";
    }
  })();
  const visibleText = (() => {
    try {
      return document.body?.innerText ?? "";
    } catch {
      return "";
    }
  })();

  return {
    url: window.location.href.trim(),
    title: bound(document.title ?? "", 300),
    selectionText: bound(selectionText, 20_000),
    visibleText: bound(visibleText, 40_000),
  };
}

export function adapterForUrl(value: string):
  | "generic"
  | "khan"
  | "quizlet"
  | "classroom"
  | "drive"
  | "docs" {
  const hostname = (() => {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (hostname === "classroom.google.com") return "classroom";
  if (hostname === "drive.google.com") return "drive";
  if (hostname === "docs.google.com") return "docs";
  if (hostname === "quizlet.com" || hostname.endsWith(".quizlet.com")) {
    return "quizlet";
  }
  if (
    hostname === "khanacademy.org" ||
    hostname.endsWith(".khanacademy.org")
  ) {
    return "khan";
  }
  return "generic";
}

export function browserForUserAgent(userAgent: string): "chrome" | "edge" {
  return /Edg\//i.test(userAgent) ? "edge" : "chrome";
}
