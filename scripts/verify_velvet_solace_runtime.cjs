const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFile, writeFile } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const runId = args[args.indexOf("--run-id") + 1];
if (!/^[0-9]{8}t[0-9]{6}z-[a-z0-9]{6,16}$/.test(runId || "")) {
  process.stderr.write("invalid run id\n");
  process.exit(1);
}

const artifactRoot = path.resolve(process.env.QUORUMX_E2E_ARTIFACT_DIR || path.join(root, ".quorumx-e2e"));
const runDirectory = path.join(artifactRoot, runId);
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const children = [];
const chrome = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean).find((candidate) => require("node:fs").existsSync(candidate));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`runtime did not become ready at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function start(config, port, env, logName, extraArgs = []) {
  const output = [];
  const child = spawn(process.execPath, [
    wrangler, "dev", "--config", config, "--local", "--ip", "127.0.0.1",
    "--port", String(port), "--inspector-port", "0", "--log-level", "error",
    "--show-interactive-dev-session", "false", ...extraArgs,
  ], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  child.once("exit", async () => {
    await writeFile(path.join(runDirectory, logName), output.join(""), { flag: "w" }).catch(() => undefined);
  });
  children.push(child);
  return child;
}

async function portClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(true));
    socket.setTimeout(1_000, () => { socket.destroy(); resolve(true); });
  });
}

async function stopAll() {
  for (const child of children) if (!child.killed) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

async function main() {
  const state = JSON.parse(await readFile(path.join(runDirectory, "state.json"), "utf8"));
  const [apiPort, sitePort] = await Promise.all([freePort(), freePort()]);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const siteUrl = `http://127.0.0.1:${sitePort}`;
  start("wrangler.jsonc", apiPort, {
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: state.runtimeUrl,
    QUORUMX_ADMIN_TOKEN: `local-${runId}`,
    QUORUMX_GENLAYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  }, "api-runtime.log");
  start("wrangler.site.jsonc", sitePort, {}, "site-runtime.log", ["--var", `QUORUMX_API_BASE:${apiUrl}`]);
  try {
    const identity = await (await waitFor(`${apiUrl}/`)).json();
    const sources = await (await waitFor(`${apiUrl}/v1/sources`)).json();
    const proposals = await (await waitFor(`${apiUrl}/v1/proposals?source=${encodeURIComponent(`snapshot:velvet-solace-${runId}.test`)}&limit=20`)).json();
    const siteResponse = await waitFor(`${siteUrl}/`);
    const siteHtml = await siteResponse.text();
    const [robots, llms, favicon] = await Promise.all([
      waitFor(`${siteUrl}/robots.txt`), waitFor(`${siteUrl}/llms.txt`), waitFor(`${siteUrl}/favicon.svg`),
    ]);
    const securityHeaders = {
      frameAncestors: siteResponse.headers.get("content-security-policy")?.includes("frame-ancestors 'none'") === true,
      nosniff: siteResponse.headers.get("x-content-type-options") === "nosniff",
      permissions: siteResponse.headers.has("permissions-policy"),
    };
    const publicAssets = {
      robots: robots.headers.get("content-type")?.includes("text/plain") === true,
      llms: llms.headers.get("content-type")?.includes("text/plain") === true,
      favicon: favicon.headers.get("content-type")?.includes("image/svg+xml") === true,
    };
    if (!Object.values(securityHeaders).every(Boolean) || !Object.values(publicAssets).every(Boolean)) {
      throw new Error(`site delivery assertions failed: ${JSON.stringify({ securityHeaders, publicAssets })}`);
    }
    const siteSources = await (await waitFor(`${siteUrl}/api/v1/sources`)).json();
    const sourceRows = sources.data || sources;
    const proposalRows = proposals.data || proposals;
    const containsVelvetSolace = sourceRows.some((item) => item.displayName === "Velvet Solace");
    const siteSourceRows = siteSources.data || siteSources;
    const browserEvidence = { directRoute: false, javascriptDisabled: false, desktopScreenshot: false, mobileScreenshot: false };
    const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
    try {
      const proposal = proposalRows[0];
      if (!proposal) throw new Error("browser smoke requires at least one proposal");
      const directUrl = `${siteUrl}/proposals/${encodeURIComponent(proposal.canonicalId)}`;
      const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
      const noScriptPage = await noScriptContext.newPage();
      const response = await noScriptPage.goto(directUrl, { waitUntil: "domcontentloaded" });
      const noScriptHtml = await noScriptPage.content();
      browserEvidence.directRoute = response?.ok() === true && noScriptHtml.includes("data-direct-proposal=");
      browserEvidence.javascriptDisabled = noScriptHtml.includes(proposal.title)
        && noScriptHtml.includes("Open canonical proposal");
      await noScriptContext.close();
      for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
        const screenshot = path.join(runDirectory, `${name}.png`);
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.goto(directUrl, { waitUntil: "networkidle" });
        await page.screenshot({ path: screenshot, fullPage: true });
        await context.close();
        browserEvidence[`${name}Screenshot`] = require("node:fs").existsSync(screenshot);
      }
      if (!Object.values(browserEvidence).every(Boolean)) throw new Error(`browser smoke assertions failed: ${JSON.stringify(browserEvidence)}`);
      await writeFile(path.join(runDirectory, "browser-evidence.json"), `${JSON.stringify({
        route: "/proposals/:canonicalId", canonicalId: proposal.canonicalId, ...browserEvidence,
      }, null, 2)}\n`);
    } finally { await browser.close(); }
    const contractFixture = spawnSync(process.execPath, [path.join(root, "scripts", "generate_contract_fixture.cjs")], { cwd: root, encoding: "utf8" });
    if (contractFixture.status !== 0) throw new Error(`contract fixture failed: ${contractFixture.stderr.trim()}`);
    const contract = {
      mode: "python-normalization-fixture",
      fixtureSha256: createHash("sha256").update(contractFixture.stdout.trim()).digest("hex"),
    };
    const manifestPath = path.join(runDirectory, "manifest.redacted.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.services = { ...manifest.services, api: { url: apiUrl, runtime: "wrangler-local" }, site: { url: siteUrl, runtime: "wrangler-local" } };
    manifest.contract = contract;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
    await stopAll();
    const listenersClosed = (await portClosed(apiPort)) && (await portClosed(sitePort));
    process.stdout.write(`${JSON.stringify({
      api: { status: identity.status, url: apiUrl, sources: containsVelvetSolace ? 1 : 0, proposals: proposalRows.length },
      site: { status: siteResponse.status, url: siteUrl, containsVelvetSolace: siteSourceRows.some((item) => item.displayName === "Velvet Solace") && siteHtml.includes("QuorumX") },
      siteApiBase: `${siteUrl}/api`,
      contract,
      browser: browserEvidence,
      securityHeaders,
      publicAssets,
      listenersClosed,
    })}\n`);
  } finally {
    await stopAll();
  }
}

main().catch(async (error) => {
  await stopAll();
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
