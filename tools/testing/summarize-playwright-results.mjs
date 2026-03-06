#!/usr/bin/env node
import fs from "fs";
import path from "path";

const reportPath = process.argv[2];
if (!reportPath) {
    console.error("[agent-e2e] Missing report path argument.");
    process.exit(1);
}

if (!fs.existsSync(reportPath)) {
    console.error(`[agent-e2e] Report file not found: ${reportPath}`);
    process.exit(1);
}

const raw = fs.readFileSync(reportPath, "utf8");
const report = JSON.parse(raw);

const tests = [];
walkSuite(report?.suites || [], tests);

const total = tests.length;
const passed = tests.filter((test) => test.status === "expected").length;
const skipped = tests.filter((test) => test.status === "skipped").length;
const flaky = tests.filter((test) => test.status === "flaky").length;
const failed = tests.filter((test) => test.status === "unexpected");

console.log(`[agent-e2e] Summary: total=${total} passed=${passed} failed=${failed.length} flaky=${flaky} skipped=${skipped}`);

if (failed.length === 0) {
    process.exit(0);
}

console.log("[agent-e2e] Failed tests:");
for (const [index, test] of failed.entries()) {
    const result = lastResult(test.results);
    const title = `${test.project ? `[${test.project}] ` : ""}${test.titlePath.join(" > ")}`;
    console.log(`${index + 1}. ${title}`);
    if (test.location) {
        console.log(`   at ${test.location.file}:${test.location.line}:${test.location.column}`);
    }
    if (result?.status) {
        console.log(`   status: ${result.status}`);
    }
    const firstError = firstErrorMessage(result);
    if (firstError) {
        console.log(`   error: ${firstError}`);
    }
    const artifactLines = artifactSummary(result?.attachments || []);
    for (const line of artifactLines) {
        console.log(`   ${line}`);
    }
}

function walkSuite(suites, tests, parentTitles = []) {
    for (const suite of suites || []) {
        const nextTitles = suite.title ? [...parentTitles, suite.title] : parentTitles;
        for (const spec of suite.specs || []) {
            for (const test of spec.tests || []) {
                tests.push({
                    titlePath: [...nextTitles, spec.title],
                    status: test.status || "unknown",
                    project: test.projectName || "",
                    location: {
                        file: spec.file || suite.file || "",
                        line: Number.isFinite(spec.line) ? spec.line : 0,
                        column: Number.isFinite(spec.column) ? spec.column : 0,
                    },
                    results: test.results || [],
                });
            }
        }
        walkSuite(suite.suites || [], tests, nextTitles);
    }
}

function lastResult(results) {
    if (!Array.isArray(results) || results.length === 0) {
        return null;
    }
    return results[results.length - 1];
}

function firstErrorMessage(result) {
    if (!result) {
        return "";
    }
    if (Array.isArray(result.errors) && result.errors.length > 0) {
        const text = result.errors[0]?.message || "";
        return singleLine(text);
    }
    return singleLine(result.error?.message || "");
}

function artifactSummary(attachments) {
    const lines = [];
    for (const attachment of attachments) {
        if (!attachment?.path) {
            continue;
        }
        const name = attachment.name || "artifact";
        const relPath = normalizePath(attachment.path);
        lines.push(`${name}: ${relPath}`);
    }
    return lines;
}

function normalizePath(filePath) {
    const absolute = path.resolve(filePath);
    return absolute;
}

function singleLine(text) {
    return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
}
