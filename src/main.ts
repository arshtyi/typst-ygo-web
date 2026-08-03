import "./styles.css";
import { formatCardInformation } from "./cardInfo";
import {
  richCardHtmlBlob,
  supportsClipboardTypes,
  textBlob,
  writeClipboardRepresentations,
} from "./clipboard";
import { bytesToBlob, downloadBytes } from "./files";
import { indexCards, searchCards } from "./search";
import {
  DEFAULT_CARD_RENDER_OPTIONS,
  preloadCardResources,
  renderCardPng,
  renderCardSvg,
} from "./typstRenderer";
import type { AssetManifest, CardKind, CardRenderOptions, IndexedCard, RawCard } from "./types";

type KindFilter = CardKind | "all";
type CopyMode = "image" | "image-and-information";
const PNG_MIME_TYPE = "image/png";
const HTML_MIME_TYPE = "text/html";
const TEXT_MIME_TYPE = "text/plain";

type UrlState = {
  kind: KindFilter;
  query: string;
  cardId: number | null;
  compressDescription: boolean;
  drawPassword: boolean;
  fullwidthSlash: boolean;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root.");
}

app.innerHTML = `
  <main class="app-shell">
    <section class="search-pane" aria-label="card search">
      <header class="topbar">
        <h1>typst-ygo web</h1>
        <div id="resourceStatus" class="resource-status loading" aria-live="polite">
          <span id="resourceSummary">loading cards...</span>
        </div>
      </header>

      <div class="search-controls">
        <input
          id="searchInput"
          type="search"
          autocomplete="off"
          placeholder="search by id, name, or card text"
          aria-label="search cards"
          disabled
        />
        <div class="segmented" aria-label="card format">
          <button class="active" type="button" data-kind="all" disabled>all</button>
          <button type="button" data-kind="ot" disabled>ot</button>
          <button type="button" data-kind="rd" disabled>rd</button>
        </div>
      </div>

      <div id="status" class="status" role="status">loading the card library...</div>
      <div id="results" class="results" role="listbox" aria-label="search results"></div>
    </section>

    <section class="preview-pane" aria-label="card preview">
      <div class="preview-toolbar">
        <div id="selection" class="selection">no card selected</div>
        <div class="preview-controls">
          <div class="render-options" role="group" aria-label="card rendering options">
            <label class="render-option">
              <input id="compressDescriptionInput" type="checkbox" role="switch" checked disabled />
              <span>compact card text</span>
            </label>
            <label class="render-option">
              <input id="drawPasswordInput" type="checkbox" role="switch" checked disabled />
              <span>show passcode</span>
            </label>
            <label class="render-option">
              <input id="fullwidthSlashInput" type="checkbox" role="switch" disabled />
              <span>full-width type slashes</span>
            </label>
          </div>
          <div class="actions">
            <button id="randomButton" type="button" disabled>random card</button>
            <button id="copyImageButton" type="button" disabled>copy image</button>
            <button id="copyCardButton" type="button" disabled>copy card + info</button>
            <button id="downloadButton" type="button" disabled>download png</button>
          </div>
        </div>
      </div>
      <div id="preview" class="preview">
        <div class="preview-empty">search for a card to get started.</div>
      </div>
    </section>
  </main>
`;

const searchInput = getElement<HTMLInputElement>("searchInput");
const resourceStatus = getElement<HTMLDivElement>("resourceStatus");
const resourceSummary = getElement<HTMLSpanElement>("resourceSummary");
const statusNode = getElement<HTMLDivElement>("status");
const resultsNode = getElement<HTMLDivElement>("results");
const selectionNode = getElement<HTMLDivElement>("selection");
const copyImageButton = getElement<HTMLButtonElement>("copyImageButton");
const copyCardButton = getElement<HTMLButtonElement>("copyCardButton");
const downloadButton = getElement<HTMLButtonElement>("downloadButton");
const randomButton = getElement<HTMLButtonElement>("randomButton");
const compressDescriptionInput = getElement<HTMLInputElement>("compressDescriptionInput");
const drawPasswordInput = getElement<HTMLInputElement>("drawPasswordInput");
const fullwidthSlashInput = getElement<HTMLInputElement>("fullwidthSlashInput");
const previewNode = getElement<HTMLDivElement>("preview");
const kindButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-kind]"));
const renderOptionInputs = [compressDescriptionInput, drawPasswordInput, fullwidthSlashInput];
const imageClipboardAvailable = supportsClipboardTypes(PNG_MIME_TYPE);
const cardClipboardAvailable = supportsClipboardTypes(HTML_MIME_TYPE, TEXT_MIME_TYPE);

if (!imageClipboardAvailable) {
  copyImageButton.title = "copying images requires a supported browser over https.";
}
if (!cardClipboardAvailable) {
  copyCardButton.title = "copying images with card information requires a supported browser over https.";
}

let manifest: AssetManifest | null = null;
let allCards: IndexedCard[] = [];
let selected: IndexedCard | null = null;
let kindFilter: KindFilter = "all";
let searchTimer: number | null = null;
let cardLibraryAvailable = false;

void initialize();

searchInput.addEventListener("input", () => {
  clearSearchTimer();
  searchTimer = window.setTimeout(() => {
    searchTimer = null;
    renderSearchResults();
  }, 120);
});

for (const button of kindButtons) {
  button.addEventListener("click", () => {
    setKindFilter(parseKindFilter(button.dataset.kind ?? ""));
    renderSearchResults();
  });
}

randomButton.addEventListener("click", () => {
  void selectRandomCard();
});

copyImageButton.addEventListener("click", () => {
  void copySelectedCard("image");
});

copyCardButton.addEventListener("click", () => {
  void copySelectedCard("image-and-information");
});

downloadButton.addEventListener("click", () => {
  void downloadSelectedCard();
});

for (const input of renderOptionInputs) {
  input.addEventListener("change", () => {
    updateUrlState();
    if (selected && manifest) {
      void renderSelectedCard("preview updated.");
    }
  });
}

async function initialize(): Promise<void> {
  try {
    manifest = await fetchJson<AssetManifest>("asset-manifest.json");
    const [otCards, rdCards] = await Promise.all([
      fetchJson<RawCard[]>("cards/ot.json"),
      fetchJson<RawCard[]>("cards/rd.json"),
    ]);

    allCards = [...indexCards("ot", otCards), ...indexCards("rd", rdCards)];
    cardLibraryAvailable = true;
    renderResourceStatus(otCards.length, rdCards.length);
    setBusy(false);
    await applyUrlState(readUrlState());
  } catch (error) {
    console.error("Failed to load the card library.", error);
    cardLibraryAvailable = false;
    setBusy(false);
    setStatus("we couldn't load the card library. refresh the page to try again.", true);
    resourceStatus.classList.remove("loading");
    resourceStatus.classList.add("error");
    resourceStatus.title = "refresh the page to try loading the card library again.";
    resourceSummary.textContent = "cards unavailable";
    setEmptyPreview("card features are unavailable because the card library couldn't be loaded.");
  }
}

async function selectRandomCard(): Promise<void> {
  const candidates = cardsForKind(kindFilter);
  if (candidates.length === 0) {
    const format = kindFilter === "all" ? "" : `${kindLabel(kindFilter)} `;
    setStatus(`no ${format}cards are available right now.`, true);
    return;
  }

  const item = candidates[randomIndex(candidates.length)];
  clearSearchTimer();
  searchInput.value = "";

  const button = createResultButton(item);
  resultsNode.replaceChildren(button);
  selectCard(item, button);

  await renderSelectedCard(`here's a random card: ${item.card.name}`);
}

function renderSearchResults({ syncUrl = true }: { syncUrl?: boolean } = {}): void {
  resultsNode.replaceChildren();
  clearSelection();

  const results = searchCards(allCards, searchInput.value, kindFilter);
  if (results.length === 0) {
    const query = searchInput.value.trim();
    setStatus(query ? `no cards match "${query}".` : "search by card id, name, or card text.");
    if (syncUrl) {
      updateUrlState();
    }
    return;
  }

  const resultLabel = results.length === 1 ? "card" : "cards";
  setStatus(`showing ${results.length.toLocaleString("en-US")} matching ${resultLabel}.`);
  const fragment = document.createDocumentFragment();
  for (const item of results) {
    fragment.appendChild(createResultButton(item));
  }
  resultsNode.appendChild(fragment);
  if (syncUrl) {
    updateUrlState();
  }
}

function createResultButton(item: IndexedCard): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "result-item";
  button.setAttribute("role", "option");
  button.dataset.cardId = String(item.card.id);
  button.dataset.kind = item.kind;

  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = item.card.name;

  const meta = document.createElement("span");
  meta.className = "result-meta";
  meta.textContent = `${kindLabel(item.kind)} · ${item.card.id} · ${item.card.type.join("/")}`;

  const description = document.createElement("span");
  description.className = "result-description";
  description.textContent = item.card.description;

  button.append(title, meta, description);
  button.addEventListener("click", () => selectCard(item, button));
  button.addEventListener("dblclick", () => {
    selectCard(item, button);
    void renderSelectedCard();
  });
  return button;
}

function selectCard(item: IndexedCard, button: HTMLButtonElement, { syncUrl = true }: { syncUrl?: boolean } = {}): void {
  selected = item;
  for (const node of resultsNode.querySelectorAll(".selected")) {
    node.classList.remove("selected");
  }
  button.classList.add("selected");
  const selectionLabel = `${kindLabel(item.kind)} · ${item.card.id} · ${item.card.name} · ${item.card.type.join("/")}`;
  selectionNode.textContent = selectionLabel;
  selectionNode.title = selectionLabel;
  copyImageButton.disabled = !imageClipboardAvailable;
  copyCardButton.disabled = !cardClipboardAvailable;
  downloadButton.disabled = false;
  setEmptyPreview("double-click this card to see the preview.");
  if (manifest) {
    void preloadCardResources(manifest, item.kind, item.card).catch((error: unknown) => {
      console.warn(`Failed to preload card ${item.card.id}.`, error);
    });
  }
  if (syncUrl) {
    updateUrlState();
  }
}

function clearSelection(): void {
  selected = null;
  selectionNode.textContent = "no card selected";
  selectionNode.removeAttribute("title");
  copyImageButton.disabled = true;
  copyCardButton.disabled = true;
  downloadButton.disabled = true;
  setEmptyPreview("search for a card to get started.");
}

async function renderSelectedCard(successMessage = "preview ready."): Promise<void> {
  if (!selected || !manifest) {
    return;
  }

  setBusy(true, "rendering your preview...");
  try {
    const svg = await renderCardSvg(manifest, selected.kind, selected.card, currentRenderOptions());
    showSvgPreview(svg, selected);
    setStatus(successMessage);
  } catch (error) {
    console.error(`Failed to render card ${selected.card.id}.`, error);
    setStatus("we couldn't render this card. please try again.", true);
    setEmptyPreview("the preview isn't available right now.");
  } finally {
    setBusy(false);
  }
}

async function downloadSelectedCard(): Promise<void> {
  if (!selected || !manifest) {
    return;
  }

  setBusy(true, "preparing your png...");
  try {
    const png = await renderCardPng(manifest, selected.kind, selected.card, currentRenderOptions());
    downloadBytes(png, `${selected.kind}-${selected.card.id}.png`, PNG_MIME_TYPE);
    setStatus("your png is ready.");
  } catch (error) {
    console.error(`Failed to create a PNG for card ${selected.card.id}.`, error);
    setStatus("we couldn't create the png. please try again.", true);
  } finally {
    setBusy(false);
  }
}

async function copySelectedCard(mode: CopyMode): Promise<void> {
  const includeInformation = mode === "image-and-information";
  const clipboardAvailable = includeInformation ? cardClipboardAvailable : imageClipboardAvailable;
  if (!selected || !manifest || !clipboardAvailable) {
    return;
  }

  const item = selected;
  setBusy(true, includeInformation ? "copying the card and its information..." : "copying the card image...");
  try {
    const png = renderCardPng(manifest, item.kind, item.card, currentRenderOptions()).then((bytes) =>
      bytesToBlob(bytes, PNG_MIME_TYPE),
    );
    const information = includeInformation ? formatCardInformation(item.kind, item.card) : "";
    const representations: Record<string, Blob | Promise<Blob>> = includeInformation
      ? {
        [HTML_MIME_TYPE]: richCardHtmlBlob(png, information, item.card.name),
        [TEXT_MIME_TYPE]: textBlob(information),
      }
      : { [PNG_MIME_TYPE]: png };
    await writeClipboardRepresentations(representations);
    setStatus(includeInformation ? "card image and information copied to your clipboard." : "card image copied.");
  } catch (error) {
    console.error(`Failed to copy card ${item.card.id}.`, error);
    setStatus(
      includeInformation
        ? "we couldn't copy the card and its information. check your clipboard permission and try again."
        : "we couldn't copy the card image. check your clipboard permission and try again.",
      true,
    );
  } finally {
    setBusy(false);
  }
}

function showSvgPreview(svg: string, item: IndexedCard): void {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const parsedSvg = parsed.documentElement;
  if (parsedSvg.localName !== "svg") {
    throw new Error("Typst did not return valid SVG.");
  }

  const previewCard = document.createElement("div");
  previewCard.className = "preview-card";
  previewCard.setAttribute("role", "img");
  previewCard.setAttribute("aria-label", `${item.card.name} card preview`);

  const inlineSvg = document.importNode(parsedSvg, true) as unknown as SVGSVGElement;
  previewCard.style.setProperty("--preview-card-ratio", String(normalizeSvg(inlineSvg)));
  previewCard.append(inlineSvg);
  previewNode.replaceChildren(previewCard);
}

function setEmptyPreview(message: string): void {
  const empty = document.createElement("div");
  empty.className = "preview-empty";
  empty.textContent = message;
  previewNode.replaceChildren(empty);
}

function normalizeSvg(svg: SVGSVGElement): number {
  const { width, height } = svgDimensions(svg);
  if (!svg.hasAttribute("viewBox") && width > 0 && height > 0) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return width / height;
}

function svgDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/u)
    .map((value) => Number.parseFloat(value));
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }

  const width = parseSvgLength(svg.getAttribute("width"));
  const height = parseSvgLength(svg.getAttribute("height"));
  if (width <= 0 || height <= 0) {
    throw new Error("Typst SVG is missing valid page dimensions.");
  }
  return { width, height };
}

function parseSvgLength(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentRenderOptions(): CardRenderOptions {
  return {
    compressDescription: compressDescriptionInput.checked,
    drawPassword: drawPasswordInput.checked,
    fullwidthSlash: fullwidthSlashInput.checked,
  };
}

function setBusy(busy: boolean, message?: string): void {
  const disabled = busy || !cardLibraryAvailable;
  copyImageButton.disabled = disabled || !selected || !imageClipboardAvailable;
  copyCardButton.disabled = disabled || !selected || !cardClipboardAvailable;
  downloadButton.disabled = disabled || !selected;
  randomButton.disabled = disabled || !hasRandomCards();
  searchInput.disabled = disabled;
  for (const button of kindButtons) {
    button.disabled = disabled;
  }
  for (const input of renderOptionInputs) {
    input.disabled = disabled;
  }
  for (const button of resultsNode.querySelectorAll<HTMLButtonElement>(".result-item")) {
    button.disabled = disabled;
  }
  if (message) {
    setStatus(message);
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function setStatus(message: string, error = false): void {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", error);
}

async function applyUrlState(state: UrlState): Promise<void> {
  compressDescriptionInput.checked = state.compressDescription;
  drawPasswordInput.checked = state.drawPassword;
  fullwidthSlashInput.checked = state.fullwidthSlash;
  setKindFilter(state.kind);
  searchInput.value = state.query;

  if (state.query.trim()) {
    renderSearchResults({ syncUrl: false });
  } else {
    resultsNode.replaceChildren();
    clearSelection();
    setStatus("search by card id, name, or card text.");
  }

  if (state.cardId === null) {
    updateUrlState();
    return;
  }

  const item = findCardById(state.cardId, state.kind);
  if (!item) {
    setStatus(`card ${state.cardId} from this shared link isn't available.`, true);
    updateUrlState();
    return;
  }

  let button = findRenderedResultButton(item);
  if (!button) {
    button = createResultButton(item);
    if (resultsNode.childElementCount === 0) {
      resultsNode.append(button);
    } else {
      resultsNode.prepend(button);
    }
  }

  selectCard(item, button, { syncUrl: false });
  updateUrlState();
  await renderSelectedCard(`you're viewing ${item.card.name} from a shared link.`);
}

function renderResourceStatus(otCount: number, rdCount: number): void {
  const total = otCount + rdCount;
  const generatedAt = formatGeneratedAt(manifest?.generatedAt);

  resourceStatus.classList.remove("loading", "error");
  resourceStatus.title = [
    `ot: ${otCount.toLocaleString("en-US")}`,
    `rd: ${rdCount.toLocaleString("en-US")}`,
    `updated: ${generatedAt}`,
  ].join(" · ");
  resourceSummary.textContent = `${total.toLocaleString("en-US")} cards`;
}

function formatGeneratedAt(value: string | undefined): string {
  if (!value) {
    return "not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date).toLocaleLowerCase("en-US");
}

function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  return {
    kind: parseKindFilter(params.get("kind")),
    query: params.get("q") ?? "",
    cardId: parseCardId(params.get("id")),
    compressDescription: parseBooleanUrlParam(
      params.get("compress"),
      DEFAULT_CARD_RENDER_OPTIONS.compressDescription,
    ),
    drawPassword: parseBooleanUrlParam(params.get("password"), DEFAULT_CARD_RENDER_OPTIONS.drawPassword),
    fullwidthSlash: parseBooleanUrlParam(params.get("fullwidth"), DEFAULT_CARD_RENDER_OPTIONS.fullwidthSlash),
  };
}

function updateUrlState(): void {
  const url = new URL(window.location.href);

  if (kindFilter === "all") {
    url.searchParams.delete("kind");
  } else {
    url.searchParams.set("kind", kindFilter);
  }

  const query = searchInput.value.trim();
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }

  if (selected) {
    url.searchParams.set("id", String(selected.card.id));
  } else {
    url.searchParams.delete("id");
  }

  setBooleanUrlParam(
    url.searchParams,
    "compress",
    compressDescriptionInput.checked,
    DEFAULT_CARD_RENDER_OPTIONS.compressDescription,
  );
  setBooleanUrlParam(
    url.searchParams,
    "password",
    drawPasswordInput.checked,
    DEFAULT_CARD_RENDER_OPTIONS.drawPassword,
  );
  setBooleanUrlParam(
    url.searchParams,
    "fullwidth",
    fullwidthSlashInput.checked,
    DEFAULT_CARD_RENDER_OPTIONS.fullwidthSlash,
  );

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function parseKindFilter(value: string | null): KindFilter {
  if (value === "ot" || value === "rd") {
    return value;
  }
  return "all";
}

function parseCardId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBooleanUrlParam(value: string | null, defaultValue: boolean): boolean {
  if (value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  return defaultValue;
}

function setBooleanUrlParam(
  params: URLSearchParams,
  name: string,
  value: boolean,
  defaultValue: boolean,
): void {
  if (value === defaultValue) {
    params.delete(name);
  } else {
    params.set(name, value ? "1" : "0");
  }
}

function setKindFilter(kind: KindFilter): void {
  kindFilter = kind;
  for (const button of kindButtons) {
    button.classList.toggle("active", parseKindFilter(button.dataset.kind ?? "") === kind);
  }
  randomButton.disabled = !hasRandomCards();
}

function findCardById(cardId: number, kind: KindFilter): IndexedCard | null {
  return cardsForKind(kind).find((item) => item.card.id === cardId) ?? null;
}

function findRenderedResultButton(item: IndexedCard): HTMLButtonElement | null {
  const cardId = String(item.card.id);
  for (const button of resultsNode.querySelectorAll<HTMLButtonElement>(".result-item")) {
    if (button.dataset.kind === item.kind && button.dataset.cardId === cardId) {
      return button;
    }
  }
  return null;
}

function clearSearchTimer(): void {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }
}

function kindLabel(kind: CardKind): string {
  return kind === "ot" ? "ot" : "rd";
}

function cardsForKind(kind: KindFilter): IndexedCard[] {
  if (kind === "all") {
    return allCards;
  }
  return allCards.filter((item) => item.kind === kind);
}

function hasRandomCards(): boolean {
  return cardsForKind(kindFilter).length > 0;
}

function randomIndex(length: number): number {
  const range = 0x100000000;
  const limit = range - (range % length);
  const buffer = new Uint32Array(1);
  let value = 0;

  do {
    window.crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);

  return value % length;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}.`);
  }
  return element as T;
}
