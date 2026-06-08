import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["skills/agent-commons/scripts/sync-agent-commons.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
