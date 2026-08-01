type ClipboardRepresentations = Readonly<Record<string, Blob | Promise<Blob>>>;
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

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

export async function richCardHtmlBlob(
  image: Blob | Promise<Blob>,
  information: string,
  cardName: string,
): Promise<Blob> {
  const imageUrl = await blobToDataUrl(await image);
  const html = [
    '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">',
    `<img src="${imageUrl}" alt="${escapeHtml(cardName)}" style="display:block;width:280px;max-width:100%;height:auto">`,
    `<div style="white-space:pre-wrap;font-family:system-ui,sans-serif;line-height:1.5">${escapeHtml(information).replaceAll("\n", "<br>")}</div>`,
    "</div>",
  ].join("");
  return new Blob([html], { type: "text/html" });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `data:${blob.type};base64,${btoa(chunks.join(""))}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => HTML_ENTITIES[character]);
}
