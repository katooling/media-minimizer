const fs = require("fs");
const { execFileSync } = require("child_process");

function hasFfprobe() {
    try {
        execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
        return true;
    } catch (error) {
        return false;
    }
}

function probeMedia(filePath) {
    const raw = execFileSync("ffprobe", [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
    ], { encoding: "utf8" });
    return JSON.parse(raw);
}

function assertNonEmptyFile(expect, filePath) {
    const stat = fs.statSync(filePath);
    expect(stat.size).toBeGreaterThan(0);
}

function assertMovVideoOutput(expect, filePath, options = {}) {
    assertNonEmptyFile(expect, filePath);
    if (options.ffprobeRequired === false && !hasFfprobe()) {
        return null;
    }
    if (!hasFfprobe()) {
        throw new Error("ffprobe is required for video output validation.");
    }
    const probe = probeMedia(filePath);
    const formatName = String(probe.format?.format_name || "");
    expect(formatName).toContain("mov");
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    expect(streams.some((stream) => stream.codec_type === "video")).toBe(true);
    if (options.expectAudio === true) {
        expect(streams.some((stream) => stream.codec_type === "audio")).toBe(true);
    }
    if (options.expectNoAudio === true) {
        expect(streams.some((stream) => stream.codec_type === "audio")).toBe(false);
    }
    return probe;
}

module.exports = {
    assertMovVideoOutput,
    assertNonEmptyFile,
    hasFfprobe,
    probeMedia,
};
