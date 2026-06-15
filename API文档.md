# ACP Client Prototype — API 文档

> 本文档面向开发者，系统介绍 `acp-client-prototype` 项目的模块架构、核心类、类型定义及使用方法。

---

## 目录

- [ACP Client Prototype — API 文档](#acp-client-prototype--api-文档)
  - [目录](#目录)
  - [1. 项目架构概览](#1-项目架构概览)
  - [2. 连接层 (`src/connection/`)](#2-连接层-srcconnection)
    - [`AgentConnection` 接口](#agentconnection-接口)
  - [3. 适配器层 (`src/adapter/`)](#3-适配器层-srcadapter)
    - [`AgentAdapter`](#agentadapter)
  - [4. 认证层 (`src/auth/`)](#4-认证层-srcauth)
    - [`AuthLayer`](#authlayer)
  - [5. 事件与拦截器契约 (`src/hook-gate/`)](#5-事件与拦截器契约-srchook-gate)
  - [6. 客户端方法 (`src/client-methods/`)](#6-客户端方法-srcclient-methods)
  - [7. 核心客户端 (`src/client/acp-client.ts`)](#7-核心客户端-srcclientacp-clientts)
  - [8. 类型定义与错误处理](#8-类型定义与错误处理)
    - [`src/core/errors.ts`](#srccoreerrorsts)

---

## 1. 项目架构概览

本项目的架构采用了模块化的设计，引入了连接抽象、适配器模式以及生命周期钩子系统。

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
├── hook-gate/                ← 契约层
│   └── interface.ts          ← 事件名称与拦截器回调接口定义
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

## 5. 事件与拦截器契约 (`src/hook-gate/`)

在 Direction A 运行时设计中，Client/Driver 不负责任何策略逻辑和注册表。它扮演纯粹的事件源，并提供一级同步拦截回调。

### 事件发布 (Event Publication)
`AcpClient` 继承自 Node 的 `EventEmitter`，在特定的物理生命周期时点派发只读事件，外部可采用非阻塞方式订阅：
- **生命周期时点**：`pre:connect`、`post:initialize`、`pre:prompt`、`post:session:create` 等。

### 拦截器 (Interceptors)
拦截器采用 **Unary Callback** 一级回调机制，由外部传入函数实现同步的数据篡改过滤或阻断判断，而不由 Client 内部运行拦截器优先级聚合决策：
- **`output`**: 拦截并修改输出流报文（ConnectionEvent），可返回 `null` 执行丢弃。
- **`permission`**: 拦截工具/敏感指令执行（PermissionRequest），同步返回 `boolean` 以表示授权通过与否。

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
  interceptors: {
    output: async (event) => {
      // 外部自定义同步数据过滤/篡改
      return event;
    },
    permission: async (request) => {
      // 外部同步安全拦截与阻断判定
      return true;
    }
  }
});

// 外部事件监听
client.on("pre:connect", (payload) => {
  // 订阅生命周期事件，抛给上层协调控制面
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

## 9. Driver 包装层 (`src/driver/`)

由于 `AcpClient` 处于微观协议通道级别，在面向长程协调层（Direction C / Coordinator）时，项目要求以执行闭环的形式交付结果。因此我们在 `src/driver/` 下设计了 **Driver 包装层**：

- **`DriverRuntimeHandle` 接口**：定义了宏观的任务执行入口，包括 `sendPrompt(input: DriverPrompt): Promise<DriverRunResult>`，完全对齐长程协调的契约。
- **`MockDriver` 实现**：作为 Mock 包装实现，完全实现了该接口。能够根据 Prompt 模拟 succeeded/failed 状态的执行，并在结果中正确携带补丁产物引用（`ArtifactRef`）与审计日志引用。

---

