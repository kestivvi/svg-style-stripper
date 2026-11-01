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

test("slider compares before and after", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(paths[0]!);
  const slider = page.getByRole("slider");
  await expect(slider).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByAltText("Before preview")).toHaveCSS("clip-path", "inset(0px 50% 0px 0px)");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "52");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + 20);
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", "25");
  await expect(page.getByAltText("Before preview")).toHaveCSS("clip-path", "inset(0px 75% 0px 0px)");
});

function largestColorChange(page: Page, first: Buffer, second: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const read = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [one, two] = [await read(a!), await read(b!)];
      if (one.length !== two.length) return 255;
      let largest = 0;
      for (let i = 0; i < one.length; i++) largest = Math.max(largest, Math.abs(one[i]! - two[i]!));
      return largest;
    },
    [first.toString("base64"), second.toString("base64")],
  );
}

for (const file of files) {
  test(`slider shows each image like whole image mode: ${file}`, async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(path.join(dir, file));
    await page.addStyleTag({ content: '[data-testid="preview"] .pointer-events-none { visibility: hidden }' });
    const preview = page.getByTestId("preview");
    const shot = async () => {
      await page.mouse.move(0, 0);
      for (const img of await preview.locator("img").all()) {
        await img.evaluate((el: HTMLImageElement) => el.decode());
      }
      return preview.screenshot();
    };
    const drag = async (fraction: number) => {
      const box = (await preview.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * fraction, box.y + 20);
      await page.mouse.up();
    };
    await preview.scrollIntoViewIfNeeded();
    await drag(1.5);
    const sliderBefore = await shot();
    await drag(-0.5);
    const sliderAfter = await shot();
    await page.getByRole("button", { name: "Whole image" }).click();
    const wholeAfter = await shot();
    await page.getByRole("button", { name: "Show Before" }).click();
    const wholeBefore = await shot();
    // Rounded corners and about 100 edge pixels change by at most 7 of 255. Showing through changes text by 50 or more.
    expect(await largestColorChange(page, sliderBefore, wholeBefore), "before").toBeLessThanOrEqual(8);
    expect(await largestColorChange(page, sliderAfter, wholeAfter), "after").toBeLessThanOrEqual(8);
  });
}

test("whole image mode shows one image at a time", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(paths[0]!);
  await page.getByRole("button", { name: "Whole image" }).click();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByAltText("After preview")).toBeVisible();
  await expect(page.getByAltText("Before preview")).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Show Before" });
  const place = await toggle.boundingBox();
  await toggle.click();
  await expect(page.getByAltText("Before preview")).toBeVisible();
  await expect(page.getByAltText("After preview")).toHaveCount(0);
  const back = page.getByRole("button", { name: "Show After" });
  expect(await back.boundingBox()).toEqual(place);
  await back.click();
  await expect(page.getByAltText("After preview")).toBeVisible();
  await expect(page.getByAltText("Before preview")).toHaveCount(0);
});

for (const viewport of [{ width: 1600, height: 700 }, { width: 700, height: 1000 }]) {
  test(`preview fills the viewport ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(paths[0]!);
    const preview = page.getByTestId("preview");
    await page.getByAltText("After preview").evaluate((img: HTMLImageElement) => img.decode());
    await expect.poll(async () => {
      const box = (await preview.boundingBox())!;
      const full = await preview.evaluate((el) => el.parentElement!.clientWidth);
      return box.height <= viewport.height && (box.width >= full - 2 || box.height >= viewport.height - 34);
    }).toBe(true);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/preview-${viewport.width}.png` });
  });
}

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
