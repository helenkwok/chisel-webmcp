import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { chromium } from "/Users/helen/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs";

const HERE = new URL("./", import.meta.url).pathname;
const PROFILE = resolve(HERE, ".chrome-demo-profile");
const DOWNLOADS = resolve(HERE, "downloads");
const OUTPUT = resolve(HERE, "screen.mp4");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGET = "https://chisel-webmcp.helenkwok.workers.dev";
const REPOSITORY = "https://github.com/helenkwok/chisel-webmcp";
const CAPTURE_FPS = 15;
const DURATION_SECONDS = 150;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

await rm(PROFILE, { recursive: true, force: true });
await rm(DOWNLOADS, { recursive: true, force: true });
await mkdir(PROFILE, { recursive: true });
await mkdir(DOWNLOADS, { recursive: true });
await writeFile(
  resolve(PROFILE, "Local State"),
  JSON.stringify({ browser: { enabled_labs_experiments: ["enable-webmcp-testing@1"] } }),
);

const launchOptions = {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1920, height: 1080 },
  acceptDownloads: true,
  args: [
    "--no-first-run",
    "--disable-default-apps",
    "--disable-extensions",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1920,1080",
  ],
};

async function waitForChisel(page) {
  await page.locator("[data-chisel-badge]").filter({ hasText: "ready" }).waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await page.waitForFunction(async () => (await document.modelContext?.getTools?.())?.length >= 15, null, {
    timeout: 45_000,
  });
}

// Warm the browser cache and activate the newest service worker before the
// recorded pass. The first load of a fresh profile can otherwise show the
// previous 14-tool worker for one navigation.
{
  const warmContext = await chromium.launchPersistentContext(PROFILE, launchOptions);
  const warmPage = warmContext.pages()[0] ?? (await warmContext.newPage());
  await warmPage.goto(TARGET, { waitUntil: "domcontentloaded" });
  await warmPage.locator("[data-chisel-badge]").waitFor({ timeout: 45_000 });
  await warmPage.reload({ waitUntil: "domcontentloaded" });
  await waitForChisel(warmPage);
  await warmContext.close();
}

const context = await chromium.launchPersistentContext(PROFILE, launchOptions);
const page = context.pages()[0] ?? (await context.newPage());
page.on("console", (message) => {
  if (message.type() === "error") console.error(`[browser] ${message.text()}`);
});

function payload(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function executeTool(name, input, { approve = false, holdSeconds = 0 } = {}) {
  await setOverlay("Calling real WebMCP tool", name, JSON.stringify(input, null, 2));
  const pending = page.evaluate(
    async ({ toolName, args }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((item) => item.name === toolName);
      if (!tool) throw new Error(`Missing registered tool: ${toolName}`);
      return await document.modelContext.executeTool(tool, JSON.stringify(args));
    },
    { toolName: name, args: input },
  );

  if (approve) {
    const dialog = page.locator("[data-chisel-confirm]");
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    if (holdSeconds) await sleep(holdSeconds * 1000);
    await dialog.locator("button").nth(1).click();
  }

  const raw = await pending;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const value = payload(parsed);
  await setOverlay("Real tool result", name, JSON.stringify(value, null, 2));
  return value;
}

async function installOverlay() {
  await page.evaluate(() => {
    document.querySelector("[data-demo-agent]")?.remove();
    const root = document.createElement("section");
    root.setAttribute("data-demo-agent", "");
    root.style.cssText = [
      "position:fixed;left:294px;top:72px;z-index:2147483645",
      "width:700px;max-height:300px;overflow:hidden",
      "border:1px solid rgba(148,163,184,.7);border-radius:12px",
      "background:rgba(15,23,42,.94);color:#f8fafc",
      "box-shadow:0 18px 48px rgba(15,23,42,.28)",
      "font:14px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif",
    ].join(";");
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(148,163,184,.28);font-weight:700">
        <span style="width:8px;height:8px;border-radius:50%;background:#22c55e"></span>
        <span>WebMCP agent</span>
        <span style="margin-left:auto;color:#94a3b8;font-size:12px;font-weight:500">direct registered-tool demo</span>
      </div>
      <div style="padding:13px 15px">
        <div data-demo-kicker style="color:#93c5fd;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Prompt</div>
        <div data-demo-title style="margin-top:4px;font-weight:700"></div>
        <textarea data-demo-agent-input readonly style="display:none;width:100%;height:68px;box-sizing:border-box;margin-top:8px;padding:10px 12px;resize:none;border:1px solid #475569;border-radius:8px;background:#020617;color:#f8fafc;font:15px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace"></textarea>
        <pre data-demo-body style="margin:8px 0 0;max-height:185px;overflow:hidden;white-space:pre-wrap;color:#cbd5e1;font:13px/1.42 ui-monospace,SFMono-Regular,Menlo,monospace"></pre>
      </div>`;
    document.body.appendChild(root);
  });
}

async function setOverlay(kicker, title, body = "") {
  await page.evaluate(
    ({ nextKicker, nextTitle, nextBody }) => {
      const root = document.querySelector("[data-demo-agent]");
      if (!root) return;
      root.querySelector("[data-demo-kicker]").textContent = nextKicker;
      root.querySelector("[data-demo-title]").textContent = nextTitle;
      root.querySelector("[data-demo-body]").textContent = nextBody;
      root.querySelector("[data-demo-agent-input]").style.display = "none";
    },
    { nextKicker: kicker, nextTitle: title, nextBody: body },
  );
}

async function showPrompt(prompt) {
  await page.evaluate(() => {
    const root = document.querySelector("[data-demo-agent]");
    root.querySelector("[data-demo-kicker]").textContent = "Prompt";
    root.querySelector("[data-demo-title]").textContent = "Ask Chisel to build a solid";
    root.querySelector("[data-demo-body]").textContent = "";
    const input = root.querySelector("[data-demo-agent-input]");
    input.value = "";
    input.style.display = "block";
  });
  await page.locator("[data-demo-agent-input]").pressSequentially(prompt, { delay: 24 });
}

let timelineStart = 0;
async function at(seconds) {
  const remaining = timelineStart + seconds * 1000 - performance.now();
  if (remaining > 0) await sleep(remaining);
}

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(CAPTURE_FPS),
    "-vcodec",
    "mjpeg",
    "-i",
    "pipe:0",
    "-an",
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-movflags",
    "+faststart",
    OUTPUT,
  ],
  { stdio: ["pipe", "ignore", "pipe"] },
);
let ffmpegError = "";
ffmpeg.stderr.on("data", (chunk) => {
  ffmpegError += chunk;
});
const ffmpegDone = new Promise((resolveDone, rejectDone) => {
  ffmpeg.on("error", rejectDone);
  ffmpeg.on("close", (code) => {
    if (code === 0) resolveDone();
    else rejectDone(new Error(`ffmpeg exited ${code}: ${ffmpegError}`));
  });
});

let cdp;
let frameTimer;
let latestFrame;
let writtenFrames = 0;

try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded" });
  await waitForChisel(page);
  await installOverlay();

  cdp = await context.newCDPSession(page);
  latestFrame = await page.screenshot({ type: "jpeg", quality: 88 });
  cdp.on("Page.screencastFrame", async (event) => {
    latestFrame = Buffer.from(event.data, "base64");
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
    } catch {
      // Navigation can briefly invalidate an acknowledgement.
    }
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 88,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });

  const requiredFrames = DURATION_SECONDS * CAPTURE_FPS;
  frameTimer = setInterval(() => {
    if (!latestFrame || writtenFrames >= requiredFrames) return;
    ffmpeg.stdin.write(latestFrame);
    writtenFrames += 1;
  }, 1000 / CAPTURE_FPS);

  timelineStart = performance.now();
  const prompt = "Make me a mounting bracket 80 by 40 by 5 millimetres with two 6mm holes, 50mm apart.";

  await at(1);
  await showPrompt(prompt);

  await at(8);
  await executeTool("chisel_get_document_info", {});

  await at(14);
  const box = await executeTool(
    "chisel_create_box",
    { name: "Mounting bracket", x: -40, y: -20, z: 0, dx: 80, dy: 40, dz: 5 },
    { approve: true, holdSeconds: 5 },
  );

  await at(42);
  const holeA = await executeTool(
    "chisel_create_cylinder",
    { name: "Hole A", x: -25, y: 0, z: -1, radius: 3, dz: 7 },
    { approve: true, holdSeconds: 2 },
  );

  await at(47);
  const holeB = await executeTool(
    "chisel_create_cylinder",
    { name: "Hole B", x: 25, y: 0, z: -1, radius: 3, dz: 7 },
    { approve: true, holdSeconds: 2 },
  );

  await at(52);
  const cut = await executeTool(
    "chisel_boolean_cut",
    {
      name: "Mounting bracket",
      targetId: box.createdIds[0],
      toolIds: [holeA.createdIds[0], holeB.createdIds[0]],
    },
    { approve: true, holdSeconds: 4 },
  );
  await setOverlay(
    "Kernel result",
    "Boolean cut succeeded",
    `affectedCount: ${cut.affectedCount}\n1 resulting solid created\n3 input solids consumed`,
  );

  await at(81);
  await showPrompt("What are the exact dimensions of the bracket, and how many objects are in the document?");

  await at(86);
  await executeTool("chisel_get_scene_tree", {});
  await at(89);
  const object = await executeTool("chisel_get_object", { id: cut.createdIds[0] });
  await setOverlay(
    "Measured by the CAD kernel",
    "Mounting bracket",
    `boundingBox.size: ${JSON.stringify(object.boundingBox?.size)}\nobject id: ${object.id}\nshape: analytic B-rep solid`,
  );

  await at(106);
  const savedId = await page.evaluate(async () => {
    const document = window.app.activeView?.document;
    await document.save();
    return document.id;
  });
  await setOverlay(
    "Persistence check",
    "Saved the active document to IndexedDB",
    `document id: ${savedId}\nReloading the browser page now…`,
  );

  await at(111);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForChisel(page);
  await installOverlay();
  await setOverlay(
    "Persistence check",
    "Page reloaded",
    "The app opened a fresh empty document; reopening the saved IndexedDB document explicitly.",
  );
  await page.evaluate(async (documentId) => {
    await window.app.openDocument(documentId);
    window.app.activeView?.cameraController?.fitContent();
    window.app.activeView?.update();
  }, savedId);
  const reopened = await executeTool("chisel_get_document_info", {});
  await setOverlay(
    "Persistence check",
    "Saved document reopened after reload",
    `objectCount: ${reopened.objectCount}\ndocument: ${reopened.documentName}\nstorage: IndexedDB`,
  );

  await at(120);
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  const exported = await executeTool(
    "chisel_export",
    { format: ".step", filename: "mounting-bracket" },
    { approve: true, holdSeconds: 2 },
  );
  const download = await downloadPromise;
  await download.saveAs(resolve(DOWNLOADS, "mounting-bracket.step"));
  await setOverlay(
    "Gated export result",
    exported.file,
    `bytes: ${exported.bytes}\nvalid ISO-10303: ${exported.validIso10303}\nanalytic planes: ${exported.analyticPlanes}\nanalytic cylinders: ${exported.analyticCylinders}`,
  );

  await at(130);
  await page.goto(REPOSITORY, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const boundary = page.getByText("What is new work, and what is not", { exact: false }).first();
  await boundary.waitFor({ state: "visible", timeout: 20_000 });
  await boundary.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.zoom = "1.12";
  });

  await at(DURATION_SECONDS);
  clearInterval(frameTimer);
  frameTimer = undefined;
  while (writtenFrames < requiredFrames) {
    ffmpeg.stdin.write(latestFrame);
    writtenFrames += 1;
  }
  ffmpeg.stdin.end();
  await ffmpegDone;
  await cdp.send("Page.stopScreencast").catch(() => {});
  console.log(`Recorded ${writtenFrames} browser frames to ${OUTPUT}`);
} finally {
  if (frameTimer) clearInterval(frameTimer);
  if (!ffmpeg.stdin.destroyed && !ffmpeg.stdin.writableEnded) ffmpeg.stdin.end();
  await context.close();
}
