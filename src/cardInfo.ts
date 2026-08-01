import type { CardKind, JsonValue, RawCard } from "./types";

const FIELD_ORDER = [
  "name",
  "id",
  "image",
  "alias",
  "type",
  "attribute",
  "level",
  "rank",
  "atk",
  "def",
  "linkValue",
  "linkMarker",
  "pendulumScale",
  "legend",
  "maximum",
  "maximumAtk",
  "lf",
  "pendulumDescription",
  "description",
] as const;

const FIELD_LABELS: Readonly<Record<string, string>> = {
  alias: "同名卡编号",
  atk: "攻击力",
  attribute: "属性",
  def: "守备力",
  description: "效果文本",
  id: "卡片编号",
  image: "图片编号",
  legend: "LEGEND",
  level: "等级",
  lf: "禁限状态",
  linkMarker: "连接标记",
  linkValue: "连接值",
  maximum: "极大组件",
  maximumAtk: "极大攻击力",
  name: "卡名",
  pendulumDescription: "灵摆效果",
  pendulumScale: "灵摆刻度",
  rank: "阶级",
  type: "类型",
};

const ATTRIBUTE_NAMES = ["地", "水", "炎", "风", "光", "暗", "神"] as const;
const LINK_MARKER_NAMES = ["左上", "左", "左下", "下", "右下", "右", "右上", "上"] as const;
const LIMIT_NAMES = ["禁止", "限制", "准限制", "无限制"] as const;
const MAXIMUM_PART_NAMES = ["左", "中央", "右"] as const;

export function formatCardInformation(kind: CardKind, card: RawCard): string {
  const fields = orderedFields(card);
  const details = [`制式：${kind === "ot" ? "OCG/TCG" : "Rush Duel"}`];
  const sections: string[] = [];

  for (const [key, value] of fields) {
    const formatted = formatFieldValue(kind, card, key, value);
    const label = FIELD_LABELS[key] ?? humanizeKey(key);
    if (formatted.includes("\n")) {
      sections.push(`${label}：\n${formatted}`);
    } else {
      details.push(`${label}：${formatted}`);
    }
  }

  return [...details, ...sections.map((section) => `\n${section}`)].join("\n");
}

function orderedFields(card: RawCard): Array<[string, JsonValue]> {
  const entries = Object.entries(card).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined);
  const values = new Map(entries);
  const ordered: Array<[string, JsonValue]> = [];

  for (const key of FIELD_ORDER) {
    const value = values.get(key);
    if (value !== undefined) {
      ordered.push([key, value]);
      values.delete(key);
    }
  }

  ordered.push(...[...values].sort(([left], [right]) => left.localeCompare(right, "en")));
  return ordered;
}

function formatFieldValue(kind: CardKind, card: RawCard, key: string, value: JsonValue): string {
  switch (key) {
    case "alias":
      return value === 0 ? "无" : formatValue(value);
    case "atk":
    case "def":
    case "maximumAtk":
      return value === -1 ? "?" : formatValue(value);
    case "attribute":
      return formatAttribute(card, value);
    case "legend":
      return value === true ? "是" : "否";
    case "lf":
      return formatLimit(kind, value);
    case "linkMarker":
      return formatLinkMarkers(value);
    case "maximum":
      return formatMappedNumber(value, MAXIMUM_PART_NAMES);
    case "type":
      return Array.isArray(value) ? value.map(formatValue).join(" / ") : formatValue(value);
    default:
      return formatValue(value);
  }
}

function formatAttribute(card: RawCard, value: JsonValue): string {
  if (!card.type.includes("怪兽") || typeof value !== "number") {
    return formatValue(value);
  }
  return formatMappedNumber(value, ATTRIBUTE_NAMES);
}

function formatLimit(kind: CardKind, value: JsonValue): string {
  if (kind === "ot" && Array.isArray(value)) {
    const [ocg, tcg, ...rest] = value;
    const parts = [`OCG：${formatMappedNumber(ocg, LIMIT_NAMES)}`, `TCG：${formatMappedNumber(tcg, LIMIT_NAMES)}`];
    parts.push(...rest.map(formatValue));
    return parts.join("；");
  }
  return formatMappedNumber(value, LIMIT_NAMES);
}

function formatLinkMarkers(value: JsonValue): string {
  if (!Array.isArray(value)) {
    return formatValue(value);
  }
  return value.map((marker) => formatMappedNumber(marker, LINK_MARKER_NAMES)).join(" / ");
}

function formatMappedNumber(value: JsonValue | undefined, names: readonly string[]): string {
  if (typeof value !== "number") {
    return value === undefined ? "无" : formatValue(value);
  }
  const name = names[value];
  return name ? `${name}（${value}）` : String(value);
}

function formatValue(value: JsonValue): string {
  if (value === null) {
    return "无";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    return value.map(formatValue).join(" / ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function humanizeKey(key: string): string {
  const words = key.replace(/([a-z\d])([A-Z])/gu, "$1 $2").replace(/[_-]+/gu, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}
