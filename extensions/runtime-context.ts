import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectRuntime, runtimeContext } from "../lib/detect-runtime.mjs";

// Session-only prompt context: no commands, connections, credential issuance, or saved state.
export default function runtimeEnvironmentContext(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const context = runtimeContext(detectRuntime());
		if (event.systemPromptOptions) {
			event.systemPromptOptions.sections.runtime_environment = context;
		} else {
			// Compatibility for older Pi hosts that expose only the rendered prompt.
			return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
		}
	});
	pi.registerCommand("runtime-host", {
		description: "Show concise runtime, multiplexer, and controller/worker identity",
		handler: async (_args, ctx) => {
			ctx.ui.notify(runtimeContext(detectRuntime()), "info");
		},
	});
}
