import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "/Users/helen/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs";

const HERE = new URL("./", import.meta.url).pathname;
const PROFILE = resolve(HERE, ".chrome-flow-profile");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGET = "https://chisel-webmcp.helenkwok.workers.dev";

await rm(PROFILE, { recursive: true, force: true });
await mkdir(PROFILE, { recursive: true });
await writeFile(
  resolve(PROFILE, "Local State"),
  JSON.stringify({ browser: { enabled_labs_experiments: ["enable-webmcp-testing@1"] } }),
);

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1920, height: 1080 },
  acceptDownloads: true,
  args: ["--no-first-run", "--disable-default-apps", "--hide-scrollbars"],
});
const page = context.pages()[0] ?? (await context.newPage());

async function executeTool(name, input, approve = false) {
  const pending = page.evaluate(
    async ({ toolName, args }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((item) => item.name === toolName);
      if (!tool) throw new Error(`Missing tool ${toolName}`);
      return await document.modelContext.executeTool(tool, JSON.stringify(args));
    },
    { toolName: name, args: input },
  );
  if (approve) {
    const dialog = page.locator("[data-chisel-confirm]");
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    await dialog.locator("button").nth(1).click();
  }
  const raw = await pending;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function payload(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded" });
  await page.locator("[data-chisel-badge]").filter({ hasText: "ready" }).waitFor({ timeout: 30000 });

  console.log("initial", payload(await executeTool("chisel_get_document_info", {})));
  const box = payload(
    await executeTool(
      "chisel_create_box",
      { name: "Mounting bracket", x: -40, y: -20, z: 0, dx: 80, dy: 40, dz: 5 },
      true,
    ),
  );
  const holeA = payload(
    await executeTool(
      "chisel_create_cylinder",
      { name: "Hole A", x: -25, y: 0, z: -1, radius: 3, dz: 7 },
      true,
    ),
  );
  const holeB = payload(
    await executeTool(
      "chisel_create_cylinder",
      { name: "Hole B", x: 25, y: 0, z: -1, radius: 3, dz: 7 },
      true,
    ),
  );
  const cut = payload(
    await executeTool(
      "chisel_boolean_cut",
      {
        name: "Mounting bracket",
        targetId: box.createdIds[0],
        toolIds: [holeA.createdIds[0], holeB.createdIds[0]],
      },
      true,
    ),
  );
  console.log("cut", cut);
  console.log("object", payload(await executeTool("chisel_get_object", { id: cut.createdIds[0] })));
  console.log("globals", await page.evaluate(() => ({ app: typeof app, windowApp: typeof window.app })));
  console.log("databases before reload", await page.evaluate(() => indexedDB.databases()));
  await page.waitForTimeout(8000);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-chisel-badge]").filter({ hasText: "ready" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log("reloaded", payload(await executeTool("chisel_get_document_info", {})));
  console.log(
    "tools after reload",
    await page.evaluate(async () => (await document.modelContext.getTools()).map((tool) => tool.name)),
  );

  const candidates = await page.evaluate(() =>
    [...document.querySelectorAll("button,[title],[role=button]")]
      .map((element) => ({
        tag: element.tagName,
        text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120),
        title: element.getAttribute("title"),
        aria: element.getAttribute("aria-label"),
        cls: element.className,
      }))
      .filter((item) => /export|import/i.test(`${item.text} ${item.title} ${item.aria}`)),
  );
  console.log("export candidates", JSON.stringify(candidates, null, 2));

  const exportControl = page.locator('[title="Export"]');
  console.log("export controls", await exportControl.count());
  if (await exportControl.count()) {
    await exportControl.first().click();
    await page.waitForTimeout(1000);
    console.log("after export click", (await page.locator("body").innerText()).slice(-1800));
  }
} finally {
  await context.close();
}
