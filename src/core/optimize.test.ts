import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InvalidSvgError, optimizeSvg } from "./optimize";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (body: string, attrs = "") => `<svg ${NS} viewBox="0 0 10 10"${attrs}>${body}</svg>`;
const out = (s: string) => optimizeSvg(s).output;

describe("optimizeSvg", () => {
  it("rejects input that is not SVG", () => {
    expect(() => optimizeSvg("not xml")).toThrow(InvalidSvgError);
    expect(() => optimizeSvg("<html></html>")).toThrow(InvalidSvgError);
    expect(() => optimizeSvg("<svg")).toThrow(InvalidSvgError);
  });

  it("removes C2PA metadata and its namespace, but keeps other metadata", () => {
    const pad = "x".repeat(300);
    const r = out(
      `<svg ${NS} xmlns:c2pa="http://c2pa.org/manifest"><metadata><c2pa:manifest>${pad}</c2pa:manifest></metadata><rect/></svg>`,
    );
    expect(r).not.toContain("c2pa");
    const other = out(svg(`<metadata><info>keep</info></metadata><rect style="fill:rgb(0, 0, 0);stroke:none"/>`));
    expect(other).toContain("keep");
  });

  it("removes default and irrelevant values", () => {
    const r = out(
      svg(
        `<rect width="1" style="fill:rgb(1, 2, 3);stroke:none;color:red;stroke-width:1px;stroke-linecap:butt;opacity:1;font-family:x;font-size:16px;text-anchor:start"/>`,
      ),
    );
    expect(r).toContain('fill="#010203"');
    for (const gone of ["stroke", "color", "opacity", "font", "text-anchor", "style"]) {
      expect(r).not.toContain(gone);
    }
  });

  it("keeps a value that differs from the value of the parent", () => {
    const r = out(svg(`<g style="fill:#111"><rect style="fill:#111"/><rect style="fill:#111"/><rect style="fill:#222"/></g>`));
    expect(r).toContain('fill="#111"');
    expect(r).toContain('fill="#222"');
    expect(r.match(/#111/g)).toHaveLength(1);
  });

  it("keeps a parent text value for its tspan children", () => {
    const r = out(
      svg(`<text style="fill:#111">a<tspan style="fill:#222">b</tspan><tspan style="fill:#222">c</tspan></text>`),
    );
    expect(r).toMatch(/fill="#111"/);
    expect(r.match(/#222/g)).toHaveLength(2);
    expect(r).toContain(">a<");
  });

  it("does not inherit opacity", () => {
    const r = out(svg(`<g style="opacity:.5"><rect style="fill:#123;opacity:1"/></g>`));
    expect(r.match(/opacity/g)).toHaveLength(1);
  });

  it("keeps dominant-baseline on text and removes it from other elements", () => {
    const r = out(svg(`<g style="dominant-baseline:auto"><text dominant-baseline="central" style="dominant-baseline:central">a</text></g>`));
    expect(r.match(/dominant-baseline/g)).toHaveLength(1);
  });

  it("keeps stroke-width on an unpainted element that has markers", () => {
    const r = out(svg(`<line x2="5" marker-end="url(#a)" style="stroke:none;stroke-width:3px"/>`));
    expect(r).toContain('stroke-width="3"');
  });

  it("keeps the marker fallback pair and the marker reference", () => {
    const r = out(
      svg(
        `<defs><marker id="a"><path d="M0 0" stroke="context-stroke" style="stroke:#898781;stroke:context-stroke;"/></marker></defs><line marker-end="url(#a)"/>`,
      ),
    );
    expect(r).toContain("stroke:#898781;stroke:context-stroke");
    expect(r).toContain('id="a"');
    expect(r).toContain('marker-end="url(#a)"');
  });

  it("keeps semicolons inside quoted and bracketed values", () => {
    const r = out(svg(`<text style="font-family:'a;b', c;fill:color(srgb 0 0 0 / 0.2)">t</text>`));
    expect(r).toContain("'a;b'");
    expect(r).toContain("color(srgb 0 0 0 / 0.2)");
  });

  it("keeps whitespace in text and removes it between elements", () => {
    const r = out(svg(`\n<text> a  b </text>\n<rect/>\n`));
    expect(r).toContain("<text> a  b </text>");
    expect(r).not.toContain("\n");
  });

  it("keeps unknown style properties", () => {
    expect(out(svg(`<rect style="stroke-dasharray:1 2;fill:#123"/>`))).toContain("stroke-dasharray:1 2");
  });

  it.each([
    ["CSS rules", `<style>rect{fill:red}</style><rect style="fill:#123;color:red"/>`],
    ["currentColor", `<rect fill="currentColor" style="color:red"/>`],
    ["use", `<use href="#a" style="color:red"/><rect id="a" style="color:red"/>`],
  ])("keeps styles unchanged with %s", (_name, body) => {
    const r = optimizeSvg(svg(body + " ".repeat(50)));
    expect(r.warnings).toContain("styles-kept");
    expect(r.output).toContain("color:red");
  });

  it("ignores an unsafe attribute that a style declaration overrides", () => {
    const r = optimizeSvg(svg(`<path stroke="var(--t)" style="stroke:#123;color:red"/>`));
    expect(r.warnings).toEqual([]);
    expect(r.output).not.toContain("var(");
  });

  it("warns about embedded fonts and keeps them", () => {
    const font = `@font-face{font-family:x;src:url("data:font/otf;base64,AAAA")}`;
    const r = optimizeSvg(svg(`<style>${font}</style><text style="color:red;font-family:x">a</text>`));
    expect(r.warnings).toEqual(["embedded-fonts"]);
    expect(r.output).toContain("base64,AAAA");
    expect(r.output).not.toContain("color");
  });

  it("returns the original when the result is not smaller", () => {
    const small = `<svg ${NS}/>`;
    const r = optimizeSvg(small);
    expect(r.output).toBe(small);
    expect(r.reducedPercent).toBe(0);
  });

  it("gives the same result on a second run", () => {
    for (const file of readdirSync("example")) {
      const once = out(readFileSync(`example/${file}`, "utf8"));
      expect(out(once)).toBe(once);
    }
  });
});
