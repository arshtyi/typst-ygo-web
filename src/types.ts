export type CardKind = "ot" | "rd";

export type RawCard = {
  id: number;
  image: number;
  name: string;
  description: string;
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
  sources: {
    typstYgo: string;
    assets: string;
    cards: Record<CardKind, string>;
  };
  resourceVersions: {
    typstYgo: { revision: string };
    assets: { revision: string };
  };
};

export type CardRenderOptions = {
  compressDescription: boolean;
  drawPassword: boolean;
};
