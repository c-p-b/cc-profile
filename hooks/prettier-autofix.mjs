#!/usr/bin/env node
/**
 * Prettier Auto-Fix Hook for cc-profile
 * Automatically runs Prettier --write on supported files after Edit/Write operations
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Supported file extensions for Prettier
const SUPPORTED_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".jsonc",
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".yml",
  ".yaml",
  ".vue",
  ".svelte",
];

/**
 * Check if file should be processed by Prettier
 */
function shouldProcess(filePath) {
  if (!filePath) return false;

  const ext = path.extname(filePath);
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Run Prettier with --write on the specified file
 */
function runPrettierFix(filePath) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return false;
    }

    // Run Prettier with --write
    execSync(`npx prettier --write "${filePath}"`, {
      stdio: "pipe",
      encoding: "utf8",
      cwd: process.cwd(),
    });

    console.log(`✅ Prettier auto-format completed for: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`❌ Prettier failed for ${filePath}:`);
    if (error.stdout) {
      console.log(error.stdout);
    }
    if (error.stderr) {
      console.error(error.stderr);
    }

    // Return false for actual failures
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Read event from stdin
    let input = "";

    // Set up stdin reading
    process.stdin.setEncoding("utf8");

    for await (const chunk of process.stdin) {
      input += chunk;
    }

    // Parse the hook event
    const event = JSON.parse(input.trim());

    // Extract file path from tool input
    const filePath = event.tool_input?.file_path;

    if (!filePath) {
      console.log("No file path in tool input, skipping Prettier");
      process.exit(0);
    }

    // Check if we should process this file
    if (!shouldProcess(filePath)) {
      console.log(`Skipping Prettier for unsupported file: ${filePath}`);
      process.exit(0);
    }

    console.log(`Running Prettier auto-format on: ${filePath}`);

    // Run Prettier fix
    const success = runPrettierFix(filePath);

    // Exit with appropriate code (non-blocking)
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error("Prettier hook error:", error.message);
    process.exit(1);
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in Prettier hook:", error);
    process.exit(1);
  });
}
