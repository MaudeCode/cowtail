import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { cowtailChannelPlugin } from "./channel.js";
import { cowtailChannelConfigSchema } from "./config-schema.js";
import { setCowtailRuntime } from "./runtime.js";

export default defineChannelPluginEntry({
  id: "cowtail",
  name: "Cowtail",
  description: "Cowtail mobile realtime channel for OpenClaw",
  plugin: cowtailChannelPlugin,
  configSchema: cowtailChannelConfigSchema,
  setRuntime: setCowtailRuntime,
});

export { cowtailChannelPlugin };
