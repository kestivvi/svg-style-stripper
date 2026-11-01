import { zipSync } from "fflate";
import { minifiedName } from "../../core/format";
import type { OptimizeWarning } from "../../core/optimize";
import { optimizeSvg } from "../../core/optimize";

export interface OptimizedFile {
  status: "ok";
  id: string;
  name: string;
  downloadName: string;
  output: string;
  beforeUrl: string;
  afterUrl: string;
  originalBytes: number;
  optimizedBytes: number;
  reducedPercent: number;
  warnings: OptimizeWarning[];
}

export interface FailedFile {
  status: "error";
  id: string;
  name: string;
  message: string;
}

export type FileEntry = OptimizedFile | FailedFile;

const svgUrl = (text: string) => URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));

export async function processFile(file: File): Promise<FileEntry> {
  const id = crypto.randomUUID();
  try {
    const input = await file.text();
    const result = optimizeSvg(input);
    return {
      status: "ok",
      id,
      name: file.name,
      downloadName: minifiedName(file.name),
      beforeUrl: svgUrl(input),
      afterUrl: svgUrl(result.output),
      ...result,
    };
  } catch (error) {
    return {
      status: "error",
      id,
      name: file.name,
      message: error instanceof Error ? error.message : "This file cannot be read.",
    };
  }
}

export function releaseEntry(entry: FileEntry): void {
  if (entry.status !== "ok") return;
  URL.revokeObjectURL(entry.beforeUrl);
  URL.revokeObjectURL(entry.afterUrl);
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveSvg(file: OptimizedFile): void {
  saveBlob(new Blob([file.output], { type: "image/svg+xml" }), file.downloadName);
}

export async function saveAll(files: OptimizedFile[]): Promise<void> {
  for (const file of files) {
    saveSvg(file);
    // Browsers can drop downloads that start at the same moment.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Gives repeated names a number: name.min.svg, name-2.min.svg. */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; used.has(candidate); n++) {
      candidate = name.replace(/\.min\.svg$/, `-${n}.min.svg`);
    }
    used.add(candidate);
    return candidate;
  });
}

export function saveZip(files: OptimizedFile[]): void {
  const encoder = new TextEncoder();
  const names = uniqueNames(files.map((f) => f.downloadName));
  const entries = Object.fromEntries(files.map((f, i) => [names[i]!, encoder.encode(f.output)]));
  const zipped = zipSync(entries);
  saveBlob(new Blob([zipped.slice()], { type: "application/zip" }), "optimized-svgs.zip");
}
