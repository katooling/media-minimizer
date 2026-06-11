const { test, expect } = require("@playwright/test");

const THEME_KEY = "mm-theme";

async function openThemePage(page, colorScheme) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await page.waitForFunction(() => Boolean(window.__mediaMinimizerDebug?.getThemeState));
    await page.waitForFunction(() => {
        if (!navigator.serviceWorker) {
            return true;
        }
        return Boolean(navigator.serviceWorker.controller);
    }, null, { timeout: 15000 });
    await page.evaluate((storageKey) => localStorage.removeItem(storageKey), THEME_KEY);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__mediaMinimizerDebug?.getThemeState));
}

async function readTheme(page) {
    return page.evaluate(() => {
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        return {
            dataTheme: root.dataset.theme || "",
            bg: styles.getPropertyValue("--bg").trim(),
            theme: window.__mediaMinimizerDebug.getThemeState(),
            stored: localStorage.getItem("mm-theme"),
            icon: document.querySelector("#themeToggle")?.textContent || "",
            pressed: document.querySelector("#themeToggle")?.getAttribute("aria-pressed") || "",
            label: document.querySelector("#themeToggle")?.getAttribute("aria-label") || "",
        };
    });
}

test("system dark preference applies the dark palette with no stored override", async ({ page }) => {
    await openThemePage(page, "dark");

    const theme = await readTheme(page);
    expect(theme.dataTheme).toBe("dark");
    expect(theme.bg).toBe("#1a1a1c");
    expect(theme.theme).toMatchObject({
        mode: "system",
        effectiveTheme: "dark",
        systemTheme: "dark",
    });
    expect(theme.stored).toBeNull();
});

test("toggle persists explicit theme and reload preserves it", async ({ page }) => {
    await openThemePage(page, "light");

    await page.locator("#themeToggle").click();
    let theme = await readTheme(page);
    expect(theme.dataTheme).toBe("dark");
    expect(theme.stored).toBe("dark");
    expect(theme.theme).toMatchObject({
        mode: "dark",
        effectiveTheme: "dark",
    });

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__mediaMinimizerDebug?.getThemeState));
    theme = await readTheme(page);
    expect(theme.dataTheme).toBe("dark");
    expect(theme.bg).toBe("#1a1a1c");
    expect(theme.stored).toBe("dark");
});

test("system light preference applies the light palette with no stored override", async ({ page }) => {
    await openThemePage(page, "light");

    const theme = await readTheme(page);
    expect(theme.dataTheme).toBe("light");
    expect(theme.bg).toBe("#f5f5f7");
    expect(theme.theme).toMatchObject({
        mode: "system",
        effectiveTheme: "light",
        systemTheme: "light",
    });
    expect(theme.stored).toBeNull();
});

test("toggle updates aria state and icon for each explicit theme", async ({ page }) => {
    await openThemePage(page, "light");

    let theme = await readTheme(page);
    expect(theme.icon).toBe("🌙");
    expect(theme.pressed).toBe("false");
    expect(theme.label).toBe("Switch to dark mode");

    await page.locator("#themeToggle").click();
    theme = await readTheme(page);
    expect(theme.icon).toBe("☀️");
    expect(theme.pressed).toBe("true");
    expect(theme.label).toBe("Switch to light mode");

    await page.locator("#themeToggle").click();
    theme = await readTheme(page);
    expect(theme.icon).toBe("🌙");
    expect(theme.pressed).toBe("false");
    expect(theme.label).toBe("Switch to dark mode");
});
