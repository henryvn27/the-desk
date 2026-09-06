import { z } from "zod";

const browserId = z.enum(["chrome", "edge"]);
const httpUrl = z
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Browser context must use an HTTP(S) URL.");

/**
 * The extension sends page context as untrusted data. It never sends a
 * command, a credential, or a request to execute code in the page.
 */
export const browserPageContext = z
  .object({
    browser: browserId,
    tabId: z.string().trim().min(1).max(200),
    url: httpUrl,
    title: z.string().trim().max(300),
    selectionText: z.string().max(20_000).default(""),
    visibleText: z.string().max(40_000).default(""),
    capturedAt: z.iso.datetime(),
    adapter: z
      .enum(["generic", "khan", "quizlet", "classroom", "drive", "docs"])
      .default("generic"),
  })
  .strict();
export type BrowserPageContext = z.infer<typeof browserPageContext>;

export const browserBridgeMessage = z
  .object({
    version: z.literal(1),
    requestId: z.string().uuid(),
    type: z.literal("page-context"),
    context: browserPageContext,
  })
  .strict();
export type BrowserBridgeMessage = z.infer<typeof browserBridgeMessage>;

/** Parse once at the trusted boundary before page data reaches Lens or Desk. */
export function parseBrowserBridgeMessage(
  value: unknown,
): BrowserBridgeMessage {
  return browserBridgeMessage.parse(value);
}

/**
 * Keep only useful page evidence when building Lens context. The page URL and
 * title are always retained; selection/visible text stay bounded by the
 * schema and remain explicitly user-provided evidence.
 */
export function browserContextForLens(
  message: BrowserBridgeMessage,
): string {
  const context = browserPageContext.parse(message.context);
  const parts = [
    `Browser: ${context.browser}`,
    `Page title: ${context.title || "(untitled)"}`,
    `Page URL: ${context.url}`,
  ];
  if (context.selectionText) parts.push(`Selected text:\n${context.selectionText}`);
  if (context.visibleText) parts.push(`Visible page text:\n${context.visibleText}`);
  return parts.join("\n\n");
}
