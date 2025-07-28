import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { join } from "path";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    otlp: "src/otlp-index.ts",
  },
  format: ["iife"],
  outDir: "dist",
  minify: true,
  sourcemap: "inline",
  clean: false, // Don't clean CSS file
  noExternal: ["lit", "marked", "highlight.js", "d3"],
  target: "es2022",
  esbuildOptions: (options) => {
    options.banner = {
      js: "/* Claude Tools Frontend Bundle */",
    };

    // Source maps enabled for debugging

    // Inject CSS content - read dynamically on each build
    options.define = {
      ...options.define,
      get __CSS_CONTENT__() {
        try {
          return JSON.stringify(
            readFileSync(join(process.cwd(), "dist/styles.css"), "utf8"),
          );
        } catch {
          return JSON.stringify("");
        }
      },
    };
  },
});
