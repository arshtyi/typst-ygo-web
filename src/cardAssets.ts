import type { CardKind, CardLimit, RawCard } from "./types";

export function cardAssetFiles(kind: CardKind, card: RawCard, limit: CardLimit = null): string[] {
  const files = kind === "ot" ? otAssetFiles(card) : rdAssetFiles(card);
  if (limit !== null) {
    files.push(`assets/${kind}/lf/${limit}.png`);
  }
  return unique(files);
}

function otAssetFiles(card: RawCard): string[] {
  const types = new Set(card.type);
  const files = [
    `assets/ot/frame/${otFrame(types)}.png`,
    `assets/ot/attribute/${attribute(types, card.attribute, 7)}.png`,
  ];

  if (types.has("怪兽")) {
    if (types.has("连接")) {
      files.push("assets/ot/bar/1.png");
      for (const marker of card.linkMarker ?? []) {
        files.push(`assets/ot/link/${marker}.png`);
      }
    } else {
      files.push("assets/ot/bar/0.png", types.has("超量") ? "assets/ot/rank/0.png" : "assets/ot/level/0.png");
    }
  }

  const icon = otIcon(types);
  if (icon !== null) {
    files.push(`assets/ot/icon/${icon}.png`);
  }

  return unique(files);
}

function rdAssetFiles(card: RawCard): string[] {
  const types = new Set(card.type);
  const files = [
    `assets/rd/frame/${rdFrame(types)}.png`,
    `assets/rd/attribute/${attribute(types, card.attribute, 6)}.png`,
  ];

  if (card.legend) {
    files.push("assets/rd/legend/0.png");
  }
  if (types.has("怪兽")) {
    files.push(
      "assets/rd/bar/0.png",
      "assets/rd/level/0.png",
      `assets/rd/level/${rdLevel(card.level)}.png`,
    );
    if (card.maximumAtk !== undefined && card.maximumAtk !== null) {
      files.push("assets/rd/bar/1.png");
    }
  }

  for (const type of types) {
    const icon = rdIcon(type);
    if (icon !== null) {
      files.push(`assets/rd/icon/${icon}.png`);
    }
  }

  return unique(files);
}

function rdLevel(value: number | undefined): string {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1 || value > 13) {
    throw new Error(`Unsupported RD card level: ${String(value)}`);
  }
  return String(value);
}

function otFrame(types: ReadonlySet<string>): string {
  if (types.has("魔法")) {
    return "100";
  }
  if (types.has("陷阱")) {
    return "200";
  }

  const frame = monsterFrame(types);
  if (!types.has("灵摆") || types.has("连接")) {
    return frame;
  }

  const pendulumFrames: Readonly<Record<string, string>> = {
    "001": "011",
    "002": "012",
    "003": "013",
    "004": "014",
    "005": "015",
    "006": "016",
  };
  const pendulumFrame = pendulumFrames[frame];
  if (!pendulumFrame) {
    throw new Error(`Unsupported OT pendulum frame for card types: ${[...types].join("/")}`);
  }
  return pendulumFrame;
}

function monsterFrame(types: ReadonlySet<string>): string {
  const frames: ReadonlyArray<readonly [string, string]> = [
    ["连接", "007"],
    ["融合", "004"],
    ["仪式", "003"],
    ["同调", "005"],
    ["超量", "006"],
    ["衍生物", "000"],
    ["通常", "001"],
    ["效果", "002"],
  ];
  const match = frames.find(([type]) => types.has(type));
  if (!match) {
    throw new Error(`Unsupported OT card frame for card types: ${[...types].join("/")}`);
  }
  return match[1];
}

function rdFrame(types: ReadonlySet<string>): string {
  const frames: ReadonlyArray<readonly [string, string]> = [
    ["魔法", "4"],
    ["陷阱", "5"],
    ["融合", "3"],
    ["仪式", "2"],
    ["通常", "0"],
  ];
  return frames.find(([type]) => types.has(type))?.[1] ?? "1";
}

function attribute(types: ReadonlySet<string>, value: number | undefined, count: number): string {
  if (types.has("魔法")) {
    return "10";
  }
  if (types.has("陷阱")) {
    return "20";
  }
  if (!Number.isSafeInteger(value) || value === undefined || value < 0 || value >= count) {
    throw new Error(`Unsupported card attribute: ${String(value)}`);
  }
  return String(value).padStart(2, "0");
}

function otIcon(types: ReadonlySet<string>): string | null {
  if (types.has("魔法")) {
    const icons: ReadonlyArray<readonly [string, string]> = [
      ["场地", "4"],
      ["装备", "3"],
      ["永续", "1"],
      ["速攻", "2"],
      ["仪式", "0"],
    ];
    return icons.find(([type]) => types.has(type))?.[1] ?? null;
  }
  if (types.has("陷阱")) {
    if (types.has("永续")) {
      return "1";
    }
    if (types.has("反击")) {
      return "5";
    }
  }
  return null;
}

function rdIcon(type: string): string | null {
  const icons: Readonly<Record<string, string>> = {
    场地: "3",
    装备: "1",
    永续: "2",
    仪式: "0",
  };
  return icons[type] ?? null;
}

function unique(files: string[]): string[] {
  return [...new Set(files)];
}
