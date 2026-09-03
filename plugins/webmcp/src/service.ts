// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// Chili3d's PluginManager calls service.register(app) then service.start() when
// a plugin loads. That is the only hook in the app that hands a plugin the live
// IApplication at boot, which is exactly what tool handlers need — so the whole
// WebMCP surface hangs off this one service.

import type { IApplication, IService } from "@chili3d/core";
import { type ConfirmFn, makeGatedExecute, type ToolDef } from "./gate";
import { READ_TOOLS } from "./tools/read";
import { APPLY_OPERATION } from "./tools/write";

const ALL_TOOLS: ToolDef[] = [...READ_TOOLS, APPLY_OPERATION];

export class WebMcpService implements IService {
    private app?: IApplication;
    private controller?: AbortController;
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
                    execute: makeGatedExecute(def, app, confirm),
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
        el.style.cssText = [
            "position:fixed;left:12px;bottom:12px;z-index:2147483646",
            "display:flex;align-items:center;gap:8px",
            "padding:7px 12px;border-radius:999px",
            `background:${ok ? "#065f46" : "#7c2d12"};color:#fff`,
            "font:12px/1 ui-sans-serif,system-ui,sans-serif;font-weight:600",
            "box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none",
        ].join(";");
        const dot = document.createElement("span");
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${ok ? "#34d399" : "#fdba74"}`;
        const label = document.createElement("span");
        label.textContent = `Chisel · ${message}`;
        el.append(dot, label);
        document.body.appendChild(el);
        this.badge = el;
    }
}
