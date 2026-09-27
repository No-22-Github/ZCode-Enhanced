// Against a running Web + Server: node --import tsx packages/web/test/webConnection.e2e.mjs
// Fault injection is scoped to this isolated browser context. No model command is sent.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { BufferReader, VSBuffer, deserialize } from "../../rpc/src/index.ts";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const output = process.env.ZCODE_RECOVERY_SHOTS ?? "/tmp/zcode-web-recovery-qa";
await mkdir(output, { recursive: true });
const url = process.env.ZCODE_TEST_URL ?? "http://127.0.0.1:5173";
try {
  for (const mobile of [true, false]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sockets = [];
    const commands = [];
    const inputCommands = [];
    let blackhole = false;
    await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
      const upstream = socket.connectToServer();
      sockets.push(socket);
      socket.onMessage((message) => {
        if (Buffer.isBuffer(message) && message.length > 13) {
          const reader = new BufferReader(VSBuffer.wrap(message.subarray(13)));
          const header = deserialize(reader);
          if (Array.isArray(header) && typeof header[3] === "string") commands.push(header[3]);
          if (header[3] === "sendConversationCommandV4") {
            const args = deserialize(reader);
            const envelope = args?.[0]?.envelope;
            const type = envelope?.type;
            if (["sendText", "sendGoalCommand"].includes(type) ||
              (type === "createSession" && envelope.payload.firstInput)) inputCommands.push(type);
          }
        }
        if (!blackhole) upstream.send(message);
      });
      upstream.onMessage((message) => {
        if (!blackhole) socket.send(message);
      });
    });
    await page.goto(url);
    const editor = page.getByTestId("v4-composer-input");
    const notice = page.getByTestId("web-connection-status");
    await editor.waitFor({ timeout: 60000 });
    await notice.waitFor({ state: "hidden" });
    const draft = "Synthetic recovery draft — do not send";
    await editor.fill(draft);
    await editor.evaluate((element) => {
      element.dataset.recoveryKeep = "same-editor";
    });
    const origin = await page.evaluate(() => performance.timeOrigin);
    const pageUrl = page.url();
    const handshakeBefore = commands.filter((name) => name === "initializeConversationV4").length;
    const indexBefore = commands.filter((name) => name === "subscribeSessionsIndexV4").length;

    // A real close should recover without remounting the editor or reloading the document.
    sockets.at(-1).close({ code: 1012, reason: "test disconnect" });
    await notice.waitFor();
    await notice.screenshot({
      path: `${output}/${mobile ? "mobile" : "desktop"}-reconnecting.png`,
    });
    await notice.waitFor({ state: "hidden", timeout: 20000 });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="v4-composer-input"]')?.dataset.recoveryKeep ===
        "same-editor",
    );
    assert.equal(await editor.innerText(), draft);
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    assert.equal(page.url(), pageUrl);
    // Wait for commit-stage provider effects, not merely socket open.
    await page.waitForTimeout(800);
    assert.ok(
      commands.filter((name) => name === "initializeConversationV4").length > handshakeBefore,
    );
    assert.ok(commands.filter((name) => name === "subscribeSessionsIndexV4").length > indexBefore);

    // Mobile return-to-foreground simulation: OPEN socket that silently drops both directions.
    const beforeBlackhole = sockets.length;
    blackhole = true;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.visibilityState;
    });
    await notice.waitFor({ timeout: 12000 });
    blackhole = false;
    await notice.waitFor({ state: "hidden", timeout: 20000 });
    assert.ok(sockets.length > beforeBlackhole);
    assert.equal(await editor.innerText(), draft);

    // Offline/online uses the same owner and does not require a user refresh.
    await context.setOffline(true);
    await notice.waitFor();
    await notice.screenshot({ path: `${output}/${mobile ? "mobile" : "desktop"}-offline.png` });
    await context.setOffline(false);
    await notice.waitFor({ state: "hidden", timeout: 20000 });
    assert.equal(await editor.innerText(), draft);
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    // Draft config/prewarm commands are expected after service replacement; user input is not.
    assert.deepEqual(inputCommands, []);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${mobile ? "mobile" : "desktop"}: close, blackhole/foreground, offline/online, draft and editor retained, handshake/index restored, no command replay`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
