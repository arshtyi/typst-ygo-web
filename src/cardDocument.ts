import type { CardKind, CardRenderOptions } from "./types";

export function createCardDocument(
  kind: CardKind,
  cardPath: string,
  options: Readonly<CardRenderOptions>,
): string {
  const cardFunction = kind === "ot" ? "ot-card" : "rd-card";
  return [
    "#set page(width: auto, height: auto, margin: 0pt)",
    `#import "/lib/mod.typ": ${cardFunction}`,
    `#let card = json("${cardPath}")`,
    `#${cardFunction}(card, compact: ${options.compressDescription}, password: ${options.drawPassword})`,
    "",
  ].join("\n");
}
