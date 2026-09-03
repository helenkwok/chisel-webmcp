// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// Chili3d's PluginManager calls service.register(app) then service.start() when
// a plugin loads. That is the only hook in the app that hands a plugin the live
// IApplication at boot, which is exactly what tool handlers need — so the whole
// WebMCP surface hangs off this one service.

import type { IApplication, IService } from "@chili3d/core";
import { ActivityPanel, BOTTOM_OFFSET } from "./activityPanel";
import { BRIDGE_PROTOCOL, type BridgeToolInfo, isFramed, serveToShell } from "./bridge";
import { type ConfirmFn, makeGatedExecute, type ToolDef } from "./gate";
import { READ_TOOLS } from "./tools/read";
import { WRITE_TOOLS } from "./tools/write";

const ALL_TOOLS: ToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS];

export const APP_ID = "chisel-cad";
export const APP_TITLE = "Chisel CAD";

export class WebMcpService implements IService {
    private app?: IApplication;
    private controller?: AbortController;
    private readonly panel = new ActivityPanel();
    /** Every agent call, for the on-screen activity log. */
    readonly log: { time: string; tool: string; detail: string }[] = [];

    register(app: IApplication): void {
        this.app = app;
    }

    start(): void {
        const app = this.app;
        if (!app) return;

        const mc = (document as any).modelContext;
        if (!mc?.registerTool) {
            // Degrade to a no-op rather than throwing: the app must still work
            // in a browser without WebMCP. We tell the human why, once.
            console.warn(
                "[Chisel] document.modelContext is unavailable — WebMCP tools not registered. " +
                    "Chrome 149+ with chrome://flags/#enable-webmcp-testing, or the ChatGPT in-app browser, is required. " +
                    "Note the API is document.modelContext, NOT navigator.modelContext (that spelling was removed in the May 2026 draft).",
            );
            this.setBadge("WebMCP unavailable in this browser", false);
            return;
        }

        this.controller = new AbortController();
        const confirm = this.makeConfirm();
        this.panel.mount();

        // Build the gated executes ONCE. Both the top-level path and the framed
        // path below use these same functions — the bridge forwards, it never
        // constructs an alternative handler.
        const gated = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
        for (const def of ALL_TOOLS) {
            const execute = makeGatedExecute(def, app, confirm);
            gated.set(def.name, async (input) => {
                const started = performance.now();
                this.panel.logCall({ tool: def.name, input, phase: "requested" });
                const result: any = await execute(input);
                const detail = String(result?.content?.[0]?.text ?? "");
                this.panel.logCall({
                    tool: def.name,
                    input,
                    phase: result?.isError ? "error" : "ok",
                    detail: summariseForPanel(detail),
                    durationMs: Math.round(performance.now() - started),
                });
                return result;
            });
        }

        // If we are inside a shell, publish the catalogue upward instead of
        // registering here — an agent talks to the TOP-LEVEL document, so a
        // registration in this frame would not be the surface it sees.
        if (isFramed()) {
            const catalogue: BridgeToolInfo[] = ALL_TOOLS.map((d) => ({
                name: d.name,
                title: d.title,
                description: d.description,
                inputSchema: d.inputSchema,
                write: !!d.write,
            }));
            serveToShell(
                APP_ID,
                APP_TITLE,
                catalogue,
                (tool, input) => gated.get(tool)!(input),
                this.controller.signal,
            );
            this.setBadge(`in shell — ${ALL_TOOLS.length} tools published (${BRIDGE_PROTOCOL})`, true);
            void this.ensureDocument(app);
            return;
        }

        for (const def of ALL_TOOLS) {
            mc.registerTool(
                {
                    name: def.name,
                    title: def.title,
                    description: def.description,
                    inputSchema: def.inputSchema,
                    annotations: {
                        // Honest annotations. Both are advisory — an agent may
                        // ignore them — which is precisely why the gate exists
                        // and does not rely on them.
                        readOnlyHint: !def.write,
                        destructiveHint: !!def.write,
                        untrustedContentHint: true,
                    },
                    execute: gated.get(def.name)!,
                },
                { signal: this.controller.signal },
            );
        }

        this.setBadge(`WebMCP ready — ${ALL_TOOLS.length} tools registered`, true);
        console.info(
            `[Chisel] Registered ${ALL_TOOLS.length} WebMCP tools:`,
            ALL_TOOLS.map((t) => t.name).join(", "),
        );

        void this.ensureDocument(app);
    }

    /**
     * Make sure there is something to model into.
     *
     * Chili3d boots to an empty shell with no document, so an agent's very first
     * tool call would fail with "no document is open" and a first-time visitor
     * sees no viewport at all. Both are bad: the agent wastes a turn, and a human
     * landing on the page can't tell the app works. So we open a document if the
     * user has none.
     */
    private async ensureDocument(app: IApplication): Promise<void> {
        try {
            if (app.activeView?.document || app.documents.size > 0) return;
            await app.newDocument("Chisel");
            console.info("[Chisel] Opened a document so agent tools have something to act on.");
        } catch (err) {
            console.warn("[Chisel] Could not auto-open a document:", err);
        }
    }

    stop(): void {
        // There is no unregisterTool() in WebMCP. You unregister by aborting the
        // signal you passed to registerTool.
        this.controller?.abort();
        this.controller = undefined;
        this.panel.unmount();
        this.badge?.remove();
        this.badge = undefined;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The confirm seam. WebMCP has no consent primitive, so this is it.
    // ─────────────────────────────────────────────────────────────────────────

    private makeConfirm(): ConfirmFn {
        return (summary: string) =>
            new Promise<boolean>((resolve) => {
                const overlay = document.createElement("div");
                overlay.setAttribute("data-chisel-confirm", "");
                overlay.style.cssText = [
                    "position:fixed;inset:0;z-index:2147483647",
                    "background:rgba(8,10,14,.55);backdrop-filter:blur(3px)",
                    "display:flex;align-items:center;justify-content:center",
                    "font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif",
                ].join(";");

                const card = document.createElement("div");
                card.style.cssText = [
                    "background:#fff;color:#111;border-radius:12px;max-width:460px;width:calc(100% - 48px)",
                    "box-shadow:0 24px 64px rgba(0,0,0,.35);overflow:hidden",
                ].join(";");

                const head = document.createElement("div");
                head.style.cssText = "padding:16px 20px;background:#0f172a;color:#fff;font-weight:600";
                head.textContent = "An AI agent wants to modify your model";

                const body = document.createElement("div");
                body.style.cssText = "padding:20px";
                const pre = document.createElement("pre");
                pre.style.cssText =
                    "margin:0 0 16px;padding:12px;background:#f1f5f9;border-radius:8px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,monospace";
                pre.textContent = summary;
                const note = document.createElement("p");
                note.style.cssText = "margin:0;color:#475569;font-size:12.5px";
                note.textContent =
                    "Chisel requires your approval for every change. Nothing runs unless you approve — declining does not run the operation at all.";
                body.append(pre, note);

                const foot = document.createElement("div");
                foot.style.cssText =
                    "display:flex;gap:8px;justify-content:flex-end;padding:0 20px 20px";

                const mk = (label: string, primary: boolean) => {
                    const b = document.createElement("button");
                    b.textContent = label;
                    b.style.cssText = [
                        "padding:9px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px",
                        primary
                            ? "background:#2563eb;color:#fff;border:1px solid #2563eb"
                            : "background:#fff;color:#334155;border:1px solid #cbd5e1",
                    ].join(";");
                    return b;
                };
                const no = mk("Decline", false);
                const yes = mk("Approve", true);

                const done = (ok: boolean) => {
                    overlay.remove();
                    this.record(ok ? "approved" : "declined", summary.split("\n")[0]);
                    resolve(ok);
                };
                no.onclick = () => done(false);
                yes.onclick = () => done(true);
                overlay.onkeydown = (e) => {
                    if ((e as KeyboardEvent).key === "Escape") done(false);
                };

                foot.append(no, yes);
                card.append(head, body, foot);
                overlay.append(card);
                document.body.appendChild(overlay);
                yes.focus();
            });
    }

    private record(kind: string, detail: string) {
        this.log.push({ time: new Date().toLocaleTimeString(), tool: kind, detail });
        this.panel.logCall({
            tool: detail.split("(")[0] || "write",
            input: {},
            phase: kind === "approved" ? "approved" : "declined",
            detail: kind === "approved" ? "human approved" : "human declined — handler never ran",
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A small always-visible badge, so a viewer of the demo can see at a glance
    // that the tools really registered rather than taking our word for it.
    // ─────────────────────────────────────────────────────────────────────────

    private badge?: HTMLElement;

    private setBadge(message: string, ok: boolean) {
        this.badge?.remove();
        const el = document.createElement("div");
        el.setAttribute("data-chisel-badge", "");
        // BOTTOM_OFFSET clears Chili3d's own 25px status bar; anchoring at 12px
        // put this behind it. Light, tinted toward the host's blue, so it reads
        // as part of the app rather than a widget someone bolted on.
        el.style.cssText = [
            `position:fixed;left:12px;bottom:${BOTTOM_OFFSET}px;z-index:2147483646`,
            "display:flex;align-items:center;gap:8px",
            "padding:8px 13px;border-radius:8px",
            "background:oklch(99% 0.004 255);color:oklch(28% 0.02 255)",
            `border:1px solid ${ok ? "oklch(88% 0.05 155)" : "oklch(86% 0.07 75)"}`,
            "box-shadow:0 8px 28px oklch(28% 0.02 255 / .16)",
            "font:12.5px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;font-weight:600",
            "pointer-events:none",
        ].join(";");
        const dot = document.createElement("span");
        dot.style.cssText =
            `width:7px;height:7px;border-radius:50%;flex:none;background:${ok ? "oklch(52% 0.14 155)" : "oklch(62% 0.15 75)"}`;
        const label = document.createElement("span");
        label.textContent = `Chisel · ${message}`;
        el.append(dot, label);
        document.body.appendChild(el);
        this.badge = el;
    }
}

/** Keeps the on-screen log readable: one line, the numbers that matter. */
function summariseForPanel(text: string): string {
    const m = text.match(/"affectedCount":\s*(\d+)/);
    if (m) return `affectedCount ${m[1]}`;
    const first = text.split("\n").find((l) => l.trim().length) ?? "";
    return first.slice(0, 90);
}
