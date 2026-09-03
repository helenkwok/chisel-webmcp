# Chisel demo script

Target length: **2 minutes 30 seconds**. Hard stop: **2 minutes 55 seconds**.

Record in 1080p in **Chrome 152 with `chrome://flags/#enable-webmcp-testing` enabled**, or the
ChatGPT desktop in-app browser. Public YouTube upload, **audio required** — a silent screencast
with background music does not meet the rules. AI text-to-speech narration is allowed.

**Open on working geometry within the first 10 seconds.** Judges watch a lot of these.

Live URL: <https://chisel-webmcp.helenkwok.workers.dev>

Before recording: open the site once, let the OCCT WASM warm the cache, then hard-reload so the
recorded load is fast. Clear any existing document so you start empty.

---

## 0:00–0:15 — The hook, on screen immediately

**On screen:** the app already open, empty viewport, Chisel badge visible bottom-left reading
*"WebMCP ready — 7 tools registered"*. Agent panel open beside it.

**Type the prompt live** (don't paste — it reads as real):

```text
Make me a mounting bracket 80 by 40 by 5 millimetres with two 6mm holes, 50mm apart.
```

**Say:**

> This is a real CAD kernel — OpenCascade, compiled to WebAssembly, running in a browser tab.
> I'm going to ask an AI agent to build a part in it. Not move a mesh around. Build a solid.

## 0:15–0:50 — The agent calls the kernel

**On screen:** the agent calls `chisel_get_document_info`, then `chisel_apply_operation` with
`create_box`. **The confirm dialog appears.** Let it sit for a beat before approving.

**Say:**

> Every tool call that changes the model stops here first and shows me exactly what it wants to
> do. This matters more than it looks. WebMCP has no consent primitive at all — no permission
> prompt, no user-gesture requirement — and `readOnlyHint` is only advisory. The spec says agents
> "must assume good faith from site developers." So any safety this page has, the page author has
> to build. This dialog is that.

Approve. Geometry appears and the view frames itself.

**Say:**

> There's the plate. Now the holes.

## 0:50–1:25 — Booleans, and an honest count

**On screen:** two `create_cylinder` calls, then `boolean_cut`. Approve each. Point at the
returned result showing **`affectedCount: 4`** — one solid created, three consumed.

**Say:**

> Two cylinders, then a boolean cut — real B-rep subtraction in the kernel. And look at what the
> tool hands back: an affected count of four. One solid created, three consumed. If an operation
> changes nothing, this returns an error, never a cheerful "done". The spec itself warns that a
> tool can claim to be read-only while changing data; the mirror image is a tool that claims
> success while changing nothing, and an agent that gets lied to compounds the lie.

## 1:25–1:50 — Ask it a question about the model

**On screen:** type

```text
What are the exact dimensions of the bracket, and how many objects are in the document?
```

Agent calls `chisel_get_object` / `chisel_get_document_info`. Show the bounding box:
**`size: [80, 40, 5]`**.

**Say:**

> Six read tools let it inspect what's actually there — the scene tree, the selection, an
> object's real bounding box. Eighty by forty by five. It's not guessing from the DOM; there is
> no DOM for a solid. This is exactly the gap WebMCP exists to close.

## 1:50–2:10 — The beat judges won't have seen five times

**On screen:** **reload the page.** Wait for it to come back. The bracket is still there.

**Say:**

> And now the part that makes this a product rather than a demo. I reload the page — and the
> agent's work is still here. It's in the undo history and persisted to IndexedDB.

Then use **File → Export → STEP** (or the download control) and show the `.step` file land.

**Say:**

> And I can export it as STEP. That's a real manufacturable CAD file. The agent didn't draw a
> picture of a bracket; it made one.

## 2:10–2:30 — What it is, honestly

**On screen:** the GitHub repo, scrolled to the "What is new work, and what is not" table.

**Say:**

> To be straight about what I built: the CAD application is Chili3d, an excellent open-source
> project I did not write. What I built is the agent surface for it — seven tools, one gated
> write, and the safety layer around them. And it isn't a fork; not one upstream file is
> modified. Chili3d already loads plugins from its own origin, so Chisel is a genuine drop-in.
> That's the thing I'd want for any app: your CAD tool, your agent, no rewrite.

**Hard stop.**

---

## Recording checklist

- [ ] WebMCP flag enabled; badge shows **7 tools registered** before you start
- [ ] Empty document at frame 1
- [ ] **Audio narration present** (rules requirement — silent + music is a fail)
- [ ] Confirm dialog clearly visible at least once, and paused on
- [ ] `affectedCount: 4` legible on screen
- [ ] Bounding box `[80, 40, 5]` legible
- [ ] Reload-persistence beat actually shows a reload (address bar / spinner visible)
- [ ] STEP export lands
- [ ] Under 3:00. Upload **public** (not unlisted-only — rules say public)
