import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { RawPair } from "../../../src/types";

@customElement("raw-pairs-view")
export class RawPairsView extends LitElement {
  @property({ type: Array }) rawPairs: RawPair[] = [];

  // Disable shadow DOM to use global Tailwind styles
  createRenderRoot() {
    return this;
  }

  render() {
    if (this.rawPairs.length === 0) {
      return html`<div class="text-vs-muted">No raw pairs found.</div>`;
    }

    // Filter out pairs with null responses for display
    const validPairs = this.rawPairs.filter((pair) => pair.response !== null);

    return html`
      <div>
        ${validPairs.map(
          (pair, index) => html`
            <div class="mt-8 first:mt-0">
              <!-- Pair Header -->
              <div class="border border-vs-highlight p-4 mb-0">
                <div class="flex justify-between items-start mb-2">
                  <div class="text-vs-assistant font-bold">
                    ${pair.request.method} ${this.getUrlPath(pair.request.url)}
                  </div>
                  <div class="text-vs-muted text-sm">
                    ${new Date(pair.logged_at).toLocaleTimeString()}
                  </div>
                </div>
                <div class="flex items-center gap-4 text-sm mb-2">
                  <span class="text-vs-text">
                    <span class="text-vs-muted">Pair ${index + 1}</span>
                  </span>
                  <span class="${this.getModelColor(this.getModelName(pair))}">
                    ${this.getModelName(pair)}
                  </span>
                  <span
                    class="${this.getStatusColor(pair.response!.status_code)}"
                  >
                    Status ${pair.response!.status_code}
                  </span>
                  ${this.hasToolCalls(pair)
                    ? html`
                        <span class="text-vs-type"
                          >🔧 ${this.getToolCallCount(pair)} tools</span
                        >
                      `
                    : ""}
                </div>
                ${this.renderMetrics(pair)}
              </div>

              <!-- Request Section -->
              <div class="px-4 mt-4">
                <div class="mb-4">
                  <div
                    class="cursor-pointer text-vs-user font-bold hover:text-white transition-colors"
                    @click=${(e: Event) => this.toggleContent(e)}
                  >
                    <span class="mr-2">[+]</span>
                    <span>Request</span>
                  </div>
                  <div class="hidden mt-2">
                    <div
                      class="bg-vs-bg-secondary p-4 text-vs-text overflow-x-auto"
                    >
                      <pre class="whitespace-pre text-vs-text m-0">
${this.formatJson(pair.request)}</pre
                      >
                    </div>
                  </div>
                </div>

                <!-- Response Section -->
                <div class="mb-4">
                  <div
                    class="cursor-pointer text-vs-assistant font-bold hover:text-white transition-colors"
                    @click=${(e: Event) => this.toggleContent(e)}
                  >
                    <span class="mr-2">[+]</span>
                    <span>Response</span>
                  </div>
                  <div class="hidden mt-2">
                    <div
                      class="bg-vs-bg-secondary p-4 text-vs-text overflow-x-auto"
                    >
                      <pre class="whitespace-pre text-vs-text m-0">
${this.formatJson(pair.response)}</pre
                      >
                    </div>
                  </div>
                </div>

                <!-- SSE Events Section -->
                ${pair.response!.events && pair.response!.events.length > 0
                  ? html`
                      <div class="mb-4">
                        <div
                          class="cursor-pointer text-vs-type font-bold hover:text-white transition-colors"
                          @click=${(e: Event) => this.toggleContent(e)}
                        >
                          <span class="mr-2">[+]</span>
                          <span
                            >SSE Events (${pair.response!.events.length})</span
                          >
                        </div>
                        <div class="hidden mt-2">
                          <div
                            class="bg-vs-bg-secondary p-4 text-vs-text overflow-x-auto"
                          >
                            <pre class="whitespace-pre text-vs-text m-0">
${this.formatJson(pair.response!.events)}</pre
                            >
                          </div>
                        </div>
                      </div>
                    `
                  : ""}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private getUrlPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private getModelName(pair: RawPair): string {
    return pair.request.body?.model || "unknown";
  }

  private formatJson(obj: any): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  private toggleContent(e: Event) {
    const header = e.currentTarget as HTMLElement;
    const content = header.nextElementSibling as HTMLElement;
    const toggle = header.querySelector("span:first-child") as HTMLElement;

    if (content && toggle) {
      const isHidden = content.classList.contains("hidden");
      content.classList.toggle("hidden", !isHidden);
      toggle.textContent = isHidden ? "[-]" : "[+]";
    }
  }

  private getModelColor(model: string): string {
    if (model.includes("haiku")) return "text-green-400";
    if (model.includes("sonnet")) return "text-blue-400";
    if (model.includes("opus")) return "text-purple-400";
    return "text-vs-text";
  }

  private getStatusColor(statusCode: number): string {
    if (statusCode >= 200 && statusCode < 300) return "text-green-400";
    if (statusCode >= 400) return "text-red-400";
    return "text-yellow-400";
  }

  private hasToolCalls(pair: RawPair): boolean {
    const responseBody = pair.response?.body;
    if (!responseBody || !responseBody.content) return false;

    return (
      Array.isArray(responseBody.content) &&
      responseBody.content.some((block: any) => block.type === "tool_use")
    );
  }

  private getToolCallCount(pair: RawPair): number {
    const responseBody = pair.response?.body;
    if (!responseBody || !responseBody.content) return 0;

    if (Array.isArray(responseBody.content)) {
      return responseBody.content.filter(
        (block: any) => block.type === "tool_use",
      ).length;
    }
    return 0;
  }

  private renderMetrics(pair: RawPair) {
    const responseBody = pair.response?.body;
    if (!responseBody?.usage) return "";

    const usage = responseBody.usage;
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;

    // Rough cost calculation (Claude 3.5 Sonnet rates)
    const inputCost = (inputTokens * 3) / 1000000;
    const outputCost = (outputTokens * 15) / 1000000;
    const totalCost = inputCost + outputCost;

    return html`
      <div
        class="flex items-center gap-4 text-xs text-vs-muted border-t border-vs-highlight pt-2 mt-2"
      >
        <span>
          <span class="text-vs-text">${this.formatTokens(inputTokens)}</span> in
        </span>
        <span>
          <span class="text-vs-text">${this.formatTokens(outputTokens)}</span>
          out
        </span>
        ${cacheRead > 0
          ? html`
              <span class="text-green-400">
                ${this.formatTokens(cacheRead)} cache
              </span>
            `
          : ""}
        ${cacheWrite > 0
          ? html`
              <span class="text-blue-400">
                ${this.formatTokens(cacheWrite)} cached
              </span>
            `
          : ""}
        <span>
          <span class="text-vs-text">${this.formatCost(totalCost)}</span> cost
        </span>
      </div>
    `;
  }

  private formatTokens(tokens: number): string {
    if (tokens < 1000) return tokens.toString();
    return `${(tokens / 1000).toFixed(1)}k`;
  }

  private formatCost(cost: number): string {
    if (cost < 0.001) return "<$0.001";
    return `$${cost.toFixed(3)}`;
  }
}
