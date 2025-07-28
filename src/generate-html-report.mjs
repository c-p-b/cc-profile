#!/usr/bin/env node

// Script to generate HTML report from Stop hook
import path from "path";
import os from "os";

async function generateHTML() {
  const runId = process.env.CC_PROFILE_RUN_ID;
  const sessionId = process.env.CC_PROFILE_SESSION_ID || "unknown";

  let messages = [];
  messages.push("");
  messages.push("✅ Session complete!");

  if (!runId || !sessionId || sessionId === "unknown") {
    messages.push("❌ Missing run ID or session ID, skipping HTML generation");
    messages.push(`   Run ID: ${runId || "missing"}`);
    messages.push(`   Session ID: ${sessionId}`);

    // Output JSON with stopReason to show to user
    console.log(
      JSON.stringify({
        stopReason: messages.join("\n"),
      }),
    );
    return;
  }

  messages.push(`🔧 Generating HTML for Claude session ${sessionId}...`);

  try {
    const { OTLPHTMLGenerator } = await import("./otlp-html-generator.js");

    // Use session ID as primary identifier instead of run ID
    const baseDir = path.join(os.homedir(), ".cc-profile", "logs", runId);
    const otlpFile = path.join(baseDir, "trace.otlp.jsonl");
    const htmlFile = path.join(baseDir, "report.html");

    messages.push(`📋 OTLP Trace:  ${otlpFile}`);

    const htmlGenerator = new OTLPHTMLGenerator();
    await htmlGenerator.generateHTML(otlpFile, htmlFile, {
      title: `CC-Profile - Claude Session ${sessionId}`,
      sessionId: sessionId,
      parentSessionId: process.env.CC_PROFILE_PARENT_SESSION,
    });

    messages.push(`📊 HTML Report: ${htmlFile}`);
    messages.push(`💻 Open with:   open "${htmlFile}"`);

    // Auto-open browser if requested
    const shouldOpenBrowser =
      process.env.CLAUDE_TRACE_OPEN_BROWSER === "true" ||
      process.env.CC_PROFILE_OPEN_HTML === "true";
    if (shouldOpenBrowser) {
      const { spawn } = await import("child_process");
      const fs = await import("fs");
      if (fs.existsSync(htmlFile)) {
        spawn("open", [htmlFile], {
          detached: true,
          stdio: "ignore",
        }).unref();
        messages.push(`🌐 Opened in browser`);
      }
    }

    // Silent generation - no output to avoid hook display issues
  } catch (error) {
    // Enhanced error logging with full stack trace and debugging info
    console.error("=== HTML GENERATION ERROR ===");
    console.error("Error message:", error.message);
    console.error("Error name:", error.name);
    console.error("Stack trace:");
    console.error(error.stack);
    console.error("Environment variables:");
    console.error("  CC_PROFILE_RUN_ID:", process.env.CC_PROFILE_RUN_ID);
    console.error(
      "  CC_PROFILE_SESSION_ID:",
      process.env.CC_PROFILE_SESSION_ID,
    );
    console.error(
      "  CC_PROFILE_PARENT_SESSION:",
      process.env.CC_PROFILE_PARENT_SESSION,
    );
    console.error("  CC_PROFILE_OPEN_HTML:", process.env.CC_PROFILE_OPEN_HTML);
    console.error(
      "  CLAUDE_TRACE_OPEN_BROWSER:",
      process.env.CLAUDE_TRACE_OPEN_BROWSER,
    );
    console.error("Process info:");
    console.error("  Node version:", process.version);
    console.error("  Platform:", process.platform);
    console.error("  Current working directory:", process.cwd());
    console.error("Arguments:", process.argv);
    console.error("=== END ERROR DETAILS ===");

    // Also write error details to a log file for debugging
    try {
      const fs = await import("fs");
      const errorLogPath = path.join(
        os.homedir(),
        ".cc-profile",
        "logs",
        "error.log",
      );
      const timestamp = new Date().toISOString();
      const errorDetails = `
[${timestamp}] HTML Generation Error
Error: ${error.message}
Name: ${error.name}
Stack: ${error.stack}
Environment: ${JSON.stringify(
        {
          CC_PROFILE_RUN_ID: process.env.CC_PROFILE_RUN_ID,
          CC_PROFILE_SESSION_ID: process.env.CC_PROFILE_SESSION_ID,
          CC_PROFILE_PARENT_SESSION: process.env.CC_PROFILE_PARENT_SESSION,
          NODE_VERSION: process.version,
          PLATFORM: process.platform,
          CWD: process.cwd(),
        },
        null,
        2,
      )}
Arguments: ${JSON.stringify(process.argv)}
=====================================

`;
      fs.appendFileSync(errorLogPath, errorDetails);
    } catch (logError) {
      console.error("Failed to write error log:", logError.message);
    }
  }
}

generateHTML().catch((error) => {
  console.error("=== UNCAUGHT ERROR IN GENERATE-HTML-REPORT ===");
  console.error("This error was not caught by the main try/catch block");
  console.error("Error message:", error.message);
  console.error("Error name:", error.name);
  console.error("Stack trace:");
  console.error(error.stack);
  console.error("=== END UNCAUGHT ERROR ===");
  process.exit(1);
});
