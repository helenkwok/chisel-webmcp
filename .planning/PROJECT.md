# Chisel — agentic browser CAD over WebMCP

**Submission:** OpenAI WebMCP Challenge · https://webmcp.devpost.com/
**Hard deadline:** 2026-09-03 13:00 PDT (verify the clock, never inherit a claim about it)

## What it is

A real B-rep CAD kernel running in a browser tab, whose modelling verbs are registered as
WebMCP tools so an AI agent can *build manufacturable solids* by conversation — then export
a STEP file.

Base application: **Chili3d** (github.com/xiangechen/chili3d), AGPL-3.0, OpenCascade 8.0.0
compiled to WASM + Three.js. 4.8k stars, working STEP/IGES/BREP/STL export, IndexedDB
persistence, undo/redo transactions.

**Our contribution is one plugin: the WebMCP agent surface.** We did not write the CAD kernel
and the write-up will say so plainly. The hackathon rules allow an existing codebase; the
WebMCP layer must be new and dated after 2026-08-25. Ours is authored 2026-09-03.

## Why this wins on the four (equally weighted) criteria

- **WebMCP Leverage** — boolean cut, extrude, fillet and revolve are the canonical operations
  you *cannot* reach by DOM scraping. This is the strongest available statement of WebMCP's
  own founding argument. A to-do list does not make that case; a CAD viewport does.
- **Creativity & Ambition** — no other entry will ship an OpenCascade kernel.
- **Potential Impact** — agentic CAD is a real, unsolved, valuable problem, and the closing
  beat is one nothing else can match: the agent produces a **real STEP file**, not a mesh.
- **Execution** — a bracket appearing from one sentence is self-evident on video in 10 seconds.

## Architecture decision

Chili3d's `PluginManager.registerPlugin()` calls `service.register(app)` then `service.start?.()`.
A plugin may therefore ship a **service** that receives `IApplication` at load time. That is
where WebMCP registration belongs, and it keeps 100% of our new code inside one plugin
directory — legible to a judge, and cleanly separated from AGPL core.

## Safety posture (a judging answer, not a feature)

WebMCP has **no consent primitive, no user-gesture requirement**, and `readOnlyHint` is
advisory — an agent may ignore it. The spec's own words: agents "must assume good faith from
site developers." Whatever safety exists, we build.

1. **Single gated write chokepoint.** Every mutation goes through ONE `apply_operation` tool
   behind an in-page confirm. There is deliberately no second way to write. Per-handler
   enforcement is opt-in and the eleventh tool loses.
2. **Honest affected count.** 0 changed returns an error, never a fake success. This directly
   answers the spec's own "a tool can claim to be read-only while changing data" threat.
3. **Output capped (~1.5K chars) and the truncation announced.** Tool results carry model
   content authored by whoever made the file — untrusted third-party text, and an unbounded
   prompt-injection surface. Silent truncation is worse than none: the agent acts on half a
   picture believing it whole.

## Honest framing for the write-up

- WebMCP is **not MCP on the wire**. The spec "does not prescribe the format in which tools
  are exposed", so Claude Desktop / Cursor cannot connect to a WebMCP page. It is an
  in-browser-agent surface. Claiming otherwise is wrong and a judge may know it.
- It is a **W3C Community Group draft, not a standard**. WebKit has filed *oppose*, Mozilla is
  *neutral*, the TAG review is open and labelled "Missing: Multi-stakeholder support". Chrome
  and Edge are in origin trial. Saying so shows we evaluated the platform rather than adopting
  it uncritically.

## Constraints

- **No IFC, no IFC5, no ifc-editor or bimblock code.** Separate projects, hard boundary.
- Licence: forking Chili3d makes this entry **AGPL-3.0**. Satisfies "detectable open-source
  licence"; source is published regardless.
- Deploy: Cloudflare Workers static assets (explicit `_headers` control, which we need for
  the isolation question).
