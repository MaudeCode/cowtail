import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const store = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "cowtail",
  errorMessage: "Cowtail channel runtime not initialized",
});

export const setCowtailRuntime = store.setRuntime;
export const getCowtailRuntime = store.getRuntime;
