import { SessionManager, SessionInfo } from "./interface.js";

export class MemorySessionStore implements SessionManager {
  private sessions = new Map<string, SessionInfo>();

  async createSession(agentId: string, cwd: string): Promise<SessionInfo> {
    const sessionId = `sess_${Math.random().toString(36).substring(7)}`;
    const info = { sessionId, cwd, agentId };
    this.sessions.set(sessionId, info);
    return info;
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }
}
