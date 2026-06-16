import type { CardKind, IndexedCard, RawCard } from "./types";

const TOKEN_SPLIT = /[\s,，;；、|/]+/u;

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN");
}

export function splitKeyword(keyword: string): string[] {
  return normalizeSearchText(keyword)
    .split(TOKEN_SPLIT)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function indexCards(kind: CardKind, cards: RawCard[]): IndexedCard[] {
  return cards.map((card) => ({
    kind,
    card,
    searchText: normalizeSearchText([
      card.id,
      card.name,
      card.description,
      card.pendulumDescription,
      card.pendulumDescsription,
    ].join("\n")),
  }));
}

export function searchCards(cards: IndexedCard[], keyword: string, kind: CardKind | "all", limit = 80): IndexedCard[] {
  const tokens = splitKeyword(keyword);
  if (tokens.length === 0) {
    return [];
  }

  const filtered = cards.filter((item) => {
    if (kind !== "all" && item.kind !== kind) {
      return false;
    }
    return tokens.every((token) => item.searchText.includes(token));
  });

  return filtered
    .map((item) => ({ item, score: scoreCard(item, tokens) }))
    .sort((left, right) => left.score - right.score || left.item.card.id - right.item.card.id)
    .slice(0, limit)
    .map(({ item }) => item);
}

function scoreCard(item: IndexedCard, tokens: string[]): number {
  const id = String(item.card.id);
  const name = normalizeSearchText(item.card.name);
  let score = item.kind === "ot" ? 0 : 10;

  for (const token of tokens) {
    if (token === id) {
      score -= 100;
    } else if (id.startsWith(token)) {
      score -= 40;
    } else if (name === token) {
      score -= 30;
    } else if (name.includes(token)) {
      score -= 10;
    }
  }

  return score;
}
