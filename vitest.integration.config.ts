import { defineConfig } from "vitest/config";

// Integration tests against a real headless Zotero (see CONTRIBUTING.md). One Zotero instance is shared
// by all files, so files run one after another.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.itest.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
