/**
 * Unified event schema for cc-profile
 * Combines HTTP API calls and Claude Code hook events into a single timeline
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface UnifiedEvent {
  // Core event metadata
  ts: string; // ISO-8601 timestamp
  run_id: string; // UUID for this cc-profile session
  session_id: string; // Claude's session ID
  event_type:
    | "api_call"
    | "tool_call"
    | "file_change"
    | "test_result"
    | "message"
    | "stop"
    | "hook_event"
    | "hook_execution"
    | "hook_error";
  span_id: string; // UUID for this event
  parent_span_id?: string; // For nested events (e.g., hook executions under hook events)

  // Event-specific payload
  payload: EventPayload;
}

// Union type for all possible payloads
export type EventPayload =
  | ApiCallPayload
  | ToolCallPayload
  | FileChangePayload
  | TestResultPayload
  | MessagePayload
  | StopPayload
  | HookEventPayload
  | HookExecutionPayload
  | HookErrorPayload;

// API call from HTTP interception
export interface ApiCallPayload {
  type: "api_call";
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_estimate: number;
  endpoint: string;
  status_code: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  request_blob_path?: string; // Optional path to full request body
  response_blob_path?: string; // Optional path to full response body
}

// Tool execution from hooks
export interface ToolCallPayload {
  type: "tool_call";
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | string;
  duration_ms: number;
  exit_code?: number;
  error?: string;
}

// File changes from Edit/Write tools
export interface FileChangePayload {
  type: "file_change";
  path: string;
  operation: "create" | "edit" | "delete";
  loc_added: number;
  loc_removed: number;
  diff?: string; // Optional inline diff for small changes
  diff_blob_path?: string; // Path to full diff for large changes
}

// Test execution results
export interface TestResultPayload {
  type: "test_result";
  framework: string; // jest, pytest, etc.
  passed: number;
  failed: number;
  skipped?: number;
  duration_ms: number;
  output_blob_path?: string; // Path to full test output
}

// User/assistant messages
export interface MessagePayload {
  type: "message";
  role: "user" | "assistant" | "system";
  content: string;
  truncated?: boolean; // If content was truncated for size
  content_blob_path?: string; // Path to full content if truncated
}

// Session stop event
export interface StopPayload {
  type: "stop";
  reason: string;
  duration_ms: number;
  total_tokens?: number;
  total_cost?: number;
}

// Hook event fired by Claude Code
export interface HookEventPayload {
  type: "hook_event";
  hook_name: string; // PreToolUse, PostToolUse, etc.
  tool_name?: string; // For tool-related hooks
  input: Record<string, unknown>; // The event data passed to hooks
}

// Hook execution (from orchestrator)
export interface HookExecutionPayload {
  type: "hook_execution";
  hook_path: string;
  duration_ms: number;
  exit_code: number;
  stdout?: string;
  stdout_blob_path?: string; // For large outputs
}

// Hook execution error
export interface HookErrorPayload {
  type: "hook_error";
  hook_path: string;
  duration_ms: number;
  error: string;
  stderr?: string;
  stderr_blob_path?: string; // For large error outputs
}

// Helper functions
export function createUnifiedEvent(
  params: Omit<UnifiedEvent, "span_id" | "ts">,
): UnifiedEvent {
  return {
    ...params,
    ts: new Date().toISOString(),
    span_id: generateUUID(),
  };
}

// Simple UUID v4 generator
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Type guards
export function isApiCallPayload(
  payload: EventPayload,
): payload is ApiCallPayload {
  return payload.type === "api_call";
}

export function isToolCallPayload(
  payload: EventPayload,
): payload is ToolCallPayload {
  return payload.type === "tool_call";
}

export function isHookEventPayload(
  payload: EventPayload,
): payload is HookEventPayload {
  return payload.type === "hook_event";
}

// Blob storage helper
export interface BlobStorage {
  saveBlobPath(runId: string, content: string): string;
  readBlobPath(path: string): string;
}

// Default implementation saves to ~/.cc-profile/logs/<run_id>/raw/
export class FileBlobStorage implements BlobStorage {
  private basePath: string;

  constructor(basePath: string = ".cc-profile") {
    this.basePath = basePath;
  }

  saveBlobPath(runId: string, content: string): string {
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const blobPath = path.join(
      this.basePath,
      "logs",
      runId,
      "raw",
      `${hash.substring(0, 8)}.json`,
    );

    const dir = path.dirname(blobPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(blobPath, content);
    return blobPath;
  }

  readBlobPath(path: string): string {
    return fs.readFileSync(path, "utf8");
  }
}
