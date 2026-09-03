// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// The plugin entry point. Chili3d's AppBuilder.loadDefaultPlugins() fetches
// <origin>/plugins/plugins.json at boot and loads everything listed there from
// the SAME ORIGIN, which is why this needs no user interaction and no trust
// dialog — and why upstream Chili3d needs no modification at all to host it.

import type { Plugin } from "@chili3d/core";
import { WebMcpService } from "./service";

const ChiselWebMcpPlugin: Plugin = {
    services: [new WebMcpService()],
};

export default ChiselWebMcpPlugin;
