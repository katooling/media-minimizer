const baseConfig = require("./playwright.config");

module.exports = {
    ...baseConfig,
    fullyParallel: false,
    workers: 1,
    retries: 1,
    reporter: [
        ["line"],
        ["json", { outputFile: "test-results/agent-results.json" }],
        ["html", { open: "never", outputFolder: "playwright-report" }],
    ],
    use: {
        ...baseConfig.use,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
};
