import type { CardKind, IndexedCard, RawCard } from "./types";

const TOKEN_SPLIT = /[\s,，;；、|/]+/u;
const COMPACT_SEARCH_IGNORED = /[\p{P}\p{S}\s]+/gu;
const HAN_CHAR = /\p{Script=Han}/u;

type SearchToken = {
  text: string;
  compactText: string;
  compactChars: string[];
};

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

export function normalizeCompactSearchText(value: unknown): string {
  return normalizeSearchText(value).replace(COMPACT_SEARCH_IGNORED, "");
}

export function indexCards(kind: CardKind, cards: RawCard[]): IndexedCard[] {
  return cards.map((card) => {
    const searchFields = [
      card.id,
      card.name,
      card.description,
      card.pendulumDescription,
      card.pendulumDescsription,
    ];
    const compactSearchText = searchFields.map(normalizeCompactSearchText).filter(Boolean).join("\n");

    return {
      kind,
      card,
      searchText: normalizeSearchText(searchFields.join("\n")),
      compactSearchText,
      compactSearchChars: toUniqueChars(compactSearchText),
    };
  });
}

export function searchCards(cards: IndexedCard[], keyword: string, kind: CardKind | "all", limit = 80): IndexedCard[] {
  const tokens = splitKeyword(keyword).map(toSearchToken);
  if (tokens.length === 0) {
    return [];
  }

  const filtered = cards.filter((item) => {
    if (kind !== "all" && item.kind !== kind) {
      return false;
    }
    return tokens.every((token) => matchesToken(item, token));
  });

  return filtered
    .map((item) => ({ item, score: scoreCard(item, tokens) }))
    .sort((left, right) => left.score - right.score || left.item.card.id - right.item.card.id)
    .slice(0, limit)
    .map(({ item }) => item);
}

function toSearchToken(text: string): SearchToken {
  const compactText = normalizeCompactSearchText(text);
  return {
    text,
    compactText,
    compactChars: Array.from(toUniqueChars(compactText)),
  };
}

function matchesToken(item: IndexedCard, token: SearchToken): boolean {
  return (
    item.searchText.includes(token.text) ||
    (token.compactText.length > 0 && item.compactSearchText.includes(token.compactText)) ||
    token.compactChars.some((char) => item.compactSearchChars.has(char))
  );
}

function scoreCard(item: IndexedCard, tokens: SearchToken[]): number {
  const id = String(item.card.id);
  const name = normalizeSearchText(item.card.name);
  const compactName = normalizeCompactSearchText(item.card.name);
  const compactNameChars = toUniqueChars(compactName);
  let score = item.kind === "ot" ? 0 : 10;

  for (const token of tokens) {
    const hasCompactText = token.compactText.length > 0;
    if (token.text === id || (hasCompactText && token.compactText === id)) {
      score -= 100;
    } else if (id.startsWith(token.text) || (hasCompactText && id.startsWith(token.compactText))) {
      score -= 40;
    } else if (name === token.text || (hasCompactText && compactName === token.compactText)) {
      score -= 30;
    } else if (name.includes(token.text) || (hasCompactText && compactName.includes(token.compactText))) {
      score -= 10;
    } else {
      const nameCharHits = countCharHits(compactNameChars, token.compactChars);
      if (nameCharHits > 0) {
        score -= 4 + nameCharHits;
      } else {
        score -= countCharHits(item.compactSearchChars, token.compactChars);
      }
    }
  }

  return score;
}

function toUniqueChars(value: string): Set<string> {
  return new Set(Array.from(value).filter((char) => HAN_CHAR.test(char)));
}

function countCharHits(chars: ReadonlySet<string>, searchChars: string[]): number {
  let hits = 0;
  for (const char of searchChars) {
    if (chars.has(char)) {
      hits += 1;
    }
  }
  return hits;
}
