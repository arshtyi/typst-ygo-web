import { $typst, TypstSnippet } from "@myriaddreamin/typst.ts/contrib/snippet";
import compilerWasmUrl from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasmUrl from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";
import type { AssetManifest, CardKind, RawCard, RenderFormat } from "./types";

const MAIN_FILE_PATH = "/runtime/main.typ";
const SELECTED_CARD_PATH = "/runtime/selected-card.json";
const MAX_MAPPED_IMAGES = 6;
const PNG_EXPORT_PPI = 600;
const PNG_EXPORT_PIXEL_PER_POINT = PNG_EXPORT_PPI / 72;
const CARD_IMAGE_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_IMAGE_PROXY_TEMPLATE = "https://images.weserv.nl/?url={url}";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const textEncoder = new TextEncoder();

let runtimeConfigured = false;
let sourceFilesLoaded = false;
const loadedStaticKinds = new Set<CardKind>();
const mappedImagePaths: string[] = [];

export async function renderCardSvg(manifest: AssetManifest, kind: CardKind, card: RawCard): Promise<string> {
  await prepareDocument(manifest, kind, card);
  return await $typst.svg({
    mainFilePath: MAIN_FILE_PATH,
    root: "/",
    data_selection: {
      body: true,
      defs: true,
      css: true,
      js: false,
    },
  });
}

export async function renderCardPdf(manifest: AssetManifest, kind: CardKind, card: RawCard): Promise<Uint8Array> {
  await prepareDocument(manifest, kind, card);
  const pdf = await $typst.pdf({ mainFilePath: MAIN_FILE_PATH, root: "/" });
  if (!pdf) {
    throw new Error("Typst did not return PDF data.");
  }
  return pdf;
}

export async function renderCardPng(manifest: AssetManifest, kind: CardKind, card: RawCard): Promise<Uint8Array> {
  await prepareDocument(manifest, kind, card);

  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    height: "0",
    left: "-10000px",
    overflow: "hidden",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: "1000px",
  });
  document.body.append(container);

  try {
    await $typst.canvas(container, {
      mainFilePath: MAIN_FILE_PATH,
      root: "/",
      backgroundColor: "#ffffff",
      pixelPerPt: PNG_EXPORT_PIXEL_PER_POINT,
    });

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Typst did not render a PNG canvas.");
    }

    return setPngPpi(await canvasToPngBytes(canvas), PNG_EXPORT_PPI);
  } finally {
    container.remove();
  }
}

async function prepareDocument(manifest: AssetManifest, kind: CardKind, card: RawCard): Promise<void> {
  configureRuntime(manifest);
  await loadTypstSources(manifest);
  await loadStaticAssets(manifest, kind);
  await loadCardImage(kind, card);

  const rendererName = kind === "ot" ? "ot_card" : "rd_card";
  const mainContent = [
    `#import "/lib/mod.typ": ${rendererName}`,
    `#let card = json("${SELECTED_CARD_PATH}")`,
    `#${rendererName}(card)`,
    "",
  ].join("\n");

  await $typst.mapShadow(SELECTED_CARD_PATH, textEncoder.encode(JSON.stringify(card)));
  await $typst.addSource(MAIN_FILE_PATH, mainContent);
}

function configureRuntime(manifest: AssetManifest): void {
  if (runtimeConfigured) {
    return;
  }

  $typst.setCompilerInitOptions({
    getModule: () => compilerWasmUrl,
  });
  $typst.setRendererInitOptions({
    getModule: () => rendererWasmUrl,
  });

  const fontFiles = manifest.staticAssetFiles.filter((file) => /\/font\/.+\.(ttf|otf)$/iu.test(file));
  for (const fontFile of fontFiles) {
    $typst.use(TypstSnippet.preloadFontFromUrl(publicUrl(fontFile)));
  }

  runtimeConfigured = true;
}

async function loadTypstSources(manifest: AssetManifest): Promise<void> {
  if (sourceFilesLoaded) {
    return;
  }

  for (const file of manifest.typstLibFiles) {
    const content = await fetchText(file);
    await $typst.addSource(`/${file.replace(/^typst-ygo\//u, "")}`, content);
  }

  sourceFilesLoaded = true;
}

async function loadStaticAssets(manifest: AssetManifest, kind: CardKind): Promise<void> {
  if (loadedStaticKinds.has(kind)) {
    return;
  }

  const files = manifest.staticAssetFiles.filter((file) => file.startsWith(`assets/${kind}/`));
  for (const file of files) {
    const data = await fetchBytes(file);
    await $typst.mapShadow(`/${file}`, data);
  }

  loadedStaticKinds.add(kind);
}

async function loadCardImage(kind: CardKind, card: RawCard): Promise<void> {
  const imageId = Number(card.image);
  if (!Number.isSafeInteger(imageId) || imageId <= 0) {
    throw new Error(`Card ${card.id} has invalid image id: ${String(card.image)}`);
  }

  const shadowPath = `/assets/${kind}/images/${imageId}.jpg`;
  if (mappedImagePaths.includes(shadowPath)) {
    return;
  }

  const imageUrl = `https://images.ygoprodeck.com/images/cards_cropped/${imageId}.jpg`;
  const imageBytes = await fetchCardImageBytes(imageUrl);
  await $typst.mapShadow(shadowPath, imageBytes);
  mappedImagePaths.push(shadowPath);

  while (mappedImagePaths.length > MAX_MAPPED_IMAGES) {
    const stalePath = mappedImagePaths.shift();
    if (stalePath) {
      await $typst.unmapShadow(stalePath);
    }
  }
}

async function fetchCardImageBytes(sourceUrl: string): Promise<Uint8Array> {
  const candidates = [proxiedImageUrl(sourceUrl), sourceUrl];
  let lastError = "";

  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, CARD_IMAGE_FETCH_TIMEOUT_MS);
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`;
        continue;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`Image download failed from CORS proxy and source: ${lastError}`);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function proxiedImageUrl(sourceUrl: string): string {
  const template = import.meta.env.VITE_IMAGE_PROXY_TEMPLATE || DEFAULT_IMAGE_PROXY_TEMPLATE;
  return template.replace("{url}", encodeURIComponent(sourceUrl.replace(/^https?:\/\//u, "")));
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(publicUrl(path));
  if (!response.ok) {
    throw new Error(`Resource missing: ${path}`);
  }
  return await response.text();
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(publicUrl(path));
  if (!response.ok) {
    throw new Error(`Resource missing: ${path}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Canvas PNG encoding failed."));
      }
    }, "image/png");
  });

  return new Uint8Array(await blob.arrayBuffer());
}

function setPngPpi(png: Uint8Array, ppi: number): Uint8Array {
  if (!isPng(png)) {
    throw new Error("Canvas did not return valid PNG data.");
  }

  const pixelsPerMeter = Math.round(ppi / 0.0254);
  const physData = new Uint8Array(9);
  const view = new DataView(physData.buffer);
  view.setUint32(0, pixelsPerMeter, false);
  view.setUint32(4, pixelsPerMeter, false);
  physData[8] = 1;

  const physChunk = createPngChunk("pHYs", physData);
  const chunks: Uint8Array[] = [png.slice(0, PNG_SIGNATURE.length)];
  let offset: number = PNG_SIGNATURE.length;
  let insertedPhys = false;
  let sawIhdr = false;

  while (offset < png.length) {
    if (offset + 12 > png.length) {
      throw new Error("PNG data ended inside a chunk header.");
    }

    const length = readUint32(png, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + length + 4;
    if (chunkEnd > png.length) {
      throw new Error("PNG chunk length exceeds file size.");
    }

    const type = String.fromCharCode(png[typeOffset], png[typeOffset + 1], png[typeOffset + 2], png[typeOffset + 3]);
    if (type === "pHYs") {
      if (!insertedPhys) {
        chunks.push(physChunk);
        insertedPhys = true;
      }
    } else {
      chunks.push(png.slice(offset, chunkEnd));
      if (type === "IHDR") {
        sawIhdr = true;
        if (!insertedPhys) {
          chunks.push(physChunk);
          insertedPhys = true;
        }
      }
    }

    offset = chunkEnd;
    if (type === "IEND") {
      break;
    }
  }

  if (!sawIhdr) {
    throw new Error("PNG data is missing IHDR.");
  }

  return concatBytes(chunks);
}

function isPng(data: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  view.setUint32(data.length + 8, crc32(chunk.subarray(4, data.length + 8)), false);
  return chunk;
}

function readUint32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (crc32Table) {
    return crc32Table;
  }

  crc32Table = new Uint32Array(256);
  for (let index = 0; index < crc32Table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crc32Table[index] = value >>> 0;
  }
  return crc32Table;
}

function publicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/u, "")}`;
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  const data = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(data).set(bytes);
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function extensionForFormat(format: RenderFormat): string {
  if (format === "pdf") {
    return "pdf";
  }
  return format === "png" ? "png" : "svg";
}
