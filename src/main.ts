import "./styles.css";
import { indexCards, searchCards } from "./search";
import { downloadBytes, renderCardPng, renderCardSvg } from "./typstRenderer";
import type { AssetManifest, CardKind, IndexedCard, RawCard } from "./types";

type KindFilter = CardKind | "all";

type UrlState = {
  kind: KindFilter;
  query: string;
  cardId: number | null;
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
    <section class="search-pane" aria-label="card search">
      <header class="topbar">
        <div>
          <h1>typst-ygo web</h1>
          <details class="resource-details">
            <summary><span id="resourceSummary">资源未加载</span></summary>
            <div id="resourceMeta" class="resource-meta">资源未加载</div>
          </details>
        </div>
      </header>

      <div class="search-controls">
        <input id="searchInput" type="search" autocomplete="off" placeholder="ID / 名称 / 效果文本" />
        <div class="segmented" aria-label="card kind">
          <button class="active" type="button" data-kind="all">全部</button>
          <button type="button" data-kind="ot">OCG/TCG</button>
          <button type="button" data-kind="rd">RD</button>
        </div>
      </div>

      <div id="status" class="status" role="status">正在加载资源...</div>
      <div id="results" class="results" role="listbox" aria-label="search results"></div>
    </section>

    <section class="preview-pane" aria-label="card preview">
      <div class="preview-toolbar">
        <div id="selection" class="selection">未选择卡片</div>
        <div class="actions">
          <button id="randomButton" type="button" disabled>随机一卡</button>
          <button id="downloadButton" type="button" disabled>下载图片</button>
        </div>
      </div>
      <div id="preview" class="preview">
        <div class="preview-empty">等待渲染</div>
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
const previewNode = getElement<HTMLDivElement>("preview");
const kindButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-kind]"));

let manifest: AssetManifest | null = null;
let allCards: IndexedCard[] = [];
let selected: IndexedCard | null = null;
let kindFilter: KindFilter = "all";
let searchTimer: number | null = null;

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

async function initialize(): Promise<void> {
  try {
    manifest = await fetchJson<AssetManifest>("asset-manifest.json");
    const [otCards, rdCards] = await Promise.all([
      fetchJson<RawCard[]>("assets/ot/card/ot.json"),
      fetchJson<RawCard[]>("assets/rd/card/rd.json"),
    ]);

    allCards = [...indexCards("ot", otCards), ...indexCards("rd", rdCards)];
    renderResourceMeta(otCards.length, rdCards.length);
    randomButton.disabled = !hasRandomCards();
    await applyUrlState(readUrlState());
  } catch (error) {
    setStatus(
      `资源加载失败：${formatError(error)}。本地运行 npm run sync:resources，或在 GitHub Actions 手动选择 refresh_resources=true。`,
      true,
    );
    resourceSummary.textContent = "资源不可用";
    resourceMeta.textContent = "资源加载失败，查看状态栏获取详情。";
  }
}

async function selectRandomCard(): Promise<void> {
  const candidates = cardsForKind(kindFilter);
  if (candidates.length === 0) {
    setStatus(`当前${kindFilterLabel(kindFilter)}没有可随机的卡片。`, true);
    return;
  }

  const item = candidates[randomIndex(candidates.length)];
  clearSearchTimer();
  searchInput.value = "";

  const button = createResultButton(item);
  resultsNode.replaceChildren(button);
  selectCard(item, button);

  await renderSelectedCard(`已从${kindFilterLabel(kindFilter)}随机抽取：${item.card.name}`);
}

function renderSearchResults({ syncUrl = true }: { syncUrl?: boolean } = {}): IndexedCard[] {
  resultsNode.replaceChildren();
  clearSelection({ syncUrl: false });

  const results = searchCards(allCards, searchInput.value, kindFilter);
  if (results.length === 0) {
    setStatus(searchInput.value.trim() ? "没有匹配结果。" : "输入关键词后显示匹配结果。");
    if (syncUrl) {
      updateUrlState();
    }
    return [];
  }

  setStatus(`显示 ${results.length.toLocaleString("zh-CN")} 条结果。`);
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
  setEmptyPreview(`已选择：${item.card.name}`);
  if (syncUrl) {
    updateUrlState();
  }
}

function clearSelection({ syncUrl = true }: { syncUrl?: boolean } = {}): void {
  selected = null;
  selectionNode.textContent = "未选择卡片";
  selectionNode.removeAttribute("title");
  downloadButton.disabled = true;
  setEmptyPreview("等待渲染");
  if (syncUrl) {
    updateUrlState();
  }
}

async function renderSelectedCard(successMessage = "渲染完成。"): Promise<void> {
  if (!selected || !manifest) {
    return;
  }

  setBusy(true, "正在渲染...");
  try {
    const svg = await renderCardSvg(manifest, selected.kind, selected.card);
    showSvgPreview(svg, selected);
    downloadButton.disabled = false;
    setStatus(successMessage);
  } catch (error) {
    setStatus(`渲染失败：${formatError(error)}`, true);
    setEmptyPreview("渲染失败");
  } finally {
    setBusy(false);
  }
}

async function downloadSelectedCard(): Promise<void> {
  if (!selected || !manifest) {
    return;
  }

  setBusy(true, "正在生成图片...");
  try {
    const png = await renderCardPng(manifest, selected.kind, selected.card);
    downloadBytes(png, `${selected.kind}-${selected.card.id}.png`, "image/png");
    setStatus("图片已生成。");
  } catch (error) {
    setStatus(`图片生成失败：${formatError(error)}`, true);
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
  previewCard.setAttribute("aria-label", `${item.card.name} preview`);

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

function setBusy(busy: boolean, message?: string): void {
  downloadButton.disabled = busy || !selected;
  randomButton.disabled = busy || !hasRandomCards();
  searchInput.disabled = busy;
  for (const button of kindButtons) {
    button.disabled = busy;
  }
  for (const button of resultsNode.querySelectorAll<HTMLButtonElement>(".result-item")) {
    button.disabled = busy;
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
  setKindFilter(state.kind);
  searchInput.value = state.query;

  if (state.query.trim()) {
    renderSearchResults({ syncUrl: false });
  } else {
    resultsNode.replaceChildren();
    clearSelection({ syncUrl: false });
    setStatus("输入关键词后显示匹配结果。");
  }

  if (state.cardId === null) {
    updateUrlState();
    return;
  }

  const item = findCardById(state.cardId, state.kind);
  if (!item) {
    setStatus(`链接中的卡片 ID ${state.cardId} 不存在。`, true);
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
  await renderSelectedCard(`已从链接打开：${item.card.name}`);
}

function renderResourceMeta(otCount: number, rdCount: number): void {
  const total = otCount + rdCount;
  const generatedAt = formatGeneratedAt(manifest?.generatedAt);
  const sourceLinks = sourceLinksFromManifest(manifest);

  resourceSummary.textContent = `资源：${total.toLocaleString("zh-CN")} 张卡`;
  resourceSummary.title = `OCG/TCG ${otCount.toLocaleString("zh-CN")} / RD ${rdCount.toLocaleString("zh-CN")}`;

  const list = document.createElement("dl");
  list.className = "resource-list";

  appendResourceRow(list, "卡片数量", document.createTextNode(`总计 ${total.toLocaleString("zh-CN")} 张`));
  appendResourceRow(
    list,
    "环境",
    document.createTextNode(`OCG/TCG ${otCount.toLocaleString("zh-CN")} / RD ${rdCount.toLocaleString("zh-CN")}`),
  );
  appendResourceRow(list, "生成时间", document.createTextNode(generatedAt));

  if (sourceLinks.length > 0) {
    const sources = document.createDocumentFragment();
    for (const [index, link] of sourceLinks.entries()) {
      if (index > 0) {
        sources.append(document.createTextNode(" / "));
      }
      sources.append(createSourceAnchor(link));
    }
    appendResourceRow(list, "来源", sources);
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
  appendSourceLink(links, "素材", sources.assets);

  if (typeof sources.cards === "string") {
    appendSourceLink(links, "卡片数据", sources.cards);
  } else if (isRecord(sources.cards)) {
    appendSourceLink(links, "OCG/TCG 数据", sources.cards.ot);
    appendSourceLink(links, "RD 数据", sources.cards.rd);
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
    return "未知";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
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
  return kind === "ot" ? "OCG/TCG" : "RD";
}

function kindFilterLabel(kind: KindFilter): string {
  return kind === "all" ? "全部环境" : kindLabel(kind);
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}.`);
  }
  return element as T;
}
