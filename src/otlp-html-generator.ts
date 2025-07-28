import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OTLPTraceData, ParsedSpan } from "./otlp-parser.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface OTLPHTMLGenerationData {
  traceData: OTLPTraceData;
  parsedSpans: ParsedSpan[] | null;
  timestamp: string;
  runId: string;
}

export interface OTLPHTMLGeneratorOptions {
  mode?: "development" | "production";
}

export class OTLPHTMLGenerator {
  private frontendDir: string;
  private templatePath: string;
  private bundlePath: string;

  constructor(_options: OTLPHTMLGeneratorOptions = {}) {
    // Use bundled files from npm installation location
    // First try to find frontend files relative to this module (npm install case)
    this.frontendDir = path.join(__dirname, "..", "frontend");
    this.bundlePath = path.join(this.frontendDir, "dist", "otlp.global.js");
    
    // For template, try frontend/template.html first (npm package), then src/otlp-template.html (dev)
    this.templatePath = path.join(this.frontendDir, "template.html");
    if (!fs.existsSync(this.templatePath)) {
      this.templatePath = path.join(__dirname, "otlp-template.html");
    }
  }

  private ensureFrontendBuilt(): void {
    if (!fs.existsSync(this.bundlePath)) {
      throw new Error(
        `Frontend bundle not found at ${this.bundlePath}. Run 'npm run build' to generate frontend files.`,
      );
    }

    if (!fs.existsSync(this.templatePath)) {
      throw new Error(
        `Template file not found at ${this.templatePath}. Ensure template file exists.`,
      );
    }
  }

  private loadTemplateFiles(): { htmlTemplate: string; jsBundle: string } {
    this.ensureFrontendBuilt();

    // Check if template file exists and has correct OTLP markers
    let htmlTemplate = this.getDefaultOTLPTemplate();

    if (fs.existsSync(this.templatePath)) {
      const templateContent = fs.readFileSync(this.templatePath, "utf-8");
      // Only use external template if it has the correct OTLP replacement markers
      if (
        templateContent.includes("__OTLP_BUNDLE_REPLACEMENT__") &&
        templateContent.includes("__OTLP_DATA_REPLACEMENT__")
      ) {
        htmlTemplate = templateContent;
      }
    }

    const jsBundle = fs.readFileSync(this.bundlePath, "utf-8");

    return { htmlTemplate, jsBundle };
  }

  private getDefaultOTLPTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>cc-profile - __OTLP_TITLE_REPLACEMENT__</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            margin: 0;
            padding: 0;
            background: #fafafa;
        }
        .header {
            background: white;
            border-bottom: 1px solid #e5e7eb;
            padding: 16px 24px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
            color: #111827;
        }
        .metrics-bar {
            display: flex;
            gap: 24px;
            margin-top: 12px;
            font-size: 14px;
            color: #6b7280;
        }
        .metric {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .metric-value {
            font-weight: 600;
            color: #111827;
        }
        .metric.error-metric {
            color: #dc2626;
        }
        .metric.error-metric .metric-value {
            color: #dc2626;
            font-weight: 700;
        }
        .error-badge {
            background: #dc2626;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            min-width: 20px;
            text-align: center;
        }
        .error-badge.zero-errors {
            background: #10b981;
        }
        .main-container {
            display: flex;
            height: calc(100vh - 120px);
        }
        .timeline-panel {
            flex: 0 0 70%;
            background: white;
            margin: 16px 0 16px 16px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .details-panel {
            flex: 0 0 30%;
            background: white;
            margin: 16px 16px 16px 8px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 16px;
            overflow-y: auto;
        }
        .panel-header {
            padding: 16px;
            border-bottom: 1px solid #e5e7eb;
            font-weight: 600;
            color: #111827;
        }
        #trace-viewer, #flame-viewer {
            flex: 1;
            overflow: hidden;
        }
        .no-selection {
            color: #6b7280;
            text-align: center;
            margin-top: 40px;
        }
        .legend {
            display: flex;
            gap: 16px;
            padding: 12px 16px;
            background: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
            font-size: 12px;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .legend-color {
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }
        .view-tabs {
            display: flex;
            background: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
        }
        .tab-btn {
            padding: 12px 24px;
            border: none;
            background: transparent;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: #6b7280;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .tab-btn:hover {
            color: #111827;
            background: #f3f4f6;
        }
        .tab-btn.active {
            color: #3b82f6;
            border-bottom-color: #3b82f6;
            background: white;
        }
        .view-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .view-panel {
            display: none;
            flex: 1;
            overflow: hidden;
        }
        .view-panel.active {
            display: flex;
            flex-direction: column;
        }
        
        /* JSON syntax highlighting */
        .json-key {
            color: #0066cc;
            font-weight: 600;
        }
        .json-string {
            color: #008000;
        }
        .json-number {
            color: #ff6600;
        }
        .json-boolean {
            color: #cc0066;
            font-weight: 600;
        }
        .json-null {
            color: #999999;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>__OTLP_TITLE_REPLACEMENT__</h1>
        <div class="metrics-bar">
            <div class="metric">
                <span>Total Cost:</span>
                <span class="metric-value" id="total-cost">$0.00</span>
            </div>
            <div class="metric">
                <span>Input Tokens:</span>
                <span class="metric-value" id="total-input-tokens">0</span>
            </div>
            <div class="metric">
                <span>Output Tokens:</span>
                <span class="metric-value" id="total-output-tokens">0</span>
            </div>
            <div class="metric">
                <span>Duration:</span>
                <span class="metric-value" id="total-duration">0ms</span>
            </div>
            <div class="metric">
                <span>API Calls:</span>
                <span class="metric-value" id="api-call-count">0</span>
            </div>
            <div class="metric">
                <span>Tool Calls:</span>
                <span class="metric-value" id="tool-call-count">0</span>
            </div>
            <div class="metric">
                <span>Hook Calls:</span>
                <span class="metric-value" id="hook-call-count">0</span>
            </div>
            <div class="metric error-metric">
                <span>Errors:</span>
                <span class="error-badge" id="error-count">0</span>
            </div>
        </div>
    </div>
    
    <div class="main-container">
        <div class="timeline-panel">
            <div class="view-tabs">
                <button class="tab-btn active" data-view="timeline">Timeline</button>
                <button class="tab-btn" data-view="flamegraph">Flamegraph</button>
            </div>
            <div class="view-container">
                <div id="timeline-view" class="view-panel active">
                    <div class="legend">
                        <div class="legend-item">
                            <div class="legend-color" style="background: #3b82f6;"></div>
                            <span>API</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" style="background: #10b981;"></div>
                            <span>Tool</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" style="background: #8b5cf6;"></div>
                            <span>Hook</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" style="background: #dc2626;"></div>
                            <span>Error</span>
                        </div>
                    </div>
                    <div id="trace-viewer"></div>
                </div>
                <div id="flamegraph-view" class="view-panel">
                    <div id="flame-viewer"></div>
                </div>
            </div>
        </div>
        
        <div class="details-panel">
            <div class="panel-header">Span Details</div>
            <div id="span-details">
                <div class="no-selection">
                    Click on a span in the timeline to view details
                </div>
            </div>
        </div>
    </div>
    
    <script>
        window.otlpData = __OTLP_DATA_REPLACEMENT__;
    </script>
    
    <script>
__OTLP_BUNDLE_REPLACEMENT__
    </script>
</body>
</html>`;
  }

  private prepareDataForInjection(data: OTLPHTMLGenerationData): string {
    // Convert to JSON with minimal whitespace and safe characters only
    const dataJson = JSON.stringify(data, null, 0);

    // For safe injection as JS object literal, we need to handle potential script injection
    // and browser extension interference by using a different approach
    return dataJson
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028") // Line separator
      .replace(/\u2029/g, "\\u2029"); // Paragraph separator
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  public async generateHTML(
    otlpFile: string,
    outputFile: string,
    options: {
      title?: string;
      sessionId?: string;
      parentSessionId?: string;
    } = {},
  ): Promise<void> {
    // Handle missing or empty OTLP file gracefully
    let traceData: OTLPTraceData;

    if (!fs.existsSync(otlpFile)) {
      // Create empty trace data structure
      traceData = { resourceSpans: [] };
    } else {
      // Parse OTLP trace data - handle both JSON and JSONL formats
      const otlpContent = fs.readFileSync(otlpFile, "utf-8");

      if (!otlpContent.trim()) {
        traceData = { resourceSpans: [] };
      } else {
        // Parse OTLP content
        if (otlpFile.endsWith(".jsonl")) {
          // Parse JSONL format - merge all resource spans
          const lines = otlpContent
            .trim()
            .split("\n")
            .filter((line) => line.trim());
          const allResourceSpans: any[] = [];

          for (const line of lines) {
            try {
              const lineData = JSON.parse(line);
              if (lineData.resourceSpans) {
                allResourceSpans.push(...lineData.resourceSpans);
              }
            } catch (e) {
              console.warn("Skipping invalid JSONL line:", e);
            }
          }

          traceData = { resourceSpans: allResourceSpans };
        } else {
          // Parse regular JSON
          traceData = JSON.parse(otlpContent);
        }
      }
    }

    // Extract run ID from file path or generate one
    const runId = path.basename(path.dirname(otlpFile));

    // Load template and bundle files
    const { htmlTemplate, jsBundle } = this.loadTemplateFiles();

    // Prepare data for injection (let frontend parse the OTLP data)
    const htmlData: OTLPHTMLGenerationData = {
      traceData,
      parsedSpans: null, // Will be parsed by frontend with fixed parser
      timestamp: new Date().toISOString().replace("T", " ").slice(0, -5),
      runId,
    };

    const dataJsonEscaped = this.prepareDataForInjection(htmlData);

    // Replace template placeholders
    const templateParts = htmlTemplate.split("__OTLP_BUNDLE_REPLACEMENT__");
    if (templateParts.length !== 2) {
      throw new Error(
        "Template bundle replacement marker not found or found multiple times",
      );
    }

    // Reconstruct the template with the bundle injected
    let htmlContent = templateParts[0] + jsBundle + templateParts[1];
    htmlContent = htmlContent
      .replace("__OTLP_DATA_REPLACEMENT__", dataJsonEscaped)
      .replace(
        /__OTLP_TITLE_REPLACEMENT__/g,
        this.escapeHtml(options.title || `Trace ${runId}`),
      );

    // Ensure output directory exists
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write HTML file
    fs.writeFileSync(outputFile, htmlContent, "utf-8");
  }

  public getTemplatePaths(): { templatePath: string; bundlePath: string } {
    return {
      templatePath: this.templatePath,
      bundlePath: this.bundlePath,
    };
  }
}
