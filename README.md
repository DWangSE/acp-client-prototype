# acp-client-prototype

[![EN](https://img.shields.io/badge/Language-English-blue.svg)](README.md)
[![ZH](https://img.shields.io/badge/Language-中文-red.svg)](README.zh.md)


# Universal ACP Client (V3 Refactored)

A modular and extensible ACP (Agent Client Protocol) client library designed to connect standard AI coding agents (Gemini, Claude, Codex) and TUI-based tools (Aider) to upper-layer systems.

Powered by `@agentclientprotocol/sdk`.

---

## Core Refactoring Highlights

- **Builder Pattern**: Instantiate and configure client client instances via a clean, chainable Builder.
- **State Machine Integration**: Expose fine-grained state queries (`disconnected`, `initializing`, `authenticated`, `ready`, `busy`, `shutting_down`) and state change events.
- **Config-Driven Extensibility**: Define custom client capabilities in plain `YAML` or `JSON` and register extension method handlers effortlessly.
- **Isolated Test Layer**: Standardised Hello World testing is separated into its own package/layer to allow building the library and tests independently.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure credentials
```bash
cp .env.example .env
# Edit .env with your API keys (e.g., GEMINI_API_KEY)
```

### 3. Run Separated Integration Test
```bash
npm run hello -- gemini "Hello World"
```

---

## Architectural API & Interface Specifications

### 1. The Builder Pattern (`AcpClientBuilder`)

Instead of configuring child connections manually, use the `AcpClientBuilder` to set up and construct an `AcpClient`.

```typescript
import { AcpClientBuilder } from "acp-client-prototype";

const builder = new AcpClientBuilder()
  .withAgent("gemini")                         // Select agent adapter
  .withVerbose(true)                           // Enable verbose debug logging
  .withAutoApprove(true)                       // Auto-approve agent tool execution
  .withSandboxDir("/sandbox")                  // Enforce FileSystem sandboxing
  .withExtensionConfig("extensions.yaml")      // Load custom client methods
  .registerExtensionHandler("custom/greet", new MyCustomHandler());

const client = builder.build();
```

---

### 2. Client States & Events

The client client exposes standard execution states and functions as a unified I/O channel for upper-layer orchestrators.

#### Connection & Turn States (`ClientState`)

The client transitions through the following states, queryable via `client.getState()`:
- `disconnected`: The child agent process has not been spawned.
- `initializing`: The process is spawned and waiting for initialize shake-hands.
- `authenticated`: The client has resolved and executed the appropriate credential strategy.
- `ready`: Active session created; the client is idle and ready for user prompt instructions.
- `busy`: Currently streaming thoughts, chunks, or executing tool calls on behalf of the remote Agent.
- `shutting_down`: Process termination and resource cleanups are in progress.

#### Type-Safe Event Reference

The `AcpClient` class extends Node's `EventEmitter` with **strictly typed method overrides** (`on`, `once`, `off`). Modern IDEs (like VS Code) will automatically provide full autocomplete and type validation for both event names and their payload objects.

Below is the complete registry of typed events emitted by the client:

| Event Name | Parameter Type | Description |
|------------|----------------|-------------|
| `stateChange` | `(newState: ClientState, oldState: ClientState)` | Triggered on any connection or execution state transition. |
| `event` | `(event: ConnectionEvent)` | Raw, unmodified wrapper for any packet coming from the connection. |
| `agent_message_chunk` | `(payload: any)` | Live textual answer tokens streamed from the Agent. |
| `agent_thought_chunk` | `(payload: any)` | Live thinking process tokens streamed from reasoning-capable Agents. |
| `tool_call` | `(payload: any)` | Signals that the Agent wants to invoke a specific client/client method/tool. |
| `tool_call_update` | `(payload: any)` | Signals the execution result status of a requested tool call. |
| `stderr` | `(payload: any)` | Raw standard error diagnostics emitted by the underlying Agent process. |
| `permission_request` | `(payload: any)` | Raised when an Agent requests permission to run interactive commands. |

```typescript
// Strict autocompleted subscription
client.on("stateChange", (newState, oldState) => {
  // TypeScript knows that newState and oldState are of type ClientState!
});
```

#### Connecting to Sub-Streams (I/O Outlet)
Upper layers can subscribe directly to specific stream events rather than parsing raw text:
```typescript
// Streamed text response chunks from the Agent
client.on("agent_message_chunk", (payload) => {
  process.stdout.write(payload.update.content.text);
});

// Streamed thinking/reasoning chunks from the Agent
client.on("agent_thought_chunk", (payload) => {
  console.log(`[Thinking] ${payload.update.content.text}`);
});

// Intercept tool calls
client.on("tool_call", (payload) => {
  console.log(`[Tool] Agent requested: ${payload.update.title}`);
});
```

---

### 3. Custom Method Capabilities (Extensibility Configuration)

You can easily extend client capabilities without altering the core codebase. This is done by specifying a configuration file and registering a corresponding handler.

#### 1. Define Method Descriptions (`extensions.yaml`)
```yaml
methods:
  - name: "custom/greet"
    description: "Greet a user with a customized styling theme"
    params:
      name: "string"
      style: "string"
```

#### 2. Implement the Handler (`ClientMethodHandler`)
Write a custom class implementing `ClientMethodHandler`:
```typescript
import { ClientMethodHandler } from "acp-client-prototype";

class MyCustomHandler implements ClientMethodHandler {
  async handle(method: string, params: any): Promise<any> {
    if (method === "custom/greet") {
      return { 
        greeting: `Hello ${params.name || "User"}, styled using: ${params.style || "plain"}` 
      };
    }
    throw new Error(`Unsupported custom method: ${method}`);
  }
}
```

#### 3. Register Custom Capabilities
```typescript
const builder = new AcpClientBuilder()
  .withAgent("gemini")
  .withExtensionConfig("extensions.yaml")
  .registerExtensionHandler("custom/greet", new MyCustomHandler());
```
During client initialization, custom capabilities are packed and sent inside `clientCapabilities.experimental`, telling the AI Agent how to invoke these new capabilities.

---

## Supported Adapters

| Agent | Connection | Auth Strategy | Description |
|-------|------------|--------------|-------------|
| **gemini** | `acp` | `env-auto` | Google Gemini via `gemini-cli` |
| **claude** | `acp` | `none` | Anthropic Claude via `claude-agent-acp` |
| **codex** | `acp` | `none` | OpenAI Codex via `codex-acp` |
| **aider** | `pty` | `pre-configured` | AI coding assistant via PTY fallback |

---

## Workspace Layout
```
src/
├── adapter/          # Agent definitions, quirks, & extensible registry
├── auth/             # Environment-auto, interactive, pre-configured strategies
├── client/           # Builder pattern, AcpClient lifecycle orchestrator
├── client-methods/   # Standard (FS, Terminal, Session) & Custom Extensions
├── connection/       # Protocol drivers (JSON-RPC / PTY abstraction)
├── core/             # Errors, shared types, ACP schemas
├── hook-gate/        # Extensible lifecycle hooks and gate interceptors
└── session/          # Session cache & store
tests/
└── hello.ts          # Separated testing layer
```

---

## Advanced Environment Configurations

| Variable | Description |
|----------|-------------|
| `VERBOSE=1` | Enable detailed debug logging and state outputs |
| `AUTO_APPROVE=1` | Automatically approve all agent filesystem & terminal requests |
| `GEMINI_API_KEY` | API key for Gemini adapter |
| `ANTHROPIC_API_KEY` | API key for Claude adapter |
| `OPENAI_API_KEY` | API key for Codex/Aider |

---

## Troubleshooting

- **Process Hangs**: Ensure you call `client.shutdown()` to clean up event loops and terminate child processes.
- **Sandbox Access Denied**: The filesystem handler enforces a strict sandbox. Ensure agents are accessing paths relative to the current working directory.