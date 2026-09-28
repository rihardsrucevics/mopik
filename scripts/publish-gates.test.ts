/**
 * `scripts/publish-gates.ts` never throws away what is already published.
 *
 * `npx tsx --test scripts/publish-gates.test.ts`
 *
 * `data/` is untracked and per checkout; the main checkout's copy predates
 * the node ids and `access=*` the gate card shows (release check,
 * 2026-09-28). A plain copy from it would have wiped them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { mergePublished, publish } from "./publish-gates";

const KINDS = { barrierKinds: ["gate", "lift_gate"], highwayKinds: ["track", "service"] };
const old = {
  country: "XX", builtAt: "2026-09-14T20:24:26Z", ...KINDS,
  gates: [[24.1, 56.9, 0, 0], [24.2, 56.9, 1, 1], [24.3, 56.9, 0, 0]],
};
// The same build, enriched: ids for the first two, access on the second; the third matched nothing.
const enriched = {
  ...old, accessKinds: ["private"],
  gates: [[24.1, 56.9, 0, 0, 111, -1], [24.2, 56.9, 1, 1, 222, 0], [24.3, 56.9, 0, 0]],
};

function dirs(source: object, published: object | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-gates-"));
  const inDir = path.join(root, "data"), outDir = path.join(root, "public", "gates");
  fs.mkdirSync(inDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(inDir, "gates-XX.json"), JSON.stringify(source));
  if (published) fs.writeFileSync(path.join(outDir, "XX.json"), JSON.stringify(published));
  const read = () => JSON.parse(fs.readFileSync(path.join(outDir, "XX.json"), "utf-8"));
  return { inDir, outDir, read };
}
const quiet = { log: () => {} };

test("the same build without ids: ids and access carried over from the published file", () => {
  const d = dirs(old, enriched);
  const lines: string[] = [];
  const index = publish(d.inDir, d.outDir, { log: (l) => lines.push(l) });
  assert.deepEqual(d.read().gates, enriched.gates);
  assert.deepEqual(d.read().accessKinds, ["private"]);
  assert.equal(index.countries[0].count, 3);
  assert.ok(lines.some((l) => /^XX: 2 node ids and access values carried over/.test(l)), lines.join("\n"));
});

test("an older build never replaces a newer published one", () => {
  const newer = { ...enriched, builtAt: "2026-10-01T00:00:00Z", gates: [...enriched.gates, [24.4, 56.9, 0, 1, 444, -1]] };
  const d = dirs(old, newer);
  const before = fs.readFileSync(path.join(d.outDir, "XX.json"), "utf-8");
  const index = publish(d.inDir, d.outDir, quiet);
  assert.equal(fs.readFileSync(path.join(d.outDir, "XX.json"), "utf-8"), before, "byte for byte");
  assert.equal(index.countries[0].count, 4, "indexed as published");
  assert.equal(index.countries[0].builtAt, newer.builtAt);
});

test("a newer build with its own ids is published as it is; --force publishes an old one", () => {
  const rebuilt = { ...old, builtAt: "2026-10-02T00:00:00Z", accessKinds: [], gates: [[24.1, 56.9, 0, 0, 999, -1]] };
  const d = dirs(rebuilt, enriched);
  publish(d.inDir, d.outDir, quiet);
  assert.deepEqual(d.read().gates, rebuilt.gates);
  const f = dirs(old, { ...enriched, builtAt: "2026-10-01T00:00:00Z" });
  publish(f.inDir, f.outDir, { ...quiet, force: true });
  assert.deepEqual(f.read().gates, old.gates);
});

test("carried only on the very same spot and barrier, never on two candidates", () => {
  const pub = { ...enriched, gates: [[24.1, 56.9, 1, 0, 111, -1], [24.2, 56.9, 1, 1, 222, 0], [24.2, 56.9, 1, 1, 223, 0]] };
  const src = { ...old, gates: [[24.1, 56.9, 0, 0], [24.2, 56.9, 1, 1], [24.30001, 56.9, 0, 0]] };
  type F = Parameters<typeof mergePublished>[0];
  const { file, carried } = mergePublished(src as F, pub as F);
  assert.equal(carried, 0);
  assert.deepEqual(file.gates, src.gates);
  // No published file: the source as it is.
  assert.equal(mergePublished(src as F, null).file, src);
});
