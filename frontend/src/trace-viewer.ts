/**
 * D3.js-based trace viewer for OpenTelemetry spans
 * Creates an interactive waterfall timeline visualization
 */

import * as d3 from "d3";
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
  rowHeight?: number;
  visibleRowsBuffer?: number;
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
  rowHeight: number;
  visibleRowsBuffer: number;
}

interface SpanColors {
  api: string;
  tool: string;
  hook: string;
  file: string;
  test: string;
  other: string;
}

enum CausalityType {
  ROOT = "root", // Top-level API calls
  CHILD = "child", // Direct child (tool calls)
  TRIGGER = "trigger", // Hooks triggered by parent
  SIBLING = "sibling", // Same-level operations
}

interface HierarchicalSpan extends D3Span {
  level: number;
  children?: HierarchicalSpan[];
  isExpanded: boolean;
  isVisible: boolean;
  service: string;
  operation: string;
  causalityType: CausalityType;
  triggerSpanId?: string; // ID of span that triggered this one
  isCompressed: boolean; // Whether span width is artificially expanded
  actualDuration: number; // Original duration before compression
}

export class TraceViewer {
  private config: RequiredViewerConfig;
  private readonly MIN_SPAN_WIDTH = 20; // Minimum clickable width in pixels
  private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>;
  private mainGroup: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
  private xScale: d3.ScaleLinear<number, number>;
  private yScale: d3.ScaleLinear<number, number>;
  private zoom: d3.ZoomBehavior<Element, unknown>;
  private tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;
  private selectedSpan: D3Span | HierarchicalSpan | null = null;
  private onSpanClick?: (span: D3Span | HierarchicalSpan) => void;

  // Virtual scrolling state
  private allSpans: D3Span[] = [];
  private hierarchicalData: HierarchicalSpan[] = [];
  private visibleSpans: HierarchicalSpan[] = [];
  private scrollPosition: number = 0;
  private totalRows: number = 0;
  private visibleRowCount: number = 0;

  private colors: SpanColors = {
    api: "#3B82F6", // Blue
    tool: "#10B981", // Green
    hook: "#8B5CF6", // Purple
    file: "#F59E0B", // Orange
    test: "#EF4444", // Red
    other: "#6B7280", // Gray
  };

  private errorColors = {
    error: "#DC2626", // Bright red for errors
    unknown: "#6B7280", // Gray for unknown status
    success: null, // Use default type colors
  };

  constructor(config: ViewerConfig) {
    this.config = {
      container: config.container,
      width: config.width || 800,
      height: config.height || 600,
      margins: config.margins || { top: 40, right: 200, bottom: 40, left: 200 },
      rowHeight: config.rowHeight || 30,
      visibleRowsBuffer: config.visibleRowsBuffer || 5,
    };

    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleLinear();
    this.zoom = d3
      .zoom<Element, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", this.zoomed.bind(this));

    this.svg = this.createSvg();
    this.mainGroup = this.svg
      .append("g")
      .attr(
        "transform",
        `translate(${this.config.margins.left},${this.config.margins.top})`,
      );

    this.tooltip = this.createTooltip();
    this.setupVirtualScrolling();

    // Calculate visible row count
    const availableHeight =
      this.config.height - this.config.margins.top - this.config.margins.bottom;
    this.visibleRowCount =
      Math.ceil(availableHeight / this.config.rowHeight) +
      this.config.visibleRowsBuffer * 2;
  }

  private createSvg(): d3.Selection<SVGSVGElement, unknown, HTMLElement, any> {
    const container = d3.select(this.config.container);
    container.selectAll("*").remove();

    return container
      .append("svg")
      .attr("width", this.config.width)
      .attr("height", this.config.height)
      .attr("viewBox", `0 0 ${this.config.width} ${this.config.height}`)
      .style("overflow", "hidden")
      .call(this.zoom as any);
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
      .attr("class", "trace-tooltip")
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

  render(spans: D3Span[], _metrics: TraceMetrics): void {
    // Store original spans
    this.allSpans = spans;

    // Create hierarchical structure
    this.hierarchicalData = this.createHierarchicalStructure(spans);
    this.updateVisibleSpans();

    // Calculate dimensions
    const width =
      this.config.width - this.config.margins.left - this.config.margins.right;
    const height =
      this.config.height - this.config.margins.top - this.config.margins.bottom;

    // Set up scales
    const minTime = d3.min(spans, (d) => d.startTime) || 0;
    const maxTime = d3.max(spans, (d) => d.endTime) || 1;

    this.xScale.domain([0, maxTime - minTime]).range([0, width]);

    // Calculate actual content height based on total rows
    const contentHeight = Math.max(
      this.totalRows * this.config.rowHeight,
      height,
    );

    this.yScale.domain([0, contentHeight]).range([0, contentHeight]);

    // Update SVG height to accommodate content
    this.svg.attr(
      "height",
      contentHeight + this.config.margins.top + this.config.margins.bottom + 40,
    ); // +40 for axis

    // Clear previous content
    this.mainGroup.selectAll("*").remove();

    // Add grid lines
    this.addGridLines(width, height);

    // Add time axis
    this.addTimeAxis(width);

    // Add spans (virtual scrolled)
    this.addVirtualSpans(minTime);

    // Metrics header removed - duplicates info already shown in main header
  }

  private addGridLines(width: number, height: number): void {
    // Calculate the actual content height for grid lines
    const contentHeight = Math.max(
      this.totalRows * this.config.rowHeight,
      height,
    );

    // Remove existing grid lines
    this.mainGroup.select(".grid-lines-vertical").remove();

    // Vertical grid lines
    this.mainGroup
      .append("g")
      .attr("class", "grid-lines-vertical")
      .selectAll("line")
      .data(this.xScale.ticks(10))
      .enter()
      .append("line")
      .attr("x1", (d) => this.xScale(d))
      .attr("x2", (d) => this.xScale(d))
      .attr("y1", 0)
      .attr("y2", contentHeight)
      .attr("stroke", "#e5e7eb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2,2");
  }

  private addTimeAxis(_width: number): void {
    // Calculate the actual content height based on total rows
    const contentHeight = Math.max(
      this.totalRows * this.config.rowHeight,
      this.config.height - this.config.margins.top - this.config.margins.bottom,
    );

    const xAxis = d3
      .axisBottom(this.xScale)
      .tickFormat((d) => this.formatTimeAxisLabel(d));

    // Remove existing axis to avoid duplicates
    this.mainGroup.select(".x-axis").remove();

    this.mainGroup
      .append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${contentHeight})`)
      .call(xAxis);
  }

  private addSpans(spans: D3Span[], minTime: number): void {
    // This method is deprecated - use addVirtualSpans instead
    console.warn("addSpans is deprecated, using virtual rendering");
    this.addVirtualSpans(minTime);
  }

  // Removed addMetricsHeader method - metrics are already displayed in the main header

  private zoomed(event: d3.D3ZoomEvent<Element, unknown>): void {
    this.mainGroup.attr("transform", event.transform.toString());

    // Update x-axis labels with new zoom level
    this.updateAxisLabels();
  }

  private updateAxisLabels(): void {
    const xAxis = d3
      .axisBottom(this.xScale)
      .tickFormat((d) => this.formatTimeAxisLabel(d));

    // Update existing axis
    this.mainGroup.select(".x-axis").call(xAxis);
  }

  private handleSpanClick(span: HierarchicalSpan): void {
    this.selectedSpan = span;

    // Highlight selected span and related causal chain
    this.highlightCausalChain(span);

    // Callback for external detail panel
    if (this.onSpanClick) {
      this.onSpanClick(span);
    }
  }

  private showTooltip(event: MouseEvent, span: HierarchicalSpan): void {
    let tooltipContent: string[];

    if (span.level === 0) {
      // Service-level tooltip
      const operationCount = span.children?.length || 0;
      const errorCount =
        span.children?.filter((c) => c.status === "error").length || 0;
      tooltipContent = [
        `<strong>${span.service}</strong>`,
        `Operations: ${operationCount}`,
        `Duration: ${this.formatDuration(span.duration)}`,
        errorCount > 0
          ? `<span style="color: #ef4444">Errors: ${errorCount}</span>`
          : "Status: OK",
      ];
    } else {
      // Operation-level tooltip
      tooltipContent = [
        `<strong>${span.name}</strong>`,
        `Service: ${span.service}`,
        `Type: ${span.type}`,
        this.getCompressionTooltip(span),
        `Duration: ${this.formatDuration(span.duration)}`,
        `Status: ${span.status}`,
        this.getCausalityTooltip(span),
        span.cost ? `Cost: $${span.cost.toFixed(3)}` : "",
        span.tokensIn ? `Tokens: ${span.tokensIn}↓ ${span.tokensOut}↑` : "",
      ];
    }

    this.tooltip
      .html(tooltipContent.filter(Boolean).join("<br>"))
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY - 10}px`)
      .transition()
      .duration(200)
      .style("opacity", 1);
  }

  private hideTooltip(): void {
    this.tooltip.transition().duration(200).style("opacity", 0);
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  private formatTimeAxisLabel(ms: number): string {
    // Dynamic formatting based on the scale and zoom level
    const domain = this.xScale.domain();
    const range = domain[1] - domain[0];

    // For very short durations (< 1 second total), show milliseconds
    if (range < 1000) {
      return `${Math.round(ms)}ms`;
    }
    // For short durations (< 2 minutes total), show seconds with decimals
    else if (range < 120000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    // For medium durations (< 10 minutes), show seconds without decimals
    else if (range < 600000) {
      return `${Math.round(ms / 1000)}s`;
    }
    // For long durations, show minutes
    else {
      return `${(ms / 60000).toFixed(1)}m`;
    }
  }

  private truncateText(text: string, maxLength: number): string {
    return text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;
  }

  onSpanSelected(callback: (span: D3Span | HierarchicalSpan) => void): void {
    this.onSpanClick = callback;
  }

  resetZoom(): void {
    this.svg
      .transition()
      .duration(750)
      .call(this.zoom.transform as any, d3.zoomIdentity);
  }

  destroy(): void {
    this.tooltip.remove();
  }

  private setupVirtualScrolling(): void {
    // Add scroll event listener to the SVG container
    const container = d3.select(this.config.container);
    container.on("wheel", (event: WheelEvent) => {
      event.preventDefault();
      this.handleScroll(event.deltaY);
    });
  }

  private handleScroll(deltaY: number): void {
    const scrollSensitivity = 3;
    const maxScroll = Math.max(
      0,
      (this.totalRows - this.visibleRowCount) * this.config.rowHeight,
    );

    this.scrollPosition = Math.max(
      0,
      Math.min(maxScroll, this.scrollPosition + deltaY * scrollSensitivity),
    );
    this.updateVisibleSpans();
    this.renderVisibleSpans();
  }

  private createHierarchicalStructure(spans: D3Span[]): HierarchicalSpan[] {
    // Convert spans to hierarchical format first
    const spanMap = new Map<string, HierarchicalSpan>();

    spans.forEach((span) => {
      const hierarchicalSpan: HierarchicalSpan = {
        ...span,
        level: 0,
        children: [],
        isExpanded: true,
        isVisible: true,
        service: this.extractService(span),
        operation: this.extractOperation(span),
        causalityType: CausalityType.ROOT,
        isCompressed: false,
        actualDuration: span.duration,
      };
      spanMap.set(span.id, hierarchicalSpan);
    });

    // Build causal relationships based on parent-child and timing
    spanMap.forEach((span) => {
      // Handle parent-child relationships from OTLP data
      if (span.parentId && spanMap.has(span.parentId)) {
        const parent = spanMap.get(span.parentId)!;
        parent.children!.push(span);
        span.level = parent.level + 1;

        // Determine causality type based on span types and timing
        if (span.type === "hook") {
          span.causalityType = CausalityType.TRIGGER;
          span.triggerSpanId = parent.id;
        } else {
          span.causalityType = CausalityType.CHILD;
        }
      }
    });

    // Find root spans (those without parents in our dataset)
    const rootSpans: HierarchicalSpan[] = [];
    spanMap.forEach((span) => {
      if (!span.parentId || !spanMap.has(span.parentId)) {
        span.causalityType = CausalityType.ROOT;
        span.level = 0;
        rootSpans.push(span);
      }
    });

    // Group API calls with their associated hooks and tools for better visualization
    const groupedRoots = this.groupCausalSequences(rootSpans);

    return groupedRoots.sort((a, b) => a.startTime - b.startTime);
  }

  private extractService(span: D3Span): string {
    // For causal grouping, we want logical flow-based services
    if (span.attributes["service.name"]) {
      return span.attributes["service.name"];
    }

    // Group by logical flow instead of span type
    switch (span.type) {
      case "api":
        return "Claude API";
      case "tool":
        return `Tool: ${span.attributes["tool.name"] || span.name}`;
      case "hook":
        return `Hook: ${span.name}`;
      case "file":
        return "File Operations";
      case "test":
        return "Test Execution";
      default:
        return "Other Operations";
    }
  }

  private extractOperation(span: D3Span): string {
    // Use the span name as operation, but truncate if too long
    return span.name.length > 40
      ? span.name.substring(0, 37) + "..."
      : span.name;
  }

  private groupCausalSequences(
    rootSpans: HierarchicalSpan[],
  ): HierarchicalSpan[] {
    // Group API calls with their temporally related hooks
    // This handles cases where hooks aren't direct children but are causally related

    const result: HierarchicalSpan[] = [];
    const processed = new Set<string>();

    rootSpans.forEach((rootSpan) => {
      if (processed.has(rootSpan.id)) return;

      if (rootSpan.type === "api") {
        // Find all spans that occur during or shortly after this API call
        const relatedSpans = this.findTemporallyRelatedSpans(
          rootSpan,
          rootSpans,
        );

        // Add related spans as children if they aren't already
        relatedSpans.forEach((related) => {
          if (!rootSpan.children!.some((child) => child.id === related.id)) {
            related.level = rootSpan.level + 1;
            related.causalityType =
              related.type === "hook"
                ? CausalityType.TRIGGER
                : CausalityType.CHILD;
            related.triggerSpanId = rootSpan.id;
            rootSpan.children!.push(related);
          }
          processed.add(related.id);
        });

        // Sort children by start time
        rootSpan.children!.sort((a, b) => a.startTime - b.startTime);
      }

      result.push(rootSpan);
      processed.add(rootSpan.id);
    });

    return result;
  }

  private findTemporallyRelatedSpans(
    apiSpan: HierarchicalSpan,
    allSpans: HierarchicalSpan[],
  ): HierarchicalSpan[] {
    const related: HierarchicalSpan[] = [];
    const timeWindow = 1000; // 1 second window after API call

    allSpans.forEach((span) => {
      if (span.id === apiSpan.id) return;

      // Check if span occurs during or shortly after API call
      const isDuringCall =
        span.startTime >= apiSpan.startTime &&
        span.startTime <= apiSpan.endTime;
      const isShortlyAfter =
        span.startTime > apiSpan.endTime &&
        span.startTime <= apiSpan.endTime + timeWindow;

      if (
        (isDuringCall || isShortlyAfter) &&
        (span.type === "hook" || span.type === "tool")
      ) {
        related.push(span);
      }
    });

    return related;
  }

  private calculateRenderWidth(span: HierarchicalSpan): {
    width: number;
    isCompressed: boolean;
  } {
    const naturalWidth = this.xScale(span.duration);
    const width = Math.max(this.MIN_SPAN_WIDTH, naturalWidth);
    const isCompressed = width > naturalWidth;

    // Update span compression state
    span.isCompressed = isCompressed;

    return { width, isCompressed };
  }

  private updateVisibleSpans(): void {
    const flatSpans = this.flattenHierarchy(this.hierarchicalData);
    this.totalRows = flatSpans.length;

    const startRow = Math.floor(this.scrollPosition / this.config.rowHeight);
    const endRow = Math.min(startRow + this.visibleRowCount, this.totalRows);

    this.visibleSpans = flatSpans.slice(startRow, endRow);
  }

  private flattenHierarchy(
    hierarchical: HierarchicalSpan[],
  ): HierarchicalSpan[] {
    const result: HierarchicalSpan[] = [];

    hierarchical.forEach((span) => {
      result.push(span);

      if (span.isExpanded && span.children) {
        span.children.forEach((child) => {
          if (child.isVisible) {
            result.push(child);
          }
        });
      }
    });

    return result;
  }

  private renderVisibleSpans(): void {
    if (!this.allSpans.length) return;

    const minTime = d3.min(this.allSpans, (d) => d.startTime) || 0;
    this.addVirtualSpans(minTime);

    // Update axis position after rendering spans
    const width =
      this.config.width - this.config.margins.left - this.config.margins.right;
    this.addTimeAxis(width);
  }

  private addVirtualSpans(minTime: number): void {
    // Remove existing span groups
    this.mainGroup.selectAll(".span-group").remove();

    const startRow = Math.floor(this.scrollPosition / this.config.rowHeight);

    const spanGroups = this.mainGroup
      .selectAll(".span-group")
      .data(this.visibleSpans)
      .enter()
      .append("g")
      .attr("class", "span-group")
      .attr("transform", (d, i) => {
        const rowIndex = startRow + i;
        const yPos = rowIndex * this.config.rowHeight;
        return `translate(0,${yPos})`;
      });

    // Add span bars with minimum width and compression indicators
    spanGroups
      .append("rect")
      .attr("class", "span-bar")
      .attr("x", (d) => this.xScale(d.startTime - minTime))
      .attr("width", (d) => {
        const { width } = this.calculateRenderWidth(d);
        return width;
      })
      .attr("height", this.config.rowHeight - 2)
      .attr("fill", (d) => {
        if (d.level === 0) return "#e5e7eb"; // Service summary bars are light gray
        // Prioritize error status over type color
        if (d.status === "error") return this.errorColors.error;
        if (d.status === "unknown") return this.errorColors.unknown;
        return this.colors[d.type];
      })
      .attr("opacity", (d) => {
        if (d.level === 0) return 0.6;
        // Slightly transparent for compressed spans
        return d.isCompressed ? 0.7 : 0.8;
      })
      .attr("stroke", (d) => {
        if (d.status === "error") return "#ef4444";
        // Add subtle border for compressed spans
        return d.isCompressed ? "#9ca3af" : "none";
      })
      .attr("stroke-width", (d) =>
        d.status === "error" ? 2 : d.isCompressed ? 1 : 0,
      )
      .attr("stroke-dasharray", (d) => (d.isCompressed ? "2,2" : "none"))
      .attr("cursor", "pointer")
      .on("click", (event, d) => this.handleSpanClick(d))
      .on("mouseover", (event, d) => this.showTooltip(event, d))
      .on("mouseout", () => this.hideTooltip());

    // Add compression indicator icons for compressed spans
    spanGroups
      .filter((d) => d.isCompressed)
      .append("text")
      .attr("class", "compression-indicator")
      .attr("x", (d) => this.xScale(d.startTime - minTime) + 2)
      .attr("y", this.config.rowHeight / 2)
      .attr("alignment-baseline", "middle")
      .attr("font-size", "10px")
      .attr("fill", "#6b7280")
      .attr("pointer-events", "none")
      .text("⇄"); // Compression indicator symbol

    // Add invisible hit areas for better interaction, especially for tiny spans
    spanGroups
      .append("rect")
      .attr("class", "span-hit-area")
      .attr("x", (d) => this.xScale(d.startTime - minTime))
      .attr("width", (d) => {
        const { width } = this.calculateRenderWidth(d);
        // Ensure minimum 40px hit area for very small spans
        return Math.max(40, width);
      })
      .attr("height", this.config.rowHeight)
      .attr("fill", "transparent")
      .attr("cursor", "pointer")
      .on("click", (event, d) => this.handleSpanClick(d))
      .on("mouseover", (event, d) => this.showTooltip(event, d))
      .on("mouseout", () => this.hideTooltip());

    // Add connecting lines for causal relationships
    this.addCausalConnections(spanGroups, minTime);

    // Add span names with causal indentation and indicators
    spanGroups
      .append("text")
      .attr("class", "span-name")
      .attr("x", (d) => this.calculateNamePosition(d))
      .attr("y", this.config.rowHeight / 2)
      .attr("text-anchor", "end")
      .attr("alignment-baseline", "middle")
      .attr("font-size", (d) => this.getFontSize(d))
      .attr("font-weight", (d) => (d.level === 0 ? "bold" : "normal"))
      .attr("fill", (d) => this.getNameColor(d))
      .text((d) => {
        const name = this.formatSpanName(d);
        // Add error indicator to span name
        if (d.status === "error") return `⚠️ ${name}`;
        if (d.status === "unknown") return `❓ ${name}`;
        return name;
      })
      .style("cursor", (d) => (d.level === 0 ? "pointer" : "default"))
      .on("click", (event, d) => {
        if (d.level === 0) {
          this.toggleServiceExpansion(d);
        }
      });

    // Add cost/token annotations for API calls (level 1 only)
    spanGroups
      .filter((d) => d.level === 1 && d.type === "api" && d.cost !== undefined)
      .append("text")
      .attr("class", "span-cost")
      .attr("x", (d) => this.xScale(d.startTime - minTime + d.duration) + 5)
      .attr("y", this.config.rowHeight / 2)
      .attr("alignment-baseline", "middle")
      .attr("font-size", "9px")
      .attr("fill", "#6b7280")
      .text((d) => `$${d.cost?.toFixed(3)} | ${d.tokensIn}↓ ${d.tokensOut}↑`);
  }

  private calculateNamePosition(span: HierarchicalSpan): number {
    // Base position with enhanced indentation for causal relationships
    const baseIndent = -10;
    const levelIndent = span.level * 20; // Increased indent for better visibility

    // Additional indent for triggered spans (hooks)
    const causalIndent = span.causalityType === CausalityType.TRIGGER ? 10 : 0;

    return baseIndent - levelIndent - causalIndent;
  }

  private getFontSize(span: HierarchicalSpan): string {
    switch (span.level) {
      case 0:
        return "13px"; // Root API calls
      case 1:
        return "11px"; // Tools and primary operations
      default:
        return "10px"; // Hooks and nested operations
    }
  }

  private getNameColor(span: HierarchicalSpan): string {
    if (span.level === 0) return "#374151"; // Dark for root spans

    switch (span.causalityType) {
      case CausalityType.TRIGGER:
        return "#8b5cf6"; // Purple for triggered spans (hooks)
      case CausalityType.CHILD:
        return "#10b981"; // Green for child operations (tools)
      default:
        return "#6b7280"; // Gray for others
    }
  }

  private formatSpanName(span: HierarchicalSpan): string {
    let prefix = "";
    let displayName = span.name;

    if (span.level === 0) {
      // Root level - show expand/collapse indicator
      const indicator = span.isExpanded ? "▼" : "▶";
      prefix = `${indicator} `;
    } else {
      // Add causal indicators
      switch (span.causalityType) {
        case CausalityType.TRIGGER:
          prefix = "🪝 "; // Hook emoji for triggered spans
          // For hooks, show event type + script filename
          if (span.type === "hook") {
            const hookEvent = span.attributes["hook.event"] || span.name;
            const hookCommand = span.attributes["hook.command"] || "";
            const scriptName = this.extractScriptName(hookCommand);
            displayName = scriptName
              ? `${hookEvent}: ${scriptName}`
              : hookEvent;
          }
          break;
        case CausalityType.CHILD:
          prefix = "⚡ "; // Lightning for child operations
          break;
        default:
          prefix = "• "; // Bullet for other spans
      }
    }

    return `${prefix}${displayName}`;
  }

  private extractScriptName(command: string): string {
    if (!command) return "";

    // Split by spaces to get the command parts
    const parts = command.trim().split(/\s+/);
    if (parts.length === 0) return "";

    // Get the first part (the script path/name)
    const scriptPath = parts[0];

    // Extract just the filename from the path
    const filename = scriptPath.split("/").pop() || scriptPath;

    // Remove common shell prefixes if present
    if (filename.startsWith("./")) {
      return filename.substring(2);
    }

    return filename;
  }

  private addCausalConnections(
    spanGroups: d3.Selection<
      SVGGElement,
      HierarchicalSpan,
      d3.BaseType,
      unknown
    >,
    minTime: number,
  ): void {
    // Add subtle connecting lines to show causal relationships
    spanGroups
      .filter((d) => d.level > 0 && d.triggerSpanId)
      .append("line")
      .attr("class", "causal-connection")
      .attr("x1", (d) => {
        // Start from the triggering span's end position
        const triggerSpan = this.findSpanById(d.triggerSpanId!);
        if (!triggerSpan) return 0;
        return this.xScale(triggerSpan.endTime - minTime);
      })
      .attr("y1", (d) => {
        // Connect from parent row
        return (
          -(this.config.rowHeight * (d.level - 1)) + this.config.rowHeight / 2
        );
      })
      .attr("x2", (d) => this.xScale(d.startTime - minTime))
      .attr("y2", this.config.rowHeight / 2)
      .attr("stroke", (d) => {
        return d.causalityType === CausalityType.TRIGGER
          ? "#8b5cf6"
          : "#10b981";
      })
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("opacity", 0.5)
      .attr("pointer-events", "none");

    // Add arrow markers for better visual flow
    spanGroups
      .filter((d) => d.level > 0 && d.triggerSpanId)
      .append("polygon")
      .attr("class", "causal-arrow")
      .attr("points", "0,0 -6,-3 -6,3")
      .attr("transform", (d) => {
        const x = this.xScale(d.startTime - minTime) - 3;
        const y = this.config.rowHeight / 2;
        return `translate(${x},${y})`;
      })
      .attr("fill", (d) => {
        return d.causalityType === CausalityType.TRIGGER
          ? "#8b5cf6"
          : "#10b981";
      })
      .attr("opacity", 0.6)
      .attr("pointer-events", "none");
  }

  private findSpanById(spanId: string): HierarchicalSpan | null {
    // Helper method to find a span by ID in the current visible spans
    for (const span of this.visibleSpans) {
      if (span.id === spanId) return span;
    }
    return null;
  }

  private getCompressionTooltip(span: HierarchicalSpan): string {
    if (span.isCompressed) {
      return `<span style="color: #f59e0b">⇄ Compressed (actual: ${this.formatDuration(span.actualDuration)})</span>`;
    }
    return "";
  }

  private getCausalityTooltip(span: HierarchicalSpan): string {
    if (span.level === 0) return "";

    switch (span.causalityType) {
      case CausalityType.TRIGGER:
        return `<span style="color: #8b5cf6">🪝 Triggered by parent operation</span>`;
      case CausalityType.CHILD:
        return `<span style="color: #10b981">⚡ Child operation</span>`;
      default:
        return "";
    }
  }

  private highlightCausalChain(selectedSpan: HierarchicalSpan): void {
    // Find all spans in the causal chain
    const chainSpans = this.getCausalChain(selectedSpan);
    const chainIds = new Set(chainSpans.map((s) => s.id));

    // Highlight spans in the causal chain
    this.mainGroup
      .selectAll(".span-bar")
      .attr("opacity", (d) => {
        const span = d as HierarchicalSpan;
        if (span.id === selectedSpan.id) return 1; // Selected span fully opaque
        if (chainIds.has(span.id)) return 0.8; // Chain spans highlighted
        return 0.3; // Other spans dimmed
      })
      .attr("stroke-width", (d) => {
        const span = d as HierarchicalSpan;
        return chainIds.has(span.id) ? 2 : span.status === "error" ? 2 : 0;
      });
  }

  private getCausalChain(span: HierarchicalSpan): HierarchicalSpan[] {
    const chain: HierarchicalSpan[] = [span];

    // Add parent spans
    let currentSpan = span;
    while (currentSpan.triggerSpanId) {
      const parent = this.findSpanById(currentSpan.triggerSpanId);
      if (parent) {
        chain.unshift(parent);
        currentSpan = parent;
      } else {
        break;
      }
    }

    // Add child spans
    this.addChildrenToChain(span, chain);

    return chain;
  }

  private addChildrenToChain(
    parent: HierarchicalSpan,
    chain: HierarchicalSpan[],
  ): void {
    if (parent.children) {
      parent.children.forEach((child) => {
        if (!chain.includes(child)) {
          chain.push(child);
          this.addChildrenToChain(child, chain);
        }
      });
    }
  }

  private toggleServiceExpansion(serviceSpan: HierarchicalSpan): void {
    serviceSpan.isExpanded = !serviceSpan.isExpanded;
    this.updateVisibleSpans();
    this.renderVisibleSpans();
  }
}
