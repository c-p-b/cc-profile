#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { execSync } = require("child_process");

// OTEL tracer imports - use dynamic loading to handle initialization
let otelTracer = null;
let isTracerInitialized = false;

function getOtelTracer() {
  if (!isTracerInitialized && process.env.CC_PROFILE_RUN_ID) {
    try {
      // Load OTEL tracer module
      const libPath = path.join(
        os.homedir(),
        ".cc-profile",
        "lib",
        "otel-tracer.js",
      );
      otelTracer = require(libPath);

      // Initialize tracer if not already done
      try {
        otelTracer.getTracer();
        isTracerInitialized = true;
      } catch (_e) {
        // Tracer not initialized, we need to do it
        otelTracer.initializeTracer({
          runId: process.env.CC_PROFILE_RUN_ID,
          sessionId: process.env.CC_PROFILE_SESSION_ID || crypto.randomUUID(),
          outputDir: path.join(
            os.homedir(),
            ".cc-profile",
            "logs",
            process.env.CC_PROFILE_RUN_ID,
          ),
        });
        isTracerInitialized = true;
      }
    } catch (error) {
      console.error(
        "[CC-PROFILE] FATAL: Could not load OTEL tracer:",
        error.message,
      );
      process.exit(1);
    }
  }
  return otelTracer;
}

// Read event from stdin
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const runId = process.env.CC_PROFILE_RUN_ID;

    // No run ID? FAIL HARD.
    if (!runId) {
      console.error(
        "[CC-PROFILE] FATAL: CC_PROFILE_RUN_ID environment variable not set",
      );
      process.exit(1);
    }

    // Get OTEL tracer - this is the only way we roll now
    const tracer = getOtelTracer();
    if (!tracer) {
      console.error("[CC-PROFILE] FATAL: No OTEL tracer available.");
      process.exit(1);
    }

    // Start OTEL span for this hook event
    let hookEventSpan = null;
    try {
      hookEventSpan = tracer.startHookEventSpan(
        event.hook_event_name,
        event.tool_name,
      );
      if (hookEventSpan) {
        hookEventSpan.setAttributes({
          "session.id": event.session_id || "unknown",
          "hook.cwd": event.cwd || process.cwd(),
          ...(event.prompt && {
            "hook.prompt": event.prompt.substring(0, 100) + "...",
          }),
        });
      }
    } catch (error) {
      console.error(
        "[CC-PROFILE] FATAL: Failed to create hook span:",
        error.message,
      );
      process.exit(1);
    }

    // Helper function to extract commands from hook definitions
    function extractHookCommands(hookDef, toolName) {
      const commands = [];

      // Handle direct string format
      if (typeof hookDef === "string") {
        commands.push(hookDef);
        return commands;
      }

      // Handle array of hook definitions
      const hookArray = Array.isArray(hookDef) ? hookDef : [hookDef];

      for (const hookEntry of hookArray) {
        // Skip non-object entries
        if (typeof hookEntry !== "object" || !hookEntry) continue;

        // Check matcher for tool-based events
        if (
          event.hook_event_name === "PreToolUse" ||
          event.hook_event_name === "PostToolUse"
        ) {
          if (hookEntry.matcher !== undefined && hookEntry.matcher !== "") {
            // Check if tool matches the pattern
            const regex = new RegExp("^(" + hookEntry.matcher + ")$");
            if (!regex.test(toolName)) continue;
          }
        }

        // Extract commands from hooks array
        if (hookEntry.hooks && Array.isArray(hookEntry.hooks)) {
          for (const hook of hookEntry.hooks) {
            if (hook.type === "command" && hook.command) {
              commands.push(hook.command);
            }
          }
        }
      }

      return commands;
    }

    // Discover hooks from settings.json files
    const eventName = event.hook_event_name;
    const toolName = event.tool_name || "";
    const hooks = [];
    let hookOutputs = [];

    // Check regular settings files for hooks
    const settingsFiles = [
      path.join(process.env.HOME, ".claude/settings.json"),
      path.join(process.cwd(), ".claude/settings.json"),
      path.join(process.cwd(), ".claude/settings.local.json"),
    ];

    for (const file of settingsFiles) {
      if (fs.existsSync(file)) {
        try {
          const settings = JSON.parse(fs.readFileSync(file, "utf8"));
          if (settings.hooks && settings.hooks[eventName]) {
            const commands = extractHookCommands(
              settings.hooks[eventName],
              toolName,
            );
            hooks.push(...commands);
          }
        } catch (_e) {
          console.error(
            `[CC-PROFILE] FATAL: Invalid JSON in settings file ${file}:`,
            _e.message,
          );
          process.exit(1);
        }
      }
    }

    // Execute all hooks (deduped)
    const allHooks = [...new Set(hooks)];

    for (const hookCmd of allHooks) {
      // Skip orchestrator itself
      if (hookCmd.includes("orchestrator")) continue;

      // Start OTEL span for hook execution
      let execSpan = null;
      if (hookEventSpan) {
        try {
          execSpan = tracer.startHookExecutionSpan(
            hookCmd,
            hookEventSpan,
            false,
          );
        } catch (error) {
          console.error(
            "[CC-PROFILE] FATAL: Failed to create hook execution span:",
            error.message,
          );
          process.exit(1);
        }
      }

      const startTime = Date.now();
      try {
        const result = execSync(hookCmd, {
          input: JSON.stringify(event),
          encoding: "utf8",
          env: { ...process.env },
        });

        // Store hook output for forwarding
        hookOutputs.push({ command: hookCmd, output: result.trim() });

        // OTEL span tracking
        if (execSpan) {
          execSpan.setAttributes({
            "hook.exit_code": 0,
            "hook.duration_ms": Date.now() - startTime,
            "hook.stdout_length": result.length,
          });
          execSpan.setStatus({ code: tracer.SpanStatusCode?.OK || 0 });
          execSpan.end();
        }
      } catch (error) {
        // OTEL span handles errors too
        if (execSpan) {
          execSpan.recordException(error);
          execSpan.setAttributes({
            "hook.exit_code": error.status || 1,
            "hook.duration_ms": Date.now() - startTime,
            "hook.error": error.message,
          });
          execSpan.setStatus({
            code: tracer.SpanStatusCode?.ERROR || 2,
            message: error.message,
          });
          execSpan.end();
        }
      }
    }

    // End the hook event span
    if (hookEventSpan) {
      hookEventSpan.setStatus({ code: tracer.SpanStatusCode?.OK || 0 });
      hookEventSpan.end();
    }

    // Merge hook outputs into proper Claude hook response format
    let finalResponse = { continue: true };

    if (hookOutputs && hookOutputs.length > 0) {
      // Try to parse JSON outputs, fall back to text
      const parsedOutputs = hookOutputs.map((hookOutput) => {
        try {
          const parsed = JSON.parse(hookOutput.output);
          return { command: hookOutput.command, json: parsed };
        } catch (_e) {
          return { command: hookOutput.command, text: hookOutput.output };
        }
      });

      // Simple first-wins merge strategy
      for (const hookOutput of parsedOutputs) {
        if (hookOutput.json) {
          // Blocking hooks take absolute precedence - return immediately
          if (hookOutput.json.continue === false) {
            console.log(JSON.stringify(hookOutput.json));
            return;
          }

          // Merge other fields (first meaningful value wins)
          if (hookOutput.json.stopReason && !finalResponse.stopReason) {
            finalResponse.stopReason = hookOutput.json.stopReason;
          }
          if (hookOutput.json.decision && !finalResponse.decision) {
            finalResponse.decision = hookOutput.json.decision;
            finalResponse.reason = hookOutput.json.reason;
          }
          // Add other standard Claude hook fields as needed
          if (
            hookOutput.json.suppressOutput !== undefined &&
            finalResponse.suppressOutput === undefined
          ) {
            finalResponse.suppressOutput = hookOutput.json.suppressOutput;
          }
        }
      }
    }

    console.log(JSON.stringify(finalResponse));
  } catch (error) {
    console.error("[CC-PROFILE] Orchestrator error:", error.message);
    console.log(JSON.stringify({ success: false, error: error.message }));
  }
});
