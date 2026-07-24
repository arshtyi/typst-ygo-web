import "./styles.css";
import { indexCards, searchCards } from "./search";
import { DEFAULT_CARD_RENDER_OPTIONS, downloadBytes, renderCardPng, renderCardSvg } from "./typstRenderer";
import type { AssetManifest, CardKind, CardRenderOptions, IndexedCard, RawCard } from "./types";

type KindFilter = CardKind | "all";

type UrlState = {
  kind: KindFilter;
  query: string;
  cardId: number | null;
  compressDescription: boolean;
  drawPassword: boolean;
};

type SourceLink = {
  label: string;
  url: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root.");
}

app.innerHTML = `
  <main class="app-shell">
    <section class="search-pane" aria-label="Card search">
      <header class="topbar">
        <div>
          <h1>typst-ygo web</h1>
          <details class="resource-details">
            <summary><span id="resourceSummary">Loading card library...</span></summary>
            <div id="resourceMeta" class="resource-meta">Card details will appear when loading is complete.</div>
          </details>
        </div>
      </header>

      <div class="search-controls">
        <input
          id="searchInput"
          type="search"
          autocomplete="off"
          placeholder="Search by ID, name, or card text"
          aria-label="Search cards"
          disabled
        />
        <div class="segmented" aria-label="Card format">
          <button class="active" type="button" data-kind="all" disabled>All</button>
          <button type="button" data-kind="ot" disabled>OCG/TCG</button>
          <button type="button" data-kind="rd" disabled>RD</button>
        </div>
      </div>

      <div id="status" class="status" role="status">Loading the card library...</div>
      <div id="results" class="results" role="listbox" aria-label="Search results"></div>
    </section>

    <section class="preview-pane" aria-label="Card preview">
      <div class="preview-toolbar">
        <div id="selection" class="selection">No card selected</div>
        <div class="preview-controls">
          <div class="render-options" role="group" aria-label="Card rendering options">
            <label class="render-option">
              <input id="compressDescriptionInput" type="checkbox" role="switch" checked disabled />
              <span>Compact card text</span>
            </label>
            <label class="render-option">
              <input id="drawPasswordInput" type="checkbox" role="switch" checked disabled />
              <span>Show passcode</span>
            </label>
          </div>
          <div class="actions">
            <button id="randomButton" type="button" disabled>Random card</button>
            <button id="downloadButton" type="button" disabled>Download PNG</button>
          </div>
        </div>
      </div>
      <div id="preview" class="preview">
        <div class="preview-empty">Search for a card to get started.</div>
      </div>
    </section>
  </main>
`;

const searchInput = getElement<HTMLInputElement>("searchInput");
const resourceSummary = getElement<HTMLSpanElement>("resourceSummary");
const resourceMeta = getElement<HTMLDivElement>("resourceMeta");
const statusNode = getElement<HTMLDivElement>("status");
const resultsNode = getElement<HTMLDivElement>("results");
const selectionNode = getElement<HTMLDivElement>("selection");
const downloadButton = getElement<HTMLButtonElement>("downloadButton");
const randomButton = getElement<HTMLButtonElement>("randomButton");
const compressDescriptionInput = getElement<HTMLInputElement>("compressDescriptionInput");
const drawPasswordInput = getElement<HTMLInputElement>("drawPasswordInput");
const previewNode = getElement<HTMLDivElement>("preview");
const kindButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-kind]"));
const renderOptionInputs = [compressDescriptionInput, drawPasswordInput];

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

downloadButton.addEventListener("click", () => {
  void downloadSelectedCard();
});

for (const input of renderOptionInputs) {
  input.addEventListener("change", () => {
    updateUrlState();
    if (selected && manifest) {
      void renderSelectedCard("Preview updated.");
    }
  });
}

async function initialize(): Promise<void> {
  try {
    manifest = await fetchJson<AssetManifest>("asset-manifest.json");
    const [otCards, rdCards] = await Promise.all([
      fetchJson<RawCard[]>("assets/ot/card/ot.json"),
      fetchJson<RawCard[]>("assets/rd/card/rd.json"),
    ]);

    allCards = [...indexCards("ot", otCards), ...indexCards("rd", rdCards)];
    cardLibraryAvailable = true;
    renderResourceMeta(otCards.length, rdCards.length);
    setBusy(false);
    await applyUrlState(readUrlState());
  } catch (error) {
    console.error("Failed to load the card library.", error);
    cardLibraryAvailable = false;
    setBusy(false);
    setStatus("We couldn't load the card library. Refresh the page to try again.", true);
    resourceSummary.textContent = "Card library unavailable";
    resourceMeta.textContent = "Try refreshing the page. The data source may be temporarily unavailable.";
    setEmptyPreview("Card features are unavailable because the card library couldn't be loaded.");
  }
}

async function selectRandomCard(): Promise<void> {
  const candidates = cardsForKind(kindFilter);
  if (candidates.length === 0) {
    const format = kindFilter === "all" ? "" : `${kindLabel(kindFilter)} `;
    setStatus(`No ${format}cards are available right now.`, true);
    return;
  }

  const item = candidates[randomIndex(candidates.length)];
  clearSearchTimer();
  searchInput.value = "";

  const button = createResultButton(item);
  resultsNode.replaceChildren(button);
  selectCard(item, button);

  await renderSelectedCard(`Here's a random card: ${item.card.name}`);
}

function renderSearchResults({ syncUrl = true }: { syncUrl?: boolean } = {}): IndexedCard[] {
  resultsNode.replaceChildren();
  clearSelection({ syncUrl: false });

  const results = searchCards(allCards, searchInput.value, kindFilter);
  if (results.length === 0) {
    const query = searchInput.value.trim();
    setStatus(query ? `No cards match "${query}".` : "Search by card ID, name, or card text.");
    if (syncUrl) {
      updateUrlState();
    }
    return [];
  }

  const resultLabel = results.length === 1 ? "card" : "cards";
  setStatus(`Showing ${results.length.toLocaleString("en-US")} matching ${resultLabel}.`);
  const fragment = document.createDocumentFragment();
  for (const item of results) {
    fragment.appendChild(createResultButton(item));
  }
  resultsNode.appendChild(fragment);
  if (syncUrl) {
    updateUrlState();
  }
  return results;
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
  meta.textContent = `${kindLabel(item.kind)} · ${item.card.id} · ${Array.isArray(item.card.type) ? item.card.type.join("/") : ""}`;

  const description = document.createElement("span");
  description.className = "result-description";
  description.textContent = item.card.description ?? "";

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
  const selectionLabel = `${kindLabel(item.kind)} · ${item.card.id} · ${item.card.name}`;
  selectionNode.textContent = selectionLabel;
  selectionNode.title = selectionLabel;
  downloadButton.disabled = false;
  setEmptyPreview("Double-click this card to see the preview.");
  if (syncUrl) {
    updateUrlState();
  }
}

function clearSelection({ syncUrl = true }: { syncUrl?: boolean } = {}): void {
  selected = null;
  selectionNode.textContent = "No card selected";
  selectionNode.removeAttribute("title");
  downloadButton.disabled = true;
  setEmptyPreview("Search for a card to get started.");
  if (syncUrl) {
    updateUrlState();
  }
}

async function renderSelectedCard(successMessage = "Preview ready."): Promise<void> {
  if (!selected || !manifest) {
    return;
  }

  setBusy(true, "Rendering your preview...");
  try {
    const svg = await renderCardSvg(manifest, selected.kind, selected.card, currentRenderOptions());
    showSvgPreview(svg, selected);
    downloadButton.disabled = false;
    setStatus(successMessage);
  } catch (error) {
    console.error(`Failed to render card ${selected.card.id}.`, error);
    setStatus("We couldn't render this card. Please try again.", true);
    setEmptyPreview("The preview isn't available right now.");
  } finally {
    setBusy(false);
  }
}

async function downloadSelectedCard(): Promise<void> {
  if (!selected || !manifest) {
    return;
  }

  setBusy(true, "Preparing your PNG...");
  try {
    const png = await renderCardPng(manifest, selected.kind, selected.card, currentRenderOptions());
    downloadBytes(png, `${selected.kind}-${selected.card.id}.png`, "image/png");
    setStatus("Your PNG is ready.");
  } catch (error) {
    console.error(`Failed to create a PNG for card ${selected.card.id}.`, error);
    setStatus("We couldn't create the PNG. Please try again.", true);
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
  };
}

function setBusy(busy: boolean, message?: string): void {
  const disabled = busy || !cardLibraryAvailable;
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
  setKindFilter(state.kind);
  searchInput.value = state.query;

  if (state.query.trim()) {
    renderSearchResults({ syncUrl: false });
  } else {
    resultsNode.replaceChildren();
    clearSelection({ syncUrl: false });
    setStatus("Search by card ID, name, or card text.");
  }

  if (state.cardId === null) {
    updateUrlState();
    return;
  }

  const item = findCardById(state.cardId, state.kind);
  if (!item) {
    setStatus(`Card ${state.cardId} from this shared link isn't available.`, true);
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
  await renderSelectedCard(`You're viewing ${item.card.name} from a shared link.`);
}

function renderResourceMeta(otCount: number, rdCount: number): void {
  const total = otCount + rdCount;
  const generatedAt = formatGeneratedAt(manifest?.generatedAt);
  const sourceLinks = sourceLinksFromManifest(manifest);

  resourceSummary.textContent = `${total.toLocaleString("en-US")} cards loaded`;
  resourceSummary.title =
    `OCG/TCG: ${otCount.toLocaleString("en-US")} · Rush Duel: ${rdCount.toLocaleString("en-US")}`;

  const list = document.createElement("dl");
  list.className = "resource-list";

  appendResourceRow(list, "Library size", document.createTextNode(`${total.toLocaleString("en-US")} cards`));
  appendResourceRow(
    list,
    "Formats",
    document.createTextNode(
      `OCG/TCG: ${otCount.toLocaleString("en-US")} · Rush Duel: ${rdCount.toLocaleString("en-US")}`,
    ),
  );
  appendResourceRow(list, "Last updated", document.createTextNode(generatedAt));

  if (sourceLinks.length > 0) {
    const sources = document.createDocumentFragment();
    for (const [index, link] of sourceLinks.entries()) {
      if (index > 0) {
        sources.append(document.createTextNode(" / "));
      }
      sources.append(createSourceAnchor(link));
    }
    appendResourceRow(list, "Sources", sources);
  }

  resourceMeta.replaceChildren(list);
  resourceMeta.title = manifest?.generatedAt ? `generatedAt: ${manifest.generatedAt}` : "";
}

function appendResourceRow(list: HTMLDListElement, label: string, value: Node): void {
  const term = document.createElement("dt");
  term.textContent = label;

  const description = document.createElement("dd");
  description.append(value);

  list.append(term, description);
}

function createSourceAnchor(link: SourceLink): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = link.url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = link.label;
  return anchor;
}

function sourceLinksFromManifest(assetManifest: AssetManifest | null): SourceLink[] {
  const sources = assetManifest?.sources;
  if (!isRecord(sources)) {
    return [];
  }

  const links: SourceLink[] = [];
  appendSourceLink(links, "typst-ygo", sources.typstYgo);
  appendSourceLink(links, "Card assets", sources.assets);

  if (typeof sources.cards === "string") {
    appendSourceLink(links, "Card data", sources.cards);
  } else if (isRecord(sources.cards)) {
    appendSourceLink(links, "OCG/TCG data", sources.cards.ot);
    appendSourceLink(links, "RD data", sources.cards.rd);
  }

  return links;
}

function appendSourceLink(links: SourceLink[], label: string, value: unknown): void {
  if (typeof value === "string" && /^https?:\/\//iu.test(value)) {
    links.push({ label, url: value });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatGeneratedAt(value: string | undefined): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
  return kind === "ot" ? "OCG/TCG" : "Rush Duel";
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
