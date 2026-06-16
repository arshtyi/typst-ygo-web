export type CardKind = "ot" | "rd";

export type RawCard = {
  id: number;
  image: number;
  name: string;
  description: string;
  pendulumDescription?: string;
  pendulumDescsription?: string;
  type?: string[];
  [key: string]: unknown;
};

export type IndexedCard = {
  kind: CardKind;
  card: RawCard;
  searchText: string;
};

export type AssetManifest = {
  generatedAt: string;
  typstLibFiles: string[];
  staticAssetFiles: string[];
  cardDataFiles: string[];
  sources?: Record<string, unknown>;
};

export type RenderFormat = "svg" | "png" | "pdf";
