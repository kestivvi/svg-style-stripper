import type { OptimizeWarning } from "./optimize";

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function minifiedName(name: string): string {
  return `${name.replace(/\.svg$/i, "")}.min.svg`;
}

export const warningText: Record<OptimizeWarning, string> = {
  "embedded-fonts": "Embedded fonts are kept unchanged and can stay large.",
  "styles-kept": "Styles are kept unchanged because this file uses features that are not safe to rewrite.",
};
