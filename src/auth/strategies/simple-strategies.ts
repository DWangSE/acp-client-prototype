import { AuthStrategy, AuthCredential } from "../interface.js";

export class NoneStrategy implements AuthStrategy {
  readonly type = "none";
  async execute(): Promise<AuthCredential | null> {
    return null;
  }
}

export class PreConfiguredStrategy implements AuthStrategy {
  readonly type = "pre-configured";
  async execute(): Promise<AuthCredential | null> {
    return null;
  }
}
