# Third-party notices

The MIT licence in [LICENSE](LICENSE) covers **only the code in this repository** — the Chisel
WebMCP plugin under `plugins/webmcp/`, plus the build scripts.

## Chili3d — AGPL-3.0

This project is designed to be dropped into a build of
[**Chili3d**](https://github.com/xiangechen/chili3d) by xiangechen, which is licensed
**AGPL-3.0** (its C++/OpenCascade WASM module: **LGPL-3.0**). No file of Chili3d is modified by
this project; `scripts/vendor.mjs` clones it at a pinned commit and builds it untouched.

**A deployed bundle that combines this plugin with Chili3d is a combined work governed by
AGPL-3.0.** Under AGPL-3.0 §13, users interacting with that deployment over a network are
entitled to its Corresponding Source, which is:

1. this repository (public), and
2. unmodified upstream Chili3d at the commit pinned in `scripts/vendor.mjs` (public).

## OpenCascade Technology

Chili3d embeds OpenCascade (OCCT) compiled to WebAssembly. OCCT is licensed **LGPL-2.1** with an
exception. See the Chili3d repository for its full notices.
