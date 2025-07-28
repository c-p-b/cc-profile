#!/usr/bin/env node
/**
 * ESLint Check Hook for cc-profile
 * Runs ESLint in check mode on JavaScript/TypeScript files at session end
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Supported file extensions for ESLint
const SUPPORTED_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];

/**
 * Find all supported files in the current directory and subdirectories
 */
function findSupportedFiles(dir = process.cwd(), files = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip node_modules, .git, and other common ignored directories
      if (entry.isDirectory()) {
        if (
          ![
            "node_modules",
            ".git",
            "dist",
            "build",
            ".next",
            "coverage",
          ].includes(entry.name)
        ) {
          findSupportedFiles(fullPath, files);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (_error) {
    // Skip directories we can't read
  }

  return files;
}

/**
 * Run ESLint in check mode on all supported files
 */
function runESLintCheck() {
  try {
    // Find all supported files
    const files = findSupportedFiles();

    if (files.length === 0) {
      console.log("No JavaScript/TypeScript files found to check");
      return true;
    }

    console.log(`🔍 Running ESLint check on ${files.length} files...`);

    // Run ESLint in check mode
    const result = execSync(
      'npx eslint . --ext .js,.jsx,.ts,.tsx,.mjs,.cjs --ignore-pattern "frontend/src/utils/" --ignore-pattern "frontend/dist/**" --ignore-pattern "zipkin-lens/"',
      {
        stdio: "pipe",
        encoding: "utf8",
        cwd: process.cwd(),
      },
    );

    console.log("✅ ESLint check passed - no issues found");
    if (result.trim()) {
      console.log(result);
    }
    return true;
  } catch (_error) {
    console.log("❌ ESLint check found issues:");
    if (_error.stdout) {
      console.log(_error.stdout);
    }
    if (_error.stderr) {
      console.error(_error.stderr);
    }

    // Return false to indicate issues were found (blocking on Stop)
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

    // Only run on Stop events
    if (event.hook_event_name !== "Stop") {
      console.log("ESLint check only runs on Stop events");
      process.exit(0);
    }

    console.log("Running ESLint check at session end...");

    // Run ESLint check
    const success = runESLintCheck();

    // Exit with appropriate code (BLOCKING on Stop - exit code 2 blocks and feeds stderr to Claude)
    if (!success) {
      console.error(
        "🚨 ESLint check failed - Fix ESLint issues before proceeding",
      );
      // Exit with code 2 to block the session (feeds stderr back to Claude)
      process.exit(2);
    }

    process.exit(0);
  } catch (_error) {
    console.error("ESLint check hook error:", _error.message);
    process.exit(2);
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((_error) => {
    console.error("Fatal error in ESLint check hook:", _error);
    process.exit(1);
  });
}
