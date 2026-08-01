import {
  mkdir,
  readdir,
  readlink,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(projectRoot, "public");
const typstYgoRoot = join(projectRoot, "vendor", "typst-ygo");
const ygoAssetsRoot = join(projectRoot, "vendor", "ygo-assets");
const assetsRoot = join(ygoAssetsRoot, "assets");

const sources = {
  typstYgo: "https://github.com/arshtyi/typst-ygo",
  assets: "https://github.com/arshtyi/ygo-assets",
  cards: {
    ot: "https://github.com/arshtyi/ygo-cards/releases/download/latest/ot.json",
    rd: "https://github.com/arshtyi/ygo-cards/releases/download/latest/rd.json",
  },
};

await assertSubmodule(typstYgoRoot, "lib/mod.typ");
await assertSubmodule(ygoAssetsRoot, "assets/ot/frame/000.png");
await linkDirectory(join(publicRoot, "typst-ygo", "lib"), join(typstYgoRoot, "lib"));
await linkDirectory(join(publicRoot, "assets"), assetsRoot);

console.log("Downloading card data...");
await Promise.all(
  Object.entries(sources.cards).map(([kind, url]) =>
    downloadCards(url, join(publicRoot, "cards", `${kind}.json`)),
  ),
);

console.log("Writing resource manifest...");
await writeManifest();
console.log("Resources ready.");

async function assertSubmodule(root, requiredFile) {
  const info = await stat(join(root, requiredFile)).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`Submodule is unavailable: ${relative(projectRoot, root)}. Run git submodule update --init.`);
  }
}

async function linkDirectory(linkPath, targetPath) {
  const expectedTarget = relative(dirname(linkPath), targetPath);
  const currentTarget = await readlink(linkPath).catch(() => null);
  if (currentTarget !== null && resolve(dirname(linkPath), currentTarget) === targetPath) {
    return;
  }

  if (await stat(linkPath).catch(() => null)) {
    throw new Error(`Generated resource path must be a symlink: ${relative(projectRoot, linkPath)}`);
  }

  await mkdir(dirname(linkPath), { recursive: true });
  if (currentTarget !== null) {
    await unlink(linkPath);
  }
  await symlink(expectedTarget, linkPath, "dir");
}

async function downloadCards(url, outputPath) {
  const response = await fetchWithRetry(url);
  const data = new Uint8Array(await response.arrayBuffer());
  validateCards(data, url);

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, outputPath);
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "typst-ygo-web-resource-preparer" },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 1000));
      }
    }
  }
  throw new Error(`Failed to download ${url}: ${String(lastError)}`);
}

function validateCards(data, sourceUrl) {
  const cards = JSON.parse(new TextDecoder().decode(data));
  if (
    !Array.isArray(cards) ||
    cards.length === 0 ||
    cards.some(
      (card) =>
        typeof card !== "object" ||
        card === null ||
        !Number.isSafeInteger(card.id) ||
        !Number.isSafeInteger(card.image) ||
        typeof card.name !== "string" ||
        typeof card.description !== "string" ||
        !Array.isArray(card.type),
    )
  ) {
    throw new Error(`Card data has an unsupported shape: ${sourceUrl}`);
  }
}

async function writeManifest() {
  const typstLibRoot = join(typstYgoRoot, "lib");
  const typstLibFiles = (await listFiles(typstLibRoot))
    .filter((path) => path.endsWith(".typ"))
    .map((path) =>
      toPublicPath(join(publicRoot, "typst-ygo", "lib", relative(typstLibRoot, path))),
    );
  const staticAssetFiles = (await listFiles(assetsRoot))
    .filter(isStaticAsset)
    .map((path) => toPublicPath(join(publicRoot, "assets", relative(assetsRoot, path))));

  const manifest = {
    generatedAt: new Date().toISOString(),
    sources,
    typstLibFiles,
    staticAssetFiles,
  };

  await writeFile(join(publicRoot, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

function isStaticAsset(path) {
  const assetPath = relative(assetsRoot, path).split(sep).join("/");
  return /^(ot|rd)\//u.test(assetPath) && !assetPath.includes("/card/") && !assetPath.includes("/images/");
}

function toPublicPath(path) {
  return relative(publicRoot, path).split(sep).join("/");
}
