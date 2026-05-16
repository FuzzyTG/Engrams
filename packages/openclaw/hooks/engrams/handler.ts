import { injectEngramsContext } from "../../src/bootstrap.js";

type PluginConfig = Record<string, unknown>;

type HookEvent = {
  type?: string;
  action?: string;
  context?: {
    bootstrapFiles?: Array<{ path: string; content: string }>;
    agentId?: string;
    cfg?: {
      plugins?: {
        entries?: Record<string, { config?: PluginConfig }>;
      };
    };
  };
};

function resolvePluginConfig(event: HookEvent): PluginConfig | undefined {
  return event.context?.cfg?.plugins?.entries?.engrams?.config;
}

export default async function handler(event: HookEvent): Promise<void> {
  if (event.type !== "agent" || event.action !== "bootstrap") return;

  const context = event.context;
  if (!context) return;

  const pluginConfig = resolvePluginConfig(event);

  await injectEngramsContext(context, pluginConfig);
}
