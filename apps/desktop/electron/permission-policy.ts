export type DeskMediaPermissionInput = {
  permission: string;
  trustedWindow: boolean;
  isMainFrame: boolean;
  requestingUrl: string;
  securityOrigin?: string;
  mediaTypes?: readonly string[];
};

/**
 * Keep media access default-deny while allowing only Desk's explicit audio
 * surfaces. Electron invokes this for both the check and request paths.
 */
export function shouldAllowDeskMediaPermission(input: DeskMediaPermissionInput): boolean {
  if (input.permission !== "media" || !input.trustedWindow || !input.isMainFrame)
    return false;
  if (!/^desk:\/\/app(?:\/|$)/.test(input.requestingUrl)) return false;
  if (input.securityOrigin && input.securityOrigin !== "desk://app") return false;
  return input.mediaTypes?.length === 1 && input.mediaTypes[0] === "audio";
}
