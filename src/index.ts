import dotenv from "dotenv";
dotenv.config();

export { AcpClientBuilder } from "./client/builder.js";
export { AcpClient, ClientState } from "./client/acp-client.js";
export { ADAPTER_REGISTRY } from "./adapter/registry.js";
export { ClientMethodRouter } from "./client-methods/router.js";
export { ClientMethodHandler } from "./client-methods/interface.js";
export { FileSystemHandler } from "./client-methods/filesystem-handler.js";
export { PermissionHandler } from "./client-methods/permission-handler.js";
export { TerminalHandler } from "./client-methods/terminal-handler.js";
export * from "./hook-gate/interface.js";

// Driver exports
export * from "./driver/interface.js";
export { MockDriver } from "./driver/mock-driver.js";

