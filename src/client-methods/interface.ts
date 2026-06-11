export interface ClientMethodHandler {
  handle(method: string, params: any): Promise<any>;
}
