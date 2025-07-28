/**
 * Frontend initialization script for OTLP-based HTML reports
 * This script will be embedded in the generated HTML to initialize the trace viewer
 */

import { TraceViewer } from "./trace-viewer.js";
import { OTLPHTMLGenerationData } from "./otlp-html-generator.js";
import { D3Span, TraceMetrics } from "./otlp-parser.js";

declare global {
  interface Window {
    otlpData: OTLPHTMLGenerationData;
  }
}

export function initializeOTLPReport(): void {
  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initializeOTLPReport());
    return;
  }

  try {
    const data = window.otlpData;
    if (!data) {
      console.error("No OTLP data found");
      return;
    }

    // Initialize trace viewer
    const traceViewer = new TraceViewer({
      container: "#trace-viewer",
      width: window.innerWidth * 0.7 - 32, // 70% minus padding
      height: window.innerHeight - 200, // Full height minus header/padding
    });

    // Parse spans if not already parsed
    const spans = data.parsedSpans || [];

    // Calculate metrics for header
    const metrics = calculateMetrics(spans);
    updateMetricsHeader(metrics);

    // Render the trace
    traceViewer.render(spans, metrics);

    // Set up span selection handler
    traceViewer.onSpanSelected((span: D3Span) => {
      updateSpanDetails(span);
    });

    // Handle window resize
    let resizeTimeout: NodeJS.Timeout;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Recreate viewer with new dimensions
        traceViewer.destroy();
        const newViewer = new TraceViewer({
          container: "#trace-viewer",
          width: window.innerWidth * 0.7 - 32,
          height: window.innerHeight - 200,
        });
        newViewer.render(spans, metrics);
        newViewer.onSpanSelected(updateSpanDetails);
      }, 250);
    });
  } catch (error) {
    console.error("Failed to initialize OTLP report:", error);
    showError(
      "Failed to load trace data. Please check the console for details.",
    );
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
        if (span.attributes.get("ai.cost.usd")) {
          totalCost += parseFloat(span.attributes.get("ai.cost.usd"));
        }
        if (span.attributes.get("ai.tokens.input")) {
          totalTokensIn += parseInt(span.attributes.get("ai.tokens.input"));
        }
        if (span.attributes.get("ai.tokens.output")) {
          totalTokensOut += parseInt(span.attributes.get("ai.tokens.output"));
        }
        if (span.attributes.get("ai.cache.read")) {
          totalCacheRead += parseInt(span.attributes.get("ai.cache.read"));
        }
        if (span.attributes.get("ai.cache.write")) {
          totalCacheWrite += parseInt(span.attributes.get("ai.cache.write"));
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
  };

  Object.entries(elements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  });
}

function updateSpanDetails(span: D3Span): void {
  const detailsContainer = document.getElementById("span-details");
  if (!detailsContainer) return;

  const startTime = new Date(span.startTime / 1000); // Convert from microseconds
  const endTime = new Date(span.endTime / 1000);
  const duration = span.endTime - span.startTime;

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
        <strong>Start:</strong> <span>${startTime.toLocaleTimeString()}</span>
        <strong>End:</strong> <span>${endTime.toLocaleTimeString()}</span>
      </div>
    </div>
  `;

  // Add type-specific details
  if (span.type === "api") {
    const model = span.attributes.get("ai.model");
    const inputTokens = span.attributes.get("ai.tokens.input");
    const outputTokens = span.attributes.get("ai.tokens.output");
    const cost = span.attributes.get("ai.cost.usd");
    const cacheRead = span.attributes.get("ai.cache.read");
    const cacheWrite = span.attributes.get("ai.cache.write");

    if (model === undefined)
      throw new Error(
        `Missing required attribute 'ai.model' for API span: ${span.name}`,
      );
    if (inputTokens === undefined)
      throw new Error(
        `Missing required attribute 'ai.tokens.input' for API span: ${span.name}`,
      );
    if (outputTokens === undefined)
      throw new Error(
        `Missing required attribute 'ai.tokens.output' for API span: ${span.name}`,
      );
    if (cost === undefined)
      throw new Error(
        `Missing required attribute 'ai.cost.usd' for API span: ${span.name}`,
      );
    if (cacheRead === undefined)
      throw new Error(
        `Missing required attribute 'ai.cache.read' for API span: ${span.name}`,
      );
    if (cacheWrite === undefined)
      throw new Error(
        `Missing required attribute 'ai.cache.write' for API span: ${span.name}`,
      );

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
  } else if (span.type === "tool") {
    const toolName = span.attributes.get("tool.name");
    const exitCode = span.attributes.get("tool.exit_code");
    const duration = span.attributes.get("tool.duration_ms");
    const output = span.attributes.get("tool.output");

    if (toolName === undefined)
      throw new Error(
        `Missing required attribute 'tool.name' for tool span: ${span.name}`,
      );
    if (exitCode === undefined)
      throw new Error(
        `Missing required attribute 'tool.exit_code' for tool span: ${span.name}`,
      );
    if (duration === undefined)
      throw new Error(
        `Missing required attribute 'tool.duration_ms' for tool span: ${span.name}`,
      );
    if (output === undefined)
      throw new Error(
        `Missing required attribute 'tool.output' for tool span: ${span.name}`,
      );

    html += `
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: #374151;">Tool Details</h4>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; font-size: 14px;">
          <strong>Tool:</strong> <span>${escapeHtml(toolName)}</span>
          <strong>Exit Code:</strong> <span style="color: ${exitCode === 0 ? "#10b981" : "#ef4444"}">${exitCode}</span>
          <strong>Duration:</strong> <span>${duration}ms</span>
          <strong>Output:</strong> <pre style="font-size: 11px; margin: 4px 0; max-height: 100px; overflow-y: auto;">${escapeHtml(output)}</pre>
        </div>
      </div>
    `;
  } else if (span.type === "hook") {
    const hookEvent = span.attributes.get("hook.event");
    const hookCommand = span.attributes.get("hook.command");
    const exclusive = span.attributes.get("hook.exclusive");
    const duration = span.attributes.get("hook.duration_ms");
    const exitCode = span.attributes.get("hook.exit_code");

    if (hookEvent === undefined)
      throw new Error(
        `Missing required attribute 'hook.event' for hook span: ${span.name}`,
      );
    if (hookCommand === undefined)
      throw new Error(
        `Missing required attribute 'hook.command' for hook span: ${span.name}`,
      );
    if (duration === undefined)
      throw new Error(
        `Missing required attribute 'hook.duration_ms' for hook span: ${span.name}`,
      );
    if (exitCode === undefined)
      throw new Error(
        `Missing required attribute 'hook.exit_code' for hook span: ${span.name}`,
      );

    html += `
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; color: #374151;">Hook Details</h4>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; font-size: 14px;">
          <strong>Event:</strong> <span>${escapeHtml(hookEvent)}</span>
          <strong>Command:</strong> <code style="font-size: 12px; background: #f3f4f6; padding: 2px 4px; border-radius: 3px;">${escapeHtml(hookCommand)}</code>
          <strong>Duration:</strong> <span>${duration}ms</span>
          <strong>Exit Code:</strong> <span style="color: ${exitCode === 0 ? "#10b981" : "#ef4444"}">${exitCode}</span>
          ${exclusive ? `<strong>Type:</strong> <span style="color: #8b5cf6;">Managed Hook</span>` : `<strong>Type:</strong> <span style="color: #6b7280;">Regular Hook</span>`}
        </div>
      </div>
    `;
  }

  // Add attributes section
  const otherAttributes: [string, any][] = [];
  for (const [key, value] of span.attributes.entries()) {
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

// Auto-initialize when loaded
if (typeof window !== "undefined") {
  initializeOTLPReport();
}
