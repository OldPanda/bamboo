/** Match native Windows drive/UNC roots without changing Unix filenames or cloud URLs. */
const windowsRoot = (root: string) =>
  /^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\");

/** Add the native separator to an already canonical workspace root. */
export function workspacePrefix(root: string): string {
  const separator = windowsRoot(root) ? "\\" : "/";
  return root.endsWith(separator) ? root : root + separator;
}

/** Build a native absolute path from the bridge's slash-separated relative entry. */
export function workspacePath(root: string, relative: string): string {
  return (
    workspacePrefix(root) +
    (windowsRoot(root) ? relative.replaceAll("/", "\\") : relative)
  );
}

/** Return the stable slash-separated key used for workspace drafts and SQL tables. */
export function workspaceRelative(root: string, path: string): string {
  const relative = path.slice(workspacePrefix(root).length);
  return windowsRoot(root) ? relative.replaceAll("\\", "/") : relative;
}

/** Compare native Windows paths case-insensitively, retaining Unix/cloud semantics. */
export function workspaceContains(root: string, path: string): boolean {
  const prefix = workspacePrefix(root);
  return windowsRoot(root)
    ? path.toLowerCase().startsWith(prefix.toLowerCase())
    : path.startsWith(prefix);
}
