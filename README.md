# Chisel — agentic browser CAD over WebMCP

**A real solid-modelling CAD kernel in a browser tab, whose modelling verbs are registered as
[WebMCP](https://github.com/webmachinelearning/webmcp) tools — so an AI agent can build
manufacturable geometry by conversation.**

Ask it for *"a mounting bracket 80×40×5mm with two 6mm holes"* and it doesn't nudge a mesh
around. It calls an OpenCascade B-rep kernel: `create_box`, `create_cylinder`, `boolean_cut` —
and the result is a genuine solid you can export as STEP.

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/).

---

## ⚠️ What is new work, and what is not

**This repository contains only new work, authored on 2026-09-03, inside the submission period.**
Per the challenge rules (Section 4), here is the boundary, stated plainly:

| | |
|---|---|
| **Written by us, new, in this repo** | The entire WebMCP integration: `plugins/webmcp/` and `shell/` — 15 CAD tools, the registration-boundary gate, the human confirm seam, exact STEP export, the activity panel, the framed-app bridge, and a shell that merges tools from multiple web apps into one agent surface. |
| **NOT ours — third-party open source** | The CAD application itself: [**Chili3d**](https://github.com/xiangechen/chili3d) by xiangechen (AGPL-3.0), which supplies the OpenCascade 8.0.0 WASM kernel, the Three.js viewport, IndexedDB persistence and STEP/IGES/BREP/STL export. |

**We did not write the CAD kernel and we do not claim to.** What we built is the agent surface for
one — which is the thing this hackathon is about.

**We did not maintain a fork or patch Chili3d's application code.** Chili3d's `AppBuilder` already
fetches `<origin>/plugins/plugins.json` at boot and loads what it lists from the same origin.
`scripts/vendor.mjs` checks out a pinned upstream commit in a build-only staging directory, adds
our plugin to that documented plugin list, and produces the combined deployable bundle.

```
chisel-webmcp/                  ← this repo: 100% new work
  plugins/webmcp/src/
    gate.ts                     ← the registration boundary (read this one first)
    service.ts                  ← registers tools; owns the confirm dialog
    bridge.ts                   ← publishes a framed app's tools to a same-origin shell
    activityPanel.ts            ← visible audit trail for agent calls and approvals
    tools/read.ts               ← 6 read tools
    tools/write.ts              ← 8 named write tools, one shared operation core
    tools/export.ts             ← gated STEP/IGES/BREP/STL/OBJ download
  shell/index.html              ← merges the CAD tools with shell-owned tools
  scripts/vendor.mjs            ← pins upstream and builds the combined bundle

deployed bundle:
  dist/                         ← the pinned Chili3d build plus Chisel integration
  dist/plugins/webmcp/          ← our plugin, auto-loaded at boot
  dist/shell/                   ← the multi-app WebMCP shell
```

---

## The tools

The CAD app exposes **15 tools**: six read tools, eight named modelling tools, and one gated export
tool. The optional
[`/shell/`](https://chisel-webmcp.helenkwok.workers.dev/shell/) adds two shell-owned read tools,
giving the top-level agent one 17-tool surface across two apps.

| Tool | |
|---|---|
| `chisel_get_document_info` | Document name, object count, breakdown by kind, kernel, units |
| `chisel_get_scene_tree` | Full object hierarchy with ids |
| `chisel_get_selection` | What the human has selected — resolves "this one" into an id |
| `chisel_query_objects` | Find objects by name substring / kind |
| `chisel_get_object` | Detail for one object: bounding box, size, transform, material |
| `chisel_get_change_log` | Recent undo history — lets the agent verify its own work |
| `chisel_create_box` | Create a rectangular B-rep solid |
| `chisel_create_cylinder` | Create a cylindrical B-rep solid |
| `chisel_create_sphere` | Create a spherical B-rep solid |
| `chisel_boolean_cut` | Subtract one or more solids from a target |
| `chisel_boolean_union` | Fuse solids into one result |
| `chisel_move` | Translate an object in millimetres |
| `chisel_delete` | Remove one or more objects |
| `chisel_undo` | Retract the most recent document change |
| `chisel_export` | Download STEP, IGES, BREP, STL or OBJ and report what the file contains |

## Why every consequential tool shares one gate

WebMCP has **no consent primitive, no user-activation requirement**, and `readOnlyHint` is
advisory — an agent may ignore it. The spec's own words: agents *"must assume good faith from
site developers."* Whatever safety a WebMCP page has, the page author builds.

So three deliberate choices, all in [`plugins/webmcp/src/gate.ts`](plugins/webmcp/src/gate.ts):

**1. Enforcement lives at the registration boundary, not in the handlers.**
WebMCP hands `registerTool` a function and the browser calls it. There is no authorization hook.
If you enforce per-handler, the eleventh tool someone adds is ungated until its author remembers
the line. So every registration goes through one wrapper, and there is deliberately no exported
path that registers a tool without it.

**2. Narrow tools are easier to call correctly.** An earlier version hid every operation behind a
single enum-driven dispatcher. That did not reduce authority — seven operations are still seven
operations — and it made tool selection less reliable. Named tools provide smaller schemas while
still funnelling every mutation through the same in-page approval dialog. Declining means the
handler *never runs* — not "runs and rolls back."

Export uses the same gate even though it does not change geometry: downloading a file is still a
consequence outside the page. The returned STEP summary checks the ISO-10303 envelope, schema,
solid count, and analytic surfaces instead of reporting success from a byte count alone.

**3. The affected count is honest.** An operation that changed nothing returns an **error**, never
a cheerful "done". This answers the spec's own stated threat — *"a tool can claim to be read-only
while changing data"* — and its mirror image, a tool that claims success while changing nothing.
An agent that is lied to compounds the lie.

And **tool output is capped at ~1500 characters with the truncation announced.** That is a
prompt-injection control, not cosmetics: a tool result is text the agent reads as context, and in
a CAD app that text derives from model content authored by whoever made the file — untrusted
third-party data. Silent truncation is worse than none, because the agent acts on half a picture
believing it whole.

## The multi-app shell

WebMCP tools belong to a document, and an agent talks to the top-level document. Chisel turns that
constraint into a composition primitive: a same-origin app frame publishes its catalogue to the
shell, the shell registers those verbs alongside its own, and calls are forwarded back to the
original app. The shell never receives an ungated CAD handler, so the confirmation UI remains in
the app that owns the model. Today the second app reports session and model statistics; the bridge
protocol is intentionally catalogue-driven so another app can join without the shell knowing its
tools at compile time.

---

## Two honest things about WebMCP

Worth saying out loud, because both are true and easy to get wrong:

- **WebMCP is not MCP on the wire.** The spec *"does not prescribe the format in which tools are
  exposed"*. An external MCP client — Claude Desktop, Cursor — **cannot** connect to a WebMCP page.
  It is an in-browser-agent surface, and claiming otherwise would be wrong.
- **It is a W3C Community Group draft, not a standard.** WebKit has filed *oppose*, Mozilla is
  *neutral*, the TAG review is open and labelled *"Missing: Multi-stakeholder support"*. Chrome and
  Edge are in origin trial. We think it's worth building on; we don't think it's settled.

### Three gotchas that cost us real time

1. **It is `document.modelContext`, NOT `navigator.modelContext`.** The `navigator` spelling and
   `provideContext()` are the mid-2025 shape, removed by
   [PR #184](https://github.com/webmachinelearning/webmcp/pull/184). Much training data still
   repeats them.
2. **There is no `unregisterTool()`.** You unregister by aborting an `AbortSignal` you passed in.
3. **The document must be origin-isolated, and it fails *silently* if not.** Worth checking before
   you build anything else — especially if your app sets COEP/COOP for WASM threading.

---

## Running it

```bash
npm run build      # fetch the pinned Chili3d commit and build the combined bundle
npm run preview    # serve dist/ on localhost:8080
```

Requires **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled, or the ChatGPT
desktop in-app browser. Without WebMCP the plugin degrades to a no-op and Chili3d works normally —
you'll see a badge saying so.

The direct CAD experience is at `/`; the multi-app composition demo is at `/shell/`.

## Licence

Our code is **MIT** (see [LICENSE](LICENSE)). A deployed bundle combining it with Chili3d is a
combined work governed by **AGPL-3.0**. Its Corresponding Source is this repository together with
the public Chili3d commit pinned in `scripts/vendor.mjs`.
