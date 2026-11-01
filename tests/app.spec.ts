import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { optimizeSvg } from "../src/core/optimize";

const dir = "example";
const files = readdirSync(dir).filter((f) => f.endsWith(".svg"));
const paths = files.map((f) => path.join(dir, f));

async function render(page: Page, svg: string, width: number): Promise<Buffer> {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(`<body style="margin:0;background:#fff"><img id="i" style="display:block;width:${width}px"></body>`);
  await page.evaluate(async (s) => {
    const img = document.getElementById("i") as HTMLImageElement;
    img.src = s;
    await img.decode();
  }, src);
  return page.locator("#i").screenshot();
}

for (const file of files) {
  test(`pixels stay the same: ${file}`, async ({ page }) => {
    const input = readFileSync(path.join(dir, file), "utf8");
    const { output, warnings, reducedPercent } = optimizeSvg(input);
    expect(warnings).toEqual([]);
    expect(reducedPercent).toBeGreaterThan(50);
    for (const width of [380, 680, 1360]) {
      const before = await render(page, input, width);
      const after = await render(page, output, width);
      expect(after.equals(before), `width ${width}`).toBe(true);
    }
  });
}

test("adds files, shows results, and downloads them", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(paths[0]!);
  await expect(page.getByText(files[0]!)).toBeVisible();
  await expect(page.getByText(/−\d+\.\d%/)).toBeVisible();
  await expect(page.getByAltText("After preview")).toHaveJSProperty("complete", true);
  await expect(page.getByRole("button", { name: "Download all" })).toHaveCount(0);

  const [single] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Download .*min\.svg/ }).click(),
  ]);
  expect(single.suggestedFilename()).toBe(files[0]!.replace(".svg", ".min.svg"));
  const saved = readFileSync(await single.path(), "utf8");
  expect(saved).toBe(optimizeSvg(readFileSync(paths[0]!, "utf8")).output);

  await page.locator('input[type="file"]').setInputFiles(paths[0]!);
  const [zip] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download as ZIP" }).click(),
  ]);
  const names = Object.keys(unzipSync(readFileSync(await zip.path()))).sort();
  const base = files[0]!.replace(".svg", "");
  expect(names).toEqual([`${base}-2.min.svg`, `${base}.min.svg`].sort());

  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole("button", { name: "Download all" }).click();
  await expect.poll(() => downloads.length).toBe(2);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText(files[0]!)).toHaveCount(0);
});

test("previews a dark file on a dark background, and the user can change it", async ({ page }) => {
  const dark = files.find((f) => f.includes("(dark)"))!;
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path.join(dir, dark));
  const preview = page.getByTestId("preview").first();
  await expect(preview).toHaveCSS("background-color", "rgb(38, 38, 36)");
  await page.getByAltText("After preview").evaluate((img: HTMLImageElement) => img.decode());
  await page.screenshot({ path: "test-results/dark-preview.png" });
  await page.getByRole("button", { name: "Light preview" }).click();
  await expect(preview).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("previews a light file on a light background", async ({ page }) => {
  const light = files.find((f) => !f.includes("(dark)"))!;
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path.join(dir, light));
  await expect(page.getByTestId("preview").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "Dark preview" })).toBeVisible();
});

test("shows an error for one bad file and keeps the good file", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("nope") },
    { name: files[0]!, mimeType: "image/svg+xml", buffer: readFileSync(paths[0]!) },
  ]);
  await expect(page.getByRole("alert")).toContainText("bad.svg");
  await expect(page.getByText(files[0]!)).toBeVisible();
});

test("accepts dropped files", async ({ page }) => {
  await page.goto("/");
  const transfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "dropped.svg", { type: "image/svg+xml" }));
    return dt;
  }, readFileSync(paths[0]!, "utf8"));
  await page.locator("label").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByText("dropped.svg")).toBeVisible();
});
