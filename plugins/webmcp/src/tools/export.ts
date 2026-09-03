// Chisel — WebMCP agent surface for Chili3d. MIT licensed. See LICENSE.
//
// EXPORT.
//
// Without this tool the story stops one step short: the agent builds a solid and
// then a human has to reach for a menu to get it out. With it, the agent can
// finish the job — "make me a bracket and give me the STEP file" is a single
// conversation, and what lands on disk is a real ISO-10303 part file.
//
// Why it counts as a write even though it changes no geometry: it puts a file on
// the user's machine. The gate is about consequences leaving the page, not about
// mutation specifically, so this goes through the same confirm as everything
// else. It also demonstrates that the gate is not hardwired to geometry.
//
// The returned summary reports what is actually IN the file — the schema, the
// solid count, the number of analytic surfaces — because "exported 25kB" is not
// evidence of anything. Analytic surfaces are the difference between a real
// B-rep part file and a tessellated mesh wearing a .step extension, and an agent
// reporting success to a human should be able to tell them apart.

import type { IApplication, IDocument } from "@chili3d/core";
import { VisualNode } from "@chili3d/core";
import type { ToolDef } from "../gate";

/** Formats Chili3d's exporter accepts, as reported by the app at runtime. */
const FORMATS = [".step", ".iges", ".brep", ".stl", ".obj"] as const;

function requireDocument(app: IApplication): IDocument {
    const doc = app.activeView?.document ?? [...app.documents][0];
    if (!doc) throw new Error("No document is open, so there is nothing to export.");
    return doc;
}

function visualNodes(doc: IDocument): VisualNode[] {
    const out: VisualNode[] = [];
    const walk = (n: any) => {
        if (n instanceof VisualNode) out.push(n);
        let c = n.firstChild;
        while (c) {
            walk(c);
            c = c.nextSibling;
        }
    };
    walk(doc.modelManager.rootNode);
    return out;
}

/** What is actually in the file. Cheap to compute, and it makes the claim checkable. */
function describeStep(text: string) {
    const schema = text.match(/FILE_SCHEMA\(\('([^']+)'\)\)/)?.[1];
    return {
        validIso10303: text.startsWith("ISO-10303-21;") && text.trimEnd().endsWith("END-ISO-10303-21;"),
        schema,
        solids: (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length,
        analyticPlanes: (text.match(/\bPLANE\(/g) ?? []).length,
        analyticCylinders: (text.match(/CYLINDRICAL_SURFACE/g) ?? []).length,
    };
}

export const EXPORT_TOOLS: ToolDef[] = [
    {
        name: "chisel_export",
        title: "Export the model to a CAD file",
        write: true,
        description:
            "Export the model to a real CAD file and download it. STEP (.step) is the interchange format to use unless the user asks otherwise — it carries exact analytic B-rep geometry, so the result is manufacturable rather than a triangle mesh. Use .stl or .obj only for 3D printing or rendering. Returns a summary of what the file actually contains, including whether the geometry is analytic; report that to the user rather than just claiming success.",
        inputSchema: {
            type: "object",
            properties: {
                format: {
                    type: "string",
                    enum: [...FORMATS],
                    description: "File format. Default .step.",
                },
                filename: {
                    type: "string",
                    description: "Filename without extension. Defaults to the document name.",
                },
            },
            required: [],
            additionalProperties: false,
        },
        handler: async (input: { format?: string; filename?: string }, app) => {
            const doc = requireDocument(app);
            const format = input?.format ?? ".step";
            const nodes = visualNodes(doc);
            if (!nodes.length) {
                throw new Error(
                    "The document has no geometry to export. Create something first, then export.",
                );
            }

            const parts = await app.dataExchange.export(format, nodes);
            if (!parts?.length) {
                throw new Error(
                    `The exporter returned nothing for ${format}. Do not report this as a successful export.`,
                );
            }

            const blob = new Blob(parts);
            if (blob.size === 0) {
                throw new Error(`The exporter produced a zero-byte ${format} file. Nothing was saved.`);
            }

            const base = (input?.filename ?? doc.name ?? "model").replace(/[^\w.-]+/g, "_");
            const name = `${base}${format.split(" ")[0]}`;

            // Hand the file to the browser's own download path.
            const url = URL.createObjectURL(blob);
            try {
                const a = document.createElement("a");
                a.href = url;
                a.download = name;
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                a.remove();
            } finally {
                // Give the download a tick to start before revoking.
                setTimeout(() => URL.revokeObjectURL(url), 30_000);
            }

            const summary: Record<string, unknown> = {
                file: name,
                format,
                bytes: blob.size,
                objectsExported: nodes.length,
            };
            if (format === ".step") {
                Object.assign(summary, describeStep(await blob.text()));
            }
            summary["note"] =
                "The file has been downloaded to the user's machine. If analyticPlanes or analyticCylinders are above zero, this is exact B-rep geometry, not a mesh.";
            return summary;
        },
    },
];
