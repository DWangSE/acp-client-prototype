# acp-client-prototype

[![EN](https://img.shields.io/badge/Language-English-blue.svg)](README.md)
[![ZH](https://img.shields.io/badge/Language-中文-red.svg)](README.zh.md)

# Universal ACP Client

一个模块化、高可扩展的 ACP (Agent Client Protocol) 宿主客户端类库，用于将标准的 AI 编码 Agent (Gemini, Claude, Codex) 以及基于 TUI 的工具 (Aider) 无缝接入上层系统（例如 Multi-Agent 编排框架、IDE 插件等）。

基于 `@agentclientprotocol/sdk` 构建。

---

## 核心设计特性

- **Builder 模式**: 抽象出简单易用的 `AcpClientBuilder`，通过链式调用进行 Client 实例的参数化构建。
- **状态机与生命周期暴露**: 暴露 Client 全生命周期状态 (`disconnected`, `initializing`, `authenticated`, `ready`, `busy`, `shutting_down`)，并支持实时状态变更事件。
- **配置驱动的方法扩展**: 支持通过 `YAML` 或 `JSON` 配置文件定义新增方法描述，并配合 Builder 注册自定义处理器（Handler），快速完成 ACP/MCP 扩展。
- **完全隔离的测试层**: 测试代码与核心库分离，位于独立的 `tests/` 目录中，支持独立编译，且测试代码完全使用 Client 暴露的公开 Builder 和接口。

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置凭证

```bash
cp .env.example .env
# 编辑 .env 并填入 API Key (例如 GEMINI_API_KEY)
```

### 3. 运行隔离的集成测试

```bash
npm run hello -- gemini "Hello World"
```

---

## 核心 API 与接口规范

### 1. 使用 Builder 构建 Client 实例 (`AcpClientBuilder`)

上层使用者无须关注复杂的连接驱动、鉴权策略、会话管理的底层组装。使用 `AcpClientBuilder` 完成一站式配置：

```typescript
import { AcpClientBuilder } from "acp-client-prototype";

const builder = new AcpClientBuilder()
  .withAgent("gemini") // 选择要连接的 Agent 标识 (如 gemini, claude)
  .withVerbose(true) // 开启详细调试输出
  .withAutoApprove(true) // 自动批准所有敏感权限请求
  .withSandboxDir("/my-sandbox") // 指定文件系统沙箱路径
  .withExtensionConfig("extensions.yaml") // 载入自定义 ACP 扩展协议描述文件
  .registerExtensionHandler("custom/greet", new MyCustomHandler()); // 注册自定义方法处理器

const client = builder.build();
```

---

### 2. Client 状态管理与数据出口

`AcpClient` 作为统一的主体，只负责网络通信、协议解析与状态编排。所有的输入命令（入口）与事件流（出口）完全交给上层进行接管与控制。

#### Client 连接与 turn 状态机 (`ClientState`)

宿主状态可通过 `client.getState()` 进行实时查询，包含以下状态：

- `disconnected`: Agent 子进程未启动。
- `initializing`: 进程已启动，正在执行 initialize 协议握手。
- `authenticated`: 握手成功，客户端已自动解析并执行完成 Agent 对应策略的鉴权。
- `ready`: 会话创建完毕，处于闲置状态，随时准备接收上层 Prompt 指令。
- `busy`: 正在向远端 Agent 发送指令并等待返回，或者 Agent 正在流式输出/调用工具中。
- `shutting_down`: 进程和资源释放中。

#### 强类型事件参考手册 (Type-Safe Event Reference)

`AcpClient` 类通过**严格的 TypeScript 方法重载**重写了 Node 原生的 `EventEmitter` 方法（如 `on`, `once`, `off`）。现代 IDE（如 VS Code）会自动提供事件名拼写补全，并对事件的回调参数（Payload）提供完整的类型校验与结构提示。

以下是客户端支持的完整类型化事件表：

| 事件名称 (Event Name) | 回调参数类型 (Parameter Type)                    | 事件描述                                                   |
| --------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `stateChange`         | `(newState: ClientState, oldState: ClientState)` | 任何连接状态、会话执行状态发生转换时触发。                 |
| `event`               | `(event: ConnectionEvent)`                       | 底层连接层收到的所有原始数据包包头包装。                   |
| `agent_message_chunk` | `(payload: any)`                                 | Agent 流式返回的文本消息 Token 片段。                      |
| `agent_thought_chunk` | `(payload: any)`                                 | 支持推理思维链的 Agent 正在流式输出的思考 Token 片段。     |
| `tool_call`           | `(payload: any)`                                 | Agent 请求调用特定的主机/客户端工具/方法。                 |
| `tool_call_update`    | `(payload: any)`                                 | 被调用的工具执行完成、失败等执行状态更新。                 |
| `stderr`              | `(payload: any)`                                 | 远端 Agent 进程抛出的原始标准错误诊断输出。                |
| `permission_request`  | `(payload: any)`                                 | Agent 请求高风险操作（如运行终端脚本）时触发的交互式授权。 |

```typescript
// 支持拼写补全与类型校验
client.on("stateChange", (newState, oldState) => {
  // TypeScript 会自动推断出 newState 与 oldState 为 ClientState 类型！
});
```

#### 订阅细粒度数据流 (出口)

上层程序可直接订阅特定的事件名称，实现高亮文本、日志归档或人工审核拦截：

```typescript
// 监听 Agent 输出的文本消息流
client.on("agent_message_chunk", (payload) => {
  process.stdout.write(payload.update.content.text);
});

// 监听 Agent 思考的思维链消息流
client.on("agent_thought_chunk", (payload) => {
  console.log(`[思考中...] ${payload.update.content.text}`);
});

// 拦截并接管工具调用
client.on("tool_call", (payload) => {
  console.log(`[工具调用拦截] Agent 请求执行: ${payload.update.title}`);
});
```

---

### 3. ACP 协议扩展 (方法扩展机制)

要为 Client 增加新的方法/能力，扩展者**完全不需要修改 Client 核心代码**，只需简单 3 步：

#### 第一步：在配置文件中描述方法 (`extensions.yaml`)

```yaml
methods:
  - name: "custom/greet"
    description: "Greet a user with a customized styling theme"
    params:
      name: "string"
      style: "string"
```

#### 第二步：编写方法处理器 (`ClientMethodHandler`)

编写一个类，实现 `ClientMethodHandler` 接口：

```typescript
import { ClientMethodHandler } from "acp-client-prototype";

class MyCustomHandler implements ClientMethodHandler {
  async handle(method: string, params: any): Promise<any> {
    if (method === "custom/greet") {
      return {
        greeting: `Hello ${params.name || "User"}, styled using: ${params.style || "plain"}`,
      };
    }
    throw new Error(`Unsupported custom method: ${method}`);
  }
}
```

#### 第三步：使用 Builder 注册

```typescript
const builder = new AcpClientBuilder()
  .withAgent("gemini")
  .withExtensionConfig("extensions.yaml")
  .registerExtensionHandler("custom/greet", new MyCustomHandler());
```

在 Client 初始化时，这些自定义方法会自动注入到 `clientCapabilities.experimental` 中传输给 Agent，告知其本宿主客户端支持此方法的调用。

---

## 已支持的适配器列表

| Agent 标识    | 连接方式 | 鉴权策略         | 描述                                          |
| ------------- | -------- | ---------------- | --------------------------------------------- |
| **gemini**    | `acp`    | `env-auto`       | 通过 `gemini-cli` 连接 Google Gemini          |
| **claude**    | `acp`    | `none`           | 通过 `claude-agent-acp` 连接 Anthropic Claude |
| **copilot**   | `acp`    | `none`           | 通过 `@github/copilot` 连接 GitHub Copilot    |
| **codex**     | `acp`    | `none`           | 通过 `codex-acp` 连接 OpenAI Codex            |
| **codebuddy** | `acp`    | `env-auto`       | 通过 `codebuddy-code` 连接腾讯 CodeBuddy      |
| **aider**     | `pty`    | `pre-configured` | 通过 PTY 伪终端兜底连接 AI 编码助手 Aider     |

---

## 项目架构图

```
src/
├── adapter/          # Agent 定义、差异抹平及扩展注册表
├── auth/             # 统一鉴权策略（自动、交互、预配置等）
├── client/           # Builder 模式实现与 Client 核心生命周期编排器
├── client-methods/   # 宿主内置功能 (FS 沙箱、虚拟终端等) 与自定义扩展处理器
├── connection/       # 底层连接驱动（ACP JSON-RPC / PTY）
├── core/             # 通用错误、类型定义及协议规范定义
├── driver/           # A方向 Driver 包装层 (MockDriver)
├── hook-gate/        # 事件点位定义与拦截回调契约 (解耦)
└── session/          # 会话存储与管理
tests/
├── driver.test.ts    # A方向 Driver 契约集成测试层
└── hello.ts          # 分离出的独立测试层
```

---

### 4. A 方向 Driver 契约包装层 (`src/driver/`)

为了支持端到端多智能体 BCD 流水线，微观协议通道层的 `AcpClient` 被包裹在 `MockDriver` 适配器中，该适配器完全实现了 C 方向要求的 `DriverRuntimeHandle` 接口：

- **`sendPrompt(input: DriverPrompt): Promise<DriverRunResult>`**：宏观任务执行信封，向 C 方向返回标准的补丁产物引用与审计日志。

执行独立的 A 方向驱动集成测试契约套件：

```bash
npm run build && npm run build:test && node dist/tests/driver.test.js
```

---

---

## 核心环境变量

| 变量名                 | 描述                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `VERBOSE=1`            | 开启详细的调试与状态转移日志                                       |
| `AUTO_APPROVE=1`       | 自动批准所有 Agent 对文件系统、终端操作的授权请求                  |
| `CODEX_HOME`           | 指向自定义目录以覆盖全局 Codex 配置 (例如 `./.codex`)              |
| `GEMINI_API_KEY`       | Gemini 适配器的 API Key                                            |
| `ANTHROPIC_API_KEY`    | Claude 适配器的 API Key                                            |
| `OPENAI_API_KEY`       | Codex/Aider 的 API Key                                             |
| `COPILOT_GITHUB_TOKEN` | Copilot 适配器的 GitHub Access Token（支持使用 GH_TOKEN 作为备用） |

### OpenAI Codex 本地配置 (`CODEX_HOME`)

默认情况下，OpenAI Codex 适配器 (`codex-acp`) 会读取全局的 `~/.codex/` 目录。如果你希望使用项目本地的配置（例如重写 API 端点或沙箱行为），你可以将 `CODEX_HOME` 指向一个本地文件夹：

1. 将 `.env.example` 复制为 `.env` 并设置 `CODEX_HOME=./.codex`。
2. 在项目根目录的 `.codex/` 文件夹中创建本地配置文件：
   - 将 `.codex/config.toml.example` 复制为 `.codex/config.toml` 并根据需要进行定制。
   - 将 `.codex/auth.json.example` 复制为 `.codex/auth.json` 并填入你的 API Key 或凭据。

这些本地配置文件已添加到 `.gitignore` 中，以防止你的 API Key 和工作区特定配置被误提交到 Git。

---

## 故障排查

- **进程挂起**: 请务必确保在业务结束时调用了 `client.shutdown()` 进而清理资源、断开底层子进程。
- **沙箱文件访问拒绝**: 内置的 FileSystem Handler 强制推行沙箱安全策略。请确保 Agent 访问的路径均位于当前运行工作目录下。
