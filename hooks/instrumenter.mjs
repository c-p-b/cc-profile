#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Utility function to display session summary
function displaySessionSummary() {
  const runId = process.env.CC_PROFILE_RUN_ID;
  const sessionId = process.env.CC_PROFILE_SESSION_ID;

  if (runId && sessionId) {
    const baseDir = path.join(os.homedir(), ".cc-profile", "logs", runId);
    const htmlFile = path.join(baseDir, "report.html");
    const otlpFile = path.join(baseDir, "trace.otlp.jsonl");

    console.log("📊 cc-profile tracing active");
    console.log(`   Session ID:  ${sessionId}`);
    console.log(`   OTLP Trace:  ${otlpFile}`);
    console.log(`   HTML Report: ${htmlFile} (generated at session end)`);
  }
}

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import our OTEL utilities
async function loadOtelUtils() {
  try {
    // Try to import from the built dist directory
    const distPath = path.join(
      os.homedir(),
      ".cc-profile",
      "lib",
      "otel-tracer.js",
    );
    if (fs.existsSync(distPath)) {
      return await import(distPath);
    }

    // Fallback to relative path during development
    const srcPath = path.join(__dirname, "..", "dist", "otel-tracer.js");
    if (fs.existsSync(srcPath)) {
      return await import(srcPath);
    }

    // If neither exists, return null and fall back to legacy logging
    return null;
  } catch (_error) {
    return null;
  }
}

// Read event from stdin
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  try {
    const event = JSON.parse(input);
    const runId = process.env.CC_PROFILE_RUN_ID || crypto.randomUUID();
    const sessionId =
      process.env.CC_PROFILE_SESSION_ID || event.session_id || "unknown";
    const parentSessionId = process.env.CC_PROFILE_PARENT_SESSION;
    const baseDir = path.join(os.homedir(), ".cc-profile", "logs", runId);

    // Ensure directory exists
    fs.mkdirSync(baseDir, { recursive: true });

    // Try to use OTEL tracing
    const otel = await loadOtelUtils();
    let hookEventSpan = null;

    if (otel && !process.env.CC_PROFILE_OTEL_INITIALIZED) {
      // Initialize OTEL tracer if not already done
      try {
        otel.initializeTracer({
          runId,
          sessionId,
          outputDir: baseDir,
          parentSessionId,
        });
        process.env.CC_PROFILE_OTEL_INITIALIZED = "true";
      } catch (_error) {
        console.error(
          "[cc-profile] Failed to initialize OTEL tracer:",
          _error.message,
        );
        process.exit(1);
      }
    }

    if (otel) {
      // Check if we have a tool.id to correlate with API interceptor
      const currentToolId = process.env.CC_PROFILE_CURRENT_TOOL_ID;
      const currentToolName = process.env.CC_PROFILE_CURRENT_TOOL_NAME;

      if (currentToolId && event.tool_name === currentToolName) {
        // This hook is executing a tool from API - create child span
        hookEventSpan = otel.startHookEventSpan(
          `${event.hook_event_name}[${event.tool_name}]`,
          event.tool_name,
        );
        hookEventSpan.setAttributes({
          "hook.session_id": sessionId,
          "hook.transcript_path": event.transcript_path || "",
          "hook.cwd": event.cwd || process.cwd(),
          "hook.event": event.hook_event_name, // Required by frontend
          "hook.command": "tool-execution", // Required by frontend
          "hook.duration_ms": 0, // Will be updated when finished
          "hook.exit_code": 0, // Will be updated when finished
          "tool.id": currentToolId, // Link to API tool intention
          "tool.correlation": "execution", // This is actual execution
        });
      } else {
        // Regular hook not tied to API tool
        hookEventSpan = otel.startHookEventSpan(
          event.hook_event_name,
          event.tool_name,
        );
        hookEventSpan.setAttributes({
          "hook.session_id": sessionId,
          "hook.transcript_path": event.transcript_path || "",
          "hook.cwd": event.cwd || process.cwd(),
          "hook.event": event.hook_event_name, // Required by frontend
          "hook.command": "hook-event", // Required by frontend
          "hook.duration_ms": 0, // Will be updated when finished
          "hook.exit_code": 0, // Will be updated when finished
        });
      }
    }


    // End the hook event span and clean up tool correlation
    if (hookEventSpan) {
      hookEventSpan.setStatus({ code: 0 }); // OK
      hookEventSpan.end();

      // Clear tool correlation after execution completes
      if (process.env.CC_PROFILE_CURRENT_TOOL_ID) {
        delete process.env.CC_PROFILE_CURRENT_TOOL_ID;
        delete process.env.CC_PROFILE_CURRENT_TOOL_NAME;
        delete process.env.CC_PROFILE_CURRENT_TOOL_SPAN_ID;
      }
    }

    // Handle UserPromptSubmit event - display session summary at start
    if (event.hook_event_name === "UserPromptSubmit") {
      displaySessionSummary();
    }

    // Handle Stop event - shutdown OTEL tracer
    if (
      event.hook_event_name === "Stop" &&
      otel &&
      process.env.CC_PROFILE_RUN_ID === runId
    ) {
      try {
        await otel.shutdown();
        // Display session summary when stop hook fires
        displaySessionSummary();
        // HTML generation is now handled by the interceptor
      } catch (_error) {
        // Silently ignore shutdown errors
      }
    }

    // Always return success
    console.log(JSON.stringify({ success: true }));
  } catch (_error) {
    console.error(JSON.stringify({ success: false, error: _error.message }));
    process.exit(1);
  }
});
