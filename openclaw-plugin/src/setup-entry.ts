import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { cowtailChannelPlugin } from "./channel.js";

export default defineSetupPluginEntry(cowtailChannelPlugin);
