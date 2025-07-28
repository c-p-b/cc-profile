import fs from "fs";
import os from "os";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import * as crypto from "crypto";
import { EventEmitter } from "events";
import { fileURLToPath } from "url";
import {
  initializeTracer,
  updateTracerConfig,
  shutdown as shutdownTracer,
} from "./otel-tracer.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InterceptorConfig {
  logDirectory?: string;
  enableRealTimeHTML?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
}

export class Interceptor extends EventEmitter {
  private outputDir: string;
  private sessionId: string;
  private runId: string;
  private claudeProcess?: ChildProcess;

  constructor(outputDir: string, runId?: string) {
    super();
    this.outputDir = outputDir;
    this.runId = runId || crypto.randomUUID();
    this.sessionId = crypto.randomUUID();
  }

  async startInterception(args: string[]): Promise<void> {
    // Setup environment for spawn preload
    const spawnPreloadPath = path.join(__dirname, "spawn-preload.cjs");

    // Set up environment variables for preload module
    const env = {
      ...process.env,
      INTERCEPTOR_OUTPUT_DIR: this.outputDir,
      CC_PROFILE_RUN_ID: this.runId,
      CC_PROFILE_SESSION_ID: this.sessionId,
    };

    // Initialize OTEL tracer
    initializeTracer({
      runId: this.runId,
      sessionId: this.sessionId,
      outputDir: this.outputDir,
      parentSessionId: process.env.CC_PROFILE_PARENT_SESSION,
    });

    // Find Claude binary
    const claudePath = this.getClaudeAbsolutePath();

    // Simple spawn with stdio inheritance - let Claude run normally
    const child = spawn(
      "node",
      ["--require", spawnPreloadPath, claudePath, ...args],
      {
        stdio: "inherit",
        cwd: process.cwd(),
        env: env,
      },
    );

    // Handle process exit
    child.on("exit", async (exitCode, signal) => {
      // Look for session ID in interceptor output
      await this.discoverSessionInfo();

      // Shutdown tracer and generate reports
      await shutdownTracer();

      // Emit completion event
      this.emit("intercept-complete", {
        sessionId: this.sessionId,
        exitCode,
        signal,
      });

      if (exitCode !== 0) {
        process.exit(exitCode || 1);
      }
    });

    child.on("error", (error) => {
      console.error("Failed to start Claude process:", error);
      process.exit(1);
    });
  }

  private getClaudeAbsolutePath(): string {
    // Check for dev mode mock first
    const mockClaudePath = process.env.CC_PROFILE_MOCK_CLAUDE_PATH;
    if (mockClaudePath && fs.existsSync(mockClaudePath)) {
      console.log(`🧪 Using mock Claude CLI: ${mockClaudePath}`);
      return mockClaudePath;
    }

    // Use the symlinked claude-original created during init
    const claudeOriginalPath = path.join(
      os.homedir(),
      ".cc-profile",
      "bin",
      "claude-original",
    );

    if (fs.existsSync(claudeOriginalPath)) {
      return this.resolveToJsFile(claudeOriginalPath);
    }

    // Fallback error - should not happen if init was run properly
    console.error("claude-original symlink not found");
    console.error('Please run "cc-profile init" to set up the symlink');
    process.exit(1);
  }

  private resolveToJsFile(filePath: string): string {
    try {
      const realPath = fs.realpathSync(filePath);

      if (realPath.endsWith(".js")) {
        return realPath;
      }

      if (fs.existsSync(realPath)) {
        const content = fs.readFileSync(realPath, "utf-8");
        if (
          content.startsWith("#!/usr/bin/env node") ||
          content.match(/^#!.*\/node$/m) ||
          content.includes("require(") ||
          content.includes("import ")
        ) {
          return realPath;
        }
      }

      // Try common JS file locations
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

      return realPath;
    } catch (_error) {
      return filePath;
    }
  }

  private async discoverSessionInfo(): Promise<void> {
    // Look for actual session information from Claude's execution
    const eventsFile = path.join(this.outputDir, "events.jsonl");

    if (fs.existsSync(eventsFile)) {
      try {
        const lines = fs.readFileSync(eventsFile, "utf-8").trim().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            const data = JSON.parse(line);
            if (
              data.eventType === "hook" &&
              data.hookEventData &&
              data.hookEventData.session_id
            ) {
              const actualSessionId = data.hookEventData.session_id;

              // Update session ID (but keep using run directory)
              this.sessionId = actualSessionId;

              // Update OTEL tracer configuration with real session info
              updateTracerConfig({
                runId: this.runId,
                sessionId: this.sessionId,
                outputDir: this.outputDir,
              });

              break;
            }
          }
        }
      } catch (_error) {
        console.log("Could not discover session information from events log");
      }
    }
  }
}
