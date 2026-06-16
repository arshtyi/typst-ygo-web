import { defineConfig } from "vite";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const base = process.env.VITE_BASE_PATH ?? (process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : "/");

export default defineConfig({
  base,
  build: {
    sourcemap: true,
  },
});
