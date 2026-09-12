import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      include: ["packages/*/test/**/*.test.ts"],
      testTimeout: 5_000,
      hookTimeout: 5_000,
    },
  },
]);
