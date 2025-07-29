// spawn-preload.cjs - Preload module to intercept spawn BEFORE Claude loads
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

// Store original spawn BEFORE any module imports it
const originalSpawn = childProcess.spawn;

// Find the interceptor output directory from environment or create temp
const outputDir =
  process.env.INTERCEPTOR_OUTPUT_DIR || "/tmp/interceptor-spawn-logs";
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Debug: Write a startup marker
fs.appendFileSync(
  path.join(outputDir, "events.jsonl"),
  JSON.stringify({
    eventType: "preload_startup",
    timestamp: new Date().toISOString(),
    outputDir: outputDir,
    pid: process.pid,
  }) + "\n",
);

// Hook detection function - based on official Claude Code hooks documentation
function isClaudeHook(command, args, options) {
  const env = options?.env || process.env;

  // Official Claude hooks pattern (from Claude Code docs):
  // - Spawned with shell: true
  // - Have CLAUDE_PROJECT_DIR environment variable
  // - Receive JSON data via stdin
  const hasClaudeProjectDir = env.CLAUDE_PROJECT_DIR;
  const isShellMode = options?.shell === true;
  const isOfficialHook = hasClaudeProjectDir && isShellMode;

  // Also detect our cc-profile orchestrator and test patterns for compatibility
  const commandStr = [command, ...args].join(" ");
  const isOrchestratorHook =
    commandStr.includes("cc-profile") ||
    commandStr.includes("INTERCEPTOR TEST");

  return isOfficialHook || isOrchestratorHook;
}

// Function to find matching tool_use_id from recent events.jsonl entries
function findRecentToolUseId(toolName, toolInput, logFile) {
  try {
    if (!fs.existsSync(logFile)) return null;

    const fileContent = fs.readFileSync(logFile, "utf8");
    const lines = fileContent
      .trim()
      .split("\n")
      .filter((line) => line.trim());

    // Look at last 50 events for efficiency
    const recentLines = lines.slice(-50);

    // Search backwards (most recent first)
    for (let i = recentLines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(recentLines[i]);

        if (
          event.eventType === "tool_use_request" &&
          event.toolName === toolName &&
          JSON.stringify(event.toolInput) === JSON.stringify(toolInput)
        ) {
          return event.toolUseId;
        }
      } catch (_e) {
        // Skip malformed JSON lines
        continue;
      }
    }
  } catch (_e) {
    // Fall back gracefully on file read errors
  }
  return null;
}

// Tool detection is now handled via PostToolUse hooks - no pattern matching needed

// Intercepted spawn function
function interceptedSpawn(command, args = [], options = {}) {
  const env = options.env || process.env;

  // Also intercept shell commands that might be hooks
  const _isShellCommand =
    command === "sh" ||
    command === "/bin/sh" ||
    command === "bash" ||
    command === "/bin/bash";
  const hasEchoInArgs = args.some((arg) => typeof arg === 'string' && arg.includes("INTERCEPTOR TEST"));

  // Check if this is an official Claude hook OR our test patterns
  if (isClaudeHook(command, args, options) || hasEchoInArgs) {
    // Start the actual process
    const child = originalSpawn(command, args, options);

    let stdout = "";
    let stderr = "";
    let stdinData = "";

    // Official Claude hook execution data (JSON via stdin per Claude docs)
    const hookData = {
      timestamp: new Date().toISOString(),
      command,
      args,
      env: {
        CLAUDE_PROJECT_DIR: env.CLAUDE_PROJECT_DIR,
        cwd: env.cwd || options.cwd,
      },
      options: {
        shell: options.shell,
        stdio: options.stdio,
      },
      startTime: Date.now(),
      stdinData: null,
      hookEventData: null, // Will contain parsed JSON from stdin
    };

    // Capture stdin data to get hook event information
    if (child.stdin) {
      const originalWrite = child.stdin.write.bind(child.stdin);
      child.stdin.write = function (chunk, encoding, callback) {
        if (chunk) {
          stdinData += chunk.toString();
          // Try to parse official Claude hook JSON from stdin
          try {
            if (stdinData.trim()) {
              const hookEventData = JSON.parse(stdinData.trim());
              // Official Claude hook data has session_id and hook_event_name
              if (hookEventData.session_id && hookEventData.hook_event_name) {
                hookData.hookEventData = hookEventData;
              }
            }
          } catch (_e) {
            // Not complete JSON yet, continue accumulating
          }
        }
        return originalWrite(chunk, encoding, callback);
      };
    }

    // Capture outputs
    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    // Handle completion
    child.on("close", (code) => {
      hookData.endTime = Date.now();
      hookData.duration = hookData.endTime - hookData.startTime;
      hookData.exitCode = code || 0;
      hookData.stdout = stdout;
      hookData.stderr = stderr;
      hookData.stdinData = stdinData;

      const logFile = path.join(outputDir, "events.jsonl");

      // Special handling for PostToolUse events - create complete tool execution records
      if (
        hookData.hookEventData &&
        hookData.hookEventData.hook_event_name === "PostToolUse"
      ) {
        const event = hookData.hookEventData;

        // Find matching API tool_use_id by looking backwards in events.jsonl
        const toolUseId = findRecentToolUseId(
          event.tool_name,
          event.tool_input,
          logFile,
        );

        // Write complete tool execution event with correlation
        const toolExecutionEvent = {
          eventType: "tool_execution_complete",
          timestamp: new Date().toISOString(),
          toolUseId: toolUseId,
          toolName: event.tool_name,
          toolInput: event.tool_input,
          toolResponse: event.tool_response,
          sessionId: event.session_id,
          startTime: hookData.startTime,
          endTime: hookData.endTime,
          duration: hookData.duration,
        };
        fs.appendFileSync(logFile, JSON.stringify(toolExecutionEvent) + "\n");

        // Create OTLP span for complete tool execution
        createToolExecutionSpan(toolExecutionEvent).catch(() => {
          // Silently ignore OTLP errors
        });
      } else {
        // Regular hook execution logging
        fs.appendFileSync(
          logFile,
          JSON.stringify({ ...hookData, eventType: "hook" }) + "\n",
        );

        // Create OTLP span for hook execution
        createHookSpan(hookData).catch(() => {
          // Silently ignore OTLP errors
        });
      }
    });

    child.on("error", (error) => {
      hookData.error = error.message;
      hookData.endTime = Date.now();
      hookData.duration = hookData.endTime - hookData.startTime;

      const logFile = path.join(outputDir, "events.jsonl");

      // Special handling for PostToolUse events - even on error
      if (
        hookData.hookEventData &&
        hookData.hookEventData.hook_event_name === "PostToolUse"
      ) {
        const event = hookData.hookEventData;

        // Find matching API tool_use_id by looking backwards in events.jsonl
        const toolUseId = findRecentToolUseId(
          event.tool_name,
          event.tool_input,
          logFile,
        );

        // Write complete tool execution event with error
        const toolExecutionEvent = {
          eventType: "tool_execution_complete",
          timestamp: new Date().toISOString(),
          toolUseId: toolUseId,
          toolName: event.tool_name,
          toolInput: event.tool_input,
          toolResponse: event.tool_response,
          sessionId: event.session_id,
          startTime: hookData.startTime,
          endTime: hookData.endTime,
          duration: hookData.duration,
          error: hookData.error,
        };
        fs.appendFileSync(logFile, JSON.stringify(toolExecutionEvent) + "\n");

        // Create OTLP span for complete tool execution (error case)
        createToolExecutionSpan(toolExecutionEvent).catch(() => {
          // Silently ignore OTLP errors
        });
      } else {
        // Regular hook execution logging
        fs.appendFileSync(
          logFile,
          JSON.stringify({ ...hookData, eventType: "hook" }) + "\n",
        );

        // Create OTLP span for hook execution (error case)
        createHookSpan(hookData).catch(() => {
          // Silently ignore OTLP errors
        });
      }
    });

    return child;
  }

  // Not a Claude hook - pass through
  return originalSpawn(command, args, options);
}

// Function to create OTLP spans for hook executions
async function createHookSpan(hookData) {
  try {
    const otelModule = await import("./otel-tracer.js");
    const startHookEventSpan = otelModule.startHookEventSpan;

    if (!startHookEventSpan) return;

    // Extract event name from hook data
    let eventName = "hook_execution";
    let toolName = null;

    if (hookData.hookEventData) {
      eventName = hookData.hookEventData.hook_event_name || eventName;
      toolName = hookData.hookEventData.tool_name;
    }

    // Create span with historical timestamps
    const span = startHookEventSpan(eventName, toolName);

    // Set attributes with hook execution details
    span.setAttributes({
      "hook.event": eventName,
      "hook.command": [hookData.command, ...hookData.args].join(" "),
      "hook.duration.ms": hookData.duration,
      "hook.exit_code": hookData.exitCode || 0,
      "process.shell": hookData.options.shell || false,
    });

    if (toolName) {
      span.setAttributes({ "tool.name": toolName });
    }

    if (hookData.env && hookData.env.CLAUDE_PROJECT_DIR) {
      span.setAttributes({
        "hook.project_dir": hookData.env.CLAUDE_PROJECT_DIR,
      });
    }

    // Add output information
    if (hookData.stdout) {
      span.setAttributes({ "hook.stdout_length": hookData.stdout.length });
    }
    if (hookData.stderr) {
      span.setAttributes({ "hook.stderr_length": hookData.stderr.length });
    }

    // Set status based on exit code
    if (hookData.error || (hookData.exitCode && hookData.exitCode !== 0)) {
      span.setStatus({
        code: 2,
        message: hookData.error || `Exit code: ${hookData.exitCode}`,
      });
      if (hookData.error) {
        span.recordException(new Error(hookData.error));
      }
    } else {
      span.setStatus({ code: 1 }); // OK
    }

    // End span normally - let OTEL handle timing
    span.end();
  } catch (_e) {
    // Silently ignore OTLP creation errors
  }
}

// Function to create OTLP spans for complete tool executions (from PostToolUse events)
async function createToolExecutionSpan(toolExecutionEvent) {
  try {
    const otelModule = await import("./otel-tracer.js");
    const startEnhancedToolSpan = otelModule.startEnhancedToolSpan;

    if (!startEnhancedToolSpan) return;

    // Create span for complete tool execution
    const span = startEnhancedToolSpan(
      toolExecutionEvent.toolName,
      toolExecutionEvent.toolInput,
      null, // mcpServer - could be extracted from toolInput if needed
      null, // parentSpan
    );

    // Set attributes with complete tool execution details
    span.setAttributes({
      "tool.name": toolExecutionEvent.toolName,
      "tool.input":
        typeof toolExecutionEvent.toolInput === "string"
          ? toolExecutionEvent.toolInput
          : JSON.stringify(toolExecutionEvent.toolInput),
      "tool.output":
        typeof toolExecutionEvent.toolResponse === "string"
          ? toolExecutionEvent.toolResponse
          : JSON.stringify(toolExecutionEvent.toolResponse),
      "tool.duration.ms": toolExecutionEvent.duration,
      "session.id": toolExecutionEvent.sessionId,
    });

    // Add official API correlation if available
    if (toolExecutionEvent.toolUseId) {
      span.setAttributes({ "tool.use_id": toolExecutionEvent.toolUseId });
    }

    // Set status based on errors
    if (toolExecutionEvent.error) {
      span.setStatus({ code: 2, message: toolExecutionEvent.error });
      span.recordException(new Error(toolExecutionEvent.error));
    } else {
      span.setStatus({ code: 1 }); // OK
    }

    // End span normally - let OTEL handle timing
    span.end();
  } catch (_e) {
    // Silently ignore OTLP creation errors
  }
}

// Replace the spawn function IMMEDIATELY on the module before ES imports
Object.defineProperty(childProcess, "spawn", {
  value: interceptedSpawn,
  writable: true,
  enumerable: true,
  configurable: true,
});

// Also hook into the module cache for any future require() calls
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  const result = originalRequire.apply(this, arguments);

  // If someone requires child_process, make sure they get our intercepted version
  if (id === "child_process" && result && result.spawn !== interceptedSpawn) {
    Object.defineProperty(result, "spawn", {
      value: interceptedSpawn,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return result;
};

// CRITICAL: Install fetch interceptor BEFORE Claude Code loads

// Initialize OTEL tracer for API spans
let otelInitialized = false;
async function initializeOTELTracer() {
  if (otelInitialized) return;
  try {
    const otelModule = await import("./otel-tracer.js");
    const runId = process.env.CC_PROFILE_RUN_ID || "unknown";
    const sessionId = process.env.CC_PROFILE_SESSION_ID || "unknown";

    otelModule.initializeTracer({
      runId: runId,
      sessionId: sessionId,
      outputDir: outputDir,
      serviceName: "claude-code",
      serviceVersion: "1.0.0",
    });
    otelInitialized = true;
  } catch (_e) {
    // Silently ignore OTEL initialization errors
  }
}

if (global.fetch && !global.fetch.__interceptorInstrumented) {
  const originalFetch = global.fetch;

  // Anthropic API detection
  function isAnthropicAPI(url) {
    const baseUrl =
      process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    const apiHost = new URL(baseUrl).hostname;
    return url.includes(apiHost);
  }

  // Model pricing per 1M tokens (as of 2024)
  const modelPricing = {
    "claude-3-5-sonnet-20241022": {
      input: 3.0,
      output: 15.0,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    "claude-sonnet-4-20250514": {
      input: 3.0,
      output: 15.0,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    "claude-3-5-haiku-20241022": {
      input: 1.0,
      output: 5.0,
      cacheRead: 0.1,
      cacheWrite: 1.25,
    },
    "claude-3-opus-20240229": {
      input: 15.0,
      output: 75.0,
      cacheRead: 1.5,
      cacheWrite: 18.75,
    },
  };

  // Rough token estimation (approximately 4 characters per token for English text)
  function estimateTokenCount(text) {
    if (!text) return 0;
    // More accurate estimation: count words, punctuation, and apply Claude-specific rules
    const characters = text.length;
    const words = text.split(/\s+/).length;
    // Claude tends to use ~3.5-4 chars per token on average
    return Math.ceil(Math.max(characters / 3.7, words * 0.75));
  }

  // Calculate model cost
  function calculateModelCost(model, usage, estimatedInputTokens = 0) {
    const pricing =
      modelPricing[model] || modelPricing["claude-3-5-sonnet-20241022"]; // fallback
    const inputTokens = usage?.input_tokens || estimatedInputTokens;
    const outputTokens = usage?.output_tokens || 0;
    const cacheReadTokens = usage?.cache_read_input_tokens || 0;
    const cacheCreationTokens = usage?.cache_creation_input_tokens || 0;

    const inputCost = (inputTokens * pricing.input) / 1_000_000;
    const outputCost = (outputTokens * pricing.output) / 1_000_000;
    const cacheReadCost = (cacheReadTokens * pricing.cacheRead) / 1_000_000;
    const cacheWriteCost =
      (cacheCreationTokens * pricing.cacheWrite) / 1_000_000;

    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  // Truncate content to prevent span attributes from becoming too large
  function truncateContent(content, maxLength) {
    if (!content) return null;
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "... [TRUNCATED]";
  }

  // Install fetch interceptor
  global.fetch = async function (input, init = {}) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method || "GET";

    // Only intercept Anthropic API calls
    if (!isAnthropicAPI(url)) {
      return originalFetch(input, init);
    }

    const requestTimestamp = Date.now();

    // Extract request content (prompt text)
    let requestContent = null;
    if (init?.body && method === "POST") {
      try {
        const requestBody =
          typeof init.body === "string" ? init.body : JSON.stringify(init.body);
        const requestData = JSON.parse(requestBody);
        requestContent = {
          messages: requestData.messages,
          system: requestData.system,
        };
      } catch (_e) {
        // Failed to parse request body
      }
    }

    // Create OTLP span for API calls
    let span = null;
    try {
      await initializeOTELTracer();

      const otelModule = await import("./otel-tracer.js");
      const startApiCallSpan = otelModule.startApiCallSpan;

      if (startApiCallSpan) {
        span = startApiCallSpan(url, method);
        span.setAttributes({
          "http.url": url,
          "http.method": method,
          "ai.provider": "anthropic",
        });
      }
    } catch (_e) {
      // Silently ignore tracing errors
    }

    try {
      const response = await originalFetch(input, init);
      const responseTimestamp = Date.now();

      // Clone response to read body without consuming it
      const responseClone = response.clone();
      let enhancedData = {};

      try {
        const responseBody = await responseClone.text();
        let responseData = null;
        let responseContent = null;

        // Handle both JSON and SSE (Server-Sent Events) formats
        if (
          responseBody.startsWith("event:") ||
          responseBody.includes("data:")
        ) {
          // SSE format - extract JSON from data: lines
          const dataLines = responseBody
            .split("\n")
            .filter((line) => line.startsWith("data: "));
          let fullContent = "";

          for (const line of dataLines) {
            try {
              const jsonStr = line.substring(6); // Remove 'data: ' prefix
              if (jsonStr === "[DONE]") continue; // Skip SSE terminator
              const data = JSON.parse(jsonStr);

              // Collect content from streaming response
              if (data.type === "content_block_delta" && data.delta?.text) {
                fullContent += data.delta.text;
              }

              // Merge usage data intelligently - preserve complete usage from message_start
              if (data.usage) {
                if (!responseData || !responseData.usage) {
                  // First usage object found
                  responseData = data;
                } else {
                  // Merge usage objects, prioritizing more complete data
                  const currentUsage = responseData.usage;
                  const newUsage = data.usage;

                  // Preserve input_tokens if we already have them and new data doesn't
                  const mergedUsage = {
                    ...currentUsage,
                    ...newUsage,
                    // Keep existing input_tokens if new data doesn't have them
                    input_tokens:
                      newUsage.input_tokens ?? currentUsage.input_tokens,
                    cache_creation_input_tokens:
                      newUsage.cache_creation_input_tokens ??
                      currentUsage.cache_creation_input_tokens,
                    cache_read_input_tokens:
                      newUsage.cache_read_input_tokens ??
                      currentUsage.cache_read_input_tokens,
                  };

                  responseData = {
                    ...responseData,
                    ...data,
                    usage: mergedUsage,
                  };
                }
                // Don't break here, continue collecting content
              }
            } catch (_e) {
              // Not valid JSON in this data line, continue
            }
          }

          if (fullContent) {
            responseContent = { text: fullContent };
          }
        } else {
          // Plain JSON format
          responseData = JSON.parse(responseBody);

          // Extract content from non-streaming response
          if (responseData.content && Array.isArray(responseData.content)) {
            const textContent = responseData.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("\n");
            if (textContent) {
              responseContent = { text: textContent };
            }
          }
        }

        // Extract tool_use blocks from response and write to events.jsonl for correlation
        if (
          responseData &&
          responseData.content &&
          Array.isArray(responseData.content)
        ) {
          responseData.content.forEach((block) => {
            if (block.type === "tool_use") {
              // Write tool_use_request to events.jsonl for correlation with hooks
              const toolUseEvent = {
                eventType: "tool_use_request",
                timestamp: new Date().toISOString(),
                toolUseId: block.id,
                toolName: block.name,
                toolInput: block.input,
                sessionId: "unknown", // Will be correlated by hooks
              };
              fs.appendFileSync(
                path.join(outputDir, "events.jsonl"),
                JSON.stringify(toolUseEvent) + "\n",
              );
            }
          });
        }

        // Extract enhanced AI attributes from API response
        if (responseData && responseData.usage) {
          const usage = responseData.usage;
          const model = responseData.model || "claude-3-5-sonnet-20241022";

          // Estimate input tokens if missing from API response
          let inputTokens = usage.input_tokens;
          let tokenSource = "api";

          if (!inputTokens && requestContent) {
            // Estimate from request content when API doesn't provide input_tokens
            const requestText = JSON.stringify(requestContent);
            inputTokens = estimateTokenCount(requestText);
            tokenSource = "estimated";
          }

          const finalInputTokens = inputTokens || 0;
          const cost = calculateModelCost(model, usage, finalInputTokens);

          enhancedData = {
            // AI model and request info
            model: model,
            requestType: "completion",
            // Token usage breakdown
            tokensInput: finalInputTokens,
            tokensOutput: usage.output_tokens || 0,
            tokensCacheRead: usage.cache_read_input_tokens || 0,
            tokensCacheCreation: usage.cache_creation_input_tokens || 0,
            tokensTotal: finalInputTokens + (usage.output_tokens || 0),
            // Cost calculation
            costUsd: parseFloat(cost.toFixed(6)),
            costCalculation: "interceptor_estimated",
            // Track whether input tokens were estimated
            inputTokenSource: tokenSource,
            // API timing
            requestDurationMs: responseTimestamp - requestTimestamp,
            // Content capture (truncated for size limits)
            promptText: requestContent
              ? truncateContent(JSON.stringify(requestContent), 10000)
              : null,
            responseText: responseContent
              ? truncateContent(responseContent.text, 10000)
              : null,
            // Full usage object for debugging (preserve original API response)
            fullUsage: usage,
          };
        }
      } catch (parseError) {
        // Response parsing failed, continue with basic logging
        console.error(
          "Interceptor: Failed to parse API response for enhanced data:",
          parseError.message,
        );
      }

      // Log the fetch data with enhanced AI attributes to unified log file
      const logFile = path.join(outputDir, "events.jsonl");
      const fetchData = {
        eventType: "api",
        timestamp: new Date().toISOString(),
        method: init.method || "GET",
        url: url,
        status: response.status,
        startTime: requestTimestamp,
        endTime: responseTimestamp,
        durationMs: responseTimestamp - requestTimestamp,
        ...enhancedData, // Include enhanced AI attributes
      };
      fs.appendFileSync(logFile, JSON.stringify(fetchData) + "\n");

      // Complete OTEL span with response data
      if (span) {
        const duration = responseTimestamp - requestTimestamp;
        span.setAttributes({
          "http.status_code": response.status,
          "ai.duration.ms": duration,
        });

        // Add AI-specific attributes if we have enhanced data
        if (enhancedData.model) {
          span.setAttributes({
            "ai.model": enhancedData.model,
            "ai.tokens.input": enhancedData.tokensInput || 0,
            "ai.tokens.output": enhancedData.tokensOutput || 0,
            "ai.cache.read": enhancedData.tokensCacheRead || 0,
            "ai.cache.write": enhancedData.tokensCacheCreation || 0,
            "ai.cost.usd": enhancedData.costUsd || 0,
          });

          // Add content attributes if available
          if (enhancedData.promptText) {
            span.setAttributes({ "ai.prompt": enhancedData.promptText });
          }
          if (enhancedData.responseText) {
            span.setAttributes({ "ai.response": enhancedData.responseText });
          }
        }

        span.setStatus({ code: response.ok ? 1 : 2 }); // OK = 1, ERROR = 2
        span.end();
      }

      return response;
    } catch (error) {
      // Complete OTEL span with error information
      if (span) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message }); // ERROR = 2
        span.end();
      }
      throw error;
    }
  };

  global.fetch.__interceptorInstrumented = true;
}
