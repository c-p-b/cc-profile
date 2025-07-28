import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  Span,
} from "@opentelemetry/api";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  // BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";

// Custom exporter that will write to OTLP JSON format
import { OTLPJsonFileExporter } from "./otlp-json-exporter.js";

// Singleton tracer instance
let tracerInstance: ReturnType<typeof trace.getTracer> | null = null;
let rootSpan: Span | null = null;
let exporterInstance: OTLPJsonFileExporter | null = null;
let currentConfig: CCProfileConfig | null = null;

export interface CCProfileConfig {
  runId: string;
  sessionId: string;
  outputDir: string;
  serviceName?: string;
  serviceVersion?: string;
  parentSessionId?: string;
}

/**
 * Initialize the OpenTelemetry tracer for cc-profile
 */
export function initializeTracer(config: CCProfileConfig): void {
  // Store config for later use
  currentConfig = config;
  const resource = resourceFromAttributes({
    "service.name": config.serviceName || "claude-code",
    "service.version": config.serviceVersion || "1.0.0",
    "run.id": config.runId,
    "session.id": config.sessionId,
  });

  // Add our custom OTLP JSON file exporter
  exporterInstance = new OTLPJsonFileExporter({
    outputDir: config.outputDir,
    runId: config.runId,
    sessionId: config.sessionId,
    parentSessionId: config.parentSessionId,
  });

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(exporterInstance)],
  });

  // Register the provider
  trace.setGlobalTracerProvider(provider);

  // Get tracer instance
  tracerInstance = trace.getTracer("cc-profile", "0.1.0");

  // Start root span for the entire Claude Code session
  const rootAttributes: Record<string, any> = {
    "session.id": config.sessionId,
    "run.id": config.runId,
  };

  if (config.parentSessionId) {
    rootAttributes["parent.session.id"] = config.parentSessionId;
  }

  rootSpan = tracerInstance.startSpan("Claude Code Session", {
    kind: SpanKind.INTERNAL,
    attributes: rootAttributes,
  });
}

/**
 * Update tracer configuration with real session information
 */
export function updateTracerConfig(config: CCProfileConfig): void {
  if (!currentConfig) {
    throw new Error("Cannot update tracer config: tracer not initialized");
  }

  // Update current config
  currentConfig = { ...currentConfig, ...config };

  // Update exporter if needed
  if (exporterInstance) {
    exporterInstance.updateConfig({
      outputDir: config.outputDir,
      runId: config.runId,
      sessionId: config.sessionId,
      parentSessionId: config.parentSessionId,
    });
  }

  // Update root span attributes if available
  if (rootSpan) {
    rootSpan.setAttributes({
      "session.id": config.sessionId,
      "run.id": config.runId,
      ...(config.parentSessionId && {
        "parent.session.id": config.parentSessionId,
      }),
    });
  }
}

/**
 * Get the tracer instance
 */
export function getTracer() {
  if (!tracerInstance) {
    throw new Error("Tracer not initialized. Call initializeTracer first.");
  }
  return tracerInstance;
}

/**
 * Get the root span for the session
 */
export function getRootSpan(): Span {
  if (!rootSpan) {
    throw new Error("Root span not initialized. Call initializeTracer first.");
  }
  return rootSpan;
}

/**
 * Start a span as a child of the root span
 */
export function startSpan(name: string, options?: any): Span {
  const tracer = getTracer();
  const ctx = trace.setSpan(context.active(), getRootSpan());

  return tracer.startSpan(name, options, ctx);
}

/**
 * Start an API call span
 */
export function startApiCallSpan(url: string, method: string = "POST"): Span {
  return startSpan(`API ${method} ${url}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      "http.method": method,
      "http.url": url,
    },
  });
}

/**
 * Start a tool call span
 */
export function startToolSpan(toolName: string, parentSpan?: Span): Span {
  const ctx = parentSpan
    ? trace.setSpan(context.active(), parentSpan)
    : undefined;
  const tracer = getTracer();

  return tracer.startSpan(
    `Tool: ${toolName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "tool.name": toolName,
      },
    },
    ctx,
  );
}

/**
 * Start a tool span with input/output capture capability
 */
export function startEnhancedToolSpan(
  toolName: string,
  input?: any,
  mcpServer?: string,
  parentSpan?: Span,
): Span {
  const ctx = parentSpan
    ? trace.setSpan(context.active(), parentSpan)
    : undefined;
  const tracer = getTracer();

  const attributes: Record<string, any> = {
    "tool.name": toolName,
  };

  if (input) {
    attributes["tool.input"] =
      typeof input === "string" ? input : JSON.stringify(input);
  }

  if (mcpServer) {
    attributes["mcp.server"] = mcpServer;
  }

  return tracer.startSpan(
    `Tool: ${toolName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes,
    },
    ctx,
  );
}

/**
 * Add tool output to an existing span
 */
export function addToolOutput(span: Span, output: any): void {
  if (output) {
    const outputStr =
      typeof output === "string" ? output : JSON.stringify(output);
    span.setAttributes({
      "tool.output":
        outputStr.length > 10000
          ? outputStr.substring(0, 10000) + "... [TRUNCATED]"
          : outputStr,
    });
  }
}

/**
 * Start a hook event span
 */
export function startHookEventSpan(eventName: string, toolName?: string): Span {
  const name = toolName
    ? `Hook: ${eventName}[${toolName}]`
    : `Hook: ${eventName}`;
  return startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "hook.event": eventName,
      ...(toolName && { "tool.name": toolName }),
    },
  });
}

/**
 * Start a hook execution span
 */
export function startHookExecutionSpan(
  command: string,
  parentSpan: Span,
  isExclusive: boolean = false,
): Span {
  const ctx = trace.setSpan(context.active(), parentSpan);
  const tracer = getTracer();

  return tracer.startSpan(
    `Hook Execution: ${command}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "hook.command": command,
        "hook.exclusive": isExclusive,
      },
    },
    ctx,
  );
}

/**
 * Record an error on a span
 */
export function recordError(span: Span, error: Error | string): void {
  span.recordException(error instanceof Error ? error : new Error(error));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : error,
  });
}

/**
 * End the root span and shutdown the tracer
 */
export async function shutdown(): Promise<void> {
  console.log("OTEL Tracer: Starting shutdown...");

  if (rootSpan) {
    console.log("OTEL Tracer: Ending root span");
    rootSpan.end();
  }

  console.log(
    "OTEL Tracer: Shutdown complete (spans already written immediately)",
  );

  // Generate HTML report now that all traces are written
  await generateEndOfSessionHTML();
}

async function generateEndOfSessionHTML(): Promise<void> {
  if (!currentConfig) {
    console.log("❌ No tracer config available, skipping HTML report");
    return;
  }

  const { runId, sessionId } = currentConfig;

  const path = await import("path");
  const fs = await import("fs");
  const os = await import("os");

  const baseDir = path.join(os.homedir(), ".cc-profile", "logs", runId);
  const otlpFile = path.join(baseDir, "trace.otlp.jsonl");
  const htmlFile = path.join(baseDir, "report.html");

  // Ensure base directory exists
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  try {
    // Actually generate the HTML report
    const { OTLPHTMLGenerator } = await import("./otlp-html-generator.js");
    const generator = new OTLPHTMLGenerator();

    await generator.generateHTML(otlpFile, htmlFile, {
      title: `cc-profile Session ${sessionId}`,
      sessionId: sessionId,
      parentSessionId: currentConfig.parentSessionId,
    });

    // Show session completion info in the same format as the beginning
    console.log("📊 cc-profile session complete");
    console.log(`   Run ID:      ${runId}`);
    console.log(`   OTLP Trace:  ${otlpFile}`);
    console.log(`   HTML Report: ${htmlFile}`);

    // Check if should open browser
    const shouldOpen =
      process.env.CC_PROFILE_OPEN_HTML === "true" ||
      process.env.CLAUDE_TRACE_OPEN_BROWSER === "true";

    if (shouldOpen && fs.existsSync(htmlFile)) {
      const { spawn } = await import("child_process");
      spawn("open", [htmlFile], { detached: true, stdio: "ignore" }).unref();
      console.log("🌐 Opening in browser...");
    }
  } catch (_error) {
    // Silently fail
  }
}

/**
 * Helper to run code within a span context
 */
export async function withSpan<T>(
  span: Span,
  fn: () => Promise<T> | T,
): Promise<T> {
  try {
    const result = await fn();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordError(span, error as Error);
    throw error;
  } finally {
    span.end();
  }
}
