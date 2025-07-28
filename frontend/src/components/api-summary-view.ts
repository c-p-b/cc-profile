import { LitElement, html, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type {
  MessageParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { ProcessedPair } from "../../../src/shared-conversation-processor";

interface ApiCallSummary {
  id: string;
  timestamp: string;
  model: string;
  userPrompt: string;
  assistantResponse: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  duration?: number;
  status: "success" | "error" | "unknown";
  toolCalls: string[];
  isStreaming: boolean;
  hasThinking: boolean;
  pair: ProcessedPair;
}

@customElement("api-summary-view")
export class ApiSummaryView extends LitElement {
  @property({ type: Array }) processedPairs: ProcessedPair[] = [];

  // Disable shadow DOM to use global CSS
  createRenderRoot() {
    return this;
  }

  private extractApiSummaries(): ApiCallSummary[] {
    return this.processedPairs.map((pair) => {
      // Extract user prompt (last user message)
      const userMessages =
        pair.request.messages?.filter((m) => m.role === "user") || [];
      const lastUserMessage = userMessages[userMessages.length - 1];
      const userPrompt = this.extractTextFromMessage(lastUserMessage);

      // Extract assistant response
      const assistantResponse = this.extractTextFromMessage({
        role: "assistant",
        content: pair.response.content,
      });

      // Extract tool calls
      const toolCalls = this.extractToolCalls(pair.response.content);

      // Check for thinking blocks
      const hasThinking = this.hasThinkingBlocks(pair.response.content);

      // Calculate cost (rough estimate: $3/M input tokens, $15/M output tokens for Claude 3.5 Sonnet)
      const inputCost =
        ((pair.response.usage?.input_tokens || 0) * 3) / 1000000;
      const outputCost =
        ((pair.response.usage?.output_tokens || 0) * 15) / 1000000;
      const cost = inputCost + outputCost;

      // Determine status
      const status =
        pair.response.stop_reason === "end_turn"
          ? "success"
          : pair.response.stop_reason === "max_tokens"
            ? "error"
            : "unknown";

      return {
        id: pair.id,
        timestamp: pair.timestamp,
        model: pair.model,
        userPrompt: this.truncateText(userPrompt, 100),
        assistantResponse: this.truncateText(assistantResponse, 100),
        tokensIn: pair.response.usage?.input_tokens || 0,
        tokensOut: pair.response.usage?.output_tokens || 0,
        cacheRead: pair.response.usage?.cache_read_input_tokens || 0,
        cacheWrite: pair.response.usage?.cache_creation_input_tokens || 0,
        cost,
        status,
        toolCalls,
        isStreaming: pair.isStreaming,
        hasThinking,
        pair,
      };
    });
  }

  private extractTextFromMessage(
    message: MessageParam | { role: string; content: any },
  ): string {
    if (!message?.content) return "";

    if (typeof message.content === "string") {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((block) => block.type === "text")
        .map((block) => (block as any).text)
        .join(" ");
    }

    return "";
  }

  private extractToolCalls(content: any[]): string[] {
    if (!Array.isArray(content)) return [];

    return content
      .filter((block) => block.type === "tool_use")
      .map((block) => (block as ToolUseBlock).name);
  }

  private hasThinkingBlocks(content: any[]): boolean {
    if (!Array.isArray(content)) return false;
    return content.some((block) => block.type === "thinking");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + "...";
  }

  private formatDuration(ms?: number): string {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  private formatCost(cost: number): string {
    if (cost < 0.001) return "<$0.001";
    return `$${cost.toFixed(3)}`;
  }

  private formatTokens(tokens: number): string {
    if (tokens < 1000) return tokens.toString();
    return `${(tokens / 1000).toFixed(1)}k`;
  }

  private getModelColor(model: string): string {
    if (model.includes("haiku")) return "text-green-400";
    if (model.includes("sonnet")) return "text-blue-400";
    if (model.includes("opus")) return "text-purple-400";
    return "text-vs-text";
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case "success":
        return "text-green-400";
      case "error":
        return "text-red-400";
      default:
        return "text-yellow-400";
    }
  }

  private toggleDetails(e: Event) {
    const header = e.currentTarget as HTMLElement;
    const details = header.parentElement?.querySelector(
      ".api-call-details",
    ) as HTMLElement;
    const toggle = header.querySelector(".toggle-icon") as HTMLElement;

    if (details && toggle) {
      const isHidden = details.classList.contains("hidden");
      details.classList.toggle("hidden", !isHidden);
      toggle.textContent = isHidden ? "[-]" : "[+]";
    }
  }

  private renderToolCalls(toolCalls: string[]): TemplateResult {
    if (toolCalls.length === 0) return html``;

    return html`
      <div class="flex flex-wrap gap-1 mt-2">
        ${toolCalls.map(
          (tool) => html`
            <span
              class="px-2 py-1 bg-vs-bg-secondary text-vs-type text-xs rounded"
            >
              ${tool}
            </span>
          `,
        )}
      </div>
    `;
  }

  private renderApiCallCard(summary: ApiCallSummary): TemplateResult {
    return html`
      <div class="border border-vs-highlight mb-4">
        <!-- Card Header -->
        <div
          class="p-4 cursor-pointer hover:bg-vs-bg-secondary transition-colors"
          @click=${this.toggleDetails}
        >
          <div class="flex justify-between items-start mb-2">
            <div class="flex items-center gap-3">
              <span class="toggle-icon text-vs-muted">[+]</span>
              <div class="flex items-center gap-2">
                <span class="${this.getModelColor(summary.model)} font-medium"
                  >${summary.model}</span
                >
                <span class="${this.getStatusColor(summary.status)} text-sm">
                  ${summary.status === "success"
                    ? "✓"
                    : summary.status === "error"
                      ? "✗"
                      : "?"}
                </span>
                ${summary.hasThinking
                  ? html`<span class="text-gray-400 text-xs">💭</span>`
                  : ""}
                ${summary.isStreaming
                  ? html`<span class="text-blue-400 text-xs">⚡</span>`
                  : ""}
              </div>
            </div>
            <div class="text-vs-muted text-sm">
              ${new Date(summary.timestamp).toLocaleTimeString()}
            </div>
          </div>

          <!-- Key Metrics Bar -->
          <div class="flex items-center gap-4 text-sm mb-3">
            <span class="text-vs-text">
              <span class="text-vs-muted">in:</span> ${this.formatTokens(
                summary.tokensIn,
              )}
            </span>
            <span class="text-vs-text">
              <span class="text-vs-muted">out:</span> ${this.formatTokens(
                summary.tokensOut,
              )}
            </span>
            ${summary.cacheRead > 0
              ? html`
                  <span class="text-green-400">
                    <span class="text-vs-muted">cache:</span>
                    ${this.formatTokens(summary.cacheRead)}
                  </span>
                `
              : ""}
            <span class="text-vs-text">
              <span class="text-vs-muted">cost:</span> ${this.formatCost(
                summary.cost,
              )}
            </span>
            ${summary.duration
              ? html`
                  <span class="text-vs-text">
                    <span class="text-vs-muted">time:</span>
                    ${this.formatDuration(summary.duration)}
                  </span>
                `
              : ""}
          </div>

          <!-- Prompt Preview -->
          <div class="mb-2">
            <div class="text-vs-user text-sm font-medium mb-1">USER</div>
            <div class="text-vs-text text-sm bg-vs-bg p-2 rounded">
              ${summary.userPrompt}
            </div>
          </div>

          <!-- Response Preview -->
          <div class="mb-2">
            <div class="text-vs-assistant text-sm font-medium mb-1">
              ASSISTANT
            </div>
            <div class="text-vs-text text-sm bg-vs-bg p-2 rounded">
              ${summary.assistantResponse}
            </div>
          </div>

          <!-- Tool Calls -->
          ${this.renderToolCalls(summary.toolCalls)}
        </div>

        <!-- Expandable Details -->
        <div class="api-call-details hidden border-t border-vs-highlight">
          <div class="p-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Full Request -->
              <div>
                <h4 class="text-vs-function font-bold mb-2">Request</h4>
                <div
                  class="bg-vs-bg-secondary p-3 rounded text-xs overflow-x-auto"
                >
                  <pre class="text-vs-text">
${JSON.stringify(summary.pair.request, null, 2)}</pre
                  >
                </div>
              </div>

              <!-- Full Response -->
              <div>
                <h4 class="text-vs-function font-bold mb-2">Response</h4>
                <div
                  class="bg-vs-bg-secondary p-3 rounded text-xs overflow-x-auto"
                >
                  <pre class="text-vs-text">
${JSON.stringify(summary.pair.response, null, 2)}</pre
                  >
                </div>
              </div>
            </div>

            <!-- Usage Details -->
            ${summary.pair.response.usage
              ? html`
                  <div class="mt-4">
                    <h4 class="text-vs-function font-bold mb-2">Token Usage</h4>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span class="text-vs-muted">Input:</span>
                        <span class="text-vs-text"
                          >${summary.pair.response.usage.input_tokens ??
                          "N/A"}</span
                        >
                      </div>
                      <div>
                        <span class="text-vs-muted">Output:</span>
                        <span class="text-vs-text"
                          >${summary.pair.response.usage.output_tokens}</span
                        >
                      </div>
                      ${summary.pair.response.usage.cache_read_input_tokens
                        ? html`
                            <div>
                              <span class="text-vs-muted">Cache Read:</span>
                              <span class="text-green-400"
                                >${summary.pair.response.usage
                                  .cache_read_input_tokens}</span
                              >
                            </div>
                          `
                        : ""}
                      ${summary.pair.response.usage.cache_creation_input_tokens
                        ? html`
                            <div>
                              <span class="text-vs-muted">Cache Write:</span>
                              <span class="text-blue-400"
                                >${summary.pair.response.usage
                                  .cache_creation_input_tokens}</span
                              >
                            </div>
                          `
                        : ""}
                    </div>
                  </div>
                `
              : ""}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const summaries = this.extractApiSummaries();

    if (summaries.length === 0) {
      return html`<div class="text-vs-muted">No API calls found.</div>`;
    }

    // Calculate totals
    const totalTokensIn = summaries.reduce((sum, s) => sum + s.tokensIn, 0);
    const totalTokensOut = summaries.reduce((sum, s) => sum + s.tokensOut, 0);
    const totalCost = summaries.reduce((sum, s) => sum + s.cost, 0);
    const successRate = (
      (summaries.filter((s) => s.status === "success").length /
        summaries.length) *
      100
    ).toFixed(1);

    return html`
      <div class="max-w-5xl mx-auto">
        <!-- Summary Stats -->
        <div
          class="mb-6 p-4 bg-vs-bg-secondary rounded border border-vs-highlight"
        >
          <h3 class="text-vs-function font-bold mb-3">Session Overview</h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div class="text-vs-muted">API Calls</div>
              <div class="text-vs-text font-medium">${summaries.length}</div>
            </div>
            <div>
              <div class="text-vs-muted">Total Tokens In</div>
              <div class="text-vs-text font-medium">
                ${this.formatTokens(totalTokensIn)}
              </div>
            </div>
            <div>
              <div class="text-vs-muted">Total Tokens Out</div>
              <div class="text-vs-text font-medium">
                ${this.formatTokens(totalTokensOut)}
              </div>
            </div>
            <div>
              <div class="text-vs-muted">Total Cost</div>
              <div class="text-vs-text font-medium">
                ${this.formatCost(totalCost)}
              </div>
            </div>
            <div>
              <div class="text-vs-muted">Success Rate</div>
              <div class="text-vs-text font-medium">${successRate}%</div>
            </div>
          </div>
        </div>

        <!-- API Call Cards -->
        <div>
          ${summaries.map((summary) => this.renderApiCallCard(summary))}
        </div>
      </div>
    `;
  }
}
