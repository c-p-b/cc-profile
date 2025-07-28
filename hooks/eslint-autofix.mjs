#!/usr/bin/env node
/**
 * ESLint Auto-Fix Hook for cc-profile
 * Automatically runs ESLint --fix on JavaScript/TypeScript files after Edit/Write operations
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Supported file extensions for ESLint
const SUPPORTED_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];

/**
 * Check if file should be processed by ESLint
 */
function shouldProcess(filePath) {
  if (!filePath) return false;

  const ext = path.extname(filePath);
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Run ESLint with --fix on the specified file
 */
function runESLintFix(filePath) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return false;
    }

    // Run ESLint with --fix
    execSync(`npx eslint --fix "${filePath}"`, {
      stdio: "pipe",
      encoding: "utf8",
      cwd: process.cwd(),
    });

    console.log(`✅ ESLint auto-fix completed for: ${filePath}`);
    return true;
  } catch (error) {
    // ESLint returns non-zero exit code if there are unfixable errors
    // This is normal behavior, not necessarily a failure
    if (error.stdout) {
      console.log(`ESLint output for ${filePath}:`);
      console.log(error.stdout);
    }
    if (error.stderr) {
      console.error(`ESLint errors for ${filePath}:`);
      console.error(error.stderr);
    }

    // Return true if ESLint ran (even with errors), false only if it failed to run
    return error.status !== undefined;
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
      console.log("No file path in tool input, skipping ESLint");
      process.exit(0);
    }

    // Check if we should process this file
    if (!shouldProcess(filePath)) {
      console.log(`Skipping ESLint for non-JS/TS file: ${filePath}`);
      process.exit(0);
    }

    console.log(`Running ESLint auto-fix on: ${filePath}`);

    // Run ESLint fix
    const success = runESLintFix(filePath);

    // Exit with appropriate code (non-blocking)
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error("ESLint hook error:", error.message);
    process.exit(1);
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in ESLint hook:", error);
    process.exit(1);
  });
}
