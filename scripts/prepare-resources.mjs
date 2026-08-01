import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(projectRoot, "public");
const generatedRoot = join(publicRoot, "generated");
const typstYgoRoot = join(projectRoot, "vendor", "typst-ygo");
const ygoAssetsRoot = join(projectRoot, "vendor", "ygo-assets");
const typstLibRoot = join(typstYgoRoot, "lib");
const assetsRoot = join(ygoAssetsRoot, "assets");

const cardUrls = {
  ot: "https://github.com/arshtyi/ygo-cards/releases/download/latest/ot.json",
  rd: "https://github.com/arshtyi/ygo-cards/releases/download/latest/rd.json",
};

await assertSubmodule(typstYgoRoot, "lib/mod.typ");
await assertSubmodule(ygoAssetsRoot, "assets/ot/frame/000.png");
const [typstSourceFiles, assetSourceFiles] = await Promise.all([
  listFiles(typstLibRoot).then((files) => files.filter((path) => path.endsWith(".typ"))),
  listFiles(assetsRoot),
]);
const staticAssetSourceFiles = assetSourceFiles.filter(isStaticAsset);
const fontSourceFiles = assetSourceFiles.filter(isFontAsset);
const [, , fontFiles] = await Promise.all([
  stageFiles(join(generatedRoot, "typst-ygo", "lib"), typstLibRoot, typstSourceFiles),
  stageFiles(join(generatedRoot, "assets"), assetsRoot, staticAssetSourceFiles),
  stageFonts(join(generatedRoot, "fonts"), fontSourceFiles),
]);

console.log("Downloading card data...");
await Promise.all(
  Object.entries(cardUrls).map(([kind, url]) =>
    downloadCards(url, join(generatedRoot, "cards", `${kind}.json`)),
  ),
);

console.log("Writing resource manifest...");
await writeManifest(typstSourceFiles, staticAssetSourceFiles, fontFiles);
console.log("Resources ready.");

async function assertSubmodule(root, requiredFile) {
  const info = await stat(join(root, requiredFile)).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`Submodule is unavailable: ${relative(projectRoot, root)}. Run git submodule update --init.`);
  }
}

async function stageFiles(outputRoot, sourceRoot, sourceFiles) {
  await rm(outputRoot, { recursive: true, force: true });
  for (const sourcePath of sourceFiles) {
    const outputPath = join(outputRoot, relative(sourceRoot, sourcePath));
    await mkdir(dirname(outputPath), { recursive: true });
    await symlink(relative(dirname(outputPath), sourcePath), outputPath, "file");
  }
}

async function stageFonts(outputRoot, sourceFiles) {
  await rm(outputRoot, { recursive: true, force: true });
  const stagedFiles = [];
  const seenHashes = new Set();

  for (const sourcePath of sourceFiles) {
    const hash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
    if (seenHashes.has(hash)) {
      continue;
    }

    seenHashes.add(hash);
    const outputPath = join(outputRoot, `${hash}${extname(sourcePath).toLowerCase()}`);
    await mkdir(dirname(outputPath), { recursive: true });
    await symlink(relative(dirname(outputPath), sourcePath), outputPath, "file");
    stagedFiles.push(outputPath);
  }

  return stagedFiles;
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

async function writeManifest(typstFiles, assetFiles, fontFiles) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    typstLibFiles: typstFiles.map((path) =>
      toPublicPath(join(generatedRoot, "typst-ygo", "lib", relative(typstLibRoot, path))),
    ),
    staticAssetFiles: assetFiles.map((path) =>
      toPublicPath(join(generatedRoot, "assets", relative(assetsRoot, path))),
    ),
    fontFiles: fontFiles.map(toPublicPath),
  };

  await writeFile(join(generatedRoot, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
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
  return (
    /^(ot|rd)\//u.test(assetPath) &&
    !assetPath.includes("/card/") &&
    !assetPath.includes("/font/") &&
    !assetPath.includes("/images/")
  );
}

function isFontAsset(path) {
  const assetPath = relative(assetsRoot, path).split(sep).join("/");
  return /^(ot|rd)\/font\/.+\.(ttf|otf)$/iu.test(assetPath);
}

function toPublicPath(path) {
  return relative(generatedRoot, path).split(sep).join("/");
}
