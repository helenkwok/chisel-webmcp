// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// MODIFY.
//
// Fillet and chamfer are the finishing moves an agent reaches for after the
// gross geometry is right — rounding sharp edges or bevelling them for
// clearance, aesthetics, or printability. Without these tools the agent can
// build a box but cannot soften its corners, which is a common real-world ask.
//
// The kernel takes edge indexes, not edge ids. When the caller names only a
// target solid we fillet/chamfer every edge on it (the same default a human
// gets by selecting the body and accepting all edges). Failures are common —
// radius too large for the geometry is the usual one — so we throw with a
// concrete next step, never a success with affectedCount 0.

import type { IApplication, IDocument, INode, IShape, Result } from "@chili3d/core";
import { EditableShapeNode, ShapeTypes, Transaction } from "@chili3d/core";
import type { ToolDef } from "../gate";

function requireDocument(app: IApplication): IDocument {
    const doc = app.activeView?.document ?? [...app.documents][0];
    if (!doc) throw new Error("No document is open. Ask the user to create or open a document first.");
    return doc;
}

function allNodes(doc: IDocument): INode[] {
    const out: INode[] = [];
    const walk = (n: any) => {
        out.push(n);
        let c = n.firstChild;
        while (c) {
            walk(c);
            c = c.nextSibling;
        }
    };
    walk(doc.modelManager.rootNode);
    return out.slice(1);
}

function findNode(doc: IDocument, id: string): INode {
    const n = allNodes(doc).find((x) => x.id === id);
    if (!n) throw new Error(`No object with id "${id}". Call chisel_get_scene_tree to list valid ids.`);
    return n;
}

function shapeOf(node: INode): IShape {
    const r = (node as any)?.shape;
    const s = r?.value ?? r;
    if (!s) throw new Error(`Object "${node.name}" (${node.id}) has no solid geometry to operate on.`);
    return s;
}

/** 0-based indexes into TopExp::MapShapes(TopAbs_EDGE) — the kernel's edge list. */
function allEdgeIndexes(shape: IShape): number[] {
    const count = shape.findSubShapes(ShapeTypes.edge).length;
    if (count === 0) {
        throw new Error("The target solid has no edges to modify.");
    }
    return Array.from({ length: count }, (_, i) => i);
}

/**
 * Unwraps a fillet/chamfer Result. Kernel refusal is common (radius too large,
 * distance longer than an adjacent face) — the message must tell the agent what
 * to try next, not just that it failed.
 */
function unwrapModify(
    r: Result<IShape>,
    operation: "fillet" | "chamfer",
    amount: number,
    amountLabel: "radius" | "distance",
): IShape {
    if ((r as any)?.isOk === false || (r as any)?.error) {
        const err = (r as any).error ?? "unknown kernel error";
        const hint =
            operation === "fillet"
                ? `Try a smaller radius (you used ${amount} mm) — a fillet radius must usually be well under half the shortest edge. Start with 1–2 mm on a small part.`
                : `Try a smaller chamfer distance (you used ${amount} mm) — the bevel must fit within the adjacent faces. Start with 1–2 mm.`;
        throw new Error(`The CAD kernel refused to ${operation} those edges: ${err}. ${hint}`);
    }
    const v = (r as any)?.value ?? r;
    if (!v) {
        throw new Error(
            `The CAD kernel returned nothing when asked to ${operation} with ${amountLabel} ${amount} mm. ${operation === "fillet" ? "Try a smaller radius." : "Try a smaller distance."}`,
        );
    }
    return v as IShape;
}

function applyEdgeModify(
    input: { targetId: string },
    app: IApplication,
    operation: "fillet" | "chamfer",
    amount: number,
    amountLabel: "radius" | "distance",
) {
    if (!amount || amount <= 0) {
        throw new Error(`${operation} requires a positive ${amountLabel} in millimetres.`);
    }

    const doc = requireDocument(app);
    const factory = app.shapeProvider.factory;
    const target = findNode(doc, input.targetId);
    const shape = shapeOf(target);
    const edges = allEdgeIndexes(shape);

    let affected = 0;
    const created: string[] = [];
    const removed: string[] = [];

    Transaction.execute(doc, `Agent: ${operation}`, () => {
        const result =
            operation === "fillet"
                ? factory.fillet(shape, edges, amount)
                : factory.chamfer(shape, edges, amount);
        const newShape = unwrapModify(result, operation, amount, amountLabel);

        const node = new EditableShapeNode({
            document: doc,
            name: target.name,
            shape: newShape,
        } as any);
        doc.modelManager.addNode(node);
        created.push(node.id);
        affected++;

        // The operand is consumed — same discipline as boolean_cut.
        target.parent?.remove(target);
        removed.push(target.id);
        affected++;
    });

    if (affected === 0) {
        throw new Error(
            `${operation} completed without changing anything. Nothing was created, modified or removed. Do not report this as done — re-check your object id with chisel_get_scene_tree.`,
        );
    }

    try {
        app.activeView?.cameraController?.fitContent();
        app.activeView?.update();
    } catch {
        /* the geometry is correct even if the camera didn't move */
    }

    return {
        operation,
        affectedCount: affected,
        createdIds: created,
        removedIds: removed,
        edgesModified: edges.length,
        [amountLabel]: amount,
        note: "Change is in the undo history and is saved to IndexedDB — it will survive a page reload. The viewport has been re-framed to show the result.",
    };
}

const num = (description: string) => ({ type: "number", description });

export const MODIFY_TOOLS: ToolDef[] = [
    {
        name: "chisel_fillet",
        title: "Fillet (round) edges",
        write: true,
        description:
            "Round every edge of a solid by a fillet radius in millimetres. All edges on the target are filleted — there is no per-edge picker. " +
            "Sensible starting values: 1–2 mm on a small part, 5–10 mm on a large one. The radius must be smaller than roughly half the shortest edge; " +
            "if the kernel refuses, halve the radius and try again rather than reporting success.",
        inputSchema: {
            type: "object",
            properties: {
                targetId: { type: "string", description: "Id of the solid whose edges to round." },
                radius: num("Fillet radius in mm. Must be positive and smaller than about half the shortest edge."),
            },
            required: ["targetId", "radius"],
            additionalProperties: false,
        },
        handler: (input: { targetId: string; radius: number }, app) =>
            applyEdgeModify(input, app, "fillet", input.radius, "radius"),
    },
    {
        name: "chisel_chamfer",
        title: "Chamfer (bevel) edges",
        write: true,
        description:
            "Bevel every edge of a solid by a chamfer distance in millimetres. All edges on the target are chamfered — there is no per-edge picker. " +
            "Sensible starting values: 1–2 mm on a small part, 3–5 mm on a larger one. The distance must fit within the adjacent faces; " +
            "if the kernel refuses, use a smaller distance and try again rather than reporting success.",
        inputSchema: {
            type: "object",
            properties: {
                targetId: { type: "string", description: "Id of the solid whose edges to bevel." },
                distance: num("Chamfer distance in mm. Must be positive and smaller than the adjacent face width."),
            },
            required: ["targetId", "distance"],
            additionalProperties: false,
        },
        handler: (input: { targetId: string; distance: number }, app) =>
            applyEdgeModify(input, app, "chamfer", input.distance, "distance"),
    },
];
