/**
 * Reading a drop.
 *
 * A directory arrives as a `DataTransferItem` whose entry is a directory; its `getAsFile()` still
 * returns something file-shaped, which is why a naive handler silently uploads a 4 KB nothing.
 * Recursive folder upload is out of scope, so directories are detected and declined by name.
 */

export interface DroppedContent {
  files: File[];
  directoryNames: string[];
}

/** The bit of `FileSystemEntry` this needs, so a test double does not have to implement the rest. */
interface MinimalEntry {
  isDirectory: boolean;
  name: string;
}

interface EntryCapableItem {
  kind: string;
  getAsFile: () => File | null;
  webkitGetAsEntry?: () => MinimalEntry | null;
}

export function readDataTransfer(dataTransfer: DataTransfer): DroppedContent {
  const files: File[] = [];
  const directoryNames: string[] = [];

  const items = dataTransfer.items as DataTransferItemList | undefined;
  if (items !== undefined && items.length > 0) {
    for (const raw of Array.from(items)) {
      const item = raw as unknown as EntryCapableItem;
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.() ?? null;
      const file = item.getAsFile();
      if (entry !== null && entry.isDirectory) {
        directoryNames.push(entry.name);
        continue;
      }
      if (file !== null) files.push(file);
    }
    return { files, directoryNames };
  }

  return { files: Array.from(dataTransfer.files ?? []), directoryNames };
}

/** True when the drag carries files at all — dragging selected text must not raise the overlay. */
export function dragCarriesFiles(dataTransfer: DataTransfer | null): boolean {
  if (dataTransfer === null) return false;
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

export function directoryRejectionMessage(names: string[]): string {
  if (names.length === 1) {
    return `“${names[0] ?? ''}” is a folder. Folders can't be uploaded — open it and drop the files inside.`;
  }
  return `${String(names.length)} folders were skipped. Folders can't be uploaded — open them and drop the files inside.`;
}
