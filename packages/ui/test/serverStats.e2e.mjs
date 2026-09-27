// Run against a local Web + server pair: ZCODE_TEST_URL=http://127.0.0.1:5174 node packages/ui/test/serverStats.e2e.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const output = process.env.ZCODE_STATS_SHOTS ?? "/tmp/zcode-stats-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
function fixture(range = "1m") {
  const now = Date.now();
  const stepMs = { "1m": 1000, "15m": 5000, "24h": 300000 }[range];
  const point = (i) => ({
    t: now - (59 - i) * stepMs,
    cpuPercent: i === 22 ? 47 : 12 + Math.sin(i) * 5,
    memTotalBytes: 8 * 1024 ** 3,
    memUsedBytes: 2 * 1024 ** 3,
    memCachedBytes: 2.6 * 1024 ** 3,
    swapTotalBytes: 1024 ** 3,
    swapUsedBytes: 0,
    rxBytesPerSec: (171 + Math.sin(i) * 70) * 1024,
    txBytesPerSec: (105 + Math.cos(i) * 35) * 1024,
    loadAvg1: 0.42,
    loadAvg5: 0.38,
    loadAvg15: 0.3,
    uptimeSec: 12 * 86400,
    rssBytes: 96 * 1024 ** 2,
    diskTotalBytes: 79 * 1024 ** 3,
    diskUsedBytes: 33 * 1024 ** 3,
    diskReadBytesPerSec: 0,
    diskWriteBytesPerSec: 12 * 1024,
    cpuPeak: 47,
    rxPeak: 2.4 * 1024 ** 2,
    txPeak: 860 * 1024,
  });
  return {
    available: true,
    points: Array.from({ length: 60 }, (_, i) => point(i)),
    latest: point(59),
    range,
    stepMs,
    host: { name: "hk-01", cores: 4 },
    startedAt: now - 12 * 3600000,
    traffic: {
      day: new Date(now).toISOString().slice(0, 10),
      since: now - 3600000,
      rxBytes: 3.1 * 1024 ** 3,
      txBytes: 1.2 * 1024 ** 3,
    },
  };
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    localStorage.setItem("zcode-locale-preference", "en-US");
  });
  let offline = false,
    unavailable = false;
  const requests = [];
  await page.route("**/api/sys-stats?*", async (route) => {
    const range = new URL(route.request().url()).searchParams.get("range");
    requests.push(range);
    if (offline) return route.fulfill({ status: 503, body: "offline" });
    const snapshot = fixture(range);
    if (unavailable) snapshot.available = false;
    await route.fulfill({ json: snapshot });
  });
  await page.goto(process.env.ZCODE_TEST_URL ?? "http://127.0.0.1:5174");
  const trigger = page.getByTestId("server-stats-trigger"),
    panel = page.getByTestId("server-stats-panel");
  await trigger.waitFor({ timeout: 60000 });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await panel.waitFor();
  assert.equal(await panel.getByText("hk-01", { exact: true }).count(), 1);
  await page.screenshot({ path: `${output}/desktop-light.png` });
  await page.getByRole("button", { name: "24 h", exact: true }).click();
  await page.waitForResponse((res) => res.url().includes("range=24h"));
  assert.ok(requests.includes("24h"));
  await page.getByRole("button", { name: "Pin panel", exact: true }).click();
  await page.mouse.click(600, 700);
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(), false);
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Space");
  await panel.waitFor();
  await page.getByRole("button", { name: "Pin panel", exact: true }).click();
  await page.mouse.click(600, 700);
  assert.equal(await panel.isVisible(), false);
  await trigger.click();
  await page.getByRole("button", { name: "Capsule", exact: true }).click();
  await page.getByRole("button", { name: "Collapse panel", exact: true }).click();
  assert.equal(Math.round((await trigger.boundingBox()).width), 296);
  await page.screenshot({ path: `${output}/capsule.png` });
  await page.reload();
  await trigger.waitFor();
  assert.equal(Math.round((await trigger.boundingBox()).width), 296);
  await trigger.click();
  await page.getByRole("button", { name: "Mini capsule", exact: true }).click();
  await page.getByRole("button", { name: "Collapse panel", exact: true }).click();
  assert.equal(Math.round((await trigger.boundingBox()).width), 136);
  const box = await trigger.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(40, 800, { steps: 12 });
  await page.mouse.up();
  assert.equal(await panel.isVisible(), false, "drag does not open panel");
  assert.equal(
    JSON.parse(await page.evaluate(() => localStorage.getItem("zcode:server-stats-ball"))).side,
    "left",
  );
  for (const [width, height] of [
    [390, 640],
    [320, 640],
    [320, 480],
  ]) {
    await page.setViewportSize({ width, height });
    await trigger.click();
    await panel.waitFor();
    const rect = await panel.boundingBox();
    assert.ok(
      rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= height,
    );
    assert.ok(rect.height <= height / 2, "mobile summary leaves half the screen available");
    assert.ok(rect.width <= 300);
    assert.equal(await panel.getByRole("img").count(), 0);
    assert.equal(await panel.getByRole("button", { name: "24 h", exact: true }).count(), 0);
    assert.equal(await panel.getByText("25%", { exact: true }).count(), 1);
    assert.equal(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: `${output}/mobile-${width}-${height}.png` });
    await panel.getByRole("button", { name: "Collapse panel", exact: true }).click();
    assert.equal(await panel.isVisible(), false);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => document.documentElement.classList.add("dark", "zai-dark"));
  await trigger.click();
  assert.equal(await panel.getByRole("img").count(), 2, "desktop charts return after resize");
  await page.getByRole("button", { name: "Dual-ring ball", exact: true }).click();
  await page.screenshot({ path: `${output}/desktop-dark.png` });
  offline = true;
  await page.waitForResponse((res) => res.url().includes("/api/sys-stats") && res.status() === 503);
  await page.getByText(/Offline · updated/).waitFor();
  assert.equal(await trigger.isVisible(), true);
  await page.screenshot({ path: `${output}/offline.png` });
  offline = false;
  await page.waitForResponse(
    (res) => res.url().includes("/api/sys-stats") && res.status() === 200,
    { timeout: 15000 },
  );
  await page.getByText(/Connected/).waitFor();
  unavailable = true;
  await page.reload();
  await page.waitForResponse((res) => res.url().includes("/api/sys-stats"));
  await page.waitForTimeout(250);
  assert.equal(await trigger.count(), 0);
  console.log(
    "PASS: real Web monitor, keyboard/pin/shapes/persistence/drag/responsive/history/offline/recovery/unavailable",
  );
} finally {
  await browser.close();
}
