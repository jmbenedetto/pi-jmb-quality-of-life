// Offline integration proof against the installed Pi SDK. No real model or credentials.
// Usage: node tests/startup-proof.mjs <pi-package-root> <repo-owned-scratch-dir>
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
const [rootArg, scratchArg] = process.argv.slice(2);
if (!rootArg || !scratchArg) throw new Error('Expected installed Pi package root and repository-owned scratch directory.');
const root = resolve(rootArg), scratch = resolve(scratchArg);
await mkdir(scratch, { recursive: true });
const { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager, ModelRuntime } = await import(pathToFileURL(join(root, 'dist/index.js')));
const aiRoot = join(dirname(root), 'pi-ai');
const { getModel } = await import(pathToFileURL(join(aiRoot, 'dist/compat.js')));
const { AssistantMessageEventStream } = await import(pathToFileURL(join(aiRoot, 'dist/utils/event-stream.js')));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const settings = SettingsManager.inMemory({ packages: [packageRoot], compaction: { enabled: false }, retry: { enabled: false } });
const modelRuntime = await ModelRuntime.create({ authPath: join(scratch, 'test-auth.json'), modelsPath: null,
  modelsStorePath: join(scratch, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
await modelRuntime.setRuntimeApiKey('anthropic', 'offline-test-only-not-a-real-key');
const model = getModel('anthropic', 'claude-sonnet-4-5');
assert.ok(model, 'Static test model must exist; it is never contacted.');
const keys = ['T3_MCP_URL', 'T3_MCP_BEARER_TOKEN', 'T3CODE_HOME', 'T3CODE_HOST', 'T3_BOOT_SERVICE_UNIT', 'TERM_PROGRAM',
  'CMUX_WORKSPACE_ID', 'CMUX_SURFACE_ID', 'CMUX_SOCKET_PATH', 'TMUX', 'HERDR_ENV', 'PI_CODING_AGENT', 'PI_JMB_CONTROLLER_HOST'];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const proof = [];
try {
  for (const scenario of ['t3', 'cmux', 'tmux', 'herdr', 'standalone-with-t3-installed']) {
    for (const key of keys) delete process.env[key];
    process.env.PI_CODING_AGENT = '1';
    process.env.T3CODE_HOME = '/fixture/t3-installed';
    process.env.T3CODE_HOST = '127.0.0.1';
    if (scenario === 't3') {
      process.env.T3_MCP_URL = 'http://127.0.0.1:3773/mcp';
      process.env.T3_MCP_BEARER_TOKEN = 'offline-bridge-secret-not-a-real-token';
    } else if (scenario === 'cmux') {
      process.env.CMUX_WORKSPACE_ID = 'fixture-workspace';
      process.env.CMUX_SURFACE_ID = 'fixture-surface';
    } else if (scenario === 'tmux') {
      process.env.TMUX = '/fixture/socket,123,0';
    } else if (scenario === 'herdr') {
      process.env.HERDR_ENV = '1';
    }
    const loader = new DefaultResourceLoader({ cwd: scratch, agentDir, settingsManager: settings,
      noPromptTemplates: true, noThemes: true });
    await loader.reload();
    const resources = loader.getExtensions();
    assert.deepEqual(resources.errors, [], 'Auto-discovered startup extension must load cleanly.');
    for (const name of ['cleanup-agent-tmp.ts', 'path-length-guard.ts', 'runtime-context.ts']) {
      assert.ok(resources.extensions.some(extension => extension.path === join(packageRoot, 'extensions', name)),
        `Package manifest must discover ${name}.`);
    }
    assert.equal(resources.extensions.filter(extension => extension.commands.has('runtime-host')).length, 1,
      'Retired standalone hook must not register a duplicate runtime command.');
    const { session } = await createAgentSession({ cwd: scratch, agentDir, model, modelRuntime,
      resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(scratch), tools: [] });
    try {
      let calls = 0;
      session.agent.streamFunction = (currentModel, context) => {
        calls++;
        const serialized = JSON.stringify(context);
        const hint = serialized.match(/Runtime: [^"\n]+/)?.[0];
        assert.ok(hint, 'Concise context must be present on the first model request.');
        const environment = scenario === 't3' ? 't3-code' : scenario.startsWith('standalone') ? 'standalone' : scenario;
        assert.ok(hint.includes(`environment: ${environment};`));
        assert.ok(hint.includes('worker: ') && hint.includes('controller: unknown.'));
        assert.equal(hint.includes('Use multiplexer-interaction'), environment !== 'standalone');
        assert.ok(hint.length < 250);
        assert.ok(!serialized.includes('offline-bridge-secret-not-a-real-token'));
        assert.ok(serialized.includes('Session temporary files') && serialized.includes('Each agent and subagent'),
          'Runtime context must coexist with the package cleanup guidance.');
        const message = { role: 'assistant', content: [{ type: 'text', text: 'Offline startup proof passed.' }],
          api: currentModel.api, provider: currentModel.provider, model: currentModel.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop', timestamp: Date.now() };
        const stream = new AssistantMessageEventStream();
        queueMicrotask(() => { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: 'stop', message }); });
        return stream;
      };
      await session.prompt('Test the startup instructions without calling a real model.');
      assert.equal(calls, 1);
      assert.equal(session.getLastAssistantText(), 'Offline startup proof passed.');
      await session.prompt('/runtime-host');
      assert.equal(calls, 1, 'Diagnostic command must be handled without another model request.');
      proof.push({ scenario, packageManifestDiscovered: true, cleanupGuidancePreserved: true, firstModelRequestVerified: true,
        diagnosticCommandVerified: true, networkModelCalls: 0 });
    } finally { session.dispose(); }
  }
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log(JSON.stringify({ piStartup: proof, packageRoot }, null, 2));
