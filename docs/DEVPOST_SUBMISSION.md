# Devpost submission draft — Chisel

Paste-ready. Fields match the WebMCP Challenge submission form.

## Project

**Title:** Chisel

**Tagline:** Give an AI agent a real CAD kernel — solid modelling in the browser over WebMCP.

**Built with:** WebMCP (`document.modelContext`), Chili3d, OpenCascade (OCCT 8.0.0) via
WebAssembly, Three.js, TypeScript, Rspack, IndexedDB, Cloudflare Workers

**Live URL:** https://chisel-webmcp.helenkwok.workers.dev/shell/

**Repository:** https://github.com/helenkwok/chisel-webmcp  (MIT)

---

## Short description

Chisel exposes a real B-rep CAD kernel to in-browser AI agents through WebMCP. Ask for "a mounting
bracket 80×40×5mm with two 6mm holes" and the agent calls OpenCascade directly — `create_box`,
`create_cylinder`, `boolean_cut` — producing a genuine solid it can export as STEP. Seventeen CAD
tools, a single registration-boundary gate for every consequential action, and a shell that
composes multiple web apps into one 19-tool agent surface.

---

## Full description

### Inspiration

WebMCP's own explainer opens with the problem that agents drive web apps by scraping and clicking
the DOM, which is brittle and lossy. Most demos answer that with a to-do list or a shopping cart —
apps where DOM-driving mostly works anyway, so the argument stays theoretical.

A 3D CAD viewport makes it concrete. There is no DOM for a solid. You cannot click your way to a
boolean subtraction, and no amount of accessibility-tree scraping tells an agent the volume of a
part. If WebMCP is right about anything, it is right here.

### What it does

Chisel registers 17 tools on `document.modelContext` inside a working browser CAD application:

**Six read tools** — `chisel_get_document_info`, `chisel_get_scene_tree`, `chisel_get_selection`,
`chisel_query_objects`, `chisel_get_object`, `chisel_get_change_log`. These let an agent inspect
the model: hierarchy, ids, real bounding boxes, what the human currently has selected (so "this
one" resolves to something), and the undo history so it can verify its own work.

**Eight narrowly scoped write tools** — create box, cylinder and sphere; boolean cut and union;
move; delete; and undo. Small schemas make calls more reliable, while every write still passes
through the same registration-boundary gate and exact-call approval dialog.

**Two finishing tools** — `chisel_fillet` and `chisel_chamfer` round or bevel the exact B-rep
edges in OpenCascade. The agent can verify the result numerically because object inspection also
returns volume and surface area, not only a success string.

**One export tool** — `chisel_export` downloads STEP, IGES, BREP, STL or OBJ through that same gate.
For STEP it reports the ISO-10303 validity envelope, schema, B-rep solid count, and analytic plane
and cylinder counts, so the agent can verify that it produced exact CAD geometry rather than a
mesh with a `.step` extension.

The `/shell/` route demonstrates a second WebMCP idea: composition. Because agents talk to the
top-level document, the framed CAD app publishes its tool catalogue to a same-origin shell. The
shell registers those 17 verbs alongside two of its own — connected-app discovery and session
statistics — then forwards CAD calls back to the app that owns the model and its consent UI.

The result is a real solid: OpenCascade B-rep geometry, persisted to IndexedDB so it survives a
reload, exportable as STEP, IGES, BREP or STL. The agent produces a manufacturable file, not a
mesh that looks like one.

### How we built it

Chili3d's `AppBuilder` already fetches `<origin>/plugins/plugins.json` at boot and loads what it
lists from the same origin. We maintain no fork and patch none of Chili3d's application code.
`scripts/vendor.mjs` checks out a pinned upstream commit in a build-only staging directory, adds
our plugin to the documented plugin list, and emits the combined deployable bundle.

Chili3d's `PluginManager` calls `service.register(app)` then `service.start()` on load, which is
the only hook that hands a plugin the live `IApplication` at boot. The entire WebMCP surface hangs
off that one service.

### Why every consequential tool shares one gate

This is the design decision we'd most like judged.

WebMCP has **no registration-boundary authorization hook**. You hand `registerTool` a function and
the browser calls it. There is no consent primitive, no user-activation requirement, and
`readOnlyHint` is advisory — an agent may ignore it. The spec's own words: agents *"must assume
good faith from site developers."* Every safety property a WebMCP page has, its author builds.

So:

1. **Enforcement lives at the registration boundary, not in handlers.** If you enforce per-handler,
   the eleventh tool someone adds is ungated until its author remembers the line. Every
   registration goes through one wrapper and there is deliberately no exported path around it.
2. **Named verbs improve agent reliability without expanding authority.** An operation enum is not
   a sandbox; seven operations behind one dispatcher are still seven operations. Small schemas are
   easier for models to call correctly, while every mutation still passes the same approval path.
   Declining means the handler *never runs* — not "runs and rolls back."
3. **The affected count is honest.** An operation that changed nothing returns an **error**, never
   a cheerful "done". This answers the spec's own stated threat — *"a tool can claim to be
   read-only while changing data"* — and its mirror image: a tool claiming success while changing
   nothing. An agent that is lied to compounds the lie.
4. **Output is capped at ~1500 characters and the truncation is announced.** That's a
   prompt-injection control, not cosmetics. Tool results are text the agent reads as context, and
   in a CAD app that text derives from a file authored by someone else — untrusted third-party
   data. Silent truncation is worse than none, because the agent acts on half a picture believing
   it whole.

### Challenges

**The API moved and most sources are wrong.** It is `document.modelContext`, **not**
`navigator.modelContext`. The `navigator` spelling and `provideContext()` are the mid-2025 shape,
removed by webmcp PR #184 — and a great deal of training data and blog content still repeats them.

**Silent failure on origin isolation.** WebMCP requires an origin-isolated document and simply
isn't there if you don't have one — no error, no warning. Since 3D apps commonly set COEP/COOP for
WASM threading, this was the single cheapest thing that could have sunk the entry, so we probed it
before writing anything else. (Chili3d sets no COEP/COOP and `originAgentCluster` was already
`true`, so it was a non-issue — but only because we checked.)

**There is no `unregisterTool()`.** You unregister by aborting an `AbortSignal` passed to
`registerTool`.

**`executeTool` takes a JSON string, not an object.** Undocumented as far as we could find; it
costs a confusing `"Failed to parse input arguments"` until you work it out.

### Accomplishments

- A real B-rep kernel driven end-to-end by agent tool calls, verified: `create_box` +
  2×`create_cylinder` + `boolean_cut` yields a bounding box of exactly `[80, 40, 5]` and an
  `affectedCount` of 4.
- A drop-in that forks nothing — any Chili3d deployment can add an agent surface by copying one
  directory.
- A catalogue-driven shell that exposes 19 tools across two independently owned web apps without
  bypassing the CAD app's consent gate.
- Agent-driven STEP export that verifies the file's schema, solids, and analytic surfaces before
  claiming success.
- Exact fillet and chamfer operations, with volume and surface-area readback so the agent can check
  the geometry rather than trusting its own success message.
- A safety layer we'd defend on its merits rather than as hackathon garnish.

### Two honest things about WebMCP

- **WebMCP is not MCP on the wire.** The spec *"does not prescribe the format in which tools are
  exposed"*, so an external MCP client — Claude Desktop, Cursor — cannot connect to a WebMCP page.
  It is an in-browser-agent surface. We mention it because it would be easy, and wrong, to imply
  otherwise.
- **It is a W3C Community Group draft, not a standard.** WebKit has filed *oppose*, Mozilla is
  *neutral*, the TAG review is open and labelled *"Missing: Multi-stakeholder support"*. Chrome and
  Edge are in origin trial. We think it's worth building on. We don't think it's settled.

### What we learned

That the interesting design work in WebMCP isn't the tool catalogue — porting existing tool
definitions to `registerTool` is nearly mechanical. It's everything the standard deliberately
leaves to you: where authorization lives, what a refusal returns, how much text an agent is
allowed to swallow, and whether your success messages are true.

### What's next

Sketch-and-extrude so an agent can work from a profile; a proper diff view in the confirm dialog
showing before/after geometry rather than the call; and letting the agent address selected faces
and individual edges rather than applying finishing operations to the whole solid.

---

## What is new work (rules §4)

**All code in this repository was authored on 2026-09-03, inside the submission period.** The
WebMCP layer is 100% new.

**Chili3d is third-party open source that we did not write and do not claim** — it supplies the
OCCT WASM kernel, viewport, persistence and STEP export. We build from a pinned public commit and
do not patch its application code. The README states this boundary in a table at the top.

---

## Links and required fields

| Field | Value |
|---|---|
| Live URL | https://chisel-webmcp.helenkwok.workers.dev/shell/ |
| Repository | https://github.com/helenkwok/chisel-webmcp |
| Licence | MIT (detectable in About) |
| Demo video | *(paste public YouTube URL — must be <3 min WITH AUDIO)* |
| Deployed on | Cloudflare Workers |
| Test instructions | Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, or ChatGPT desktop in-app browser. No login required. |

### Official form-specific fields

| Field | Draft answer |
|---|---|
| Submitter Type | **TODO: confirm Individual / Team of Individuals / Organization** |
| Country of residence | **TODO: confirm for every team member** |
| App Status | New |
| Existing-project update | Chisel is a new project created during the submission period. It integrates the pre-existing open-source Chili3d CAD application without claiming that upstream work as ours. All WebMCP integration, safety, activity, bridge, and shell code is new and isolated in this repository. |
| Agents/clients tested | Google Chrome 152 with `chrome://flags/#enable-webmcp-testing` enabled, plus the Codex desktop in-app browser against production. Both direct registration and the top-level shell bridge were exercised with real tool calls. |
| AI tools used | Codex for implementation, debugging, review and submission preparation; Claude for concurrent development-server and browser iteration; Grok for adversarial design review. |
| Learning derived | Significant |
| Reusable career AI value | Yes |

---

## Final submission checklist

### Working project
- [x] Live URL responds 200 and loads
- [ ] 17 CAD tools present after deploying fillet and chamfer
- [ ] `/shell/` composes 17 CAD tools with 2 shell tools in the production in-app browser
- [x] Confirm dialog fires on writes
- [x] Geometry persists across reload
- [x] Gated STEP export reports success on the deployed `/shell/` route

### Repository
- [x] Public
- [x] MIT licence **detected by GitHub** in the About section
- [x] README distinguishes new work from third-party work (rules §4)
- [x] All commits dated within the submission period
- [x] WebMCP registration code present and legible

### Video
- [x] 2:30 fallback cut exists with audio narration
- [ ] Replace fallback stills with a live product capture that visibly proves the tool calls
- [ ] Keep final cut under 3:00
- [ ] **Verify audio narration end to end** (silent + music does not meet the rules)
- [ ] Public YouTube
- [ ] Working product visible in the first 10–15 seconds

### Devpost
- [ ] Description pasted
- [ ] All links filled
- [ ] Confirm submitter type and residence field values
- [x] Re-tested the top-level-only WebMCP host path in Codex's production in-app browser
- [ ] Submitted before **2026-09-03 13:00 PDT**
