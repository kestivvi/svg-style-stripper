import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import { run } from "./run";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:#123;color:red;opacity:1;stroke:none"/></svg>`;
let dir: string;
let err = "";
let out = "";
const cli = (args: string[], stdin = "") =>
  run(args, "1.2.3", {
    stdin: async () => stdin,
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
  });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cso-"));
  err = "";
  out = "";
  writeFileSync(path.join(dir, "a.svg"), SVG);
});

it("writes next to the input and keeps the input", async () => {
  expect(await cli([path.join(dir, "a.svg")])).toBe(0);
  expect(readFileSync(path.join(dir, "a.min.svg"), "utf8")).toContain('fill="#123"');
  expect(readFileSync(path.join(dir, "a.svg"), "utf8")).toBe(SVG);
  expect(err).toContain("1 optimized, 0 failed");
});

it("creates the output directory", async () => {
  expect(await cli([path.join(dir, "a.svg"), "-o", path.join(dir, "x/y")])).toBe(0);
  expect(existsSync(path.join(dir, "x/y/a.min.svg"))).toBe(true);
});

it("needs --force to overwrite", async () => {
  const target = path.join(dir, "a.min.svg");
  writeFileSync(target, "old");
  expect(await cli([path.join(dir, "a.svg")])).toBe(1);
  expect(readFileSync(target, "utf8")).toBe("old");
  expect(await cli([path.join(dir, "a.svg"), "--force"])).toBe(0);
  expect(readFileSync(target, "utf8")).not.toBe("old");
});

it("continues after an error and returns 1", async () => {
  writeFileSync(path.join(dir, "bad.svg"), "nope");
  expect(await cli([path.join(dir, "bad.svg"), path.join(dir, "a.svg"), path.join(dir, "gone.svg")])).toBe(1);
  expect(existsSync(path.join(dir, "a.min.svg"))).toBe(true);
  expect(err).toContain("1 optimized, 2 failed");
});

it("skips .min.svg files", async () => {
  writeFileSync(path.join(dir, "b.min.svg"), SVG);
  expect(await cli([path.join(dir, "b.min.svg")])).toBe(0);
  expect(err).toContain("skipped");
  expect(existsSync(path.join(dir, "b.min.min.svg"))).toBe(false);
});

it("does not let two inputs write the same output", async () => {
  writeFileSync(path.join(dir, "b.svg"), SVG);
  const code = await cli([path.join(dir, "a.svg"), path.join(dir, "a.svg"), "-o", path.join(dir, "o"), "-f"]);
  expect(code).toBe(1);
});

it("uses stdout only for SVG with stdin", async () => {
  expect(await cli(["-"], SVG)).toBe(0);
  expect(out).toContain('fill="#123"');
  expect(err).toBe("");
  expect(await cli(["-", "-o", dir])).toBe(1);
});

it("shows help, version, and usage errors", async () => {
  expect(await cli(["--help"])).toBe(0);
  expect(err).toContain("Usage");
  expect(await cli(["--version"])).toBe(0);
  expect(err).toContain("1.2.3");
  expect(await cli([])).toBe(1);
  expect(await cli(["--nope"])).toBe(1);
});
