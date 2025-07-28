- Always read README.md at the beginning of a session.

The orchestrator hook and interceptor run from ~/.cc-profile/, NOT from the source directory.
Changes to source files are meaningless until you run `cc-profile init` to deploy them.

cc-profile – Zero‑Touch Tracing & Observability for Claude Code

0. One‑liner

cc-profile adds end‑to‑end, zero‑config profiling to Claude Code: a hook interceptor + a fetch interceptor → normalized event log → self-contained HTML report. No orchestration, no extra deps beyond Node.

1. Problem

Claude Code users lack lightweight, always-on visibility into what actually happened during a run: prompts, tool calls, diffs, tests, latency, token/cost. Existing examples (e.g., claude-trace) capture some HTTP traffic but miss hook-level signals and structured gating. Teams need a dead-simple way to inspect sessions post hoc without standing up infra or writing config. Claude itself DOES output OTEL format, but only metrics and logs, no traces. We offer sophisticated tracing of requests in industry standard format (OTEL)

2. Goals (MVP)

Zero-/Low-touch install: single init command that wires one hook to all events + an optional wrapper.

Complete trace: capture API calls, hook events, tool executions, file diffs, test outputs into a single events.jsonl.

Self-contained report: on session end, emit/open report.html (no external build/runtime deps) with timeline, tables, basic metrics.

Vanilla feel: User still runs claude-code normally. cc-profile feels like an add-on, not a framework.

Non-Goals (for this project)

Orchestration/planning (reserved for future cc-runner / cc-planner).

Advanced gate enforcement/CI blocking (optional later).

External collectors/OTEL pipelines (export hooks only).

Multi-run dashboards or persistence beyond local files.

3. Guiding Principles

Principle of Least Astonishment: Don’t change Claude Code UX; be transparent about what’s running.

Single Source of Truth: One events.jsonl per run; everything derives from it.

Keep It Local: No services. HTML bundles data + JS inline.

Separation of Capture & View: Capture first (always), fancy analysis later.

### Seamless Integration Philosophy

cc-profile is designed to be invisible to users after initial setup. By aliasing `claude` to our wrapper, users continue their normal workflow while gaining automatic tracing capabilities. The wrapper intelligently parses cc-profile specific flags before passing everything else to claude-code unchanged.

Install

npx cc-profile init # or: npm i -g cc-profile && cc-profile init

Writes/merges a single hook entry into ~/.claude/settings.json.

Installs scripts under ~/.cc-profile/.

Provides shell function to alias `claude` to the cc-profile wrapper.

Prompts user to add the alias to their shell config.

Run (after setup)

claude chat # user runs as normal (via alias)

Hooks and HTTP interceptor both active, silently logging.

HTML report generated on Stop (auto-open disabled by default).

cc-profile specific flags:

claude --cc-open chat # Open HTML report on completion
claude --cc-no-trace chat # Disable tracing for this run
claude --cc-report chat # Show report path without opening

Outputs

~/.cc-profile/logs/<run_id>/events.jsonl

~/.cc-profile/logs/<run_id>/report.html

Optional: raw/ folder for full payload blobs.

Note: Logs are stored in user home directory (~/.cc-profile) to avoid cluttering project directories.

# Claude Code API Request and Response Reference

This document details the communication protocol and message formats used by Claude Code when interacting with the Anthropic API and processing tool calls.

## Architecture Overview

Claude Code uses a streaming JSON protocol for communication between the SDK/CLI and the underlying Claude API. The system operates through:

1. **Input Format**: `stream-json` - Allows bidirectional streaming communication
2. **Output Format**: `stream-json` - Provides real-time message streaming
3. **Communication Protocol**: Process-based IPC using stdin/stdout

## Message Types

### 1. User Messages (SDKUserMessage)

```typescript
{
  type: 'user',
  message: APIUserMessage,
  parent_tool_use_id: string | null,
  session_id: string
}
```

**APIUserMessage Structure**:

- Contains user prompts and tool results
- Supports text content and tool result blocks
- Includes conversation context

### 2. Assistant Messages (SDKAssistantMessage)

```typescript
{
  type: 'assistant',
  message: APIAssistantMessage,
  parent_tool_use_id: string | null,
  session_id: string
}
```

**APIAssistantMessage Structure**:

- Contains Claude's responses
- Includes tool use requests
- Supports streaming content blocks

### 3. System Messages (SDKSystemMessage)

```typescript
{
  type: 'system',
  subtype: 'init',
  apiKeySource: 'user' | 'project' | 'org' | 'temporary',
  cwd: string,
  session_id: string,
  tools: string[],
  mcp_servers: {
    name: string,
    status: string
  }[],
  model: string,
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
}
```

### 4. Result Messages (SDKResultMessage)

```typescript
// Success Result
{
  type: 'result',
  subtype: 'success',
  duration_ms: number,
  duration_api_ms: number,
  is_error: boolean,
  num_turns: number,
  result: string,
  session_id: string,
  total_cost_usd: number,
  usage: {
    input_tokens: number,
    output_tokens: number,
    cache_creation_input_tokens: number,
    cache_read_input_tokens: number
  }
}

// Error Result
{
  type: 'result',
  subtype: 'error_max_turns' | 'error_during_execution',
  duration_ms: number,
  duration_api_ms: number,
  is_error: boolean,
  num_turns: number,
  session_id: string,
  total_cost_usd: number,
  usage: NonNullableUsage
}
```

## Tool Communication Protocol

### Tool Request Format

When Claude requests to use a tool, it sends a tool_use content block:

```typescript
{
  type: 'tool_use',
  id: string,
  name: string,
  input: object // Tool-specific parameters
}
```

### Tool Response Format

Tool results are returned as:

```typescript
{
  type: 'tool_result',
  tool_use_id: string,
  content: string | Array<{type: string, [key: string]: any}>,
  is_error?: boolean
}
```

## Available Tools and Their Inputs

### File Operations

#### Read Tool

```typescript
{
  file_path: string,      // Absolute path
  offset?: number,        // Starting line
  limit?: number         // Number of lines
}
```

#### Write Tool

```typescript
{
  file_path: string,      // Absolute path
  content: string        // File content
}
```

#### Edit Tool

```typescript
{
  file_path: string,      // Absolute path
  old_string: string,    // Text to replace
  new_string: string,    // Replacement text
  replace_all?: boolean  // Replace all occurrences
}
```

#### MultiEdit Tool

```typescript
{
  file_path: string,
  edits: Array<{
    old_string: string,
    new_string: string,
    replace_all?: boolean
  }>
}
```

### Search Operations

#### Grep Tool

```typescript
{
  pattern: string,         // Regex pattern
  path?: string,          // Search path
  glob?: string,          // File glob pattern
  output_mode?: 'content' | 'files_with_matches' | 'count',
  '-A'?: number,          // Lines after match
  '-B'?: number,          // Lines before match
  '-C'?: number,          // Context lines
  '-n'?: boolean,         // Show line numbers
  '-i'?: boolean,         // Case insensitive
  type?: string,          // File type filter
  head_limit?: number,    // Limit results
  multiline?: boolean     // Multi-line matching
}
```

#### Glob Tool

```typescript
{
  pattern: string,        // Glob pattern
  path?: string          // Search directory
}
```

### Shell Operations

#### Bash Tool

```typescript
{
  command: string,        // Shell command
  timeout?: number,       // Max 600000ms
  description?: string,   // Command description
  sandbox?: boolean,      // Run in sandbox mode
  shellExecutable?: string // Custom shell path
}
```

### Web Operations

#### WebFetch Tool

```typescript
{
  url: string,           // URL to fetch
  prompt: string         // Processing prompt
}
```

#### WebSearch Tool

```typescript
{
  query: string,                // Search query
  allowed_domains?: string[],   // Domain whitelist
  blocked_domains?: string[]    // Domain blacklist
}
```

### Task Management

#### TodoWrite Tool

```typescript
{
  todos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority: "high" | "medium" | "low";
    id: string;
  }>;
}
```

### Agent Operations

#### Task Tool (Sub-agent)

```typescript
{
  description: string,    // Task description
  prompt: string,        // Task prompt
  subagent_type: string  // Agent type
}
```

## Control Requests

### Interrupt Request

```typescript
{
  request_id: string,
  type: 'control_request',
  subtype: 'interrupt'
}
```

Used to interrupt ongoing operations when streaming input is enabled.

## Error Handling

Errors are communicated through:

1. **Tool Errors**: Set `is_error: true` in tool_result
2. **System Errors**: Use error_during_execution result subtype
3. **Turn Limits**: Use error_max_turns result subtype

## Usage Tracking

All responses include usage information:

```typescript
{
  input_tokens: number,
  output_tokens: number,
  cache_creation_input_tokens: number,
  cache_read_input_tokens: number
}
```

## MCP (Model Context Protocol) Support

Claude Code supports MCP servers for extended functionality:

### MCP Server Types

1. **stdio**: Command-based servers
2. **sse**: Server-Sent Events servers
3. **http**: HTTP-based servers

### MCP Resource Operations

```typescript
// List resources
{
  server?: string  // Optional server filter
}

// Read resource
{
  server: string,  // Server name
  uri: string     // Resource URI
}
```

# Claude Code Hook Events Reference

This document provides a comprehensive list of all hook events that fire when Claude Code is working. Hooks are shell commands that execute in response to specific events during Claude's operation.

## Hook Events

### 1. PreToolUse

- **When it fires**: After Claude creates tool parameters and before processing the tool call
- **Data passed**:
  - `session_id`: Current session identifier
  - `transcript_path`: Path to the conversation transcript
  - `cwd`: Current working directory
  - `tool_name`: Name of the tool about to be used
  - `tool_input`: Input parameters for the tool

### 2. PostToolUse

- **When it fires**: Immediately after a tool completes successfully
- **Data passed**:
  - `session_id`: Current session identifier
  - `transcript_path`: Path to the conversation transcript
  - `cwd`: Current working directory
  - `tool_name`: Name of the tool that was used
  - `tool_input`: Input parameters that were sent to the tool
  - `tool_response`: Response returned by the tool

### 3. Notification

- **When it fires**:
  - When Claude needs permission to use a tool
  - When input has been idle for 60 seconds
- **Data passed**:
  - `session_id`: Current session identifier
  - `transcript_path`: Path to the conversation transcript
  - `cwd`: Current working directory
  - `message`: Notification message content

### 4. UserPromptSubmit

- **When it fires**: When the user submits a prompt, before Claude processes it
- **Data passed**:
  - `session_id`: Current session identifier
  - `transcript_path`: Path to the conversation transcript
  - `cwd`: Current working directory
  - `prompt`: The text of the user's prompt

### 5. Stop

- **When it fires**: When the main Claude Code agent has finished responding
- **Data passed**:
  - `session_id`: Current session identifier
  - `transcript_path`: Path to the conversation transcript
  - `stop_hook_active`: Boolean indicating if stop hook is active

### 6. SubagentStop

- **When it fires**: When a Claude Code sub agent (Task tool call) has finished responding
- **Data passed**:
  - `session_id`: Current session identifier
  - `transcript_path`: Path to the conversation transcript
  - `stop_hook_active`: Boolean indicating if stop hook is active

### 7. PreCompact

- **When it fires**: Before Claude Code is about to run a compact operation
- **Data passed**:
  - `session_id`: Current session identifier
  - `transcript_path`: Path to the conversation transcript
  - `trigger`: Type of trigger ("manual" or "auto")
  - `custom_instructions`: Any custom instructions for the compact operation

## Usage Notes

- Hooks are configured in the Claude Code settings
- Multiple hooks can be registered for the same event
- Hook commands receive data as environment variables
- Hooks can be used for logging, notifications, security controls, and custom integrations
- If a hook blocks an operation, Claude will attempt to adjust its actions in response

## Example Hook Configuration

```json
{
  "hooks": {
    "pre_tool_use": "echo \"Tool ${tool_name} about to be used\" >> claude.log",
    "post_tool_use": "notify-send \"Claude used ${tool_name}\"",
    "user_prompt_submit": "./validate-prompt.sh"
  }
}
```

## Security Considerations

- Hooks execute with the same permissions as Claude Code
- Be cautious about what commands you allow in hooks
- Consider using hooks for security controls and audit logging
- Validate and sanitize any data passed to external commands

# 🚨 CRITICAL REMINDER FOR AI ASSISTANTS 🚨

**AFTER MAKING ANY CHANGES TO cc-profile SOURCE CODE:**

1. Run `npm run build` to compile TypeScript files
2. Run `npm run dev:init` to copy updated files to ~/.cc-profile/
3. **CRITICAL:** Run `npm link` to update the global cc-profile installation
4. If you don't complete ALL steps, your changes WILL NOT take effect when testing with the wrapper!

## 🔧 DEVELOPMENT vs PRODUCTION COMMANDS

**ALWAYS use development npm scripts when working on cc-profile source code:**

### Development (uses latest local build)

- `npm run dev:init` - Initialize cc-profile with latest changes
- `npm run dev:run` - Run cc-profile CLI with latest changes
- `npm run dev:html <file.jsonl>` - Generate HTML with latest changes

### Production (uses global installation)

- `cc-profile init` - Initialize using global version (may be outdated during development)
- `cc-profile --generate-html` - Generate HTML using global version

## ⚠️ WRAPPER TESTING REQUIRES GLOBAL UPDATE

**CRITICAL:** The cc-profile-wrapper calls the **GLOBAL** cc-profile installation, NOT your local development code!

When testing changes that affect the wrapper behavior:

1. **Build and link**: `npm run build && npm link`
2. **Test wrapper**: Use your normal `claude` alias to test
3. **Verify paths**: Ensure output shows `run-{timestamp}` format, not `sessions/{uuid}`

**Common Bug:** If you see "Claude Trace" instead of "cc-profile" in output, or "sessions/{uuid}" paths, the global installation is outdated. Run `npm link` to fix.
