/**
 * OTLP JSON parser for converting OpenTelemetry traces to D3-friendly format
 */

// SpanKind constants from OpenTelemetry OTLP specification
enum SpanKind {
  UNSPECIFIED = 0,
  INTERNAL = 1,
  SERVER = 2,
  CLIENT = 3,
  PRODUCER = 4,
  CONSUMER = 5,
}

interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OTLPAttribute[];
  status?: {
    code: number;
    message?: string;
  };
  events?: Array<{
    timeUnixNano: string;
    name: string;
    attributes?: OTLPAttribute[];
  }>;
}

export interface OTLPTraceData {
  resourceSpans: Array<{
    resource: {
      attributes: OTLPAttribute[];
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version?: string;
      };
      spans: OTLPSpan[];
    }>;
  }>;
}

interface OTLPTrace {
  resourceSpans: Array<{
    resource: {
      attributes: OTLPAttribute[];
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version?: string;
      };
      spans: OTLPSpan[];
    }>;
  }>;
}

export interface D3Span {
  id: string;
  parentId?: string;
  name: string;
  type: "api" | "tool" | "hook" | "file" | "test" | "other";
  startTime: number;
  endTime: number;
  duration: number;
  depth: number;
  attributes: Record<string, any>;
  status: "success" | "error" | "unknown";
  cost?: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  children: D3Span[];
  // Content fields for displaying conversation details
  promptText?: string;
  responseText?: string;
  toolInput?: any;
  toolOutput?: any;
  mcpServer?: string;
}

export type ParsedSpan = D3Span;

export interface TraceMetrics {
  totalDuration: number;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  apiCallCount: number;
  toolCallCount: number;
  hookCallCount: number;
  errorCount: number;
}

export class OTLPParser {
  private spans: Map<string, D3Span> = new Map();
  private rootSpan: D3Span | null = null;

  parse(otlpJson: OTLPTrace): { root: D3Span; metrics: TraceMetrics } {
    // Extract all spans from the OTLP structure
    const allSpans: OTLPSpan[] = [];
    for (const resourceSpan of otlpJson.resourceSpans) {
      for (const scopeSpan of resourceSpan.scopeSpans) {
        allSpans.push(...scopeSpan.spans);
      }
    }

    // Convert OTLP spans to D3 format
    for (const otlpSpan of allSpans) {
      const d3Span = this.convertSpan(otlpSpan);
      this.spans.set(d3Span.id, d3Span);
    }

    // Build parent-child relationships and collect orphaned spans
    const orphanedSpans: D3Span[] = [];

    for (const span of this.spans.values()) {
      if (span.parentId && this.spans.has(span.parentId)) {
        const parent = this.spans.get(span.parentId)!;
        parent.children.push(span);
      } else {
        // Span without a parent in this trace - treat as root-level
        orphanedSpans.push(span);
      }
    }

    // Create a synthetic root to hold all orphaned spans
    if (orphanedSpans.length > 0) {
      this.rootSpan = this.createSessionRoot();
      this.rootSpan.children = orphanedSpans;

      // Update the orphaned spans to be children of the synthetic root
      for (const orphan of orphanedSpans) {
        orphan.parentId = this.rootSpan.id;
      }
    }

    // Calculate depths
    if (this.rootSpan) {
      this.calculateDepths(this.rootSpan, 0);
    }

    // Calculate metrics
    const metrics = this.calculateMetrics();

    return {
      root: this.rootSpan || this.createEmptyRoot(),
      metrics,
    };
  }

  private convertSpan(otlpSpan: OTLPSpan): D3Span {
    const attributes = this.parseAttributes(otlpSpan.attributes || []);
    const type = this.determineSpanType(otlpSpan, attributes);

    const d3Span: D3Span = {
      id: otlpSpan.spanId,
      parentId: otlpSpan.parentSpanId,
      name: this.createMeaningfulSpanName(otlpSpan, attributes, type),
      type,
      startTime: Number(otlpSpan.startTimeUnixNano) / 1_000_000, // Convert to milliseconds
      endTime: Number(otlpSpan.endTimeUnixNano) / 1_000_000,
      duration:
        (Number(otlpSpan.endTimeUnixNano) -
          Number(otlpSpan.startTimeUnixNano)) /
        1_000_000,
      depth: 0,
      attributes,
      status: this.determineStatus(otlpSpan),
      children: [],
    };

    // Extract cost and token metrics
    if (type === "api") {
      d3Span.cost = attributes["ai.cost.usd"] || 0;
      d3Span.tokensIn = attributes["ai.tokens.input"] || 0;
      d3Span.tokensOut = attributes["ai.tokens.output"] || 0;
      d3Span.cacheRead = attributes["ai.cache.read"] || 0;
      d3Span.cacheWrite = attributes["ai.cache.write"] || 0;

      // Extract content attributes
      if (attributes["ai.prompt"]) d3Span.promptText = attributes["ai.prompt"];
      if (attributes["ai.response"])
        d3Span.responseText = attributes["ai.response"];
    }

    // Extract tool input/output and MCP server info for tool spans
    if (type === "tool") {
      if (attributes["tool.input"]) d3Span.toolInput = attributes["tool.input"];
      if (attributes["tool.output"])
        d3Span.toolOutput = attributes["tool.output"];
      if (attributes["mcp.server"]) d3Span.mcpServer = attributes["mcp.server"];
    }

    return d3Span;
  }

  private createMeaningfulSpanName(
    span: OTLPSpan,
    attributes: Record<string, any>,
    type: D3Span["type"],
  ): string {
    switch (type) {
      case "api":
        return this.createApiSpanName(span, attributes);
      case "tool":
        return this.createToolSpanName(span, attributes);
      case "hook":
        return this.createHookSpanName(span, attributes);
      default:
        return span.name; // Keep original name for other types
    }
  }

  private createApiSpanName(
    span: OTLPSpan,
    attributes: Record<string, any>,
  ): string {
    const model = attributes["ai.model"] || "unknown";
    const tokensIn = attributes["ai.tokens.input"] || 0;
    const tokensOut = attributes["ai.tokens.output"] || 0;
    const cost = attributes["ai.cost.usd"] || 0;
    const duration =
      (Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) /
      1_000_000;

    // Try to extract user prompt from request body if available
    // Note: This would need to be enhanced to actually extract the prompt from the request
    // For now, we'll create a descriptive name with available metrics

    const modelShort = this.getShortModelName(model);
    const tokensInFormatted = this.formatTokenCount(tokensIn);
    const tokensOutFormatted = this.formatTokenCount(tokensOut);
    const costFormatted = this.formatCost(cost);
    const durationFormatted = this.formatDuration(duration);

    // Check if there were tool calls by looking for tool-related attributes or patterns
    const hasTools = this.hasToolCalls(attributes);
    const toolIndicator = hasTools ? " 🔧" : "";

    return `${modelShort} • ${tokensInFormatted}→${tokensOutFormatted} • ${costFormatted} • ${durationFormatted}${toolIndicator}`;
  }

  private createToolSpanName(
    span: OTLPSpan,
    attributes: Record<string, any>,
  ): string {
    const toolName = attributes["tool.name"] || span.name.replace("Tool: ", "");
    const duration =
      (Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) /
      1_000_000;
    const durationFormatted = this.formatDuration(duration);

    return `🔧 ${toolName} (${durationFormatted})`;
  }

  private createHookSpanName(
    span: OTLPSpan,
    attributes: Record<string, any>,
  ): string {
    const eventName =
      attributes["hook.event"] || span.name.replace("Hook: ", "");
    const toolName = attributes["tool.name"];
    const duration =
      (Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) /
      1_000_000;
    const durationFormatted = this.formatDuration(duration);

    if (toolName) {
      return `🪝 ${eventName}[${toolName}] (${durationFormatted})`;
    }
    return `🪝 ${eventName} (${durationFormatted})`;
  }

  private getShortModelName(model: string): string {
    if (model.includes("haiku")) return "Haiku";
    if (model.includes("sonnet")) return "Sonnet";
    if (model.includes("opus")) return "Opus";
    if (model.includes("claude")) return "Claude";
    return model.split("-").pop() || model;
  }

  private formatTokenCount(tokens: number): string {
    if (tokens < 1000) return tokens.toString();
    return `${(tokens / 1000).toFixed(1)}k`;
  }

  private formatCost(cost: number): string {
    if (cost < 0.001) return "<$0.001";
    return `$${cost.toFixed(3)}`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  private hasToolCalls(attributes: Record<string, any>): boolean {
    // This is a heuristic - in a full implementation, we'd want to parse the actual response
    // to detect tool calls. For now, we'll use some simple indicators.
    return Boolean(
      attributes["tool.name"] ||
        attributes["tool.id"] ||
        (attributes["ai.tokens.output"] &&
          attributes["ai.tokens.output"] > 100),
    );
  }

  private parseAttributes(attributes: OTLPAttribute[]): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const attr of attributes) {
      let value: any;

      // Parse attribute value based on type (check for undefined to handle falsy values correctly)
      if (attr.value.stringValue !== undefined) {
        value = attr.value.stringValue;
      } else if (attr.value.intValue !== undefined) {
        value = Number(attr.value.intValue);
      } else if (attr.value.doubleValue !== undefined) {
        value = attr.value.doubleValue;
      } else if (attr.value.boolValue !== undefined) {
        value = attr.value.boolValue;
      } else {
        value = null; // Fallback for unknown attribute types
      }

      obj[attr.key] = value;
    }
    return obj;
  }

  private determineSpanType(
    span: OTLPSpan,
    attributes: Record<string, any>,
  ): D3Span["type"] {
    // Check span kind first
    if (span.kind === SpanKind.CLIENT) {
      return "api";
    }

    // Check by name patterns
    if (span.name.includes("Tool:")) {
      return "tool";
    }
    if (span.name.includes("Hook")) {
      return "hook";
    }
    if (span.name.includes("File Change")) {
      return "file";
    }
    if (span.name.includes("Test")) {
      return "test";
    }

    // Check attributes
    if (attributes["tool.name"]) {
      return "tool";
    }
    if (attributes["hook.event"]) {
      return "hook";
    }

    return "other";
  }

  private determineStatus(span: OTLPSpan): D3Span["status"] {
    if (!span.status) return "unknown";

    // OTLP Status Codes per OpenTelemetry specification:
    // 0 = UNSET (not set)
    // 1 = OK (success)
    // 2 = ERROR (error)
    switch (span.status.code) {
      case 0:
        return "unknown"; // UNSET
      case 1:
        return "success"; // OK
      case 2:
        return "error"; // ERROR
      default:
        return "unknown"; // Unknown code
    }
  }

  private calculateDepths(span: D3Span, depth: number): void {
    span.depth = depth;
    for (const child of span.children) {
      this.calculateDepths(child, depth + 1);
    }
  }

  private calculateMetrics(): TraceMetrics {
    const metrics: TraceMetrics = {
      totalDuration: 0,
      totalCost: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      apiCallCount: 0,
      toolCallCount: 0,
      hookCallCount: 0,
      errorCount: 0,
    };

    if (this.rootSpan) {
      metrics.totalDuration = this.rootSpan.duration;
    }

    for (const span of this.spans.values()) {
      if (span.type === "api") {
        metrics.apiCallCount++;
        metrics.totalCost += span.cost || 0;
        metrics.totalTokensIn += span.tokensIn || 0;
        metrics.totalTokensOut += span.tokensOut || 0;
        metrics.totalCacheRead += span.cacheRead || 0;
        metrics.totalCacheWrite += span.cacheWrite || 0;
      } else if (span.type === "tool") {
        metrics.toolCallCount++;
      } else if (span.type === "hook") {
        metrics.hookCallCount++;
      }

      if (span.status === "error") {
        metrics.errorCount++;
      }
    }

    return metrics;
  }

  private createEmptyRoot(): D3Span {
    return {
      id: "root",
      name: "Claude Code Session",
      type: "other",
      startTime: 0,
      endTime: 0,
      duration: 0,
      depth: 0,
      attributes: {},
      status: "unknown",
      children: [],
    };
  }

  private createSessionRoot(): D3Span {
    // Find the time bounds of all spans
    let minStartTime = Infinity;
    let maxEndTime = -Infinity;

    for (const span of this.spans.values()) {
      minStartTime = Math.min(minStartTime, span.startTime);
      maxEndTime = Math.max(maxEndTime, span.endTime);
    }

    return {
      id: "session-root",
      name: "Claude Code Session",
      type: "other",
      startTime: minStartTime === Infinity ? 0 : minStartTime,
      endTime: maxEndTime === -Infinity ? 0 : maxEndTime,
      duration:
        maxEndTime === -Infinity || minStartTime === Infinity
          ? 0
          : maxEndTime - minStartTime,
      depth: 0,
      attributes: {},
      status: "success",
      children: [],
    };
  }

  /**
   * Flatten the span tree into a list for D3 rendering
   */
  static flattenSpans(root: D3Span): D3Span[] {
    const result: D3Span[] = [];

    function traverse(span: D3Span) {
      result.push(span);
      for (const child of span.children) {
        traverse(child);
      }
    }

    traverse(root);
    return result;
  }
}

/**
 * Convenience function to parse OTLP trace data
 */
export function parseOTLPTrace(traceData: OTLPTraceData): D3Span[] {
  const parser = new OTLPParser();
  const result = parser.parse(traceData);
  return OTLPParser.flattenSpans(result.root);
}
