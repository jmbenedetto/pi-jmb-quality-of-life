export interface RuntimeIdentity {
  host: string;
  environments: string[];
  agentRuntime: string;
  workerMachine: string;
  controllerMachine: string;
  t3: boolean;
  t3RpcAvailable: boolean;
  evidence: string[];
  nestedTerminals: string[];
}
export function detectRuntime(
  env?: Record<string, string | undefined>,
  machines?: { worker?: string; controller?: string },
): RuntimeIdentity;
export function runtimeContext(runtime: RuntimeIdentity): string;
