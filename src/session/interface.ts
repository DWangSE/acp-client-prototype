export interface SessionInfo {
  sessionId: string;
  cwd: string;
  agentId: string;
}

export interface SessionManager {
  createSession(agentId: string, cwd: string): Promise<SessionInfo>;
  getSession(sessionId: string): SessionInfo | undefined;
}
