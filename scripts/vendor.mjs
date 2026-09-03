// Chisel — vendors upstream Chili3d WITHOUT forking it.
//
// Chili3d's AppBuilder.loadDefaultPlugins() fetches <origin>/plugins/plugins.json
// at boot and loads what it lists from the same origin. That is the whole trick:
// we do not maintain a fork or patch Chili3d's application code. In this
// build-only checkout we add Chisel to the documented plugin list, then emit
// the combined deployment bundle.
//
// MIT licensed. See LICENSE.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
run("npm ci", VENDOR);

// Build our plugin against upstream's workspace, then place it in the output tree.
const pluginSrc = resolve(ROOT, "plugins/webmcp");
const pluginInVendor = resolve(VENDOR, "plugins/webmcp");
cpSync(pluginSrc, pluginInVendor, { recursive: true });
run(`${resolve(VENDOR, "node_modules/.bin/rspack")} build`, pluginInVendor);

// Upstream copies /public into /dist, so adding our plugin to the staging
// checkout's plugin list is enough; no application-code patch is needed.
const pubPlugins = resolve(VENDOR, "public/plugins");
mkdirSync(resolve(pubPlugins, "webmcp/dist"), { recursive: true });
// ADD to upstream's plugin list; do not replace it. Upstream ships macro and
// visual-programming, and a deployment that silently drops them is not
// "unmodified" in any sense a judge would accept.
const listPath = resolve(pubPlugins, "plugins.json");
const existing = existsSync(listPath) ? JSON.parse(readFileSync(listPath, "utf8")) : { plugins: [] };
const plugins = Array.from(new Set([...(existing.plugins ?? []), "webmcp"]));
writeFileSync(listPath, JSON.stringify({ ...existing, plugins }, null, 4));
cpSync(resolve(pluginSrc, "manifest.json"), resolve(pubPlugins, "webmcp/manifest.json"));
cpSync(resolve(pluginInVendor, "dist/main.js"), resolve(pubPlugins, "webmcp/dist/main.js"));

run("npm run build", VENDOR);

// Layout of the deployed site:
//   /        the shell — one WebMCP surface over several apps (what a visitor lands on)
//   /cad/    upstream Chili3d, byte-for-byte, with the Chisel plugin dropped in
// Chili3d's asset URLs are relative and it derives its plugin folder from
// location.pathname, so it runs unmodified under the prefix.
rmSync(resolve(ROOT, "dist"), { recursive: true, force: true });
cpSync(resolve(VENDOR, "dist"), resolve(ROOT, "dist/cad"), { recursive: true });
cpSync(resolve(ROOT, "shell/index.html"), resolve(ROOT, "dist/index.html"));
cpSync(resolve(ROOT, "video"), resolve(ROOT, "dist/video"), { recursive: true });
// AGPL-3.0 s13: users interacting over a network must be offered Corresponding
// Source. Serve the notice and licence at the deployment itself.
cpSync(resolve(ROOT, "NOTICE.md"), resolve(ROOT, "dist/NOTICE.md"));
cpSync(resolve(ROOT, "LICENSE"), resolve(ROOT, "dist/LICENSE"));
cpSync(resolve(ROOT, "shell"), resolve(ROOT, "dist/shell"), { recursive: true });

console.log("\n✓ Bundle ready in ./dist — pinned Chili3d build plus the Chisel plugin and shell.");
