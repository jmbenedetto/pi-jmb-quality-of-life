#!/usr/bin/env node
// Read-only runtime signals. No credential values, host scanning, or network requests.
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';

function machineName(value) {
  return typeof value === 'string' && value.length <= 80 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value) ? value : 'unknown';
}

// Controller identity must come from explicit launcher metadata supplied by the caller.
// Loopback endpoints and SSH client addresses do not establish controller-machine identity.
export function detectRuntime(env = process.env, machines = {}) {
  let endpoint = false;
  try {
    const url = new URL(env.T3_MCP_URL || '');
    endpoint = ['http:', 'https:'].includes(url.protocol) && url.pathname === '/mcp'
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { /* No valid T3 bridge URL. */ }
  const authenticatedBridge = endpoint && Boolean(env.T3_MCP_BEARER_TOKEN?.trim());
  const pi = Boolean(env.PI_CODING_AGENT || env.PI_SESSION_ID || env.T3_PI_MCP_EXTENSION_PATH);
  const t3Terminal = env.TERM_PROGRAM === 't3code';
  const t3 = authenticatedBridge || t3Terminal;
  const cmux = Boolean(env.CMUX_WORKSPACE_ID && (env.CMUX_SOCKET_PATH || env.CMUX_SURFACE_ID));
  const tmux = Boolean(env.TMUX);
  const herdr = env.HERDR_ENV === '1';
  const environments = [...(t3 ? ['t3-code'] : []), ...(cmux ? ['cmux'] : []),
    ...(tmux ? ['tmux'] : []), ...(herdr ? ['herdr'] : [])];
  return {
    host: environments[0] || 'standalone',
    environments,
    agentRuntime: pi ? 'pi' : 'unknown',
    workerMachine: machineName(machines.worker ?? hostname()),
    controllerMachine: machineName(machines.controller ?? env.PI_JMB_CONTROLLER_HOST),
    t3,
    t3RpcAvailable: authenticatedBridge,
    evidence: [
      ...(authenticatedBridge ? ['T3_MCP_URL + credential present (value withheld)'] : []),
      ...(t3Terminal ? ['TERM_PROGRAM=t3code'] : []),
      ...(cmux ? ['CMUX workspace + surface/socket present'] : []),
      ...(tmux ? ['TMUX present'] : []),
      ...(herdr ? ['HERDR_ENV=1'] : []),
    ],
    nestedTerminals: [...(cmux ? ['cmux'] : []), ...(tmux ? ['tmux'] : [])],
  };
}

export function runtimeContext(runtime) {
  const environments = runtime.environments.length ? runtime.environments.join('+') : 'standalone';
  const identity = `Runtime: ${runtime.agentRuntime}; environment: ${environments}; worker: ${runtime.workerMachine}; controller: ${runtime.controllerMachine}.`;
  return identity + (runtime.environments.length ? ' Use multiplexer-interaction for terminal work.' : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const result = detectRuntime();
  console.log(process.argv.includes('--context') ? runtimeContext(result) : JSON.stringify(result, null, 2));
}
