import dotenv from "dotenv";
dotenv.config();

export { AcpClientBuilder, ConnectionFactory } from "./client/builder.js";
export { AcpClient, ClientState, AcpClientOptions } from "./client/acp-client.js";
export { ADAPTER_REGISTRY } from "./driver-adapter/registry.js";
export { AgentAdapter } from "./driver-adapter/interface.js";
export {
  AgentConnection,
  ConnectionEvent,
  ConnectionOptions,
  ConnectionType,
  InitializeResult,
  SessionRecord,
  TurnController,
} from "./connection/interface.js";
export {
  PtyOutputParser,
  PtyParserContext,
  PtyParserResult,
  PtyStream,
  PtyTurnResult,
} from "./connection/pty-parser.js";
export { AuthLayer } from "./auth/auth-layer.js";
export { AuthCredential, AuthExecutor, AuthStrategy, AuthStrategyType } from "./auth/interface.js";
export { MemorySessionStore } from "./session/memory-session-store.js";
export { SessionInfo, SessionManager } from "./session/interface.js";
export { ClientMethodRouter } from "./client-methods/router.js";
export { ClientMethodHandler } from "./client-methods/interface.js";
export { FileSystemHandler } from "./client-methods/filesystem-handler.js";
export { PermissionHandler } from "./client-methods/permission-handler.js";
export { TerminalHandler } from "./client-methods/terminal-handler.js";
export * from "./hook-gate/interface.js";

// Driver exports
export * from "./driver/interface.js";
export { MockDriver } from "./driver/mock-driver.js";
