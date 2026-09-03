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
| **Written by us, new, in this repo** | The entire WebMCP layer: `plugins/webmcp/` — the tool catalogue, the JSON Schemas, the registration-boundary gate, the human confirm seam, the output cap, the honest affected count. ~600 lines. |
| **NOT ours — third-party open source** | The CAD application itself: [**Chili3d**](https://github.com/xiangechen/chili3d) by xiangechen (AGPL-3.0), which supplies the OpenCascade 8.0.0 WASM kernel, the Three.js viewport, IndexedDB persistence and STEP/IGES/BREP/STL export. |

**We did not write the CAD kernel and we do not claim to.** What we built is the agent surface for
one — which is the thing this hackathon is about.

**We did not fork Chili3d either.** Not one upstream file is modified. Chili3d's `AppBuilder`
already fetches `<origin>/plugins/plugins.json` at boot and loads what it lists from the same
origin, so Chisel is a genuine drop-in: `scripts/vendor.mjs` clones upstream at a pinned commit,
builds it untouched, and copies our plugin into the output tree.

```
chisel-webmcp/                  ← this repo: 100% new work
  plugins/webmcp/src/
    gate.ts                     ← the registration boundary (read this one first)
    service.ts                  ← registers tools; owns the confirm dialog
    tools/read.ts               ← 6 read tools
    tools/write.ts              ← 1 gated write tool
  scripts/vendor.mjs            ← pins + builds upstream Chili3d, unmodified

deployed bundle:
  dist/                         ← upstream Chili3d, byte-for-byte
  dist/plugins/webmcp/          ← our plugin, auto-loads at boot
```

---

## The tools

Six read tools and **exactly one** write tool.

| Tool | |
|---|---|
| `chisel_get_document_info` | Document name, object count, breakdown by kind, kernel, units |
| `chisel_get_scene_tree` | Full object hierarchy with ids |
| `chisel_get_selection` | What the human has selected — resolves "this one" into an id |
| `chisel_query_objects` | Find objects by name substring / kind |
| `chisel_get_object` | Detail for one object: bounding box, size, transform, material |
| `chisel_get_change_log` | Recent undo history — lets the agent verify its own work |
| **`chisel_apply_operation`** | **The only tool that can change anything.** `create_box`, `create_cylinder`, `create_sphere`, `boolean_cut`, `boolean_union`, `move`, `delete` |

## Why one write tool instead of ten

WebMCP has **no consent primitive, no user-activation requirement**, and `readOnlyHint` is
advisory — an agent may ignore it. The spec's own words: agents *"must assume good faith from
site developers."* Whatever safety a WebMCP page has, the page author builds.

So three deliberate choices, all in [`plugins/webmcp/src/gate.ts`](plugins/webmcp/src/gate.ts):

**1. Enforcement lives at the registration boundary, not in the handlers.**
WebMCP hands `registerTool` a function and the browser calls it. There is no authorization hook.
If you enforce per-handler, the eleventh tool someone adds is ungated until its author remembers
the line. So every registration goes through one wrapper, and there is deliberately no exported
path that registers a tool without it.

**2. One write verb, one confirm.** Every mutation an agent can perform passes the same in-page
approval dialog, which shows the exact call. Declining means the handler *never runs* — not "runs
and rolls back". Ten open write verbs would be a larger surface and less judgement.

**3. The affected count is honest.** An operation that changed nothing returns an **error**, never
a cheerful "done". This answers the spec's own stated threat — *"a tool can claim to be read-only
while changing data"* — and its mirror image, a tool that claims success while changing nothing.
An agent that is lied to compounds the lie.

And **tool output is capped at ~1500 characters with the truncation announced.** That is a
prompt-injection control, not cosmetics: a tool result is text the agent reads as context, and in
a CAD app that text derives from model content authored by whoever made the file — untrusted
third-party data. Silent truncation is worse than none, because the agent acts on half a picture
believing it whole.

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
npm run vendor     # clones + builds upstream Chili3d at a pinned commit
npm run build      # builds the plugin and drops it into the bundle
npm run preview    # serve dist/ and open it
```

Requires **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled, or the ChatGPT
desktop in-app browser. Without WebMCP the plugin degrades to a no-op and Chili3d works normally —
you'll see a badge saying so.

## Licence

Our code is **MIT** (see [LICENSE](LICENSE)). A deployed bundle combining it with Chili3d is a
combined work governed by **AGPL-3.0**, whose Corresponding Source is this repository plus
unmodified upstream Chili3d at the commit pinned in `scripts/vendor.mjs`. Both are public.
