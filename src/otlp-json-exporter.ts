import fs from "fs";
import path from "path";
import { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";

interface OTLPJsonFileExporterConfig {
  outputDir: string;
  runId: string;
  sessionId: string;
  parentSessionId?: string;
}

/**
 * Custom exporter that writes spans to OTLP JSON format
 */
export class OTLPJsonFileExporter implements SpanExporter {
  private outputPath: string;
  private sessionId: string;
  private parentSessionId?: string;

  constructor(private config: OTLPJsonFileExporterConfig) {
    // Write to shared trace file in base directory
    this.outputPath = path.join(config.outputDir, "trace.otlp.jsonl");
    this.sessionId = config.sessionId;
    this.parentSessionId = config.parentSessionId;

    // Ensure base directory exists
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      // Add session attributes to all spans
      const spansWithSession = spans.map((span) => {
        // Clone the span and add session attributes
        const spanData = span as any;
        if (!spanData.attributes) spanData.attributes = {};
        spanData.attributes["session.id"] = this.sessionId;
        if (this.parentSessionId) {
          spanData.attributes["parent.session.id"] = this.parentSessionId;
        }
        return span;
      });

      // Convert spans to OTLP format
      const otlpBytes = JsonTraceSerializer.serializeRequest(spansWithSession);
      const otlpJson = JSON.parse(new TextDecoder().decode(otlpBytes));

      // Append to shared JSONL file (one line per export batch)
      fs.appendFileSync(this.outputPath, JSON.stringify(otlpJson) + "\n");

      // No HTML generation during export - only at cleanup
    } catch (error) {
      console.error(`OTLP Exporter: Error writing spans:`, error);
    }

    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {
    // Silent shutdown
  }

  async forceFlush(): Promise<void> {
    // JSONL append is atomic, no need to flush
  }

  updateConfig(newConfig: OTLPJsonFileExporterConfig): void {
    this.config = newConfig;
    this.outputPath = path.join(newConfig.outputDir, "trace.otlp.jsonl");
    this.sessionId = newConfig.sessionId;
    this.parentSessionId = newConfig.parentSessionId;

    // Ensure new directory exists
    fs.mkdirSync(newConfig.outputDir, { recursive: true });
  }
}
