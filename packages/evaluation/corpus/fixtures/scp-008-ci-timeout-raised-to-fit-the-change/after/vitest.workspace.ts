import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      include: ["packages/*/test/**/*.test.ts"],
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  },
]);
