# 方向 A：Driver / ACP 接入及跨方向契约对齐（Hooks/Gates/Council）设计规范 (SPEC)

## 1. 摘要

本 SPEC 文档定义了脚手架控制面与底层执行驱动层（AI Coding Agent / TUI CLI 等）之间的 **Driver 接入层对外契约**（方向 A），并深度对齐和融合了以下方向的最新 RFC 标准：
*   **方向 D.1 (Hooks RFC)** — 5 大逻辑命名空间（`agent.*`、`task.*`、`council.*`、`lifecycle.*`、`system.*`）共 44+ 个事件流。
*   **方向 D.2 (Gates RFC)** — 4 级决策语义（`allow | deny | ask | defer`）与 `GateRequest` / `GateResult` 强数据结构模型。
*   **方向 C (长程协调与Council RFC)** — 长程协调状态机变迁、Checkpoint 语义交接、路径租约隔离以及可寻址产物（Artifact）注册消费流。

通过统一的 `DriverRuntimeHandle` 接口和首阶段的 `MockDriver` MVP 实现，建立了整个体系的运行边界：将真实的 ACP 通信、适配器（Adapter）差异抹平、PTY 命令行流等控制在 Driver 内部，并使用统一包装层转换成符合 Direction C 期望的宏观执行结果 `DriverRunResult`。

---

## 2. 术语与系统边界

| 术语 | 英文 / 原生 | 定义 / 定位 |
| :--- | :--- | :--- |
| **执行驱动** | `Driver` | 外部 AI Runtime 或 CLI 的总执行代理（如 Claude Code, Gemini CLI, Mock 驱动等）。 |
| **长程协调器** | `Coordinator` | 维护任务 DAG 状态、消息箱、租约和 Checkpoint 的核心控制面。 |
| **钩子** | `Hook` | 离散时点事件触发器（如 `task.completed`），只响应事件，不持久化状态。 |
| **门禁** | `Gate` | 实际对代码、安全性、合规性进行扫描的执行器（如 `lint`、`test`、`security_scan`）。 |
| **产物引用** | `Artifact Reference` | 协调层可寻址的资产引用，格式为 `artifact://{type}/{scope}/{id}`。 |
| **诊断信息** | `Diagnostics` | 运行期 and 门禁期产生的编译错误、警告、静态扫描异常等。 |
| **审计追溯** | `Transcript` | Driver 运行期间多步骤（thought、tool_call、stderr、output）的流式操作痕迹日志。 |

---

## 3. 方向 A：Driver 接入层契约 Spec 定义

方向 A 的主要目标是定义统一的驱动执行标准。所有 Driver 必须遵循 `DriverRuntimeHandle` 契约，将输入转化为携带 Transcript、Artifacts 和 Diagnostics 的结构化执行结果 `DriverRunResult`。

### 3.1 核心 TypeScript 类型定义 (`src/driver/interface.ts`)

```typescript
export type ArtifactType =
  | "patch"
  | "diff"
  | "test_log"
  | "review"
  | "decision_packet"
  | "checkpoint"
  | "context"
  | "transcript"
  | "driver_result"
  | "audit"
  | "merge_authorization";

export interface ArtifactRef {
  artifact_id: string;
  type: ArtifactType;
  uri: string;
  sha256?: string;
  producer_id: string;
  task_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  schema_version: string;
}

export interface ContextPackRef {
  context_pack_id: string;
  uri: string;
  task_id?: string;
  schema_version: string;
}

export interface DriverCapabilities {
  supports_acp_extension: boolean;
  supports_structured_output: boolean;
  supports_session_load: boolean;
  supports_tool_events: boolean;
  supports_permission_events: boolean;
}

export interface DriverPrompt {
  task_id: string;
  run_id: string;
  prompt: string;
  context_pack_ref?: ContextPackRef;
  created_at: string;
  schema_version: string;
}

export interface DriverToolEvent {
  tool_event_id: string;
  tool_name: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  summary: string;
  created_at: string;
  schema_version: string;
}

export interface DriverError {
  code: string;
  message: string;
  retryable: boolean;
}

export type DriverRunStatus = "succeeded" | "failed" | "cancelled" | "interrupted";

export interface DriverRunResult {
  driver_run_result_id: string;
  session_id: string;
  status: DriverRunStatus;
  artifacts: ArtifactRef[];
  transcript_ref: ArtifactRef;
  tool_events: DriverToolEvent[];
  diagnostics: {
    driver_id: string;
    duration_ms: number;
    notes: string[];
  };
  error?: DriverError;
  created_at: string;
  schema_version: string;
}

export interface DriverRuntimeHandle {
  driver_id: string;
  session_id: string;
  capabilities: DriverCapabilities;
  sendPrompt(input: DriverPrompt): Promise<DriverRunResult>;
  interrupt(reason: string): Promise<void>;
  collectTranscript(taskId?: string): Promise<ArtifactRef>;
}
```

---

### 3.2 MVP 目标：`MockDriver` 行为规范

为支持第一阶段的快速闭环和独立测试，`MockDriver` （已在 `src/driver/mock-driver.ts` 实现）遵循以下确定性状态变迁：

1.  **初始化校验**：调用 `sendPrompt` 前，必须显式调用 `initialize()` 标记驱动就绪，否则强阻断抛出初始化异常。
2.  **Success 路径流**：
    *   **触发条件**：输入 Prompt 中不包含 `"driver_fail"`（不区分大小写）。
    *   **输出内容**：
        *   `status`: `"succeeded"`。
        *   `artifacts`: 自动注册 1 个 mock 补丁产物：`art-patch-{taskId}` -> `artifact://patch/{taskId}/mock-driver.patch`。
        *   `transcript_ref`: 自动记录并导出 mock 会话审计追踪：`art-transcript-{taskId}` -> `artifact://transcript/{taskId}/mock-session`。
        *   `tool_events`: 包含 1 个工具完成事件，满足 C 方向在基本流（basic flow）中对工具执行痕迹记录的要求。
3.  **Failed 路径流**：
    *   **触发条件**：输入 Prompt 中包含 `"driver_fail"`。
    *   **输出内容**：
        *   `status`: `"failed"`。
        *   `diagnostics`: 写入相关的诊断信息笔记（Diagnostics notes）。
        *   `error`: 封装 `COMPILATION_ERROR` 错误，表示驱动运行失败。
3.  **Failed 路径流**：
    *   **触发条件**：输入 Prompt 中包含 `"fail"`。
    *   **输出内容**：
        *   `status`: `'failed'`。
        *   `transcript`: 包含 `input` 步骤，并输出具体的 `stderr` 编译错误。
        *   `artifacts`: 数组为空（不交付任何可用合并资产）。
        *   `diagnostics`: 写入一条 `'error'` 级别的编译诊断。
        *   `error`: 封装 `UNEXPECTED` 错误，并携带模拟异常说明。

---

## 4. 与方向 D：Hooks (D.1) / Gates (D.2) 的契约对齐审计

项目原有 Hook/Gate 契约偏向 ACP 的网络连接生命周期。已按照 D.1/D.2 规范对其进行了重构与对齐，仅保留与 ACP Client 及 Driver 交互相关的事件和门禁点位（已在 `src/hook-gate/interface.ts` 实现）。

### 4.1 核心对齐一：Hook 事件对齐 (D.1 §4)
将多智能体协议中与 ACP Client / Driver 运行直接关联的事件并入统一的 `HookPoint` 强类型约束：
1.  **ACP 客户端生命周期事件**：`pre:connect`、`post:connect`、`pre:initialize`、`post:initialize`、`pre:authenticate`、`post:authenticate`、`pre:session:create`、`post:session:create`、`pre:prompt`、`post:prompt`、`pre:disconnect`、`post:disconnect`。
2.  **Driver 与运行时事件**：
    *   `agent.pre_tool_use` / `agent.post_tool_use` / `agent.post_tool_use_fail`：拦截和记录工具执行阶段。
    *   `agent.checkpoint`：Agent 发起状态保存请求。
    *   `agent.session_start` / `agent.session_end`：会话生命周期的边界标志。
    *   `lifecycle.human_gate`：驱动阶段产生的人工确认/安全拦截挂起。

### 4.2 核心对齐二：标准 Gate 点位契约对齐 (D.2 §3)
重构后的 `GatePoint` 仅包含与执行驱动层产出检测、工具拦截直接关联的门禁点位：
*   **代码及构建质量类**：`lint`、`type_check`、`format_check`、`build_check`、`test`
*   **安全扫描类**：`security_scan`
*   **确认流拦截类**：`human_approval_wait`

### 4.3 核心对齐三：4 级决策权重支持与向后兼容 (D.1 §7 / D.2 §2.4)
D.1 和 D.2 均对裁决设定了 `deny > ask > defer > allow` 的最大严格度优先聚合算法。为保持原脚手架本地 `action: "pass" | "block" | "modify"` 拦截模式的正常运转，对 `GateDecision` 进行了联合信封式升级：
```typescript
export type RfcGateDecisionValue = "allow" | "deny" | "ask" | "defer";

export type GateDecision = 
  | LocalGateDecision 
  | { action: "rfc"; decision: RfcGateDecisionValue; reason?: string; payload?: any };
```
*   **老拦截流**：返回 `LocalGateDecision`。
*   **新拦截流**：返回 `{ action: "rfc", decision: "deny" | "ask" ... }`，由控制面执行严格度聚合。

### 4.4 核心对齐四：数据包模型完全对齐 (D.2 §2.3)
在 `src/hook-gate/interface.ts` 中完全对齐并暴露了 `GateRequest` 与 `GateResult` 核心接口，确保 Gate Runner 及 Audit Trail 的标准化输出。

### 4.5 架构边界重定位：Client 纯化为 Event Publisher
在多智能体系统（如 `newIDE-BCD`）的完整架构中，明确划分了 Driver/Client 与策略引擎（Hook/Gate 注册与拦截表）的边界：
1. **Client 不持有 Registry**：`AcpClient` 与具体驱动（如 `MockDriver`）属于 Direction A 运行时边界，本身应当是无状态的通信通道和执行器。不应在 Client 内部持有 `HookRegistry` 或 `GateRegistry`。
2. **Event-Driven 解耦**：Client 在运行至连接、初始化、Prompt 执行、工具调用或状态变更等关键阶段时，只需作为 **Event Publisher** 抛出对应的事件（如通过 Node.js 的 `EventEmitter` 机制执行 `this.emit("pre:connect", payload)`）。
3. **策略外置**：具体的 Hook 绑定匹配（例如“当 `task.completed` 时触发某些 Gates”）以及 Gate 的拦截决策与聚合，完全外置于上层的 `HookEngine` / `GateRegistry`。Client 仅需在敏感工具或方法执行时暴露一级 Middleware 拦截回调，而注册 and 调度策略归属于上层协调调度面（Coordinator）。

### 4.6 架构演进路线与过渡期契约垫片说明
针对目前仍保留在 `src/hook-gate/interface.ts` 中的 `HookPoint`、`GatePoint`、`GateRequest` 及 `GateResult` 接口定义：

#### 1. 为什么当前阶段需要保留该文件夹与契约定义？
* **跨方向并发开发的类型垫片 (Type Shim)**：目前大项目（`newIDE-BCD`）与本原型库处于并发开发阶段。在公共核心契约包（如 `@newide/core`）尚未抽离并统一发布前，保留该定义是向其他方向（C/D）提供**单向契约对齐证据**的垫片。它证明了 Direction A 发出的事件和预留的拦截回调，在类型层面上能够 100% 契合 D.1/D.2 规范。
* **本地测试的闭环性 (Test Closed-Loop)**：当前原型库需要在不依赖完整控制面的情况下独立进行本地编译和单元测试（`tests/driver.test.ts`）。保留这些接口有助于让测试套件在 Mock 状态下完成完整的行为回放。

#### 2. 远期生产环境的“绝对、彻底解耦”路线
随着大项目多包 Monorepo 结构的成熟，本项目将彻底移除 `src/hook-gate/` 目录，实现物理上的消融：
* **Client 彻底去策略化**：`AcpClient` 将完全不知道 `GateRequest`、`RfcHookPoint` 甚至 Hook/Gate 这两个词的存在。它将仅声明与自身物理通信时点相关的局部事件（例如 `connect:before`、`initialize:after`、`prompt:before`）。
* **策略命名翻译外置**：由 Direction D 的 **HookEngine** 或 C 方向的 **Coordinator** 充当适配层，在外部监听 `AcpClient` 的物理事件，并将其“翻译”为全局的策略事件（如将物理事件 `initialize:after` 翻译并升级为控制面事件 `agent.session_start`）。
* **Unary Interceptor 极简集成**：Client 仅暴露最通用的 Unary Callback 接口（如 `permission?: (request: { method: string; params: any }) => Promise<boolean>`），由外部的聚合引擎算完最终通过与否（`allow/deny`）后，以 `boolean` 形式简单返回。

---

## 5. 与方向 C：长程协调与 Council RFC 的契约对齐审计

在长任务/并行任务流程中，Driver 接入层并非孤立运行，而是深度嵌入了方向 C 的协调生命周期中。

### 5.1 Artifact 注册与消费链路对齐 (RFC-C §3.2.4)
*   **生成侧 (Driver)**：
    *   在执行成功时，Driver 输出 `DriverExecutionResult.artifacts`。
    *   所有产物采用 RFC-C §3.2.4 强制规范的格式，例如：
        *   补丁资产：`artifact://patch/{taskId}/mock-change.patch`
        *   会话追踪：`artifact://transcript/{taskId}/mock-run.json`
*   **消费与注册侧 (Coordinator / C 方向)**：
    *   C 方向获取到 `DriverExecutionResult` 之后，作为唯一的控制面索引发布源。
    *   调用 `_coord.artifact.register` 在 SQLite (`.agent_state.db`) 的 `artifacts` 表中进行关系化落库登记，记录 `artifact_id`、`type`、`uri` (如 `artifact://...`)、`sha256` 和生产者 `producer_id`（此即 Driver ID 或 Agent ID）。
    *   后续 C 方向的合并器（Merger）或者质量拦截 Gates，将通过此可寻址 URI 获取到该 Mock Patch 补丁进行干预和应用，彻底杜绝了多个智能体并行写入同一物理目录的文件冲突。

### 5.2 状态机变迁、租约与恢复机制对齐 (RFC-C §3.2.2)
*   **租约绑定**：C 方向接收到 Driver 执行输入后，在 `_coord.task.claim` 阶段利用 CAS 算法建立“路径租约（File Lease）”与“智能体租约”，并初始化隔离工作树 `worktree_id`。
*   **状态转换路由**：
    *   `execute(input)` 启动后，协调层将任务状态由 `ready` 转移至 `running`。
    *   若 `DriverExecutionResult.status === 'success'`，状态机通过 `reviewing` 并在 before_merge 门禁评估通过后转移至 `merging` 和 `completed`。
    *   若 `DriverExecutionResult.status === 'failed'`，状态路由至 `failed`，并回写 `error` 状态和 Diagnostics。同时，利用 Driver 产生的最近一次有效 `Checkpoint`（包含机械快照与语义交接）进行无损的沙箱回滚。

### 5.3 Council 决策包合入授权限制 (RFC-C §4.7)
*   **严格防越权合入**：
    *   根据 RFC-C §4.7 规定，任何由 Council 决策包产生的 `DecisionPacket` 不得直接包含绕过人工确认的自动合并授权。
    *   在 MockDriver 返回的 mock 产物或 transcript 模拟在 Council 流程时，合并器验证的 `MergeAuthorization.authorized` 在第一阶段将默认置为 `false` / `pending_human`，直至人工通过 D 方向的 `human_approval_wait` 门禁后，才转化为 `authorized` 传递给合并器进行试合并。

---

## 6. 能力拆分与第一阶段接入矩阵

在架构的顶层设计中，我们明确了哪些部分是原生 ACP 规范、哪些属于特定 Agent Adapter、哪些在第一阶段仅保留接口骨架：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Upper Workflow / Coordinator                    │
└────────────────────────────────────────────────────────────────────────┘
                                    │ execute(DriverExecutionInput)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Unified Driver Layer                          │
│                                                                        │
│   ┌────────────────────┐ ┌────────────────────┐ ┌──────────────────┐   │
│   │     MockDriver     │ │  AcpDriver (Real)  │ │   PTY Fallback   │   │
│   │   (MVP - Phase 1)  │ │ (Interface - Stub) │ │(Interface - Stub)│   │
│   └────────────────────┘ └────────────────────┘ └──────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

| 功能项 | 职能拆分归属 | 第一阶段验收标准 (Phase 1 Acceptance) |
| :--- | :--- | :--- |
| **模拟成功/失败结果路由** | `MockDriver` (方向 A) | **完全交付。** 能够通过 prompt 输入区分 success/failed，并结构化交付补丁、审计与诊断。 |
| **标准事件及多级决策网关**| `Hook/Gate Layer` (方向 D) | **完全交付。** 44+ 类事件、标准 12 类 Gate 已完全在 `HookPoint` 和 `GatePoint` 契约中建立。 |
| **可寻址产物登记消费** | `Coordination Store` (方向 C) | **完全交付。** Driver 交付的标准产物引用规范（artifact://...）可在 SQLite 表及测试层流畅对齐。 |
| **真实 PTY 终端字节流适配** | `PTY Driver Fallback` (方向 A) | **接口骨架保留。** 核心类型与 `AgentConnection` 接口已对齐，当前阶段不作为验收阻断。 |
| **真实 ACP JSON-RPC 握手适配**| `ACP Native Connection` (方向 A)| **接口骨架保留。** 基础客户端功能可用，长程长任务实机握手保留扩展骨架。 |
| **位置偏置/裁判画像不一致诊断**| `Council Diagnostics` (方向 C) | **接口骨架保留。** 已定义在 `DiagnosticInfo` 和事件流中，真实消融检测后续集成。 |

---

## 7. 契约符合度与本地验证报告

项目已通过严格的本地自动化构建和测试套件（`tests/driver.test.ts`）验证，测试覆盖率与类型契约完全符合各方向 RFC 标准：

```bash
# 1. 编译验证，确认 TypeScript 类型符合契约
npm run build
npm run build:test

# 2. 运行验证测试，确认执行结果符合 Spec 约束
node dist/tests/driver.test.js
```

**测试套件执行日志**：
```text
==================================================
Testing MockDriver & RFC Contracts...
==================================================
SUCCESS: Uninitialized execute correctly threw error: Driver not initialized. Please call initialize() first.
SUCCESS: Driver initialized successfully.

Success execution result status: success
SUCCESS: Received success status.
SUCCESS: Created 2 artifacts.
   Artifact ID: art-patch-task-001, Type: patch, Path: patches/mock-change.patch
   Artifact ID: art-transcript-task-001, Type: transcript, Path: transcripts/mock-run.json
SUCCESS: Created 1 diagnostics.
   Diagnostic [info] (sandbox): Mock execution completed successfully in virtual sandbox.

Failed execution result status: failed
SUCCESS: Received failed status.
SUCCESS: Diagnostics length: 1
   Diagnostic [error] (agent): Compilation failed on line 12: Cannot find name 'UndefinedSymbol'.
SUCCESS: Error state: {"code":"UNEXPECTED","message":"Mock execution simulated a failure as requested by the test prompt."}

SUCCESS: Driver shut down successfully.
==================================================
All MockDriver tests passed successfully!
==================================================
```
确认所有的 `AcpDriver` 契约结构体、`MockDriver` 实现及 `HookPoint`/`GatePoint` 扩展已就绪。
