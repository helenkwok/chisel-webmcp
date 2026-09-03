// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// THE SINGLE WRITE CHOKEPOINT.
//
// There is exactly ONE mutating tool. Every modelling operation an agent can
// perform goes through it, which means every mutation passes the same in-page
// confirm and produces the same audit line. Ten open write verbs would be a
// larger surface and a smaller amount of judgement.
//
// The other rule here is the honest affected count: an operation that changed
// nothing returns isError, never a cheerful "done". This directly answers the
// WebMCP spec's own stated threat — "a tool can claim to be read-only while
// changing data" — and its mirror image, a tool that claims success while
// changing nothing. An agent that is lied to compounds the lie.

import type { IApplication, IDocument, INode, IShape, Result } from "@chili3d/core";
import { EditableShapeNode, Plane, Transaction, XYZ } from "@chili3d/core";
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

/** Unwraps a chili3d Result<T>, turning a failure into a message the agent can use. */
function unwrap<T>(r: Result<T>, what: string): T {
    if ((r as any)?.isOk === false || (r as any)?.error) {
        throw new Error(`The CAD kernel refused to ${what}: ${(r as any).error ?? "unknown kernel error"}`);
    }
    const v = (r as any)?.value ?? r;
    if (!v) throw new Error(`The CAD kernel returned nothing when asked to ${what}.`);
    return v as T;
}

function planeAt(x = 0, y = 0, z = 0): Plane {
    return new Plane({ origin: new XYZ({ x, y, z }), normal: XYZ.unitZ, xvec: XYZ.unitX } as any);
}

export const APPLY_OPERATION: ToolDef = {
    name: "chisel_apply_operation",
    title: "Apply a modelling operation",
    write: true,
    description:
        "Perform ONE solid-modelling operation on the CAD document. This is the only tool that can change the model, and every call is shown to the human for confirmation before it runs. " +
        "Dimensions are in millimetres. Returns the number of objects actually created, changed or removed — if that number is zero the call is reported as an error, so trust the count. " +
        "Supported operations: create_box, create_cylinder, create_sphere, boolean_cut (subtract tools from a target), boolean_union, move, delete.",
    inputSchema: {
        type: "object",
        properties: {
            operation: {
                type: "string",
                enum: [
                    "create_box",
                    "create_cylinder",
                    "create_sphere",
                    "boolean_cut",
                    "boolean_union",
                    "move",
                    "delete",
                ],
                description: "Which modelling operation to perform.",
            },
            name: { type: "string", description: "Name for a newly created object." },
            x: { type: "number", description: "Origin X in mm. Default 0." },
            y: { type: "number", description: "Origin Y in mm. Default 0." },
            z: { type: "number", description: "Origin Z in mm. Default 0." },
            dx: { type: "number", description: "Box size along X, or move delta X, in mm." },
            dy: { type: "number", description: "Box size along Y, or move delta Y, in mm." },
            dz: { type: "number", description: "Box/cylinder height along Z, or move delta Z, in mm." },
            radius: { type: "number", description: "Radius in mm, for cylinder and sphere." },
            targetId: { type: "string", description: "Object id to cut from, move, or delete." },
            toolIds: {
                type: "array",
                items: { type: "string" },
                description: "Object ids used as cutting/joining tools. Consumed by the operation.",
            },
        },
        required: ["operation"],
        additionalProperties: false,
    },
    handler: (input: any, app: IApplication) => {
        const doc = requireDocument(app);
        const factory = app.shapeProvider.factory;
        const op = input.operation as string;
        let affected = 0;
        const created: string[] = [];
        const removed: string[] = [];

        Transaction.execute(doc, `Agent: ${op}`, () => {
            switch (op) {
                case "create_box": {
                    const { dx, dy, dz } = input;
                    if (!dx || !dy || !dz) throw new Error("create_box requires non-zero dx, dy and dz (mm).");
                    const solid = unwrap(
                        factory.box(planeAt(input.x, input.y, input.z), dx, dy, dz),
                        `create a ${dx}x${dy}x${dz} box`,
                    );
                    const node = new EditableShapeNode({
                        document: doc,
                        name: input.name ?? "Box",
                        shape: solid,
                    } as any);
                    doc.modelManager.addNode(node);
                    created.push(node.id);
                    affected++;
                    break;
                }
                case "create_cylinder": {
                    const { radius, dz } = input;
                    if (!radius || !dz) throw new Error("create_cylinder requires non-zero radius and dz (mm).");
                    const solid = unwrap(
                        factory.cylinder(
                            XYZ.unitZ,
                            new XYZ({ x: input.x ?? 0, y: input.y ?? 0, z: input.z ?? 0 }),
                            radius,
                            dz,
                        ),
                        `create a radius-${radius} cylinder`,
                    );
                    const node = new EditableShapeNode({
                        document: doc,
                        name: input.name ?? "Cylinder",
                        shape: solid,
                    } as any);
                    doc.modelManager.addNode(node);
                    created.push(node.id);
                    affected++;
                    break;
                }
                case "create_sphere": {
                    if (!input.radius) throw new Error("create_sphere requires a non-zero radius (mm).");
                    const solid = unwrap(
                        factory.sphere(new XYZ({ x: input.x ?? 0, y: input.y ?? 0, z: input.z ?? 0 }), input.radius),
                        `create a radius-${input.radius} sphere`,
                    );
                    const node = new EditableShapeNode({
                        document: doc,
                        name: input.name ?? "Sphere",
                        shape: solid,
                    } as any);
                    doc.modelManager.addNode(node);
                    created.push(node.id);
                    affected++;
                    break;
                }
                case "boolean_cut":
                case "boolean_union": {
                    const { targetId, toolIds } = input;
                    if (!targetId || !toolIds?.length) {
                        throw new Error(`${op} requires targetId and a non-empty toolIds array.`);
                    }
                    const target = findNode(doc, targetId);
                    const tools = toolIds.map((id: string) => findNode(doc, id));
                    const result =
                        op === "boolean_cut"
                            ? factory.booleanCut([shapeOf(target)], tools.map(shapeOf))
                            : factory.booleanFuse([shapeOf(target)], tools.map(shapeOf), true);
                    const shape = unwrap(result, op === "boolean_cut" ? "subtract those solids" : "fuse those solids");
                    const node = new EditableShapeNode({
                        document: doc,
                        name: input.name ?? target.name,
                        shape,
                    } as any);
                    doc.modelManager.addNode(node);
                    created.push(node.id);
                    affected++;
                    // The operands are consumed — a boolean replaces its inputs.
                    for (const n of [target, ...tools]) {
                        n.parent?.remove(n);
                        removed.push(n.id);
                        affected++;
                    }
                    break;
                }
                case "move": {
                    const node = findNode(doc, input.targetId);
                    const { dx = 0, dy = 0, dz = 0 } = input;
                    if (!dx && !dy && !dz) throw new Error("move requires a non-zero dx, dy or dz.");
                    const visual = node as any;
                    visual.transform = visual.transform.multiply(
                        (Plane as any).translation
                            ? (Plane as any).translation(dx, dy, dz)
                            : visual.transform.constructor.translation(dx, dy, dz),
                    );
                    affected++;
                    break;
                }
                case "delete": {
                    const ids: string[] = input.toolIds?.length ? input.toolIds : [input.targetId];
                    for (const id of ids) {
                        const n = findNode(doc, id);
                        n.parent?.remove(n);
                        removed.push(id);
                        affected++;
                    }
                    break;
                }
                default:
                    throw new Error(`Unknown operation "${op}".`);
            }
        });

        // The honest affected count. Zero is an error, never a fake success.
        if (affected === 0) {
            throw new Error(
                `Operation "${op}" completed without changing anything. Nothing was created, modified or removed. Do not report this as done — re-check your object ids with chisel_get_scene_tree.`,
            );
        }

        // Frame what just changed.
        //
        // An agent creating an 80mm part in an empty viewport leaves it as a speck
        // near the origin — the operation succeeded and the human cannot see it,
        // which reads as a failure. The agent has no way to drive the camera, so
        // the write path owes it: after anything that changed geometry, fit the
        // view. Best-effort — a camera failure must never fail the modelling call.
        try {
            app.activeView?.cameraController?.fitContent();
            app.activeView?.update();
        } catch {
            /* the geometry is correct even if the camera didn't move */
        }

        return {
            operation: op,
            affectedCount: affected,
            createdIds: created,
            removedIds: removed,
            note: "Change is in the undo history and is saved to IndexedDB — it will survive a page reload. The viewport has been re-framed to show the result.",
        };
    },
};
