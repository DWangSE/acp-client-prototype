# ACP Client Prototype — API 文档 (V3)

> 本文档面向开发者，系统介绍 `acp-client-prototype` 项目的 V3 重构后的模块架构、核心类、类型定义及使用方法。

---

## 目录

- [ACP Client Prototype — API 文档 (V3)](#acp-client-prototype--api-文档-v3)
  - [目录](#目录)
  - [1. 项目架构概览](#1-项目架构概览)
  - [2. 连接层 (`src/connection/`)](#2-连接层-srcconnection)
    - [`AgentConnection` 接口](#agentconnection-接口)
  - [3. 适配器层 (`src/adapter/`)](#3-适配器层-srcadapter)
    - [`AgentAdapter`](#agentadapter)
  - [4. 认证层 (`src/auth/`)](#4-认证层-srcauth)
    - [`AuthLayer`](#authlayer)
  - [5. Hook \& Gate 系统 (`src/hook-gate/`)](#5-hook--gate-系统-srchook-gate)
    - [钩子 (Hooks)](#钩子-hooks)
    - [拦截器 (Gates)](#拦截器-gates)
  - [6. 客户端方法 (`src/client-methods/`)](#6-客户端方法-srcclient-methods)
  - [7. 核心客户端 (`src/client/acp-client.ts`)](#7-核心客户端-srcclientacp-clientts)
  - [8. 类型定义与错误处理](#8-类型定义与错误处理)
    - [`src/core/errors.ts`](#srccoreerrorsts)

---

## 1. 项目架构概览

重构后的架构采用了高度模块化的设计，引入了连接抽象、适配器模式以及生命周期钩子系统。

```
src/
├── adapter/                  ← Agent 适配器层
│   ├── adapters/             ← 各 Agent 的具体实现（Gemini, Claude, Aider 等）
│   ├── base-adapter.ts       ← 适配器基类
│   ├── interface.ts          ← 适配器接口
│   └── registry.ts           ← 适配器注册中心
├── auth/                     ← 统一认证层
│   ├── strategies/           ← 各种认证策略（env-auto, interactive 等）
│   ├── auth-layer.ts         ← 认证编排
│   └── interface.ts          ← 认证接口
├── client/                   ← 核心客户端
│   └── acp-client.ts         ← 高层编排器 (Orchestrator)
├── client-methods/           ← 客户端能力实现 (Agent -> Client)
│   ├── filesystem-handler.ts ← 文件系统读写（带沙箱）
│   ├── permission-handler.ts ← 交互式权限确认
│   ├── terminal-handler.ts   ← 真实终端创建
│   └── router.ts             ← 能力路由分发
├── connection/               ← 连接抽象层
│   ├── acp-connection.ts     ← ACP 连接 (基于 @agentclientprotocol/sdk)
│   ├── pty-connection.ts     ← PTY 连接 (基于 node-pty, 用于 Aider 等)
│   └── interface.ts          ← 连接接口定义
├── core/                     ← 核心基础
│   ├── errors.ts             ← 统一错误定义
│   └── types.ts              ← 协议与扩展类型
├── hook-gate/                ← 扩展系统
│   ├── built-in/             ← 内置钩子与拦截点
│   ├── registry.ts           ← 钩子/拦截器注册表
│   └── interface.ts          ← 接口定义
├── session/                  ← 会话管理
│   ├── memory-session-store.ts
│   └── interface.ts
└── index.ts                  ← CLI 入口
```

---

## 2. 连接层 (`src/connection/`)

### `AgentConnection` 接口
统一了 ACP (JSON-RPC) 和 PTY (字节流) 的通信范式。

- **`AcpConnection`**: 内部集成 `@agentclientprotocol/sdk` 的 `ClientSideConnection`，处理标准 ACP 握手与通信。
- **`PtyConnection`**: 使用 `node-pty` 派生伪终端进程，支持 Aider 等不支持 ACP 的 Agent，通过字节流模拟消息更新。

---

## 3. 适配器层 (`src/adapter/`)

### `AgentAdapter`
封装每个 Agent 的特有配置，包括：
- `resolveCommand()`: 解析启动命令与参数。
- `resolveEnv()`: 获取所需的凭证环境变量（如 `GEMINI_API_KEY`）。
- `resolveAuthStrategy()`: 声明认证策略。
- `normalizeResponse()`: (仅 ACP) 处理 Agent 的协议怪癖 (Quirks)。

---

## 4. 认证层 (`src/auth/`)

### `AuthLayer`
通过策略模式处理不同 Agent 的认证差异：
- **`env-auto`**: 自动从环境变量匹配凭证。
- **`interactive`**: 如果有多个认证方式，通过命令行提示用户选择。
- **`none` / `pre-configured`**: 跳过认证调用。

---

## 5. Hook & Gate 系统 (`src/hook-gate/`)

### 钩子 (Hooks)
生命周期事件的监听点。
- 点位：`pre:connect`, `post:initialize`, `pre:prompt`, `pre:disconnect` 等。

### 拦截器 (Gates)
数据流的控制点，可以修改或拦截数据。
- 点位：`output` (控制事件输出), `request:outbound`, `permission` 等。

---

## 6. 客户端方法 (`src/client-methods/`)

实现了 Agent 回调 Client 端的真实能力：
- **文件系统**: 支持 `fs/read_text_file` 和 `fs/write_text_file`，通过 baseDir 强制进行路径沙箱隔离。
- **权限**: 通过 `@inquirer/prompts` 提供交互式确认，支持 `AUTO_APPROVE` 环境变量。
- **终端**: 真实派生本地 Shell 进程。

---

## 7. 核心客户端 (`src/client/acp-client.ts`)

`AcpClient` 负责将上述所有模块编排在一起。

**使用示例**:
```typescript
const client = new AcpClient({
  adapter,
  connection,
  authLayer,
  sessionManager,
  methodRouter,
  hookRegistry,
  gateRegistry
});

await client.initialize();
await client.createSession(process.cwd());
const turn = await client.sendPrompt("Hello");

for await (const event of turn) {
  console.log(event.payload);
}
```

---

## 8. 类型定义与错误处理

### `src/core/errors.ts`
引入了统一的错误继承体系：
- `AgentSpawnError`: 启动失败。
- `AuthError`: 认证失败。
- `PermissionDeniedError`: 权限或沙箱违规。
- `TransportError`: 通信异常。

---

> 本文档与代码同步版本：v3.0.0 | 最后更新：2026-06-03
