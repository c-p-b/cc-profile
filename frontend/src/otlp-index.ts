/**
 * Entry point for OTLP HTML reports
 * This is a separate bundle from the legacy claude-trace reports
 */

import { initializeOTLPReport } from "./otlp-frontend-init";
import { TraceViewer } from "./trace-viewer";
import { FlameGraphViewer } from "./flame-graph-viewer";

// Import CSS
declare const __CSS_CONTENT__: string;
const css = __CSS_CONTENT__;
if (css && css !== "__CSS_CONTENT__") {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

// Initialize OTLP report when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeOTLPReport);
} else {
  initializeOTLPReport();
}

// Export for debugging
(window as any).initializeOTLPReport = initializeOTLPReport;
(window as any).TraceViewer = TraceViewer;
(window as any).FlameGraphViewer = FlameGraphViewer;
