#!/usr/bin/env node
/**
 * Jest Coverage Check Hook for cc-profile
 * Runs Jest tests with coverage check on Stop event (non-blocking)
 * Exits with code 1 if coverage is below 80% threshold
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Check if Jest is configured in the project
 */
function hasJestConfig() {
  const cwd = process.cwd();
  const configFiles = [
    "jest.config.js",
    "jest.config.ts",
    "jest.config.json",
    "jest.config.mjs",
  ];

  // Check for Jest config files
  for (const configFile of configFiles) {
    if (fs.existsSync(path.join(cwd, configFile))) {
      return true;
    }
  }

  // Check for Jest config in package.json
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    );
    return packageJson.jest !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if Jest is available as dependency
 */
function hasJestDependency() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };
    return "jest" in allDeps;
  } catch {
    return false;
  }
}

/**
 * Run Jest tests with coverage
 */
function runJestCoverage() {
  try {
    console.log("🧪 Running Jest tests with coverage check...");

    // Run Jest with coverage
    const result = execSync("npm test", {
      stdio: "pipe",
      encoding: "utf8",
      cwd: process.cwd(),
    });

    console.log("✅ Jest tests passed with 80%+ coverage");
    if (result.trim()) {
      console.log(result);
    }
    return true;
  } catch (error) {
    console.log("❌ Jest tests failed or coverage below 80% threshold:");
    if (error.stdout) {
      console.log(error.stdout);
    }
    if (error.stderr) {
      console.error(error.stderr);
    }

    // Return false to indicate test/coverage failure
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
      console.log("Jest coverage check only runs on Stop events");
      process.exit(0);
    }

    console.log("Running Jest coverage check at session end...");

    // Check if Jest is configured and available
    if (!hasJestConfig()) {
      console.log("⚠️  No Jest configuration found - skipping coverage check");
      process.exit(0);
    }

    if (!hasJestDependency()) {
      console.log(
        "⚠️  Jest not found in dependencies - skipping coverage check",
      );
      process.exit(0);
    }

    // Run Jest with coverage
    const success = runJestCoverage();

    // Exit with code 1 for non-blocking failure notification
    if (!success) {
      console.error(
        "🚨 Jest coverage check failed - Tests failed or coverage below 80%",
      );
      // Exit with code 1 (non-blocking - just reports the failure)
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error("Jest coverage check hook error:", error.message);
    process.exit(1);
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in Jest coverage check hook:", error);
    process.exit(1);
  });
}
