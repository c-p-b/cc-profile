#!/usr/bin/env node

import { spawn, ChildProcess, execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { OTLPHTMLGenerator } from "./otlp-html-generator.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
export const colors = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  blue: "\x1b[0;34m",
  reset: "\x1b[0m",
} as const;

type ColorName = keyof typeof colors;

function log(message: string, color: ColorName = "reset"): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function showHelp(): void {
  console.log(`
${colors.blue}cc-profile${colors.reset}
Zero-Touch Tracing & Observability for Claude Code

${colors.yellow}USAGE:${colors.reset}
  cc-profile [OPTIONS] [--run-with CLAUDE_ARG...]

${colors.yellow}OPTIONS:${colors.reset}
  init              Initialize cc-profile hooks and setup
  --generate-html    Generate HTML report from JSONL file
  --index           Generate conversation summaries and index for .cc-profile/ directory
  --run-with         Pass all following arguments to Claude process
  --include-all-requests Include all requests made through fetch, otherwise only requests to v1/messages with more than 2 messages in the context
  --no-open          Don't open generated HTML file in browser (works with --generate-html)
  --help, -h         Show this help message

${colors.yellow}MODES:${colors.reset}
  ${colors.green}Interactive logging:${colors.reset}
    cc-profile                               Start Claude with traffic logging
    cc-profile --run-with chat                    Run Claude with specific command
    cc-profile --run-with chat --model sonnet-3.5 Run Claude with multiple arguments

  ${colors.green}HTML generation:${colors.reset}
    cc-profile --generate-html file.jsonl          Generate HTML from JSONL file
    cc-profile --generate-html file.jsonl out.html Generate HTML with custom output name
    cc-profile --generate-html file.jsonl          Generate HTML and open in browser (default)
    cc-profile --generate-html file.jsonl --no-open Generate HTML without opening browser

  ${colors.green}Indexing:${colors.reset}
    cc-profile --index                             Generate conversation summaries and index

${colors.yellow}EXAMPLES:${colors.reset}
  # Start Claude with logging
  cc-profile

  # Run Claude chat with logging
  cc-profile --run-with chat

  # Run Claude with specific model
  cc-profile --run-with chat --model sonnet-3.5

  # Pass multiple arguments to Claude
  cc-profile --run-with --model gpt-4o --temperature 0.7

  # Generate HTML report
  cc-profile --generate-html logs/traffic.jsonl report.html

  # Generate HTML report and open in browser (default)
  cc-profile --generate-html logs/traffic.jsonl

  # Generate HTML report without opening browser
  cc-profile --generate-html logs/traffic.jsonl --no-open

  # Generate conversation index
  cc-profile --index

${colors.yellow}OUTPUT:${colors.reset}
  Logs are saved to: ${colors.green}~/.cc-profile/logs/<run_id>/events.{jsonl,html}${colors.reset}

${colors.yellow}MIGRATION:${colors.reset}
  This tool replaces Python-based claude-logger and claude-token.py scripts
  with a pure Node.js implementation. All output formats are compatible.

For more information, visit: https://github.com/cc-profile/cc-profile
`);
}

function resolveToJsFile(filePath: string): string {
  try {
    // First, resolve any symlinks
    const realPath = fs.realpathSync(filePath);

    // Check if it's already a JS file
    if (realPath.endsWith(".js")) {
      return realPath;
    }

    // If it's a Node.js shebang script, check if it's actually a JS file
    if (fs.existsSync(realPath)) {
      const content = fs.readFileSync(realPath, "utf-8");
      // Check for Node.js shebang
      if (
        content.startsWith("#!/usr/bin/env node") ||
        content.match(/^#!.*\/node$/m) ||
        content.includes("require(") ||
        content.includes("import ")
      ) {
        // This is likely a JS file without .js extension
        return realPath;
      }
    }

    // If not a JS file, try common JS file locations
    const possibleJsPaths = [
      realPath + ".js",
      realPath.replace(/\/bin\//, "/lib/") + ".js",
      realPath.replace(/\/\.bin\//, "/lib/bin/") + ".js",
    ];

    for (const jsPath of possibleJsPaths) {
      if (fs.existsSync(jsPath)) {
        return jsPath;
      }
    }

    // Fall back to original path
    return realPath;
  } catch (_error) {
    // If resolution fails, return original path
    return filePath;
  }
}

function _getClaudeAbsolutePath(): string {
  try {
    let claudePath = execSync("which claude", {
      encoding: "utf-8",
    }).trim();

    // Handle shell aliases (e.g., "claude: aliased to /path/to/claude")
    const aliasMatch = claudePath.match(/:\s*aliased to\s+(.+)$/);
    if (aliasMatch && aliasMatch[1]) {
      claudePath = aliasMatch[1];
    }

    // Check if the path is a bash wrapper
    if (fs.existsSync(claudePath)) {
      const content = fs.readFileSync(claudePath, "utf-8");
      if (content.startsWith("#!/bin/bash")) {
        // Parse bash wrapper to find actual executable
        const execMatch = content.match(/exec\s+"([^"]+)"/);
        if (execMatch && execMatch[1]) {
          const actualPath = execMatch[1];
          // Resolve any symlinks to get the final JS file
          return resolveToJsFile(actualPath);
        }
      }
    }

    return resolveToJsFile(claudePath);
  } catch (_error) {
    // First try the local bash wrapper
    const localClaudeWrapper = path.join(
      os.homedir(),
      ".claude",
      "local",
      "claude",
    );

    if (fs.existsSync(localClaudeWrapper)) {
      const content = fs.readFileSync(localClaudeWrapper, "utf-8");
      if (content.startsWith("#!/bin/bash")) {
        const execMatch = content.match(/exec\s+"([^"]+)"/);
        if (execMatch && execMatch[1]) {
          return resolveToJsFile(execMatch[1]);
        }
      }
    }

    // Then try the node_modules/.bin path
    const localClaudePath = path.join(
      os.homedir(),
      ".claude",
      "local",
      "node_modules",
      ".bin",
      "claude",
    );
    if (fs.existsSync(localClaudePath)) {
      return resolveToJsFile(localClaudePath);
    }

    log(`Claude CLI not found in PATH`, "red");
    log(`Also checked for local installation at: ${localClaudeWrapper}`, "red");
    log(`Please install Claude Code CLI first`, "red");
    process.exit(1);
  }
}

// Scenario 1: Launch Claude with interceptor
async function runClaudeWithInterception(
  claudeArgs: string[] = [],
  includeAllRequests: boolean = false,
  openInBrowser: boolean = false,
): Promise<void> {
  log("cc-profile", "blue");
  if (claudeArgs.length > 0) {
    log(`Claude arguments: ${claudeArgs.join(" ")}`, "blue");
  }
  console.log("");

  // Check if interceptor runner exists
  const interceptorRunnerPath = path.join(__dirname, "interceptor-runner.js");
  if (!fs.existsSync(interceptorRunnerPath)) {
    log(`Interceptor runner not found at: ${interceptorRunnerPath}`, "red");
    log("Run 'npm run build' first", "yellow");
    process.exit(1);
  }

  log("Starting interceptor...", "green");
  console.log("");

  // Launch the interceptor runner with Claude arguments
  const child: ChildProcess = spawn(
    "node",
    [interceptorRunnerPath, ...claudeArgs],
    {
      env: {
        ...process.env,
        NODE_OPTIONS: "--no-deprecation",
        CC_PROFILE_INCLUDE_ALL_REQUESTS: includeAllRequests ? "true" : "false",
        CC_PROFILE_OPEN_HTML: openInBrowser ? "true" : "false",
      },
      stdio: "inherit",
      cwd: process.cwd(),
    },
  );

  // Handle child process events
  child.on("error", (error: Error) => {
    log(`Error starting interceptor: ${error.message}`, "red");
    process.exit(1);
  });

  child.on("exit", (code: number | null, signal: string | null) => {
    if (signal) {
      log(`\nInterceptor terminated by signal: ${signal}`, "yellow");
    } else if (code !== 0 && code !== null) {
      log(`\nInterceptor exited with code: ${code}`, "yellow");
    } else {
      log("\nClaude session completed", "green");
    }
  });

  // Handle our own signals
  const handleSignal = (signal: string) => {
    log(`\nReceived ${signal}, shutting down...`, "yellow");
    if (child.pid) {
      child.kill(signal as NodeJS.Signals);
    }
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  // Wait for child process to complete
  try {
    await new Promise<void>((resolve, reject) => {
      child.on("exit", () => resolve());
      child.on("error", reject);
    });
  } catch (error) {
    const err = error as Error;
    log(`Unexpected error: ${err.message}`, "red");
    process.exit(1);
  }
}

// Scenario 3: --generate-html input.otlp.jsonl output.html
async function generateHTMLFromCLI(
  inputFile: string,
  outputFile?: string,
  _includeAllRequests: boolean = true,
  openInBrowser: boolean = false,
): Promise<void> {
  try {
    log(`Generating HTML from OTLP trace: ${inputFile}`, "blue");

    // Default output file if not provided
    if (!outputFile) {
      outputFile = inputFile.replace(/\.jsonl$/, ".html");
    }

    const htmlGenerator = new OTLPHTMLGenerator();
    await htmlGenerator.generateHTML(inputFile, outputFile, {
      title: `cc-profile Report - ${path.basename(path.dirname(inputFile))}`,
    });

    log(`Generated HTML report: ${outputFile}`, "green");

    if (openInBrowser) {
      spawn("open", [outputFile], {
        detached: true,
        stdio: "ignore",
      }).unref();
      log(`Opening ${outputFile} in browser`, "green");
    }

    process.exit(0);
  } catch (error) {
    const err = error as Error;
    log(`Error: ${err.message}`, "red");
    process.exit(1);
  }
}

// Scenario 4: --index
async function generateIndex(): Promise<void> {
  log(
    "Index generation temporarily disabled - needs OTLP format update",
    "yellow",
  );
  process.exit(0);
}

// Type for Claude settings.json structure
interface ClaudeSettings {
  hooks?: Record<string, any>;
  [key: string]: unknown;
}

// Initialize cc-profile: setup hooks and wrapper
async function initCCProfile(): Promise<void> {
  log("Initializing cc-profile...", "blue");

  const homeDir = os.homedir();

  // Create directories
  const ccProfileDir = path.join(homeDir, ".cc-profile");
  const binDir = path.join(ccProfileDir, "bin");

  try {
    // Create directories (only need logs and bin now)
    fs.mkdirSync(ccProfileDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    log("✓ Created cc-profile directories", "green");

    // Update ~/.claude/settings.json to remove old hooks if present
    const claudeDir = path.join(homeDir, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    // Ensure .claude directory exists
    fs.mkdirSync(claudeDir, { recursive: true });

    // Read existing settings or create new
    let settings: ClaudeSettings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      } catch (_err) {
        log(
          "Warning: Could not parse existing settings.json, creating new one",
          "yellow",
        );
      }
    }

    // Write settings file to ensure it exists
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    log("✓ Updated ~/.claude/settings.json", "green");

    // Discover and symlink the real Claude binary
    let realClaudePath: string;
    try {
      // First try to detect current claude before it's aliased
      const currentClaudeCheck = execSync(
        'command -v claude 2>/dev/null || echo ""',
        { encoding: "utf-8" },
      ).trim();

      if (
        currentClaudeCheck &&
        !currentClaudeCheck.includes("cc-profile-wrapper")
      ) {
        realClaudePath = currentClaudeCheck;
      } else {
        // Try common Claude installation paths
        const commonPaths = [
          "/Users/cpb/.npm-packages/bin/claude",
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
        ];

        realClaudePath = "";
        for (const path of commonPaths) {
          if (fs.existsSync(path)) {
            realClaudePath = path;
            break;
          }
        }

        if (!realClaudePath) {
          throw new Error("Claude CLI not found in common paths");
        }
      }

      // Resolve any symlinks to get the actual binary
      realClaudePath = fs.realpathSync(realClaudePath);

      // Create symlink to preserve access to original Claude
      const claudeOriginalPath = path.join(binDir, "claude-original");
      if (fs.existsSync(claudeOriginalPath)) {
        fs.unlinkSync(claudeOriginalPath); // Remove existing symlink
      }
      fs.symlinkSync(realClaudePath, claudeOriginalPath);

      log(`✓ Created symlink: claude-original → ${realClaudePath}`, "green");
    } catch (error) {
      log(`Error finding Claude CLI: ${(error as Error).message}`, "red");
      log("Please ensure Claude Code CLI is installed and accessible", "red");
      process.exit(1);
    }

    // Create wrapper script
    const wrapperContent = `#!/bin/bash
# cc-profile wrapper for Claude Code

# Parse cc-profile specific arguments
CC_OPEN=false
CC_NO_TRACE=false
CC_REPORT=false
CLAUDE_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --cc-open)
      CC_OPEN=true
      shift
      ;;
    --cc-no-trace)
      CC_NO_TRACE=true
      shift
      ;;
    --cc-report)
      CC_REPORT=true
      shift
      ;;
    *)
      CLAUDE_ARGS+=("$1")
      shift
      ;;
  esac
done

# Use the symlinked original Claude binary (no detection needed)
CLAUDE_ORIGINAL="${path.join(binDir, "claude-original")}"

# If tracing is disabled, just run claude directly
if [ "$CC_NO_TRACE" = true ]; then
  exec "$CLAUDE_ORIGINAL" "\${CLAUDE_ARGS[@]}"
fi

# Set up environment for cc-profile
export CC_PROFILE_OPEN_HTML=$CC_OPEN
export CC_PROFILE_REPORT_ONLY=$CC_REPORT

# Use global cc-profile installation - much simpler!
exec cc-profile --run-with "\${CLAUDE_ARGS[@]}"
`;

    const wrapperPath = path.join(binDir, "cc-profile-wrapper");
    fs.writeFileSync(wrapperPath, wrapperContent);
    fs.chmodSync(wrapperPath, 0o755);
    log("✓ Created wrapper script", "green");

    // Show shell alias instructions
    console.log("");
    log(
      "Setup complete! To enable cc-profile tracing, add this alias to your shell config:",
      "yellow",
    );
    console.log("");
    console.log(`  ${colors.green}# For bash (~/.bashrc):${colors.reset}`);
    console.log(`  claude() { ${wrapperPath} "$@"; }`);
    console.log("");
    console.log(`  ${colors.green}# For zsh (~/.zshrc):${colors.reset}`);
    console.log(`  claude() { ${wrapperPath} "$@"; }`);
    console.log("");
    console.log(
      `  ${colors.green}# For fish (~/.config/fish/config.fish):${colors.reset}`,
    );
    console.log(`  function claude`);
    console.log(`    ${wrapperPath} $argv`);
    console.log(`  end`);
    console.log("");
    log(
      "After adding the alias, restart your shell or run 'source ~/.bashrc' (or equivalent)",
      "blue",
    );
    console.log("");
    log("Usage:", "yellow");
    console.log("  claude chat                    # Normal usage with tracing");
    console.log(
      "  claude --cc-open chat          # Open HTML report when done",
    );
    console.log(
      "  claude --cc-no-trace chat      # Disable tracing for this run",
    );
    console.log("");
  } catch (error) {
    const err = error as Error;
    log(`Error during initialization: ${err.message}`, "red");
    process.exit(1);
  }
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Split arguments at --run-with flag
  const argIndex = args.indexOf("--run-with");
  let claudeTraceArgs: string[];
  let claudeArgs: string[];

  if (argIndex !== -1) {
    claudeTraceArgs = args.slice(0, argIndex);
    claudeArgs = args.slice(argIndex + 1);
  } else {
    claudeTraceArgs = args;
    claudeArgs = [];
  }

  // Check for help flags
  if (claudeTraceArgs.includes("--help") || claudeTraceArgs.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  // Check for include all requests flag
  const includeAllRequests = claudeTraceArgs.includes("--include-all-requests");

  // Check for no-open flag (inverted logic - open by default)
  const openInBrowser = !claudeTraceArgs.includes("--no-open");

  // Scenario 2: --generate-html input.jsonl [output.html]
  if (claudeTraceArgs.includes("--generate-html")) {
    const flagIndex = claudeTraceArgs.indexOf("--generate-html");
    const inputFile = claudeTraceArgs[flagIndex + 1];

    // Find the next argument that's not a flag as the output file
    let outputFile: string | undefined;
    for (let i = flagIndex + 2; i < claudeTraceArgs.length; i++) {
      const arg = claudeTraceArgs[i];
      if (!arg.startsWith("--")) {
        outputFile = arg;
        break;
      }
    }

    if (!inputFile) {
      log(`Missing input file for --generate-html`, "red");
      log(
        `Usage: cc-profile --generate-html input.jsonl [output.html]`,
        "yellow",
      );
      process.exit(1);
    }

    // For HTML generation, default to including all requests
    // unless explicitly disabled with --no-include-all-requests
    const htmlIncludeAllRequests = !claudeTraceArgs.includes(
      "--no-include-all-requests",
    );

    await generateHTMLFromCLI(
      inputFile,
      outputFile,
      htmlIncludeAllRequests,
      openInBrowser,
    );
    return;
  }

  // Scenario 4: --index
  if (claudeTraceArgs.includes("--index")) {
    await generateIndex();
    return;
  }

  // Check for init command
  if (claudeTraceArgs.includes("init")) {
    await initCCProfile();
    return;
  }

  // Scenario 1: No args (or claude with args) -> launch claude with interception
  await runClaudeWithInterception(
    claudeArgs,
    includeAllRequests,
    openInBrowser,
  );
}

main().catch((error) => {
  const err = error as Error;
  log(`Unexpected error: ${err.message}`, "red");
  process.exit(1);
});
