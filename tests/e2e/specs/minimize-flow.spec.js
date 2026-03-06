const path = require("path");
const { test, expect } = require("@playwright/test");

async function waitForEngineReady(page) {
    await expect(page.locator("#status")).toContainText("Ready.", { timeout: 120000 });
}

test("image flow enables minimize/download and sends no new requests on minimize", async ({ page }) => {
    let captureRequests = false;
    let minimizeRequests = 0;
    page.on("request", (request) => {
        if (!captureRequests) {
            return;
        }
        if (!request.url().startsWith("data:")) {
            minimizeRequests += 1;
        }
    });

    await page.goto("/");
    await waitForEngineReady(page);

    const fixturePath = path.resolve(__dirname, "..", "fixtures", "sample.png");
    await page.locator("#fileInput").setInputFiles(fixturePath);

    const minimizeBtn = page.locator("#minimizeBtn");
    const downloadBtn = page.locator("#downloadBtn");

    await expect(minimizeBtn).toBeEnabled();
    await expect(downloadBtn).toBeDisabled();

    captureRequests = true;
    await minimizeBtn.click();

    await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });
    await expect(downloadBtn).toBeEnabled();
    await expect(page.locator("#outputName")).toContainText("-min");
    expect(minimizeRequests).toBe(0);
});

test("video flow converts to mov and enables download", async ({ page }) => {
    test.setTimeout(180000);
    let captureRequests = false;
    let minimizeRequests = 0;
    page.on("request", (request) => {
        if (!captureRequests) {
            return;
        }
        if (!request.url().startsWith("data:")) {
            minimizeRequests += 1;
        }
    });

    await page.goto("/");
    await waitForEngineReady(page);

    const fixturePath = path.resolve(__dirname, "..", "fixtures", "sample.mp4");
    await page.locator("#fileInput").setInputFiles(fixturePath);

    const minimizeBtn = page.locator("#minimizeBtn");
    const downloadBtn = page.locator("#downloadBtn");

    await expect(minimizeBtn).toBeEnabled();
    await expect(downloadBtn).toBeDisabled();

    captureRequests = true;
    await minimizeBtn.click();

    await expect(page.locator("#status")).toContainText("Done.", { timeout: 120000 });
    await expect(downloadBtn).toBeEnabled();
    await expect(page.locator("#outputName")).toContainText(".mov");
    expect(minimizeRequests).toBe(0);
});
