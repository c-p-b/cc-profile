/**
 * OTLP JSON parser for converting OpenTelemetry traces to D3-friendly format
 */

import { SpanKind } from "@opentelemetry/api";

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
  attributes: Map<string, any>;
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

    // Build parent-child relationships
    for (const span of this.spans.values()) {
      if (span.parentId && this.spans.has(span.parentId)) {
        const parent = this.spans.get(span.parentId)!;
        parent.children.push(span);
      } else if (!span.parentId) {
        this.rootSpan = span;
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
      name: otlpSpan.name,
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
      const cost = attributes.get("ai.cost.usd");
      const tokensIn = attributes.get("ai.tokens.input");
      const tokensOut = attributes.get("ai.tokens.output");
      const cacheRead = attributes.get("ai.cache.read");
      const cacheWrite = attributes.get("ai.cache.write");

      if (cost === undefined)
        throw new Error(
          `Missing required attribute 'ai.cost.usd' for API span: ${d3Span.name}`,
        );
      if (tokensIn === undefined)
        throw new Error(
          `Missing required attribute 'ai.tokens.input' for API span: ${d3Span.name}`,
        );
      if (tokensOut === undefined)
        throw new Error(
          `Missing required attribute 'ai.tokens.output' for API span: ${d3Span.name}`,
        );
      if (cacheRead === undefined)
        throw new Error(
          `Missing required attribute 'ai.cache.read' for API span: ${d3Span.name}`,
        );
      if (cacheWrite === undefined)
        throw new Error(
          `Missing required attribute 'ai.cache.write' for API span: ${d3Span.name}`,
        );

      d3Span.cost = cost;
      d3Span.tokensIn = tokensIn;
      d3Span.tokensOut = tokensOut;
      d3Span.cacheRead = cacheRead;
      d3Span.cacheWrite = cacheWrite;

      // Extract content attributes
      const promptText = attributes.get("ai.prompt");
      const responseText = attributes.get("ai.response");
      if (promptText) d3Span.promptText = promptText;
      if (responseText) d3Span.responseText = responseText;
    }

    // Extract tool input/output and MCP server info for tool spans
    if (type === "tool") {
      const toolInput = attributes.get("tool.input");
      const toolOutput = attributes.get("tool.output");
      const mcpServer = attributes.get("mcp.server");

      if (toolInput) d3Span.toolInput = toolInput;
      if (toolOutput) d3Span.toolOutput = toolOutput;
      if (mcpServer) d3Span.mcpServer = mcpServer;
    }

    return d3Span;
  }

  private parseAttributes(attributes: OTLPAttribute[]): Map<string, any> {
    const map = new Map<string, any>();
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

      map.set(attr.key, value);
    }
    return map;
  }

  private determineSpanType(
    span: OTLPSpan,
    attributes: Map<string, any>,
  ): D3Span["type"] {
    // Check span kind first
    if (span.kind === SpanKind.CLIENT || span.kind === SpanKind.PRODUCER) {
      return "api";
    }

    // Check by name patterns
    if (span.name.startsWith("API ")) {
      return "api";
    }
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
    if (attributes.has("ai.model")) {
      return "api";
    }
    if (attributes.has("tool.name")) {
      return "tool";
    }
    if (attributes.has("hook.event")) {
      return "hook";
    }

    return "other";
  }

  private determineStatus(span: OTLPSpan): D3Span["status"] {
    if (!span.status) return "unknown";
    return span.status.code === 0 ? "success" : "error";
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
        if (span.cost === undefined)
          throw new Error(`API span missing cost: ${span.name}`);
        if (span.tokensIn === undefined)
          throw new Error(`API span missing tokensIn: ${span.name}`);
        if (span.tokensOut === undefined)
          throw new Error(`API span missing tokensOut: ${span.name}`);
        if (span.cacheRead === undefined)
          throw new Error(`API span missing cacheRead: ${span.name}`);
        if (span.cacheWrite === undefined)
          throw new Error(`API span missing cacheWrite: ${span.name}`);

        metrics.totalCost += span.cost;
        metrics.totalTokensIn += span.tokensIn;
        metrics.totalTokensOut += span.tokensOut;
        metrics.totalCacheRead += span.cacheRead;
        metrics.totalCacheWrite += span.cacheWrite;
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
      attributes: new Map(),
      status: "unknown",
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
