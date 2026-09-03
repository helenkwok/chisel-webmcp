// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// THE REGISTRATION BOUNDARY.
//
// WebMCP has no registration-boundary authorization hook. You hand registerTool
// a function and the browser calls it — there is no platform consent primitive,
// no user-activation requirement, and `readOnlyHint` is advisory (an agent may
// ignore it). The spec's own words: agents "must assume good faith from site
// developers."
//
// So every safety property this app has, this file has to create. The design
// rule is that enforcement lives in ONE wrapper that every registration goes
// through, and there is deliberately no exported path that registers a tool
// without it. Per-handler enforcement is opt-in, and the eleventh tool someone
// adds is ungated until its author remembers the line.

import type { IApplication } from "@chili3d/core";

/** Max characters of tool output handed back to the agent. */
export const OUTPUT_CAP = 1500;

export interface ToolDef {
    name: string;
    title: string;
    description: string;
    /** JSON Schema. WebMCP requires JSON Schema, not Zod. */
    inputSchema: Record<string, unknown>;
    /** True for tools that mutate the document. Drives the confirm seam. */
    write?: boolean;
    handler: (input: any, app: IApplication) => Promise<unknown> | unknown;
}

export interface ToolResult {
    content: { type: "text"; text: string }[];
    isError?: boolean;
}

function text(s: string, isError = false): ToolResult {
    return { content: [{ type: "text", text: s }], isError };
}

/**
 * Cap tool output and ANNOUNCE the truncation.
 *
 * This bounds result volume; it is not a prompt-injection defence. Model content
 * under the cap still reaches the agent verbatim, which is why every tool is
 * annotated untrustedContentHint and the sentinel below is neutralised.
 *
 * Silent truncation is worse than none: the agent acts on half a picture
 * believing it whole. So when we cut, we say we cut, and we say by how much.
 */
const SENTINEL = "[TRUNCATED by Chisel:";

export function cap(s: string, limit = OUTPUT_CAP): string {
    // Model content could contain the sentinel itself; neutralise it so a file
    // cannot forge a "truncated" notice to the agent.
    const clean = s.split(SENTINEL).join("[truncated-by-chisel:");
    if (clean.length <= limit) return clean;
    const notice = (dropped: number) =>
        `\n\n${SENTINEL} ${dropped} of ${clean.length} characters were withheld. This result is INCOMPLETE — narrow your query (e.g. pass a filter or a smaller limit) rather than reasoning from this partial view.]`;
    // The notice counts against the limit; the total never exceeds it.
    const room = Math.max(0, limit - notice(clean.length).length);
    return clean.slice(0, room) + notice(clean.length - room);
}

/**
 * Two writes arriving together must not stack two full-screen dialogs, because
 * approving the one on top is not consent for the one underneath. Confirms run
 * one at a time, in order.
 */
let confirmChain: Promise<unknown> = Promise.resolve();
export function serialised(confirm: ConfirmFn): ConfirmFn {
    return (summary) => {
        const next = confirmChain.then(() => confirm(summary));
        confirmChain = next.catch(() => false);
        return next;
    };
}

/** Renders a handler's return value as the text an agent will read. */
function resultToText(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 1);
}

/**
 * The in-page confirm seam for writes.
 *
 * WebMCP gives an agent the ability to call a mutating tool with no human in
 * the loop at all. Exposing a destructive verb through a surface with no
 * confirmation seam would be a real safety regression, so every write stops
 * here and waits for a human.
 *
 * Returns true if the human approved.
 */
export type ConfirmFn = (summary: string) => Promise<boolean>;

/**
 * Wrap a tool def's handler with the gate. This is the ONLY way a handler
 * becomes an `execute` function; `registerTools` refuses to call registerTool
 * with anything else.
 */
export function makeGatedExecute(def: ToolDef, app: IApplication, confirm: ConfirmFn) {
    return async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
            if (def.write) {
                const approved = await confirm(describeIntent(def, input));
                if (!approved) {
                    // The handler NEVER runs. Not "runs and rolls back" — never runs.
                    return text(
                        `REFUSED: the human declined "${def.name}". The document was not modified. Do not retry this call without new instruction from the user.`,
                        true,
                    );
                }
            }
            const result = await def.handler(input, app);
            return text(cap(resultToText(result)));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return text(`ERROR in ${def.name}: ${cap(msg, 400)}`, true);
        }
    };
}

/** Human-readable summary of what the agent is asking to do, for the confirm dialog. */
function describeIntent(def: ToolDef, input: Record<string, unknown>): string {
    const args = Object.entries(input ?? {})
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
    return `${def.title}\n\n${def.name}(${args})`;
}
