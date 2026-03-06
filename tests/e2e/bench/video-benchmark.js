const path = require("path");
const { chromium } = require("playwright");

async function run() {
    const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
    const fixturePath = path.resolve(__dirname, "..", "fixtures", "sample.mp4");

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(baseURL);
    await page.waitForSelector("#engineBadge");
    await page.waitForFunction(() => {
        const badge = document.querySelector("#engineBadge");
        return badge && /Engine: Ready/.test(badge.textContent || "");
    }, null, { timeout: 120000 });

    await page.locator("#fileInput").setInputFiles(fixturePath);
    await page.locator("#minimizeBtn").click();
    await page.waitForFunction(() => {
        const status = document.querySelector("#status");
        return status && /^Done\./.test(status.textContent || "");
    }, null, { timeout: 180000 });

    const report = await page.evaluate(() => {
        const debug = window.__mediaMinimizerDebug;
        const metrics = debug?.getLastRunMetrics?.() || null;
        const runtime = debug?.getRuntimeState?.() || null;
        return {
            runtime,
            metrics,
        };
    });

    console.log(JSON.stringify(report, null, 2));
    await browser.close();
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
