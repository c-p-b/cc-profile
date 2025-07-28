# cc-profile Architecture

cc-profile provides zero-touch tracing and observability for Claude Code through a combination of hooks, HTTP interception, and unified event logging. This document describes both the current implementation and the planned architecture.

## Core Architecture

```
┌─────────────┐   alias/wrapper     ┌──────────────┐
│ User Shell  │────────────────────▶│ claude-code  │
└────┬────────┘                     └──────┬───────┘
     │ cc-profile wrapper                  │ hooks fire
     ▼                                     ▼
┌──────────────┐   append JSONL    ┌──────────────────┐
│ orchestrator │──────────────────▶│ events.jsonl     │
└────┬─────────┘                   └────────┬──────────┘
     │ http intercept                       │
     ▼                                      ▼
┌──────────────┐                   ┌──────────────────┐
│ interceptor  │──────────────────▶│ unified events   │
└──────────────┘                   └────────┬──────────┘
                                           │ on Stop
                                           ▼
                                   ┌──────────────────┐
                                   │ report.html      │
                                   └──────────────────┘
```

## Key Components

### 1. Wrapper Script (`~/.cc-profile/bin/cc-profile-wrapper`)

- Shell function aliased to `claude` command
- Parses cc-profile specific flags (`--cc-open`, `--cc-no-trace`, `--cc-report`)
- Sets up environment variables (run ID, configuration)
- Launches claude-code with HTTP interception via Node's `--require` flag

### 2. Orchestrator Hook (`~/.cc-profile/hooks/orchestrator.cjs`)

- Registered under reserved name `__cc_profile_orchestrator__` in Claude settings
- Implements "double-run" strategy for complete hook observability
- Discovers and re-executes user hooks with instrumentation
- Logs all hook events to unified event format

### 3. HTTP Interceptor (`src/interceptor.ts`)

- Patches both `global.fetch` and Node's `http/https` modules
- Captures Anthropic API traffic (messages.create endpoints)
- Extracts tokens, costs, latency, and message content
- Writes events to `~/.cc-profile/logs/<run_id>/events.jsonl`

### 4. Unified Event Schema (`src/unified-events.ts`)

```typescript
interface UnifiedEvent {
  ts: string; // ISO-8601 timestamp
  run_id: string; // Session UUID
  session_id: string; // Claude's session ID
  event_type: EventType; // Discriminated union type
  span_id: string; // Event UUID
  parent_span_id?: string; // For event correlation
  payload: EventPayload; // Type-specific payload
}
```

Event types include:

- `api_call`: HTTP API calls with tokens, costs, latency
- `tool_call`: Tool executions from hooks
- `file_change`: File modifications
- `test_result`: Test execution results
- `message`: User/assistant/system messages
- `stop`: Session termination
- `hook_event`: Hook invocations
- `hook_execution`: Successful hook runs
- `hook_error`: Hook failures

### 5. HTML Report Generator (Phase 2)

- Reads unified `events.jsonl` on session stop
- Generates self-contained HTML with inline CSS/JS
- Provides timeline view, tool call tables, metrics
- No external dependencies or CDN requirements

## Data Flow

### 1. Initialization

```bash
cc-profile init
```

- Creates directory structure under `~/.cc-profile/`
- Registers orchestrator hook for all Claude events
- Installs wrapper script and provides shell alias instructions

### 2. Runtime Execution

```bash
claude chat  # Using alias
```

1. Wrapper script:
   - Generates unique run ID
   - Configures environment
   - Launches claude-code with interceptor

2. During execution:
   - HTTP interceptor captures API calls → `events.jsonl`
   - Orchestrator captures hook events → `events.jsonl`
   - User hooks run twice (once by Claude, once instrumented)

3. On session stop:
   - Report generator reads `events.jsonl`
   - Creates `report.html` with full session timeline
   - Optionally opens in browser (`--cc-open`)

### 3. Data Storage

```
<project-root>/
└── .cc-profile/               # Auto-gitignored
    └── logs/
        └── <run_id>/
            ├── events.jsonl   # Unified event log
            ├── report.html    # Generated report
            └── raw/           # Large payloads (>10KB)
```

## Hook Observability Strategy

### The "Double-Run" Approach

1. Claude Code executes user hooks normally (unchanged behavior)
2. Orchestrator hook runs for ALL events via reserved name
3. Orchestrator discovers hooks from settings files:
   - `~/.claude/settings.json` (global)
   - `./.claude/settings.json` (project)
   - `./.claude/settings.local.json` (local overrides)
4. Re-executes discovered hooks with instrumentation
5. Captures timing, output, and errors for each hook

## Security & Privacy

- **Local-only**: All data stored on developer machine
- **No network calls**: No telemetry or external services
- **Header redaction**: Sensitive headers removed from logs
- **Gitignored**: `.cc-profile/` automatically excluded from VCS

## Performance Characteristics

- **Event append**: <5ms per event write
- **Storage**: ~10MB typical for events.jsonl
- **Report generation**: <2s for 5k events
- **Hook overhead**: Negligible for orchestrator itself

## Phase Implementation Status

### ✅ Phase 0-1: Core Capture (Complete)

- HTTP interception via Node require hooks
- Unified event schema implementation
- Orchestrator hook with double-run strategy
- Init command and wrapper script
- Project-local logging structure

### 🚧 Phase 2: Report Generation (In Progress)

- [ ] Update HTMLGenerator for unified events
- [ ] Implement `--cc-open` functionality
- [ ] Add `--cc-report` path display
- [ ] Timeline visualization
- [ ] Metrics aggregation

### 📋 Phase 3: Polish (Planned)

- [ ] Diff viewer for file changes
- [ ] Test result summaries
- [ ] Token/cost analysis tables
- [ ] Log rotation policies
- [ ] Export to OTLP (optional)

## Integration Points

### Claude Code Hooks

- `UserPromptSubmit`: User input events
- `PreToolUse`: Before tool execution (can block)
- `PostToolUse`: After tool completion
- `Stop`: Session termination
- `SubagentStop`: Subagent completion

### Environment Variables

- `CC_PROFILE_RUN_ID`: Unique session identifier
- `CC_PROFILE_OPEN_HTML`: Auto-open report flag
- `CC_PROFILE_REPORT_ONLY`: Show path without opening

### Shell Aliases

```bash
# Bash/Zsh
claude() { ~/.cc-profile/bin/cc-profile-wrapper "$@"; }

# Fish
function claude
  ~/.cc-profile/bin/cc-profile-wrapper $argv
end
```

## Design Principles

1. **Zero-Touch**: Single init command, then invisible operation
2. **Vanilla Feel**: Users run `claude` normally, cc-profile adds observability
3. **Local-First**: No external dependencies or services
4. **Append-Only**: Events written once, never modified
5. **Self-Contained**: HTML reports include all data and code inline

## Future Extensions

- **cc-runner**: Simple orchestration layer for Claude Code
- **cc-planner**: Recursive planning with CLAUDE.md management
- **Gate Engine**: Policy enforcement based on event patterns
- **Multi-run Analytics**: Cross-session dashboards and trends
