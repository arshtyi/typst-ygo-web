import { createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(projectRoot, "public");
const assetsRoot = join(publicRoot, "assets");
const typstYgoRoot = join(publicRoot, "typst-ygo");
const tmpRoot = join(projectRoot, ".tmp", "sync-resources");

const TYPST_YGO_RAW_ROOT = "https://raw.githubusercontent.com/arshtyi/typst-ygo/main";
const TYPST_YGO_REPO_URL = "https://github.com/arshtyi/typst-ygo.git";
const TYPST_YGO_LIB_FALLBACK_FILES = [
  "lib/mod.typ",
  "lib/ot/data.typ",
  "lib/ot/layout.typ",
  "lib/ot/renderer.typ",
  "lib/rd/data.typ",
  "lib/rd/layout.typ",
  "lib/rd/renderer.typ",
  "lib/utils/fit-text.typ",
  "lib/utils/jpeg-size.typ",
  "lib/utils/scale-x-to-fit.typ",
];
const ASSETS_URL = "https://github.com/arshtyi/ygo-assets/releases/download/latest/assets.tar.xz";
const CARD_URLS = {
  ot: "https://github.com/arshtyi/ygo-cards/releases/download/latest/ot.json",
  rd: "https://github.com/arshtyi/ygo-cards/releases/download/latest/rd.json",
};
const refreshAssets = shouldRefreshAssets();

function shouldRefreshAssets() {
  if (process.argv.includes("--refresh-assets")) {
    return true;
  }

  return /^(1|true|yes)$/iu.test(process.env.REFRESH_ASSETS ?? "");
}

async function fetchChecked(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "typst-ygo-web-resource-sync",
        },
      });
      if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

async function downloadFile(url, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  const response = await fetchChecked(url);
  await pipeline(response.body, createWriteStream(outputPath));
}

async function downloadText(url) {
  return await (await fetchChecked(url)).text();
}

async function syncTypstYgoLib() {
  await rm(typstYgoRoot, { recursive: true, force: true });
  const cloneRoot = join(tmpRoot, "typst-ygo");
  let copiedFromClone = false;

  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", TYPST_YGO_REPO_URL, cloneRoot], {
      cwd: projectRoot,
    });
    await execFileAsync("git", ["-C", cloneRoot, "sparse-checkout", "set", "lib"], { cwd: projectRoot });
  } catch (error) {
    console.warn(`Sparse clone failed: ${error.message}`);
  }

  if (await isFile(join(cloneRoot, "lib", "mod.typ"))) {
    await mkdir(typstYgoRoot, { recursive: true });
    await cp(join(cloneRoot, "lib"), join(typstYgoRoot, "lib"), { recursive: true });
    copiedFromClone = true;
  }

  if (!copiedFromClone) {
    console.warn("Falling back to raw typst-ygo lib file downloads.");
    for (const path of TYPST_YGO_LIB_FALLBACK_FILES) {
      const content = await downloadText(`${TYPST_YGO_RAW_ROOT}/${path}`);
      const outputPath = join(typstYgoRoot, path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content);
    }
  }

  const libFiles = (await listFiles(join(typstYgoRoot, "lib")))
    .map((path) => relative(typstYgoRoot, path).split(sep).join("/"))
    .filter((path) => path.endsWith(".typ"))
    .sort();

  if (libFiles.length === 0) {
    throw new Error("No typst-ygo lib files were found in the upstream repository tree.");
  }

  for (const path of libFiles) {
    const content = await downloadText(`${TYPST_YGO_RAW_ROOT}/${path}`);
    const outputPath = join(typstYgoRoot, path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }

  await writeFile(
    join(typstYgoRoot, "manifest.json"),
    JSON.stringify(
      {
        source: "https://github.com/arshtyi/typst-ygo",
        syncedAt: new Date().toISOString(),
        files: libFiles.map((path) => `typst-ygo/${path}`),
      },
      null,
      2,
    ),
  );
}

async function isFile(path) {
  return (await stat(path).catch(() => null))?.isFile() === true;
}

async function hasUsableStaticAssets() {
  const files = await listFiles(assetsRoot).catch(() => []);
  return files.some((file) => {
    const rel = relative(publicRoot, file).split(sep).join("/");
    return (
      !basename(rel).startsWith(".") &&
      !rel.includes("/images/") &&
      !rel.endsWith("/card/ot.json") &&
      !rel.endsWith("/card/rd.json")
    );
  });
}

async function findAssetsPayloadRoot(root) {
  const candidates = [root];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      candidates.push(join(root, entry.name));
    }
  }

  for (const candidate of candidates) {
    const children = new Set(await readdir(candidate).catch(() => []));
    if (children.has("ot") && children.has("rd")) {
      return candidate;
    }
    if (children.has("assets")) {
      const nested = join(candidate, "assets");
      const nestedChildren = new Set(await readdir(nested).catch(() => []));
      if (nestedChildren.has("ot") && nestedChildren.has("rd")) {
        return nested;
      }
    }
  }

  throw new Error("Extracted assets archive did not contain assets/ot and assets/rd.");
}

async function syncAssetsArchive() {
  const archivePath = join(tmpRoot, "assets.tar.xz");
  const extractRoot = join(tmpRoot, "assets-extract");

  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  await downloadFile(ASSETS_URL, archivePath);
  await execFileAsync("tar", ["-xJf", archivePath, "-C", extractRoot], { cwd: projectRoot });

  const payloadRoot = await findAssetsPayloadRoot(extractRoot);
  await rm(assetsRoot, { recursive: true, force: true });
  await mkdir(assetsRoot, { recursive: true });
  await cp(payloadRoot, assetsRoot, { recursive: true });

  for (const kind of ["ot", "rd"]) {
    await rm(join(assetsRoot, kind, "images"), { recursive: true, force: true });
    await mkdir(join(assetsRoot, kind, "images"), { recursive: true });
  }
}

async function syncCardData() {
  for (const [kind, url] of Object.entries(CARD_URLS)) {
    await downloadFile(url, join(assetsRoot, kind, "card", `${kind}.json`));
  }
}

async function listFiles(root) {
  const files = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  await walk(root);
  return files.sort();
}

async function createAssetManifest() {
  const typstManifest = JSON.parse(await readFile(join(typstYgoRoot, "manifest.json"), "utf8"));
  const assetFiles = await listFiles(assetsRoot);
  const staticAssetFiles = [];
  const cardDataFiles = [];

  for (const file of assetFiles) {
    const rel = relative(publicRoot, file).split(sep).join("/");
    if (basename(rel).startsWith(".")) {
      continue;
    }
    if (rel.includes("/images/")) {
      continue;
    }
    if (rel.endsWith("/card/ot.json") || rel.endsWith("/card/rd.json")) {
      cardDataFiles.push(rel);
    } else {
      staticAssetFiles.push(rel);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: {
      typstYgo: "https://github.com/arshtyi/typst-ygo",
      assets: ASSETS_URL,
      cards: CARD_URLS,
    },
    typstLibFiles: typstManifest.files,
    staticAssetFiles,
    cardDataFiles,
  };

  await writeFile(join(publicRoot, "asset-manifest.json"), JSON.stringify(manifest, null, 2));
}

async function assertUsableAssets() {
  const required = [
    join(typstYgoRoot, "lib", "mod.typ"),
    join(assetsRoot, "ot", "card", "ot.json"),
    join(assetsRoot, "rd", "card", "rd.json"),
  ];

  for (const path of required) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new Error(`Required generated file is missing or empty: ${path}`);
    }
  }

  if (!(await hasUsableStaticAssets())) {
    throw new Error("Static assets are missing. Re-run with --refresh-assets or REFRESH_ASSETS=true.");
  }
}

await rm(tmpRoot, { recursive: true, force: true });
await mkdir(tmpRoot, { recursive: true });

console.log("Syncing typst-ygo lib files...");
await syncTypstYgoLib();

if (refreshAssets) {
  console.log(`Refreshing static assets from ${basename(ASSETS_URL)}...`);
  await syncAssetsArchive();
} else if (!(await hasUsableStaticAssets())) {
  console.log(`Static assets are missing; downloading ${basename(ASSETS_URL)}...`);
  await syncAssetsArchive();
} else {
  console.log("Keeping existing static assets.");
}

console.log("Downloading latest card data...");
await syncCardData();

console.log("Writing public/asset-manifest.json...");
await createAssetManifest();
await assertUsableAssets();

console.log("Resource sync complete.");
