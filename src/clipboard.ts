export type ClipboardRepresentations = Readonly<Record<string, Blob | Promise<Blob>>>;

export function supportsClipboardTypes(...types: string[]): boolean {
  return (
    window.isSecureContext &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined" &&
    (typeof ClipboardItem.supports !== "function" || types.every((type) => ClipboardItem.supports(type)))
  );
}

export function writeClipboardRepresentations(representations: ClipboardRepresentations): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem(representations)]);
}

export function textBlob(text: string): Blob {
  return new Blob([text], { type: "text/plain" });
}
