/**
 * The handful of places this app leaves the SPA, behind one module.
 *
 * OAuth is a full-page redirect and a download is a browser navigation, so both must touch
 * `window.location` — isolating them here keeps that untestable surface to one file that tests
 * replace wholesale, instead of scattering jsdom-hostile calls through components.
 */

export function assignLocation(url: string): void {
  window.location.assign(url);
}

export function reloadPage(): void {
  window.location.reload();
}

/** Copies to the clipboard, reporting whether it worked so the UI can say so where the click was. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Triggers a save dialog for an already-fetched blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
