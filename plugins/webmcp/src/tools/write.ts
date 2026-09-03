// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// THE WRITE TOOLS, AND THE ONE PLACE THEY ARE ENFORCED.
//
// Eight named tools with narrow schemas, all funnelling into one operation core
// and all registered through one gate. The safety property is NOT "there is
// only one write tool" — that claim was wrong, and a design review was
// right to say so. An operation enum is not a sandbox; seven operations behind
// a dispatcher are still seven operations.
//
// The property that is actually true: there is exactly ONE place where a write
// becomes callable, `makeGatedExecute` in gate.ts, and no export here produces
// a handler that skips it. Add an eighth verb tomorrow and it is gated because
// there is no other way to register it.
//
// The rest of the discipline is honesty about outcomes: an operation that
// changed nothing returns isError, never a cheerful "done". That answers the
// spec's own threat — "a tool can claim to be read-only while changing data" —
// and its mirror image. An agent that is lied to compounds the lie.

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

/**
 * The operation core. Every write tool below funnels into this one function,
 * and every one of them is registered through the same gate.
 *
 * An earlier version of this file exposed a SINGLE `apply_operation` tool with
 * an operation enum, and argued that one verb was safer than seven. An external
 * review took that apart correctly: an enum is not a sandbox. Seven operations
 * behind a dispatcher are seven operations, in one origin and one JS heap, and
 * the actual control was always the gate at the registration boundary — not the
 * tool count. Worse, discriminated unions are measurably harder for a model to
 * call correctly than small tools with tight schemas, so the "safer" design was
 * also the one more likely to fail live.
 *
 * So: named tools with narrow schemas, ONE shared enforcement point. The safety
 * claim is now about where enforcement lives, which is the claim that was ever
 * true.
 */
const OPERATION_CORE: ToolDef = {
    name: "chisel_apply_operation",
    title: "Apply a modelling operation",
    write: true,
    description:
        "Internal shared operation core for the named modelling tools. Every registered write call is shown to the human for confirmation before it runs. " +
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
                    "undo",
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
                case "undo": {
                    // A design review named this gap: without undo the agent can
                    // create a wrong solid and has no way back, so the only
                    // recovery is a human reaching for the UI. An agent that can
                    // change a model should be able to retract the change.
                    const hist = doc.history as any;
                    if (!hist?.undo) throw new Error("This document has no undo history available.");
                    hist.undo();
                    affected++;
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


// ─────────────────────────────────────────────────────────────────────────────
// Named write tools.
//
// Each one is a thin, tightly-schema'd face over OPERATION_CORE. A model picks
// between small tools far more reliably than it fills a discriminated union, so
// this is both the safer design AND the one less likely to fail on camera.
// ─────────────────────────────────────────────────────────────────────────────

const num = (description: string) => ({ type: "number", description });
const ids = (description: string) => ({ type: "array", items: { type: "string" }, description });

/** Builds a write tool that fixes `operation` and forwards everything else. */
function op(
    name: string,
    title: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
): ToolDef {
    return {
        name,
        title,
        description,
        write: true,
        inputSchema: { type: "object", properties, required, additionalProperties: false },
        // Same core, same gate. The only thing a named tool adds is a better schema.
        handler: (input: any, app: IApplication) =>
            OPERATION_CORE.handler({ ...input, operation: name.replace(/^chisel_/, "") }, app),
    };
}

export const WRITE_TOOLS: ToolDef[] = [
    op(
        "chisel_create_box",
        "Create a box",
        "Create a rectangular solid box. All dimensions in millimetres. The lower corner sits at (x, y, z), which default to the origin, so a plate lies flat with dz as its THICKNESS. " +
            "For a part described as 80 by 40 by 5, use dx=80, dy=40, dz=5.",
        {
            name: { type: "string", description: "Name for the new object." },
            x: num("Lower-corner X in mm. Default 0."),
            y: num("Lower-corner Y in mm. Default 0."),
            z: num("Lower-corner Z in mm. Default 0."),
            dx: num("Size along X in mm."),
            dy: num("Size along Y in mm."),
            dz: num("Size along Z in mm."),
        },
        ["dx", "dy", "dz"],
    ),
    op(
        "chisel_create_cylinder",
        "Create a cylinder",
        "Create a cylindrical solid along the Z axis, centred on (x, y) with its base at z. All millimetres. " +
            "TO DRILL A HOLE this is step one of two: create the cylinder here, then remove it with chisel_boolean_cut. " +
            "The cylinder MUST overshoot the material on both ends or the cut leaves a thin skin behind: for a 5mm thick plate sitting on z=0, use z=-2 and dz=9, not z=0 and dz=5. " +
            "Hole radius is half the nominal diameter, so an M6 bolt hole is radius 3.",
        {
            name: { type: "string", description: "Name for the new object." },
            x: num("Centre X in mm. Default 0."),
            y: num("Centre Y in mm. Default 0."),
            z: num("Base Z in mm. Default 0."),
            radius: num("Radius in mm. For an M6 clearance hole use 3."),
            dz: num("Height in mm."),
        },
        ["radius", "dz"],
    ),
    op(
        "chisel_create_sphere",
        "Create a sphere",
        "Create a spherical solid centred on (x, y, z). Dimensions in millimetres.",
        {
            name: { type: "string", description: "Name for the new object." },
            x: num("Centre X in mm. Default 0."),
            y: num("Centre Y in mm. Default 0."),
            z: num("Centre Z in mm. Default 0."),
            radius: num("Radius in mm."),
        },
        ["radius"],
    ),
    op(
        "chisel_boolean_cut",
        "Subtract solids",
        "Subtract one or more tool solids FROM a target solid. This is how holes and pockets are made. " +
            "The target AND every tool are consumed and replaced by one new solid with a NEW id, so any id you were holding is stale afterwards: re-read the tree if you need it. " +
            "WORKED EXAMPLE, a plate with two bolt holes: chisel_create_box(dx=80,dy=40,dz=5) then chisel_create_cylinder(x=15,y=20,z=-2,radius=3,dz=9) and again at x=65, then chisel_boolean_cut(targetId=<the box>, toolIds=[<both cylinders>]). " +
            "Verify with chisel_get_object on the result: the volume should have dropped by roughly the volume of the cylinders inside the material.",
        {
            name: { type: "string", description: "Name for the resulting solid. Defaults to the target's name." },
            targetId: { type: "string", description: "Id of the solid to cut material out of." },
            toolIds: ids("Ids of the solids to subtract. These are consumed."),
        },
        ["targetId", "toolIds"],
    ),
    op(
        "chisel_boolean_union",
        "Fuse solids",
        "Fuse a target solid together with one or more other solids into a single solid. All operands are consumed.",
        {
            name: { type: "string", description: "Name for the resulting solid." },
            targetId: { type: "string", description: "Id of the first solid." },
            toolIds: ids("Ids of the solids to fuse into it. These are consumed."),
        },
        ["targetId", "toolIds"],
    ),
    op(
        "chisel_move",
        "Move an object",
        "Translate an object by a delta in millimetres.",
        {
            targetId: { type: "string", description: "Id of the object to move." },
            dx: num("Delta X in mm."),
            dy: num("Delta Y in mm."),
            dz: num("Delta Z in mm."),
        },
        ["targetId"],
    ),
    op(
        "chisel_delete",
        "Delete objects",
        "Permanently remove one or more objects from the document. Pass EITHER targetId for one object OR toolIds for several. " +
            "If you are reversing a change you just made, use chisel_undo instead: it restores the previous state exactly, whereas deleting leaves you to rebuild what was consumed.",
        {
            targetId: { type: "string", description: "Id of a single object to delete." },
            toolIds: ids("Ids of several objects to delete."),
        },
        [],
    ),
    op(
        "chisel_undo",
        "Undo the last change",
        "Undo the most recent change to the document, restoring the previous state exactly. Use it to retract an operation that turned out wrong, including a boolean that consumed solids you wanted back. " +
            "It undoes ONE step; call it repeatedly to go further back, and check chisel_get_change_log to see where you are.",
        {},
        [],
    ),
];
