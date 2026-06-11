const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures");
const DEFAULT_VIDEO_MANIFEST = path.resolve(FIXTURES_DIR, "video-fixtures.json");
const DEFAULT_REAL_VIDEO = path.resolve(FIXTURES_DIR, "local-debug-video.mov");

function parseCsv(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function resolveFixturePath(manifestPath, fixturePath) {
    if (path.isAbsolute(fixturePath)) {
        return fixturePath;
    }
    return path.resolve(path.dirname(manifestPath), fixturePath);
}

function readManifest(manifestPath) {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    const manifestDir = path.dirname(manifestPath);
    return (manifest.videos || []).map((entry) => ({
        ...entry,
        manifestPath,
        fixturePath: resolveFixturePath(manifestPath, entry.path),
        uploadName: entry.uploadName || path.basename(entry.path || ""),
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        expect: entry.expect || {},
        privateFixture: Boolean(entry.privateFixture || manifest.privateFixture),
        manifestDir,
    }));
}

function loadVideoFixtureCases(options = {}) {
    const manifestPaths = [
        DEFAULT_VIDEO_MANIFEST,
        ...parseCsv(process.env.VIDEO_FIXTURE_MANIFESTS),
        ...parseCsv(options.manifests),
    ];
    const fixtureSet = String(options.set || process.env.VIDEO_FIXTURE_SET || "all")
        .trim()
        .toLowerCase();
    const ids = new Set(parseCsv(options.ids || process.env.VIDEO_FIXTURE_IDS));

    const fixtures = [];
    for (const manifestPath of manifestPaths) {
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`Video fixture manifest not found: ${manifestPath}`);
        }
        fixtures.push(...readManifest(manifestPath));
    }

    for (const fixture of fixtures) {
        if (!fs.existsSync(fixture.fixturePath)) {
            throw new Error(`Video fixture not found: ${fixture.fixturePath} (${fixture.id})`);
        }
    }

    if (ids.size > 0) {
        const selected = fixtures.filter((fixture) => ids.has(fixture.id));
        if (selected.length === 0) {
            throw new Error(`No fixtures matched VIDEO_FIXTURE_IDS=${Array.from(ids).join(",")}`);
        }
        return selected;
    }

    if (fixtureSet === "all") {
        return fixtures;
    }

    const selected = fixtures.filter((fixture) => fixture.tags.includes(fixtureSet));
    if (selected.length === 0) {
        throw new Error(`No fixtures matched VIDEO_FIXTURE_SET=${fixtureSet}`);
    }
    return selected;
}

function loadRealVideoFixtures() {
    const manifestPath = process.env.REAL_VIDEO_MANIFEST || "";
    const fixtures = [];

    if (manifestPath) {
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`REAL_VIDEO_MANIFEST not found: ${manifestPath}`);
        }
        fixtures.push(...readManifest(manifestPath));
    }

    if (fs.existsSync(DEFAULT_REAL_VIDEO)) {
        fixtures.unshift({
            id: "local-debug-video",
            path: DEFAULT_REAL_VIDEO,
            fixturePath: DEFAULT_REAL_VIDEO,
            uploadName: "local-debug-video.mov",
            mimeType: "video/quicktime",
            maxSizeMb: 10,
            tags: ["real", "large", "smoke"],
            expect: {
                branch: "encode",
                outputContainer: "mov",
                shouldEnableDownload: true,
                shouldFitTarget: true,
                ffprobeRequired: true,
            },
        });
    }

    return fixtures.filter((fixture, index, all) => (
        all.findIndex((candidate) => candidate.id === fixture.id) === index
    ));
}

function fixturePath(relativePath) {
    return path.resolve(FIXTURES_DIR, relativePath);
}

module.exports = {
    REPO_ROOT,
    FIXTURES_DIR,
    DEFAULT_VIDEO_MANIFEST,
    DEFAULT_REAL_VIDEO,
    fixturePath,
    loadRealVideoFixtures,
    loadVideoFixtureCases,
};
