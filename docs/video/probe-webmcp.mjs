import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = new URL("./", import.meta.url).pathname;
const PROFILE = resolve(ROOT, ".chrome-probe-profile");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9471;
const TARGET = "https://chisel-webmcp.helenkwok.workers.dev";

await rm(PROFILE, { recursive: true, force: true });
await mkdir(PROFILE, { recursive: true });
await writeFile(
  resolve(PROFILE, "Local State"),
  JSON.stringify({ browser: { enabled_labs_experiments: ["enable-webmcp-testing@1"] } }),
);

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--disable-default-apps",
    "--disable-extensions",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1920,1080",
    TARGET,
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("http"));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint did not become ready");
}

function openCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  const ready = new Promise((resolveReady, rejectReady) => {
    socket.addEventListener("open", resolveReady, { once: true });
    socket.addEventListener("error", rejectReady, { once: true });
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

try {
  const target = await findTarget();
  const cdp = openCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable");
  await sleep(15000);
  const result = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      modelContext: typeof document.modelContext,
      executeTool: typeof document.modelContext?.executeTool,
      registerTool: typeof document.modelContext?.registerTool,
      modelContextOwnKeys: Reflect.ownKeys(document.modelContext ?? {}).map(String),
      modelContextPrototypeKeys: document.modelContext
        ? Reflect.ownKeys(Object.getPrototypeOf(document.modelContext)).map(String)
        : [],
      badge: document.querySelector('[data-chisel-badge]')?.textContent ?? null,
      activity: Boolean(document.querySelector('[data-chisel-activity]')),
      bodyText: document.body.innerText.slice(0, 1200)
    })`,
    returnByValue: true,
  });
  console.log(result.result?.value);
  const toolsResult = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const tools = await document.modelContext.getTools();
      return JSON.stringify(tools.map((tool) => ({
        name: tool.name,
        keys: Reflect.ownKeys(tool).map(String),
        prototypeKeys: Reflect.ownKeys(Object.getPrototypeOf(tool)).map(String)
      })));
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(toolsResult.result?.value);
  const toolResult = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((item) => item.name === "chisel_get_document_info");
      return await document.modelContext.executeTool(tool, "{}");
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(JSON.stringify(toolResult.result?.value));
  cdp.close();
} finally {
  chrome.kill("SIGTERM");
}
