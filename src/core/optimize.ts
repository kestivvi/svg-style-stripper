import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export type OptimizeWarning = "embedded-fonts" | "styles-kept";

export interface OptimizeResult {
  output: string;
  originalBytes: number;
  optimizedBytes: number;
  /** Percent of the original size removed, from 0 to 100. */
  reducedPercent: number;
  warnings: OptimizeWarning[];
}

export class InvalidSvgError extends Error {
  override name = "InvalidSvgError";
}

type Values = Map<string, string>;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Inherited properties that can move up the tree. Value is the CSS initial value, if fixed. */
const INHERITED: Record<string, string | undefined> = {
  fill: "#000",
  stroke: "none",
  "stroke-width": "1",
  "stroke-linecap": "butt",
  "stroke-linejoin": "miter",
  "fill-opacity": "1",
  "stroke-opacity": "1",
  "font-family": undefined,
  "font-size": undefined,
  "font-weight": "400",
  "text-anchor": "start",
};

/**
 * Properties that stay on the element that needs them.
 * Browsers disagree about whether dominant-baseline inherits, so it never moves.
 */
const LOCAL: Record<string, string> = { opacity: "1", "dominant-baseline": "auto" };

/** Only has an effect when something uses currentColor, and any such file is not rewritten. */
const DROPPED = new Set(["color"]);

const STROKE_DETAIL = ["stroke-linecap", "stroke-linejoin", "stroke-opacity"];
const FONT_PROPS = ["font-family", "font-size", "font-weight", "text-anchor"];
const SHAPES = new Set(["rect", "circle", "ellipse", "line", "path", "polyline", "polygon"]);
const TEXTS = new Set(["text", "tspan", "textPath"]);
const CONTAINERS = new Set(["svg", "g", "a", "defs", "marker"]);
const NO_RENDER = new Set(["title", "desc", "metadata", "style"]);
const MARKER_ATTRS = ["marker-start", "marker-mid", "marker-end", "marker"];

/** Inherited properties are resolved through these elements in a way this code does not model. */
const UNSAFE_ELEMENTS = new Set(["use", "symbol", "foreignObject", "script", "switch"]);
const UNSAFE_VALUE = /currentcolor|\binherit\b|\bunset\b|\brevert\b|context-fill|!important|\bvar\(/i;

function elements(parent: Element | Document): Element[] {
  const result: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === ELEMENT_NODE) result.push(n as Element);
  }
  return result;
}

function walk(el: Element, visit: (el: Element) => void): void {
  visit(el);
  for (const child of elements(el)) walk(child, visit);
}

function parse(text: string): Element {
  let root: Element | null;
  try {
    const doc = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") throw new InvalidSvgError(message);
      },
    }).parseFromString(text, "image/svg+xml");
    root = doc.documentElement as unknown as Element | null;
  } catch (error) {
    throw new InvalidSvgError(error instanceof Error ? error.message : String(error));
  }
  if (root?.localName !== "svg") throw new InvalidSvgError("The root element is not <svg>.");
  return root;
}

function removeC2pa(root: Element): void {
  for (const child of elements(root)) {
    if (child.localName !== "metadata") continue;
    const kids = elements(child);
    if (kids.length > 0 && kids.every((k) => k.prefix === "c2pa" || k.localName === "manifest")) {
      root.removeChild(child);
    }
  }
  let used = false;
  walk(root, (el) => {
    if (el.prefix === "c2pa") used = true;
  });
  if (!used) root.removeAttribute("xmlns:c2pa");
}

function removeWhitespace(el: Element): void {
  if (TEXTS.has(el.localName ?? "") || el.localName === "style") return;
  let node = el.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (node.nodeType === TEXT_NODE && !node.nodeValue?.trim()) el.removeChild(node);
    node = next;
  }
  for (const child of elements(el)) removeWhitespace(child);
}

function styleSheets(root: Element): string[] {
  const sheets: string[] = [];
  walk(root, (el) => {
    if (el.localName === "style") sheets.push(el.textContent ?? "");
  });
  return sheets;
}

function hasEmbeddedFonts(sheets: string[]): boolean {
  return sheets.some((s) => /@font-face[^}]*url\(\s*["']?data:/i.test(s));
}

/** True when the style rewrite cannot prove that it keeps the same rendering. */
function isUnsafeForRewrite(root: Element, sheets: string[]): boolean {
  const hasRules = sheets.some(
    (s) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@font-face\s*\{[^}]*\}/gi, "")
        .trim() !== "",
  );
  if (hasRules) return true;
  let unsafe = false;
  walk(root, (el) => {
    if (UNSAFE_ELEMENTS.has(el.localName ?? "")) unsafe = true;
    // A style declaration overrides the attribute with the same name, so that attribute has no effect.
    const styled = new Set(splitDeclarations(el.getAttribute("style") ?? "").map(([prop]) => prop));
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes.item(i);
      if (attr && !styled.has(attr.name) && UNSAFE_VALUE.test(attr.value)) unsafe = true;
    }
  });
  return unsafe;
}

function splitDeclarations(style: string): [string, string][] {
  const result: [string, string][] = [];
  let start = 0;
  let quote = "";
  let depth = 0;
  const push = (end: number) => {
    const part = style.slice(start, end);
    const colon = part.indexOf(":");
    if (colon > 0) result.push([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()]);
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(style.length);
  return result;
}

function shortenNumber(value: string): string {
  return value.replace(/^0\./, ".");
}

/** Write a value in its shortest form with the same meaning. */
function normalize(prop: string, value: string): string {
  const v = value.trim();
  if (prop === "font-family") return v.replace(/\s*,\s*/g, ",").replace(/"/g, "'");
  if (prop === "font-weight" && v === "normal") return "400";
  if (prop === "stroke-width" || prop === "font-size") {
    return shortenNumber(v.replace(/^(-?[\d.]+)px$/, "$1"));
  }
  if (prop === "fill" || prop === "stroke") {
    if (/^black$/i.test(v)) return "#000";
    const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
    if (m) {
      const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
      const short = hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5];
      return short ? `#${hex[0]}${hex[2]}${hex[4]}` : `#${hex}`;
    }
  }
  return v;
}

const isManaged = (prop: string) => prop in INHERITED || prop in LOCAL || DROPPED.has(prop);

/** Which inherited properties can change how this element itself is drawn. */
function ownWants(el: Element, resolved: Values): string[] {
  const name = el.localName ?? "";
  if (NO_RENDER.has(name) || CONTAINERS.has(name)) return [];
  const isText = TEXTS.has(name);
  if (!isText && !SHAPES.has(name)) return Object.keys(INHERITED);

  const wants: string[] = [];
  const stroked = resolved.get("stroke") !== "none";
  if (name !== "line") {
    wants.push("fill");
    if (resolved.get("fill") !== "none") wants.push("fill-opacity");
  }
  wants.push("stroke");
  if (stroked) wants.push(...STROKE_DETAIL);
  // Marker size scales with stroke-width even when the stroke itself is not painted.
  if (stroked || MARKER_ATTRS.some((a) => el.hasAttribute(a))) wants.push("stroke-width");
  if (isText) wants.push(...FONT_PROPS);
  return wants;
}

interface StyleNode {
  el: Element;
  /** Resolved values of the properties this element needs from its parent. */
  wants: Values;
  /** Values that this element must write for itself. */
  emit: Values;
  /** Values for local properties. */
  local: Values;
  /** Declarations kept as they are, such as a fallback pair for the same property. */
  verbatim: [string, string][];
  /** Managed properties held in verbatim. Children cannot rely on them after a rewrite. */
  pinned: Set<string>;
  children: StyleNode[];
}

function analyze(el: Element, inherited: Values, parentName: string): StyleNode {
  const resolved = new Map(inherited);
  resolved.delete("opacity");
  const name = el.localName ?? "";

  const declared = splitDeclarations(el.getAttribute("style") ?? "");
  const seen = new Map<string, number>();
  for (const [prop] of declared) seen.set(prop, (seen.get(prop) ?? 0) + 1);

  const verbatim: [string, string][] = [];
  const pinned = new Set<string>();
  for (const prop of [...Object.keys(INHERITED), ...Object.keys(LOCAL), ...DROPPED]) {
    const attr = el.getAttribute(prop);
    if (attr !== null && attr !== "") resolved.set(prop, normalize(prop, attr));
    el.removeAttribute(prop);
  }
  for (const [prop, value] of declared) {
    if (!isManaged(prop) || (seen.get(prop) ?? 0) > 1) {
      verbatim.push([prop, value]);
      if (isManaged(prop)) pinned.add(prop);
    }
    if (isManaged(prop)) resolved.set(prop, normalize(prop, value));
  }
  el.removeAttribute("style");

  const local: Values = new Map();
  const opacity = resolved.get("opacity");
  if (opacity !== undefined && opacity !== LOCAL.opacity && !pinned.has("opacity")) {
    local.set("opacity", opacity);
  }
  const baseline = resolved.get("dominant-baseline");
  if (TEXTS.has(name) && baseline !== undefined && !pinned.has("dominant-baseline")) {
    const fromParent = parentName === "text" ? inherited.get("dominant-baseline") : LOCAL["dominant-baseline"];
    if (baseline !== fromParent) local.set("dominant-baseline", baseline);
  }

  const children = elements(el).map((c) => analyze(c, resolved, name));

  const wants: Values = new Map();
  for (const prop of ownWants(el, resolved)) {
    const value = resolved.get(prop) ?? INHERITED[prop];
    if (value !== undefined && !pinned.has(prop)) wants.set(prop, value);
  }

  const node: StyleNode = { el, wants, emit: new Map(), local, verbatim, pinned, children };
  hoist(node);
  return node;
}

/** Choose the most common value among the children, so that fewer elements write it. */
function hoist(node: StyleNode): void {
  const props = new Set<string>();
  for (const child of node.children) for (const prop of child.wants.keys()) props.add(prop);

  for (const prop of props) {
    if (node.pinned.has(prop)) {
      for (const child of node.children) {
        const v = child.wants.get(prop);
        if (v !== undefined) child.emit.set(prop, v);
      }
      continue;
    }
    // An element passes its own value to its children, so that value cannot change.
    const best = node.wants.get(prop) ?? mostCommon(node.children, prop);
    node.wants.set(prop, best);
    for (const child of node.children) {
      const v = child.wants.get(prop);
      if (v !== undefined && v !== best) child.emit.set(prop, v);
    }
  }
}

function mostCommon(children: StyleNode[], prop: string): string {
  const counts = new Map<string, number>();
  let best = "";
  let bestCount = 0;
  for (const child of children) {
    const v = child.wants.get(prop);
    if (v === undefined) continue;
    const count = (counts.get(v) ?? 0) + 1;
    counts.set(v, count);
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

function write(node: StyleNode): void {
  for (const [prop, value] of node.emit) node.el.setAttribute(prop, value);
  for (const [prop, value] of node.local) node.el.setAttribute(prop, value);
  if (node.verbatim.length > 0) {
    node.el.setAttribute("style", node.verbatim.map(([p, v]) => `${p}:${v}`).join(";"));
  }
  for (const child of node.children) write(child);
}

function rewriteStyles(root: Element): void {
  const node = analyze(root, new Map(), "");
  // The root has no parent, so it writes every value that differs from the initial value.
  for (const [prop, value] of node.wants) {
    if (value !== INHERITED[prop]) node.emit.set(prop, value);
  }
  write(node);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function weightedLuminance(red: number, green: number, blue: number): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function luminance(color: string): number | null {
  const v = color.trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (rgb) return weightedLuminance(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
    const channel = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return weightedLuminance(channel(0), channel(2), channel(4));
  }
  if (/^black$/i.test(v)) return 0;
  if (/^white$/i.test(v)) return 1;
  return null;
}

/**
 * Tells which background makes the text of a file readable.
 * claude.ai writes the colors of its active theme into the file, and the file has no background.
 */
export function suggestBackground(input: string): "light" | "dark" {
  let lightChars = 0;
  let darkChars = 0;
  const visit = (el: Element, inheritedFill: string) => {
    let fill = el.getAttribute("fill") || inheritedFill;
    for (const [prop, value] of splitDeclarations(el.getAttribute("style") ?? "")) {
      if (prop === "fill") fill = value;
    }
    if (TEXTS.has(el.localName ?? "")) {
      let chars = 0;
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === TEXT_NODE) chars += n.nodeValue?.trim().length ?? 0;
      }
      const lum = luminance(fill);
      if (lum !== null && lum > 0.5) lightChars += chars;
      else if (lum !== null) darkChars += chars;
    }
    for (const child of elements(el)) visit(child, fill);
  };
  visit(parse(input), "#000");
  return lightChars > darkChars ? "dark" : "light";
}

export function optimizeSvg(input: string): OptimizeResult {
  const root = parse(input);
  const warnings: OptimizeWarning[] = [];

  removeC2pa(root);
  const sheets = styleSheets(root);
  if (hasEmbeddedFonts(sheets)) warnings.push("embedded-fonts");
  if (isUnsafeForRewrite(root, sheets)) warnings.push("styles-kept");
  else rewriteStyles(root);
  removeWhitespace(root);

  const serialized = new XMLSerializer().serializeToString(root as never);
  const originalBytes = byteLength(input);
  const serializedBytes = byteLength(serialized);
  const improved = serializedBytes < originalBytes;
  const optimizedBytes = improved ? serializedBytes : originalBytes;

  return {
    output: improved ? serialized : input,
    originalBytes,
    optimizedBytes,
    reducedPercent: originalBytes === 0 ? 0 : ((originalBytes - optimizedBytes) / originalBytes) * 100,
    warnings,
  };
}
