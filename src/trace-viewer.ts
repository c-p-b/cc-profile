/**
 * D3.js-based trace viewer for OpenTelemetry spans
 * Creates an interactive waterfall timeline visualization
 */

import * as d3 from "d3";
import { D3Span, TraceMetrics } from "./otlp-parser.js";

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

interface SpanColors {
  api: string;
  tool: string;
  hook: string;
  file: string;
  test: string;
  other: string;
}

export class TraceViewer {
  private config: Required<ViewerConfig>;
  private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>;
  private mainGroup: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
  private xScale: d3.ScaleLinear<number, number>;
  private yScale: d3.ScaleBand<string>;
  private zoom: d3.ZoomBehavior<Element, unknown>;
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

    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleBand().padding(0.1);
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

  render(spans: D3Span[], metrics: TraceMetrics): void {
    // Calculate dimensions
    const width =
      this.config.width - this.config.margins.left - this.config.margins.right;
    const height =
      this.config.height - this.config.margins.top - this.config.margins.bottom;

    // Set up scales
    const minTime = d3.min(spans, (d) => d.startTime) || 0;
    const maxTime = d3.max(spans, (d) => d.endTime) || 1;

    this.xScale.domain([0, maxTime - minTime]).range([0, width]);

    this.yScale.domain(spans.map((d) => d.id)).range([0, height]);

    // Clear previous content
    this.mainGroup.selectAll("*").remove();

    // Add grid lines
    this.addGridLines(width, height);

    // Add time axis
    this.addTimeAxis(width);

    // Add spans
    this.addSpans(spans, minTime);

    // Add metrics header
    this.addMetricsHeader(metrics);
  }

  private addGridLines(width: number, height: number): void {
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
      .attr("y2", height)
      .attr("stroke", "#e5e7eb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2,2");
  }

  private addTimeAxis(_width: number): void {
    const xAxis = d3.axisBottom(this.xScale).tickFormat((d) => `${d}ms`);

    this.mainGroup
      .append("g")
      .attr("class", "x-axis")
      .attr(
        "transform",
        `translate(0,${this.config.height - this.config.margins.top - this.config.margins.bottom})`,
      )
      .call(xAxis);
  }

  private addSpans(spans: D3Span[], minTime: number): void {
    const spanGroups = this.mainGroup
      .selectAll(".span-group")
      .data(spans)
      .enter()
      .append("g")
      .attr("class", "span-group")
      .attr("transform", (d) => `translate(0,${this.yScale(d.id)})`);

    // Add span bars
    spanGroups
      .append("rect")
      .attr("class", "span-bar")
      .attr("x", (d) => this.xScale(d.startTime - minTime))
      .attr("width", (d) => Math.max(1, this.xScale(d.duration)))
      .attr("height", this.yScale.bandwidth())
      .attr("fill", (d) => this.colors[d.type])
      .attr("opacity", 0.8)
      .attr("stroke", (d) => (d.status === "error" ? "#ef4444" : "none"))
      .attr("stroke-width", 2)
      .attr("cursor", "pointer")
      .on("click", (event, d) => this.handleSpanClick(d))
      .on("mouseover", (event, d) => this.showTooltip(event, d))
      .on("mouseout", () => this.hideTooltip());

    // Add span names
    spanGroups
      .append("text")
      .attr("class", "span-name")
      .attr("x", -10)
      .attr("y", this.yScale.bandwidth() / 2)
      .attr("text-anchor", "end")
      .attr("alignment-baseline", "middle")
      .attr("font-size", "12px")
      .attr("fill", "#374151")
      .text((d) => this.truncateText(d.name, 25));

    // Add cost/token annotations for API calls
    spanGroups
      .filter((d) => d.type === "api" && d.cost !== undefined)
      .append("text")
      .attr("class", "span-cost")
      .attr("x", (d) => this.xScale(d.startTime - minTime + d.duration) + 5)
      .attr("y", this.yScale.bandwidth() / 2)
      .attr("alignment-baseline", "middle")
      .attr("font-size", "10px")
      .attr("fill", "#6b7280")
      .text((d) => `$${d.cost?.toFixed(3)} | ${d.tokensIn}↓ ${d.tokensOut}↑`);

    // Add duration labels for long spans
    spanGroups
      .filter((d) => d.duration > 1000)
      .append("text")
      .attr("class", "span-duration")
      .attr("x", (d) => this.xScale(d.startTime - minTime + d.duration / 2))
      .attr("y", this.yScale.bandwidth() / 2)
      .attr("text-anchor", "middle")
      .attr("alignment-baseline", "middle")
      .attr("font-size", "10px")
      .attr("fill", "white")
      .attr("pointer-events", "none")
      .text((d) => this.formatDuration(d.duration));
  }

  private addMetricsHeader(metrics: TraceMetrics): void {
    const header = this.svg
      .append("g")
      .attr("class", "metrics-header")
      .attr("transform", `translate(${this.config.margins.left}, 10)`);

    const metricsText = [
      `Total: ${this.formatDuration(metrics.totalDuration)}`,
      `Cost: $${metrics.totalCost.toFixed(3)}`,
      `Tokens: ${metrics.totalTokensIn}↓ ${metrics.totalTokensOut}↑`,
      `API: ${metrics.apiCallCount}`,
      `Tools: ${metrics.toolCallCount}`,
      `Hooks: ${metrics.hookCallCount}`,
      metrics.errorCount > 0 ? `Errors: ${metrics.errorCount}` : "",
    ].filter(Boolean);

    header
      .selectAll("text")
      .data(metricsText)
      .enter()
      .append("text")
      .attr("x", (d, i) => i * 120)
      .attr("y", 0)
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .attr("fill", "#374151")
      .text((d) => d);
  }

  private zoomed(event: d3.D3ZoomEvent<Element, unknown>): void {
    this.mainGroup.attr("transform", event.transform.toString());
  }

  private handleSpanClick(span: D3Span): void {
    this.selectedSpan = span;

    // Highlight selected span
    this.mainGroup
      .selectAll(".span-bar")
      .attr("opacity", (d) => (d === span ? 1 : 0.4));

    // Callback for external detail panel
    if (this.onSpanClick) {
      this.onSpanClick(span);
    }
  }

  private showTooltip(event: MouseEvent, span: D3Span): void {
    const tooltipContent = [
      `<strong>${span.name}</strong>`,
      `Type: ${span.type}`,
      `Duration: ${this.formatDuration(span.duration)}`,
      `Status: ${span.status}`,
      span.cost ? `Cost: $${span.cost.toFixed(3)}` : "",
      span.tokensIn ? `Tokens: ${span.tokensIn}↓ ${span.tokensOut}↑` : "",
    ]
      .filter(Boolean)
      .join("<br>");

    this.tooltip
      .html(tooltipContent)
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

  private truncateText(text: string, maxLength: number): string {
    return text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;
  }

  onSpanSelected(callback: (span: D3Span) => void): void {
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
}
