// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// THE AGENT ACTIVITY LOG.
//
// This panel exists so that agent behaviour is accountable in the room, not
// just in a transcript somewhere. A human watching the viewport should be able
// to answer "what did it just do, and was it allowed?" without looking away for
// longer than a glance.
//
// Design decisions and the measurements behind them live in docs/DESIGN.md.
// The two that matter most here:
//
//   1. Chili3d's own status bar owns the bottom 25px of the viewport (measured,
//      not guessed). Anything at bottom:12px is clipped by it. Everything Chisel
//      floats sits at BOTTOM_OFFSET below.
//   2. The host app is light. A dark panel floating over it reads as a foreign
//      object, which is the wrong signal for a surface whose whole job is to
//      make an agent feel accountable and native. So: light, tinted toward the
//      host's own blue.

/** Chili3d's status bar is 25px; leave a 12px gutter above it. */
export const BOTTOM_OFFSET = 37;

const C = {
    surface: "oklch(99% 0.004 255)",
    surface2: "oklch(96.5% 0.006 255)",
    line: "oklch(90% 0.010 255)",
    ink: "oklch(28% 0.020 255)",
    muted: "oklch(52% 0.015 255)",
    accent: "oklch(55% 0.190 255)",
    ok: "oklch(52% 0.140 155)",
    warn: "oklch(62% 0.150 75)",
    danger: "oklch(55% 0.190 25)",
};

export type Phase = "requested" | "approved" | "declined" | "ok" | "error";

const PHASE: Record<Phase, { label: string; dot: string }> = {
    requested: { label: "called", dot: C.muted },
    approved: { label: "approved", dot: C.accent },
    declined: { label: "declined", dot: C.warn },
    ok: { label: "ok", dot: C.ok },
    error: { label: "error", dot: C.danger },
};

export interface ActivityEntry {
    tool: string;
    input: unknown;
    phase: Phase;
    detail?: string;
    durationMs?: number;
}

const MAX_ENTRIES = 50;

export class ActivityPanel {
    private root?: HTMLElement;
    private list?: HTMLElement;
    private countEl?: HTMLElement;
    private readonly buffered: ActivityEntry[] = [];
    private calls = 0;
    private changes = 0;
    private collapsed = false;

    mount(): void {
        if (this.root) return;

        const root = document.createElement("div");
        root.setAttribute("data-chisel-activity", "");
        root.style.cssText = st(
            `position:fixed;right:12px;bottom:${BOTTOM_OFFSET}px;z-index:2147483646`,
            "width:360px;max-width:calc(100vw - 24px)",
            `background:${C.surface};color:${C.ink}`,
            `border:1px solid ${C.line};border-radius:10px`,
            "box-shadow:0 8px 28px oklch(28% 0.02 255 / .16)",
            "font:12.5px/1.45 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif",
            "overflow:hidden",
        );

        // ── Header: the glanceable part.
        const header = document.createElement("button");
        header.type = "button";
        header.style.cssText = st(
            "display:flex;align-items:center;gap:9px;width:100%",
            "padding:9px 12px;border:0;cursor:pointer;text-align:left",
            `background:${C.surface2};color:${C.ink}`,
            `border-bottom:1px solid ${C.line}`,
            "font:inherit",
        );

        const dot = document.createElement("span");
        dot.style.cssText = st(`width:7px;height:7px;border-radius:50%;background:${C.accent};flex:none`);

        const title = document.createElement("span");
        title.textContent = "Agent activity";
        title.style.cssText = "font-weight:650;letter-spacing:.1px";

        const count = document.createElement("span");
        count.style.cssText = st(
            `margin-left:auto;color:${C.muted}`,
            "font-variant-numeric:tabular-nums;font-size:12px",
        );
        this.countEl = count;

        const chevron = document.createElement("span");
        chevron.textContent = "▾";
        chevron.style.cssText = `color:${C.muted};font-size:11px`;

        header.append(dot, title, count, chevron);
        header.onclick = () => {
            this.collapsed = !this.collapsed;
            if (this.list) this.list.hidden = this.collapsed;
            chevron.textContent = this.collapsed ? "▸" : "▾";
        };

        const list = document.createElement("div");
        list.style.cssText = "max-height:230px;overflow-y:auto;overscroll-behavior:contain";

        root.append(header, list);
        document.body.appendChild(root);
        this.root = root;
        this.list = list;

        // Anything logged before mount still shows up.
        const pending = this.buffered.splice(0);
        this.calls = 0;
        this.changes = 0;
        for (const e of pending) this.logCall(e);
        this.renderCount();
    }

    unmount(): void {
        this.root?.remove();
        this.root = undefined;
        this.list = undefined;
        this.countEl = undefined;
    }

    logCall(entry: ActivityEntry): void {
        if (!this.list) {
            // Never throw when called before mount(); just remember it.
            this.buffered.push(entry);
            if (this.buffered.length > MAX_ENTRIES) this.buffered.shift();
            return;
        }

        if (entry.phase === "requested") this.calls++;
        if (entry.phase === "approved") this.changes++;

        this.list.prepend(this.row(entry));
        while (this.list.childElementCount > MAX_ENTRIES) this.list.lastElementChild?.remove();
        this.list.scrollTop = 0;
        this.renderCount();
    }

    private renderCount(): void {
        if (this.countEl) {
            this.countEl.textContent = `${this.calls} tool call${this.calls === 1 ? "" : "s"} · ${this.changes} approved`;
        }
    }

    private row(entry: ActivityEntry): HTMLElement {
        const { label, dot } = PHASE[entry.phase] ?? PHASE.requested;

        const row = document.createElement("div");
        row.style.cssText = st(
            "display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:baseline",
            "padding:8px 12px",
            `border-bottom:1px solid ${C.line}`,
            // Entry motion only, and only opacity/transform.
            "opacity:0;transform:translateY(4px)",
            "transition:opacity 140ms cubic-bezier(.22,1,.36,1),transform 140ms cubic-bezier(.22,1,.36,1)",
        );
        requestAnimationFrame(() => {
            row.style.opacity = "1";
            row.style.transform = "none";
        });

        const phaseEl = document.createElement("span");
        phaseEl.style.cssText = st("display:inline-flex;align-items:center;gap:5px", `color:${C.muted}`, "font-size:12px");
        const d = document.createElement("span");
        d.style.cssText = `width:6px;height:6px;border-radius:50%;background:${dot};flex:none`;
        const l = document.createElement("span");
        l.textContent = label;
        phaseEl.append(d, l);

        const body = document.createElement("div");
        body.style.cssText = "min-width:0";

        const name = document.createElement("div");
        name.textContent = entry.tool;
        name.style.cssText = st(
            `color:${C.ink};font-weight:600`,
            "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px",
            "white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
        );

        const args = compactArgs(entry.input);
        const meta = document.createElement("div");
        meta.textContent = entry.detail ? `${args ? args + " · " : ""}${entry.detail}` : args;
        meta.style.cssText = st(
            `color:${C.muted};font-size:12px`,
            "font-variant-numeric:tabular-nums",
            "white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
        );

        body.append(name);
        if (meta.textContent) body.append(meta);

        const time = document.createElement("span");
        time.textContent = entry.durationMs !== undefined ? `${entry.durationMs}ms` : "";
        time.style.cssText = st(`color:${C.muted}`, "font-size:11.5px;font-variant-numeric:tabular-nums");

        row.append(phaseEl, body, time);
        return row;
    }
}

function st(...parts: string[]): string {
    return parts.join(";");
}

/** One-line argument rendering. Long values are elided, not wrapped. */
function compactArgs(input: unknown): string {
    if (!input || typeof input !== "object") return "";
    const entries = Object.entries(input as Record<string, unknown>);
    if (!entries.length) return "";
    return entries
        .map(([k, v]) => {
            const s = Array.isArray(v) ? `[${v.length}]` : typeof v === "string" ? v : JSON.stringify(v);
            return `${k}=${String(s).slice(0, 14)}`;
        })
        .join(" ");
}
