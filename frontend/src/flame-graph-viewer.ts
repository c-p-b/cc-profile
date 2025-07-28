/**
 * D3.js-based flamegraph viewer for OpenTelemetry spans
 * Creates an interactive hierarchical visualization using d3-flame-graph
 */

import * as d3 from "d3";
import { flamegraph } from "d3-flame-graph";
import { D3Span, TraceMetrics } from "./otlp-parser";

interface ViewerConfig {
  container: string;
  width?: number;
  height?: number;
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

interface RequiredViewerConfig extends ViewerConfig {
  width: number;
  height: number;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

interface FlameNode {
  name: string;
  value: number;
  children?: FlameNode[];
  spanId: string;
  type: string;
  cost?: number;
  tokensIn?: number;
  tokensOut?: number;
  status?: string;
  originalSpan?: D3Span;
}

interface SpanColors {
  api: string;
  tool: string;
  hook: string;
  file: string;
  test: string;
  other: string;
}

export class FlameGraphViewer {
  private config: RequiredViewerConfig;
  private chart: any;
  private container: d3.Selection<HTMLElement, unknown, HTMLElement, any>;
  private tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;
  private selectedSpan: D3Span | null = null;
  private onSpanClick?: (span: D3Span) => void;

  private colors: SpanColors = {
    api: "#3B82F6", // Blue
    tool: "#10B981", // Green
    hook: "#8B5CF6", // Purple
    file: "#F59E0B", // Orange
    test: "#EF4444", // Red
    other: "#6B7280", // Gray
  };

  constructor(config: ViewerConfig) {
    this.config = {
      container: config.container,
      width: config.width || 800,
      height: config.height || 600,
      margins: config.margins || { top: 40, right: 200, bottom: 40, left: 200 },
    };

    this.container = d3.select(this.config.container);
    this.tooltip = this.createTooltip();
    this.initializeChart();
  }

  private initializeChart(): void {
    // Clear any existing content
    this.container.selectAll("*").remove();

    // Initialize the flamegraph
    this.chart = flamegraph()
      .width(this.config.width)
      .height(this.config.height)
      .cellHeight(18)
      .minFrameSize(5)
      .transitionDuration(750)
      .inverted(false) // Standard flamegraph (root at bottom)
      .tooltip(this.createTooltipContent.bind(this))
      .onClick(this.handleClick.bind(this))
      .color(this.getNodeColor.bind(this));
  }

  private createTooltip(): d3.Selection<
    HTMLDivElement,
    unknown,
    HTMLElement,
    any
  > {
    return d3
      .select("body")
      .append("div")
      .attr("class", "flame-tooltip")
      .style("position", "absolute")
      .style("padding", "10px")
      .style("background", "rgba(0, 0, 0, 0.9)")
      .style("color", "white")
      .style("border-radius", "4px")
      .style("font-size", "12px")
      .style("pointer-events", "none")
      .style("opacity", 0)
      .style("z-index", 1000);
  }

  private createTooltipContent(d: any): string {
    const node: FlameNode = d.data;

    const content = [
      `<strong>${this.escapeHtml(node.name)}</strong>`,
      `Duration: ${this.formatDuration(node.value)}`,
      `Type: ${node.type.toUpperCase()}`,
    ];

    if (node.status === "error") {
      content.push('<span style="color: #ef4444">Status: ERROR</span>');
    }

    if (node.cost) {
      content.push(`Cost: $${node.cost.toFixed(3)}`);
    }

    if (node.tokensIn || node.tokensOut) {
      content.push(`Tokens: ${node.tokensIn || 0}↓ ${node.tokensOut || 0}↑`);
    }

    return content.join("<br>");
  }

  private getNodeColor(d: any): string {
    const node: FlameNode = d.data;

    // Prioritize error status over type color (consistent with trace viewer)
    if (node.status === "error") {
      return "#DC2626"; // Bright red for errors
    }
    if (node.status === "unknown") {
      return "#6B7280"; // Gray for unknown status
    }

    return this.colors[node.type as keyof SpanColors] || this.colors.other;
  }

  private handleClick(d: any): void {
    const node: FlameNode = d.data;

    if (node.originalSpan) {
      this.selectedSpan = node.originalSpan;

      // Callback for external detail panel
      if (this.onSpanClick) {
        this.onSpanClick(node.originalSpan);
      }
    }
  }

  render(spans: D3Span[], _metrics: TraceMetrics): void {
    if (!spans || spans.length === 0) {
      this.renderEmptyState();
      return;
    }

    // Transform spans to flamegraph data
    const flameData = this.transformSpansToFlameGraph(spans);

    // Render the flamegraph
    this.container.datum(flameData).call(this.chart);
  }

  private renderEmptyState(): void {
    this.container.selectAll("*").remove();
    this.container
      .append("div")
      .style("display", "flex")
      .style("align-items", "center")
      .style("justify-content", "center")
      .style("height", "100%")
      .style("color", "#6b7280")
      .append("div")
      .style("text-align", "center")
      .html(
        "<h3>No Trace Data</h3><p>No spans available for flamegraph visualization</p>",
      );
  }

  private transformSpansToFlameGraph(spans: D3Span[]): FlameNode {
    // Build parent-child relationships
    const spanMap = new Map<string, D3Span>();
    const children = new Map<string, string[]>();

    spans.forEach((span) => {
      spanMap.set(span.id, span);
      const parentId = this.extractParentId(span);
      if (parentId) {
        if (!children.has(parentId)) {
          children.set(parentId, []);
        }
        children.get(parentId)!.push(span.id);
      }
    });

    // Build flamegraph node structure
    const buildNode = (spanId: string): FlameNode => {
      const span = spanMap.get(spanId)!;
      const nodeChildren = children.get(spanId) || [];

      return {
        name: this.truncateSpanName(span.name),
        value: span.duration,
        spanId: span.id,
        type: span.type,
        cost: span.cost,
        tokensIn: span.tokensIn,
        tokensOut: span.tokensOut,
        status: span.status,
        originalSpan: span,
        children:
          nodeChildren.length > 0 ? nodeChildren.map(buildNode) : undefined,
      };
    };

    // Find root spans (spans without parents)
    const rootSpans = spans.filter((s) => !this.extractParentId(s));

    if (rootSpans.length === 0) {
      // No clear hierarchy, create artificial root
      return {
        name: "Session",
        value: Math.max(...spans.map((s) => s.duration)),
        spanId: "root",
        type: "session",
        children: spans.slice(0, 10).map((span) => ({
          // Limit to first 10 to avoid overcrowding
          name: this.truncateSpanName(span.name),
          value: span.duration,
          spanId: span.id,
          type: span.type,
          originalSpan: span,
        })),
      };
    }

    if (rootSpans.length === 1) {
      // Single root, use it directly
      return buildNode(rootSpans[0].id);
    }

    // Multiple roots, create artificial container
    const totalDuration = rootSpans.reduce(
      (sum, span) => sum + span.duration,
      0,
    );
    return {
      name: `Session (${rootSpans.length} operations)`,
      value: totalDuration,
      spanId: "root",
      type: "session",
      children: rootSpans.map((span) => buildNode(span.id)),
    };
  }

  private extractParentId(span: D3Span): string | null {
    // Try various common parent ID attribute names
    const parentIdFields = [
      "parent.span_id",
      "parent_span_id",
      "parentSpanId",
      "parent.id",
      "parent_id",
    ];

    for (const field of parentIdFields) {
      const parentId = span.attributes[field];
      if (parentId && typeof parentId === "string") {
        return parentId;
      }
    }

    return null;
  }

  private truncateSpanName(name: string): string {
    const maxLength = 40;
    if (name.length <= maxLength) return name;

    // Try to truncate at a meaningful boundary (space, slash, etc.)
    const truncated = name.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(" ");
    const lastSlash = truncated.lastIndexOf("/");
    const boundary = Math.max(lastSpace, lastSlash);

    if (boundary > maxLength / 2) {
      return name.substring(0, boundary) + "...";
    }

    return truncated + "...";
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  onSpanSelected(callback: (span: D3Span) => void): void {
    this.onSpanClick = callback;
  }

  selectSpan(span: D3Span): void {
    this.selectedSpan = span;
    // TODO: Implement visual highlighting of selected span in flamegraph
    // This would require extending d3-flame-graph or custom highlighting
  }

  resetZoom(): void {
    // d3-flame-graph handles its own zoom/navigation
    // Reset to root view
    if (this.chart && this.chart.resetZoom) {
      this.chart.resetZoom();
    }
  }

  destroy(): void {
    if (this.tooltip) {
      this.tooltip.remove();
    }
    if (this.container) {
      this.container.selectAll("*").remove();
    }
  }
}
