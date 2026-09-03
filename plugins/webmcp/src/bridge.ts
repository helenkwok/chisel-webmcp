// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// THE FRAMED-APP BRIDGE.
//
// WebMCP tools are registered on a *document*. An agent talks to the top-level
// document, so a tool registered inside an iframe is not the surface the agent
// sees. That is a real constraint, and it is also the interesting one: it means
// a shell page can host SEVERAL apps and present one merged tool surface over
// all of them.
//
// So the plugin behaves differently depending on where it finds itself:
//
//   top-level  → register on document.modelContext directly (the simple case)
//   framed     → publish the catalogue to the parent and answer invocations
//
// The catalogue crossing the boundary is plain JSON — name, description, JSON
// Schema — which is exactly what registerTool wants. The shell therefore needs
// no compile-time knowledge of this app at all; any app that speaks these four
// messages can be dropped into the shell and its verbs appear to the agent.
//
// SECURITY NOTE: every invocation still lands in the SAME gated execute that
// the top-level path uses. The bridge forwards, it does not bypass. A shell
// cannot obtain an ungated handler, because none is ever exported.

/** Wire protocol. Versioned, because a shell and an app deploy separately. */
export const BRIDGE_PROTOCOL = "chisel-webmcp/1";

export type BridgeToolInfo = {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    write: boolean;
};

export type BridgeMessage =
    /** app → shell, on load: "here is what I can do" */
    | { protocol: string; type: "catalogue"; appId: string; appTitle: string; tools: BridgeToolInfo[] }
    /** shell → app: "run this" */
    | { protocol: string; type: "invoke"; callId: string; tool: string; input: Record<string, unknown> }
    /** app → shell: "here is the result" */
    | { protocol: string; type: "result"; callId: string; result: unknown }
    /** shell → app, on connect: "who's there?" — covers the shell loading after the app */
    | { protocol: string; type: "hello" };

export function isBridgeMessage(data: unknown): data is BridgeMessage {
    return typeof data === "object" && data !== null && (data as any).protocol === BRIDGE_PROTOCOL;
}

/** True when this document is inside a frame and can reach a parent. */
export function isFramed(): boolean {
    try {
        return window.parent !== window;
    } catch {
        // A cross-origin parent throws on access; that still means we are framed.
        return true;
    }
}

/**
 * Serve this app's tools to a hosting shell.
 *
 * `invoke` is the already-gated execute function — the same one the top-level
 * path registers. The confirm dialog therefore still renders inside THIS
 * document, over this app's own viewport, which is where a human can actually
 * see what they are approving.
 */
export function serveToShell(
    appId: string,
    appTitle: string,
    tools: BridgeToolInfo[],
    invoke: (tool: string, input: Record<string, unknown>) => Promise<unknown>,
    signal: AbortSignal,
): void {
    const post = (msg: BridgeMessage) => {
        try {
            // The shell is same-origin in our deployment; "*" would be wrong for a
            // cross-origin host, but we do not have one, and narrowing it later is
            // a one-line change.
            window.parent.postMessage(msg, window.location.origin);
        } catch {
            /* no reachable parent — nothing to serve */
        }
    };

    const announce = () =>
        post({ protocol: BRIDGE_PROTOCOL, type: "catalogue", appId, appTitle, tools });

    const onMessage = async (ev: MessageEvent) => {
        // Only listen to our own origin. An arbitrary page must not be able to
        // drive the CAD kernel by posting at us.
        if (ev.origin !== window.location.origin) return;
        if (!isBridgeMessage(ev.data)) return;

        if (ev.data.type === "hello") {
            announce();
            return;
        }
        if (ev.data.type === "invoke") {
            const { callId, tool, input } = ev.data;
            const result = await invoke(tool, input);
            post({ protocol: BRIDGE_PROTOCOL, type: "result", callId, result });
        }
    };

    window.addEventListener("message", onMessage, { signal });
    announce(); // in case the shell is already listening
}
