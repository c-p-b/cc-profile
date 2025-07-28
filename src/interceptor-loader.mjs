// ES Module loader for interceptor
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

// Get current directory from import.meta.url
const currentDir = dirname(fileURLToPath(import.meta.url));

const jsPath = join(currentDir, "interceptor.js");
const tsPath = join(currentDir, "interceptor.ts");

if (existsSync(jsPath)) {
  // Use compiled JavaScript - dynamic import without await
  import("./interceptor.js")
    .then(({ initializeInterceptor }) => {
      initializeInterceptor();
    })
    .catch((error) => {
      console.error("Error loading interceptor:", error.message);
      process.exit(1);
    });
} else if (existsSync(tsPath)) {
  // Use TypeScript via tsx
  import("tsx/esm/api")
    .then(() => {
      return import("./interceptor.ts");
    })
    .then(({ initializeInterceptor }) => {
      initializeInterceptor();
    })
    .catch((error) => {
      console.error("Error loading interceptor:", error.message);
      process.exit(1);
    });
} else {
  console.error("Could not find interceptor file");
  process.exit(1);
}
