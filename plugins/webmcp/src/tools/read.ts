// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// Read tools. These are what make "ask a question about the model" work, and
// they matter as much as the write verb: an agent that cannot inspect the
// document can only guess at what to change.
//
// Every one of these is annotated readOnlyHint AND untrustedContentHint. The
// second is the honest one — the text these return is derived from node names
// and geometry authored by whoever made the file, which is third-party content.

import type { IApplication, IDocument, INode, INodeLinkedList } from "@chili3d/core";
import { GeometryNode, VisualNode } from "@chili3d/core";
import type { ToolDef } from "../gate";

/** Throws a message the agent can act on, rather than a null-deref. */
function requireDocument(app: IApplication): IDocument {
    const doc = app.activeView?.document ?? [...app.documents][0];
    if (!doc) {
        throw new Error(
            "No document is open. Ask the user to create or open a document before querying the model.",
        );
    }
    return doc;
}

function isLinkedList(node: INode): node is INodeLinkedList {
    return typeof (node as INodeLinkedList).firstChild !== "undefined" || "add" in node;
}

/** Depth-first walk of the model tree. */
function walk(node: INode, visit: (n: INode, depth: number) => void, depth = 0): void {
    visit(node, depth);
    if (isLinkedList(node)) {
        let child = node.firstChild;
        while (child) {
            walk(child, visit, depth + 1);
            child = child.nextSibling;
        }
    }
}

function allNodes(doc: IDocument): INode[] {
    const out: INode[] = [];
    walk(doc.modelManager.rootNode, (n) => out.push(n));
    return out.slice(1); // drop the root itself
}

function nodeKind(n: INode): string {
    return n.constructor?.name ?? "Node";
}

/**
 * Bounding box, volume and surface area.
 *
 * Volume is the load-bearing one, and it exists because of a real gap: an agent
 * driving a 3D kernel is otherwise working blind. It cannot see the viewport, so
 * after a boolean cut it has no way to tell a successful subtraction from a
 * no-op that happened to return a new solid. Volume closes that loop
 * arithmetically — an 80x40x5 plate is 16000 mm3, and after two 3mm-radius
 * holes are cut through it, it is about 15717. The agent can check its own work
 * instead of trusting a success message, which is the only kind of verification
 * worth anything.
 */
function shapeMetrics(n: INode): Record<string, unknown> {
    const geo = n as unknown as GeometryNode;
    const shape = (geo as any)?.shape?.value ?? (geo as any)?.shape;
    if (!shape) return {};
    const out: Record<string, unknown> = {};
    try {
        out["shapeType"] = shape.shapeType;
        const bb = shape.boundingBox?.();
        if (bb) {
            out["boundingBoxMin"] = [round(bb.min.x), round(bb.min.y), round(bb.min.z)];
            out["boundingBoxMax"] = [round(bb.max.x), round(bb.max.y), round(bb.max.z)];
            out["sizeMm"] = [
                round(bb.max.x - bb.min.x),
                round(bb.max.y - bb.min.y),
                round(bb.max.z - bb.min.z),
            ];
        }
    } catch {
        /* a shape without a bounding box is still worth reporting by name */
    }
    // Volume and area are separate try blocks on purpose: a non-solid (a wire,
    // a face) has an area but no meaningful volume, and one throwing must not
    // cost us the other.
    const v = volumeOf(shape);
    if (v !== undefined) out["volumeMm3"] = round(v);
    try {
        const a = shape.area?.();
        if (typeof a === "number" && Number.isFinite(a)) out["surfaceAreaMm2"] = round(a);
    } catch {
        /* no area */
    }
    return out;
}

function round(v: number): number {
    return Math.round(v * 1000) / 1000;
}

function summarize(n: INode, withMetrics = false): Record<string, unknown> {
    return {
        id: n.id,
        name: n.name,
        kind: nodeKind(n),
        visible: n.visible,
        ...(withMetrics ? shapeMetrics(n) : {}),
    };
}

export const READ_TOOLS: ToolDef[] = [
    {
        name: "chisel_get_document_info",
        title: "Get document info",
        description:
            "Summary of the open CAD document: name, object count, a breakdown by kind, undo depth, the kernel in use, and the unit system. CALL THIS FIRST in any modelling session so you know whether the document is empty and what units you are working in. All lengths in this app are MILLIMETRES.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: (_input, app) => {
            const doc = requireDocument(app);
            const nodes = allNodes(doc);
            const byKind: Record<string, number> = {};
            for (const n of nodes) byKind[nodeKind(n)] = (byKind[nodeKind(n)] ?? 0) + 1;
            return {
                documentName: doc.name,
                documentId: doc.id,
                objectCount: nodes.length,
                objectsByKind: byKind,
                undoDepth: (doc.history as any)?.undoCount?.() ?? undefined,
                kernel: app.shapeProvider?.factory?.kernelName ?? "unknown",
                units: "millimetres (Chili3d works in mm)",
            };
        },
    },
    {
        name: "chisel_get_scene_tree",
        title: "Get scene tree",
        description:
            "The full object hierarchy of the document as an indented tree, with each object's id, name and kind. Use this to find the id of an object you want to inspect or modify.",
        inputSchema: {
            type: "object",
            properties: {
                maxDepth: { type: "integer", minimum: 1, description: "Limit tree depth. Default unlimited." },
            },
            additionalProperties: false,
        },
        handler: (input: { maxDepth?: number }, app) => {
            const doc = requireDocument(app);
            const lines: string[] = [];
            walk(doc.modelManager.rootNode, (n, depth) => {
                if (input?.maxDepth !== undefined && depth > input.maxDepth) return;
                if (depth === 0) return;
                lines.push(`${"  ".repeat(depth - 1)}- [${n.id}] ${n.name} (${nodeKind(n)})`);
            });
            return lines.length ? lines.join("\n") : "(document is empty — no objects yet)";
        },
    },
    {
        name: "chisel_get_selection",
        title: "Get current selection",
        description:
            "The objects the human currently has selected in the 3D viewport. This is how you resolve phrases like 'this one', 'the selected part' or 'that face' into concrete object ids.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: (_input, app) => {
            const doc = requireDocument(app);
            const nodes = doc.selection.getSelectedNodes();
            if (!nodes.length) return "Nothing is selected in the viewport.";
            return { selectedCount: nodes.length, selected: nodes.map((n) => summarize(n, true)) };
        },
    },
    {
        name: "chisel_query_objects",
        title: "Query objects",
        description:
            "Find objects in the document by name substring and/or kind (e.g. BoxNode, EditableShapeNode). Returns matching objects with their ids. Use this instead of reading the whole tree when you are looking for something specific.",
        inputSchema: {
            type: "object",
            properties: {
                nameContains: { type: "string", description: "Case-insensitive substring match on object name." },
                kind: { type: "string", description: "Exact object kind, e.g. 'BoxNode'." },
                limit: { type: "integer", minimum: 1, maximum: 200, description: "Max results. Default 50." },
            },
            additionalProperties: false,
        },
        handler: (input: { nameContains?: string; kind?: string; limit?: number }, app) => {
            const doc = requireDocument(app);
            const limit = input?.limit ?? 50;
            const needle = input?.nameContains?.toLowerCase();
            const matches = allNodes(doc).filter((n) => {
                if (needle && !n.name.toLowerCase().includes(needle)) return false;
                if (input?.kind && nodeKind(n) !== input.kind) return false;
                return true;
            });
            return {
                matchCount: matches.length,
                returned: Math.min(matches.length, limit),
                results: matches.slice(0, limit).map((n) => summarize(n)),
            };
        },
    },
    {
        name: "chisel_get_object",
        title: "Get object detail",
        description:
            "Full detail for one object by id: name, kind, visibility, material, position, bounding box, size in millimetres, VOLUME in mm3 and surface area in mm2. Use it to VERIFY your own work: after a boolean cut, the volume should have decreased by roughly the volume of what you removed. If it did not, the cut did not do what you intended, whatever the success message said.",
        inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Object id from the scene tree or a query." } },
            required: ["id"],
            additionalProperties: false,
        },
        handler: (input: { id: string }, app) => {
            const doc = requireDocument(app);
            const node = allNodes(doc).find((n) => n.id === input.id);
            if (!node) throw new Error(`No object with id "${input.id}". Call chisel_get_scene_tree to list valid ids.`);
            const visual = node as unknown as VisualNode;
            const t = (visual as any)?.transform;
            return {
                ...summarize(node, true),
                materialId: (node as any)?.materialId,
                translation: t ? [round(t.position?.x ?? 0), round(t.position?.y ?? 0), round(t.position?.z ?? 0)] : undefined,
            };
        },
    },
    {
        name: "chisel_get_change_log",
        title: "Get change log",
        description:
            "The recent undo history of this document — what has been changed and in what order. Use it to verify that a modelling operation actually took effect, and to tell the human what you did.",
        inputSchema: {
            type: "object",
            properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 15." } },
            additionalProperties: false,
        },
        handler: (input: { limit?: number }, app) => {
            const doc = requireDocument(app);
            const hist = doc.history as any;
            const records: any[] = hist?.undos ?? hist?._undos ?? [];
            const limit = input?.limit ?? 15;
            const recent = records.slice(-limit).map((r, i) => ({
                index: records.length - Math.min(records.length, limit) + i,
                description: r?.name ?? r?.description ?? r?.constructor?.name ?? "change",
            }));
            return { totalChanges: records.length, recent };
        },
    },
];

/** ShapeTypes.solid from chili3d's bitflag enum. Inlined rather than imported. */
const SHAPE_TYPE_SOLID = 0b100;

/**
 * Volume of a shape, including the case that actually matters.
 *
 * Only OccSolid implements volume(). A boolean operation returns an OccCompound,
 * which does not — so a naive `shape.volume()` returns nothing for precisely the
 * shapes an agent most needs to measure: the results of its own cuts.
 *
 * This was caught by testing rather than by reading the types. The box reported
 * 16000 mm3 and the cut result reported nothing at all, which would have shipped
 * a verification feature that silently failed on every interesting shape.
 *
 * So: try the direct call, and if the shape is a compound, sum the solids in it.
 */
function volumeOf(shape: any): number | undefined {
    try {
        const direct = shape.volume?.();
        if (typeof direct === "number" && Number.isFinite(direct)) return direct;
    } catch {
        /* fall through to the compound case */
    }
    try {
        const solids: any[] = shape.findSubShapes?.(SHAPE_TYPE_SOLID) ?? [];
        if (!solids.length) return undefined;
        let total = 0;
        for (const solid of solids) {
            const one = solid.volume?.();
            if (typeof one !== "number" || !Number.isFinite(one)) return undefined;
            total += one;
        }
        return total;
    } catch {
        return undefined;
    }
}
