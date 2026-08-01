export type CardKind = "ot" | "rd";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type RawCard = {
  [key: string]: JsonValue | undefined;
  id: number;
  image: number;
  name: string;
  description: string;
  attribute?: number;
  legend?: boolean;
  linkMarker?: number[];
  maximumAtk?: number | null;
  pendulumDescription?: string;
  type: string[];
};

export type IndexedCard = {
  kind: CardKind;
  card: RawCard;
  searchText: string;
  compactSearchText: string;
  compactSearchChars: ReadonlySet<string>;
};

export type AssetManifest = {
  generatedAt: string;
  typstLibFiles: string[];
  staticAssetFiles: string[];
  fontFiles: string[];
};

export type CardRenderOptions = {
  compressDescription: boolean;
  drawPassword: boolean;
};
