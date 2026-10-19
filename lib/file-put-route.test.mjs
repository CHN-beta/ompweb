import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@/": new URL("../", import.meta.url).pathname },
});

async function loadRoute() {
  return jiti.import("../app/api/files/[...path]/route.ts");
}

async function loadFileAccess() {
  return jiti.import("./file-access.ts");
}

test("PUT /api/files saves content and respects allowed roots", async (t) => {
  const { PUT } = await loadRoute();
  const { allowFileRoot } = await loadFileAccess();

  const tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omp-web-put-test-")));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  allowFileRoot(tempDir);

  const testFile = path.join(tempDir, "test.txt");
  fs.writeFileSync(testFile, "initial content", "utf8");

  // Segments for the route
  const relativeSegments = path.relative(path.parse(testFile).root, testFile).split(path.sep);
  const segments = path.parse(testFile).root === "/" ? relativeSegments : [testFile];

  const req = new Request("http://localhost/api/files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "updated content" }),
  });

  const res = await PUT(req, { params: Promise.resolve({ path: segments }) });
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(fs.readFileSync(testFile, "utf8"), "updated content");
});

test("PUT /api/files detects mtime conflict", async (t) => {
  const { PUT } = await loadRoute();
  const { allowFileRoot } = await loadFileAccess();

  const tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omp-web-put-conflict-")));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  allowFileRoot(tempDir);

  const testFile = path.join(tempDir, "conflict.txt");
  fs.writeFileSync(testFile, "version 1", "utf8");

  const stat = fs.statSync(testFile);
  const relativeSegments = path.relative(path.parse(testFile).root, testFile).split(path.sep);
  const segments = path.parse(testFile).root === "/" ? relativeSegments : [testFile];

  // Provide an outdated mtime
  const req = new Request("http://localhost/api/files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "conflict edit", expectedMtime: stat.mtimeMs - 5000 }),
  });

  const res = await PUT(req, { params: Promise.resolve({ path: segments }) });
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.code, "conflict_mtime");
});
