/**
 * Frontend initialization script for OTLP-based HTML reports
 * This script will be embedded in the generated HTML to initialize the trace viewer
 */

import { TraceViewer } from "./trace-viewer";
import { D3Span, TraceMetrics, OTLPParser } from "./otlp-parser";
import { markdownToHtml } from "./utils/markdown";

interface OTLPHTMLGenerationData {
  traceData: any;
  parsedSpans: D3Span[] | null;
  timestamp: string;
  runId: string;
}

declare global {
  interface Window {
    otlpData: OTLPHTMLGenerationData;
    _otlpInitialized?: boolean;
  }
}

export function initializeOTLPReport(): void {
  // Prevent double initialization
  if (window._otlpInitialized) {
    console.log("OTLP report already initialized, skipping");
    return;
  }

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initializeOTLPReport());
    return;
  }

  // Mark as initialized
  window._otlpInitialized = true;

  console.log("🔍 Starting OTLP report initialization...");

  try {
    console.log("📊 Checking for OTLP data...");
    const data = window.otlpData;
    if (!data) {
      console.error("❌ No OTLP data found on window.otlpData");
      showError("No trace data found - window.otlpData is missing");
      return;
    }

    console.log("✅ OTLP data found:", {
      hasTraceData: !!data.traceData,
      hasParsedSpans: !!data.parsedSpans,
      timestamp: data.timestamp,
      runId: data.runId,
    });

    // Check trace data size for potential memory issues
    if (data.traceData) {
      try {
        const dataSize = JSON.stringify(data.traceData).length;
        console.log(
          `📏 Trace data size: ${(dataSize / 1024 / 1024).toFixed(2)} MB`,
        );

        // Progressive warnings and potential blocking for very large datasets
        if (dataSize > 100 * 1024 * 1024) {
          // 100MB - severe
          console.error(
            "🚨 Extremely large trace data detected (>100MB) - initialization may fail",
          );
          showError(
            "Trace data is too large (>100MB) and may cause browser issues. Consider filtering or splitting the data.",
          );
          return;
        } else if (dataSize > 50 * 1024 * 1024) {
          // 50MB - warning
          console.warn(
            "⚠️ Large trace data detected (>50MB) - this may cause performance issues",
          );
        }
      } catch (e) {
        console.warn("⚠️ Could not measure trace data size:", e);
      }
    }

    // Parse OTLP data if not already parsed
    let parsedSpans: D3Span[];
    if (data.parsedSpans) {
      console.log("🔄 Using pre-parsed spans...");
      parsedSpans = data.parsedSpans;
      console.log("✅ Pre-parsed spans loaded:", {
        spanCount: parsedSpans.length,
      });
    } else {
      console.log("🔧 Parsing OTLP trace data...");
      try {
        const parser = new OTLPParser();
        console.log("📝 Parser created, starting parse...");
        const result = parser.parse(data.traceData);
        console.log("📝 Parse complete, flattening spans...");
        parsedSpans = OTLPParser.flattenSpans(result.root);
        console.log("✅ OTLP parsing complete:", {
          spanCount: parsedSpans.length,
        });
      } catch (parseError) {
        console.error("❌ OTLP parsing failed:", parseError);
        showError(`Failed to parse trace data: ${parseError.message}`);
        return;
      }
    }

    // TypeScript doesn't recognize that parsedSpans is definitely assigned above
    if (!parsedSpans) {
      throw new Error("Failed to parse spans");
    }

    // Validate parsed spans
    if (!parsedSpans || parsedSpans.length === 0) {
      console.error("❌ No spans found after parsing");
      showError("No trace spans found - the trace data appears to be empty");
      return;
    }

    console.log(`🔢 Processing ${parsedSpans.length} spans...`);

    // Check span count for potential performance issues
    if (parsedSpans.length > 10000) {
      console.warn(
        `⚠️ Large number of spans detected (${parsedSpans.length}) - this may cause performance issues`,
      );
      if (parsedSpans.length > 50000) {
        console.error(
          `🚨 Extremely large span count (${parsedSpans.length}) - initialization may fail`,
        );
        showError(
          `Too many spans (${parsedSpans.length}) may cause browser performance issues. Consider filtering the trace data.`,
        );
        return;
      }
    }

    // Check DOM elements exist
    console.log("🔍 Checking DOM elements...");
    const traceContainer = document.getElementById("trace-viewer");
    if (!traceContainer) {
      console.error("❌ #trace-viewer element not found");
      showError(
        "Missing trace viewer container - HTML template may be corrupted",
      );
      return;
    }
    console.log("✅ DOM elements found");

    // Calculate metrics for header
    console.log("📊 Calculating metrics...");
    let metrics: TraceMetrics;
    try {
      metrics = calculateMetrics(parsedSpans);
      console.log("✅ Metrics calculated:", metrics);
      updateMetricsHeader(metrics);
      console.log("✅ Metrics header updated");
    } catch (metricsError) {
      console.error("❌ Metrics calculation failed:", metricsError);
      showError(`Failed to calculate metrics: ${metricsError.message}`);
      return;
    }

    // Initialize viewers
    console.log("🎨 Creating viewers...");
    let traceViewer: TraceViewer | null = null;
    let currentView: "timeline" | "flamegraph" = "timeline";

    // Create timeline viewer (initially active)
    const initializeTimelineViewer = () => {
      try {
        console.log("⚡ Initializing timeline viewer...");
        if (traceViewer) {
          console.log("🧹 Destroying existing viewer...");
          traceViewer.destroy();
        }

        const viewerConfig = {
          container: "#trace-viewer",
          width: window.innerWidth * 0.7 - 32,
          height: window.innerHeight - 240, // Adjusted for tabs
        };
        console.log("📐 Viewer config:", viewerConfig);

        console.log("🏗️ Creating TraceViewer instance...");
        traceViewer = new TraceViewer(viewerConfig);
        console.log("✅ TraceViewer created successfully");

        console.log("🎬 Rendering spans...");
        traceViewer.render(parsedSpans, metrics);
        console.log("✅ Spans rendered successfully");

        console.log("🔗 Setting up callbacks...");
        traceViewer.onSpanSelected(updateSpanDetails);
        console.log("✅ Timeline viewer initialization complete");
      } catch (error) {
        console.error("❌ Timeline viewer initialization failed:", error);
        console.error("Stack trace:", error.stack);
        throw error;
      }
    };

    // Create flamegraph viewer placeholder (coming soon)
    const initializeFlameViewer = () => {
      const flameContainer = document.getElementById("flame-viewer");
      if (flameContainer) {
        flameContainer.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #6b7280;">
            <div style="text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">🔥</div>
              <h3 style="margin: 0 0 8px 0; color: #111827;">Flamegraph View</h3>
              <p style="margin: 0; font-size: 16px;">Coming soon!</p>
            </div>
          </div>
        `;
      }
    };

    // Initialize timeline viewer first
    console.log("🚀 Starting initial timeline viewer...");
    try {
      initializeTimelineViewer();
      console.log("🎉 Initial timeline viewer started successfully");
    } catch (initError) {
      console.error("❌ Failed to start initial timeline viewer:", initError);
      showError(`Timeline viewer initialization failed: ${initError.message}`);
      return;
    }

    // Set up tab switching
    const setupTabSwitching = () => {
      const tabButtons = document.querySelectorAll(".tab-btn");
      const viewPanels = document.querySelectorAll(".view-panel");

      tabButtons.forEach((button) => {
        button.addEventListener("click", (e) => {
          const target = e.target as HTMLButtonElement;
          const viewType = target.dataset.view as "timeline" | "flamegraph";

          if (viewType === currentView) return; // Already active

          // Update tab buttons
          tabButtons.forEach((btn) => btn.classList.remove("active"));
          target.classList.add("active");

          // Update view panels
          viewPanels.forEach((panel) => panel.classList.remove("active"));
          const targetPanel = document.getElementById(`${viewType}-view`);
          if (targetPanel) targetPanel.classList.add("active");

          // Initialize viewer if needed
          if (viewType === "flamegraph") {
            initializeFlameViewer();
          }

          currentView = viewType;
        });
      });
    };

    setupTabSwitching();

    // Handle window resize
    let resizeTimeout: NodeJS.Timeout;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Recreate active viewer with new dimensions
        if (currentView === "timeline" && traceViewer) {
          initializeTimelineViewer();
        } else if (currentView === "flamegraph") {
          initializeFlameViewer();
        }
      }, 250);
    });
  } catch (error) {
    console.error("❌ OTLP report initialization failed:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    // Try to show more specific error information
    let errorMessage = "Failed to load trace data";
    if (error.message) {
      errorMessage += `: ${error.message}`;
    }
    errorMessage += ". Check the console for full details.";

    showError(errorMessage);
  }
}

function calculateMetrics(spans: D3Span[]): TraceMetrics {
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let apiCallCount = 0;
  let toolCallCount = 0;
  let hookCallCount = 0;
  let errorCount = 0;

  let minStartTime = Infinity;
  let maxEndTime = -Infinity;

  spans.forEach((span) => {
    // Update time bounds
    minStartTime = Math.min(minStartTime, span.startTime);
    maxEndTime = Math.max(maxEndTime, span.endTime);

    // Count errors
    if (span.status === "error") {
      errorCount++;
    }

    // Count by type
    switch (span.type) {
      case "api":
        apiCallCount++;
        // Extract cost and tokens from attributes
        if (span.attributes["ai.cost.usd"]) {
          totalCost += parseFloat(span.attributes["ai.cost.usd"]);
        }
        if (span.attributes["ai.tokens.input"]) {
          totalTokensIn += parseInt(span.attributes["ai.tokens.input"]);
        }
        if (span.attributes["ai.tokens.output"]) {
          totalTokensOut += parseInt(span.attributes["ai.tokens.output"]);
        }
        if (span.attributes["ai.cache.read"]) {
          totalCacheRead += parseInt(span.attributes["ai.cache.read"]);
        }
        if (span.attributes["ai.cache.write"]) {
          totalCacheWrite += parseInt(span.attributes["ai.cache.write"]);
        }
        break;
      case "tool":
        toolCallCount++;
        break;
      case "hook":
        hookCallCount++;
        break;
    }
  });

  const totalDuration = maxEndTime - minStartTime;

  return {
    totalDuration,
    totalCost,
    totalTokensIn,
    totalTokensOut,
    totalCacheRead,
    totalCacheWrite,
    apiCallCount,
    toolCallCount,
    hookCallCount,
    errorCount,
  };
}

function updateMetricsHeader(metrics: TraceMetrics): void {
  const elements = {
    "total-cost": `$${metrics.totalCost.toFixed(3)}`,
    "total-input-tokens": metrics.totalTokensIn.toLocaleString(),
    "total-output-tokens": metrics.totalTokensOut.toLocaleString(),
    "total-duration": formatDuration(metrics.totalDuration / 1000), // Convert from microseconds to milliseconds
    "api-call-count": metrics.apiCallCount.toString(),
    "tool-call-count": metrics.toolCallCount.toString(),
    "hook-call-count": metrics.hookCallCount.toString(),
    "error-count": metrics.errorCount.toString(),
  };

  Object.entries(elements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;

      // Apply special styling to error count badge
      if (id === "error-count") {
        const errorCount = metrics.errorCount;
        if (errorCount === 0) {
          element.classList.add("zero-errors");
          element.classList.remove("error-badge");
        } else {
          element.classList.add("error-badge");
          element.classList.remove("zero-errors");
        }
      }
    }
  });
}

function updateSpanDetails(span: D3Span): void {
  const detailsContainer = document.getElementById("span-details");
  if (!detailsContainer) return;

  const startTime = new Date(span.startTime); // Already in milliseconds from parser
  const endTime = new Date(span.endTime); // Already in milliseconds from parser
  const duration = span.endTime - span.startTime;

  // Format timestamps with full date, time, and timezone info
  const timestampOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZoneName: "short",
  };

  let html = `
    <div style="margin-bottom: 16px;">
      <h3 style="margin: 0 0 8px 0; color: #111827;">${escapeHtml(span.name)}</h3>
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
        <span style="background: ${getSpanTypeColor(span.type)}; color: white; padding: 2px 6px; border-radius: 3px; margin-right: 8px;">
          ${span.type.toUpperCase()}
        </span>
        ${span.status === "error" ? '<span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px;">ERROR</span>' : ""}
      </div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; font-size: 14px;">
        <strong>Span ID:</strong> <code style="font-size: 12px; background: #f3f4f6; padding: 2px 4px; border-radius: 3px;">${span.id.substring(0, 16)}...</code>
        <strong>Duration:</strong> <span>${formatDuration(duration / 1000)}</span>
        <strong>Start:</strong> <span style="font-family: monospace;">${startTime.toLocaleString(undefined, timestampOptions)}</span>
        <strong>End:</strong> <span style="font-family: monospace;">${endTime.toLocaleString(undefined, timestampOptions)}</span>
      </div>
    </div>
  `;

  // Add type-specific details
  if (span.type === "api") {
    const model = span.attributes["ai.model"] || "Unknown";
    const inputTokens = span.attributes["ai.tokens.input"] || "0";
    const outputTokens = span.attributes["ai.tokens.output"] || "0";
    const cost = span.attributes["ai.cost.usd"] || "0.000";
    const cacheRead = span.attributes["ai.cache.read"] || "0";
    const cacheWrite = span.attributes["ai.cache.write"] || "0";

    html += `
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: #374151;">API Call Details</h4>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; font-size: 14px;">
          <strong>Model:</strong> <span>${escapeHtml(model)}</span>
          <strong>Cost:</strong> <span>$${parseFloat(cost).toFixed(3)}</span>
          <strong>Input Tokens:</strong> <span>${parseInt(inputTokens).toLocaleString()}</span>
          <strong>Output Tokens:</strong> <span>${parseInt(outputTokens).toLocaleString()}</span>
          ${parseInt(cacheRead) > 0 ? `<strong>Cache Read:</strong> <span>${parseInt(cacheRead).toLocaleString()}</span>` : ""}
          ${parseInt(cacheWrite) > 0 ? `<strong>Cache Write:</strong> <span>${parseInt(cacheWrite).toLocaleString()}</span>` : ""}
        </div>
      </div>
    `;

    // Add prompt and response content if available
    if (span.promptText || span.responseText) {
      html += `
        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 8px 0; color: #374151;">Conversation Content</h4>
          ${
            span.promptText
              ? `
            <div style="margin-bottom: 16px;">
              <h5 style="margin: 0 0 8px 0; color: #374151; font-size: 14px; font-weight: 600;">USER PROMPT</h5>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; max-height: 400px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                ${formatConversationContent(span.promptText)}
              </div>
            </div>
          `
              : ""
          }
          ${
            span.responseText
              ? `
            <div style="margin-bottom: 16px;">
              <h5 style="margin: 0 0 8px 0; color: #374151; font-size: 14px; font-weight: 600;">ASSISTANT RESPONSE</h5>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; max-height: 400px; overflow-y: auto; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                ${formatConversationContent(span.responseText)}
              </div>
            </div>
          `
              : ""
          }
        </div>
      `;
    }
  } else if (span.type === "tool") {
    const toolName = span.attributes["tool.name"] || "Unknown";
    const exitCode = span.attributes["tool.exit_code"];

    html += `
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: #374151;">Tool Details</h4>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; font-size: 14px;">
          <strong>Tool:</strong> <span>${escapeHtml(toolName)}</span>
          ${span.mcpServer ? `<strong>MCP Server:</strong> <span style="color: #8b5cf6;">${escapeHtml(span.mcpServer)}</span>` : ""}
          ${exitCode !== undefined ? `<strong>Exit Code:</strong> <span style="color: ${exitCode === "0" ? "#10b981" : "#ef4444"}">${exitCode}</span>` : ""}
        </div>
      </div>
    `;

    // Add tool input/output if available
    if (span.toolInput || span.toolOutput) {
      html += `
        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 8px 0; color: #374151;">Tool I/O</h4>
          ${
            span.toolInput
              ? `
            <div style="margin-bottom: 12px;">
              <h5 style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; font-weight: 600;">INPUT</h5>
              <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; max-height: 300px; overflow-y: auto;">
                ${formatToolIO(span.toolInput)}
              </div>
            </div>
          `
              : ""
          }
          ${
            span.toolOutput
              ? `
            <div style="margin-bottom: 12px;">
              <h5 style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; font-weight: 600;">OUTPUT</h5>
              <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 6px; padding: 12px; max-height: 300px; overflow-y: auto;">
                ${formatToolIO(span.toolOutput)}
              </div>
            </div>
          `
              : ""
          }
        </div>
      `;
    }
  } else if (span.type === "hook") {
    const hookEvent = span.attributes["hook.event"] || "Unknown";
    const hookCommand = span.attributes["hook.command"] || "";
    const exclusive = span.attributes["hook.exclusive"];
    const exitCode =
      span.attributes["hook.exit_code"] || span.attributes["tool.exit_code"];
    const hookError = span.attributes["hook.error"];
    const toolOutput = span.attributes["tool.output"];

    html += `
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: #374151;">Hook Details</h4>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; font-size: 14px;">
          <strong>Event:</strong> <span>${escapeHtml(hookEvent)}</span>
          ${hookCommand ? `<strong>Command:</strong> <code style="font-size: 12px; background: #f3f4f6; padding: 2px 4px; border-radius: 3px;">${escapeHtml(hookCommand)}</code>` : ""}
          ${exclusive ? `<strong>Type:</strong> <span style="color: #8b5cf6;">Managed Hook</span>` : `<strong>Type:</strong> <span style="color: #6b7280;">Regular Hook</span>`}
          ${exitCode !== undefined ? `<strong>Exit Code:</strong> <span style="color: ${exitCode === "0" || exitCode === 0 ? "#10b981" : "#ef4444"}">${exitCode}</span>` : ""}
        </div>
        ${
          span.status === "error" && (hookError || toolOutput)
            ? `
          <div style="margin-top: 12px; padding: 12px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px;">
            <h5 style="margin: 0 0 8px 0; color: #dc2626; font-size: 14px;">Hook Error</h5>
            ${hookError ? `<div style="margin-bottom: 8px;"><strong>Error:</strong> <span style="color: #dc2626;">${escapeHtml(hookError)}</span></div>` : ""}
            ${toolOutput ? `<div><strong>Output:</strong> <pre style="margin: 4px 0 0 0; white-space: pre-wrap; font-size: 12px; color: #374151; background: #f9fafb; padding: 8px; border-radius: 3px; overflow-x: auto;">${escapeHtml(toolOutput)}</pre></div>` : ""}
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  // Add attributes section
  const otherAttributes: [string, any][] = [];
  for (const [key, value] of Object.entries(span.attributes)) {
    if (
      !key.startsWith("ai.") &&
      !key.startsWith("tool.") &&
      !key.startsWith("hook.") &&
      value !== undefined &&
      value !== ""
    ) {
      otherAttributes.push([key, value]);
    }
  }

  if (otherAttributes.length > 0) {
    html += `
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: #374151;">Other Attributes</h4>
        <div style="font-size: 12px;">
    `;

    otherAttributes.forEach(([key, value]) => {
      html += `
        <div style="margin-bottom: 4px;">
          <strong>${escapeHtml(key)}:</strong> <span>${escapeHtml(String(value))}</span>
        </div>
      `;
    });

    html += `</div></div>`;
  }

  detailsContainer.innerHTML = html;
}

function getSpanTypeColor(type: string): string {
  const colors = {
    api: "#3B82F6",
    tool: "#10B981",
    hook: "#8B5CF6",
    file: "#F59E0B",
    test: "#EF4444",
    other: "#6B7280",
  };
  return colors[type as keyof typeof colors] || colors.other;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatToolIO(data: any): string {
  if (typeof data === "string") {
    // Check if it's a JSON string
    try {
      const parsed = JSON.parse(data);
      return formatToolIO(parsed);
    } catch {
      // Not JSON, return as plain text
      return escapeHtml(data);
    }
  }

  if (typeof data === "object" && data !== null) {
    // Format JSON with syntax highlighting
    const jsonString = JSON.stringify(data, null, 2);
    return `<div style="position: relative;">
      <div style="font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.4; white-space: pre-wrap;">${syntaxHighlightJSON(jsonString)}</div>
    </div>`;
  }

  return escapeHtml(String(data));
}

function syntaxHighlightJSON(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    function (match) {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
        } else {
          cls = "json-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return `<span class="${cls}">${escapeHtml(match)}</span>`;
    },
  );
}

function formatConversationContent(content: string): string {
  // Extract system reminder blocks with unified regex
  const systemReminderRegex =
    /(?:&lt;system-reminder&gt;|<system-reminder>)([\s\S]*?)(?:&lt;\/system-reminder&gt;|<\/system-reminder>)/g;
  const systemReminders: string[] = [];
  let match;

  // Extract all system reminder blocks
  while ((match = systemReminderRegex.exec(content)) !== null) {
    systemReminders.push(match[1].trim());
  }

  // Remove system reminder blocks from main content
  const mainContent = content.replace(systemReminderRegex, "").trim();

  let result = "";

  // Format main content with markdown and improved readability
  if (mainContent) {
    result += `<div style="font-size: 14px; line-height: 1.6; color: #1f2937;">${markdownToHtml(mainContent)}</div>`;
  }

  // Format system reminders with better styling
  if (systemReminders.length > 0) {
    result += `
      <div style="margin-top: 16px; padding: 12px; background: #f9fafb; border-left: 4px solid #d1d5db; border-radius: 6px;">
        <div style="font-weight: 600; font-size: 13px; color: #4b5563; margin-bottom: 8px;">
          System Reminder${systemReminders.length > 1 ? "s" : ""}
        </div>
        ${systemReminders
          .map(
            (reminder, index) => `
          <div style="margin-bottom: ${index < systemReminders.length - 1 ? "12px" : "0px"};">
            ${
              systemReminders.length > 1
                ? `<div style="font-weight: 600; font-size: 12px; color: #6b7280; margin-bottom: 4px;">Reminder ${index + 1}:</div>`
                : ""
            }
            <div style="font-size: 13px; line-height: 1.5; color: #374151;">${markdownToHtml(reminder)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  return result;
}

function showError(message: string): void {
  const appContainer = document.getElementById("trace-viewer");
  if (appContainer) {
    appContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ef4444;">
        <div style="text-align: center;">
          <h3>Error Loading Trace</h3>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    `;
  }
}

function _showExtensionWarning(message: string): void {
  // Create a dismissible notification bar instead of blocking the entire view
  const existingWarning = document.getElementById("extension-warning");
  if (existingWarning) {
    existingWarning.remove();
  }

  const warningBar = document.createElement("div");
  warningBar.id = "extension-warning";
  warningBar.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #fbbf24;
    color: #92400e;
    padding: 12px;
    text-align: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  `;

  warningBar.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button onclick="this.parentElement.remove()" style="
      margin-left: 16px;
      background: transparent;
      border: 1px solid #92400e;
      color: #92400e;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    ">Dismiss</button>
  `;

  document.body.appendChild(warningBar);

  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    if (warningBar.parentElement) {
      warningBar.remove();
    }
  }, 10000);
}

// Auto-initialization is handled by otlp-index.ts
// Remove the duplicate initialization to prevent double-execution
