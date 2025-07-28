#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import { Interceptor } from "./interceptor.js";
import { OTLPHTMLGenerator } from "./otlp-html-generator.js";

export class InterceptorRunner {
  private runDir: string;
  private runId: string;
  private sessionId: string = "";

  constructor() {
    // Create run directory with timestamp
    const timestamp = Date.now();
    this.runId = `run-${timestamp}`;
    this.runDir = path.join(os.homedir(), ".cc-profile", "logs", this.runId);
    if (!fs.existsSync(this.runDir)) {
      fs.mkdirSync(this.runDir, { recursive: true });
    }

    // Show bootstrap info immediately
    console.log("📊 cc-profile tracing active");
    console.log(`   Run ID:      ${this.runId}`);
    console.log(
      `   OTLP Trace:  ${path.join(this.runDir, "trace.otlp.jsonl")}`,
    );
    console.log(`   HTML Report: ${path.join(this.runDir, "report.html")}`);
  }

  async run(args: string[]): Promise<void> {
    const interceptor = new Interceptor(this.runDir, this.runId);

    // Set up exit handlers to ensure HTML generation happens
    this.setupExitHandlers();

    interceptor.on("intercept-complete", async (data: any) => {
      this.sessionId = data.sessionId;
      await this.generateReport();
    });

    try {
      await interceptor.startInterception(args);
    } catch (error) {
      console.error("❌ Interceptor error:", error);
      process.exit(1);
    }
  }

  private setupExitHandlers(): void {
    const generateOnExit = async () => {
      await this.generateReport();
    };

    // Handle various exit scenarios
    process.on("exit", () => {
      // Synchronous only - do a quick check if HTML already exists
      const htmlFile = path.join(this.runDir, "report.html");
      if (!fs.existsSync(htmlFile)) {
        console.log("💨 Generating final report...");
      }
    });

    process.on("SIGINT", async () => {
      console.log("\n🛑 Interrupted - generating final report...");
      await generateOnExit();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\n🛑 Terminated - generating final report...");
      await generateOnExit();
      process.exit(0);
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", async (error) => {
      console.error("💥 Uncaught exception:", error);
      await generateOnExit();
      process.exit(1);
    });
  }

  private async generateReport(): Promise<void> {
    const otlpFile = path.join(this.runDir, "trace.otlp.jsonl");
    const htmlFile = path.join(this.runDir, "report.html");

    if (!fs.existsSync(otlpFile)) {
      console.log("⚠️ No OTLP trace file found");
      return;
    }

    try {
      // Generate HTML report
      const generator = new OTLPHTMLGenerator();
      await generator.generateHTML(otlpFile, htmlFile, {
        title: `cc-profile Run - ${this.runId}`,
      });

      const shouldOpen =
        process.env.CC_PROFILE_OPEN_HTML === "true" ||
        process.argv.includes("--cc-open");

      if (shouldOpen) {
        const { spawn } = await import("child_process");
        spawn("open", [htmlFile], { detached: true, stdio: "ignore" }).unref();
      }
    } catch (error) {
      console.error("❌ Failed to generate reports:", error);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Allow no args - this starts Claude in interactive mode
  const runner = new InterceptorRunner();
  await runner.run(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Interceptor runner fatal error:", error);
    process.exit(1);
  });
}
