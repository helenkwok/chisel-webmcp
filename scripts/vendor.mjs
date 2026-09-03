// Chisel — vendors upstream Chili3d WITHOUT forking it.
//
// Chili3d's AppBuilder.loadDefaultPlugins() fetches <origin>/plugins/plugins.json
// at boot and loads what it lists from the same origin. That is the whole trick:
// we never modify an upstream file, we just add ours to the built output.
//
// MIT licensed. See LICENSE.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VENDOR = resolve(ROOT, ".vendor/chili3d");

/** Pinned so the deployed bundle is reproducible and the AGPL Corresponding Source is exact. */
const UPSTREAM = "https://github.com/xiangechen/chili3d.git";
const PINNED_COMMIT = "c5b8047ca44e72b6abc3d9e16d05aff109a48092";

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

if (!existsSync(VENDOR)) {
    mkdirSync(resolve(ROOT, ".vendor"), { recursive: true });
    run(`git clone ${UPSTREAM} ${VENDOR}`, ROOT);
}
run(`git fetch --all`, VENDOR);
run(`git checkout ${PINNED_COMMIT}`, VENDOR);
run("npm install", VENDOR);

// Build our plugin against upstream's workspace, then place it in the output tree.
const pluginSrc = resolve(ROOT, "plugins/webmcp");
const pluginInVendor = resolve(VENDOR, "plugins/webmcp");
cpSync(pluginSrc, pluginInVendor, { recursive: true });
run(`${resolve(VENDOR, "node_modules/.bin/rspack")} build`, pluginInVendor);

// Upstream copies /public into /dist verbatim, so dropping our files there is
// enough — and touches nothing upstream owns.
const pubPlugins = resolve(VENDOR, "public/plugins");
mkdirSync(resolve(pubPlugins, "webmcp/dist"), { recursive: true });
writeFileSync(resolve(pubPlugins, "plugins.json"), JSON.stringify({ plugins: ["webmcp"] }, null, 4));
cpSync(resolve(pluginSrc, "manifest.json"), resolve(pubPlugins, "webmcp/manifest.json"));
cpSync(resolve(pluginInVendor, "dist/main.js"), resolve(pubPlugins, "webmcp/dist/main.js"));

run("npm run build", VENDOR);
cpSync(resolve(VENDOR, "dist"), resolve(ROOT, "dist"), { recursive: true });

console.log("\n✓ Bundle ready in ./dist — upstream Chili3d unmodified, Chisel plugin added.");
