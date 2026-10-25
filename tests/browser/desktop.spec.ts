import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { viewFor } from "./project-view";

async function openDesktop(page: Page, stage: Parameters<typeof viewFor>[0]) {
  const view = await viewFor(stage);
  await page.route("**/api/projects/harbour-clinic", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ op: "start" });
    await route.fulfill({ json: { view } });
  });
  // A fixture must never make a real authentication/model request.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4177(?:\/|$))/, (route) => route.abort());
  await page.goto("/");
}

for (const app of [
  { name: "Notes", title: "Notes — Requirements", label: "Requirements", stage: "requirements" },
  { name: "Cody", title: "Cody — AI coding agent", label: "Task for Cody", stage: "brief" },
  { name: "Meet", title: "Meet — Grace Wong", label: "Your question", stage: "interview" },
] as const) {
  for (const compact of [false, true]) {
    test(`${app.name} keeps its draft mounted while minimised and editable after restoring${compact ? " (compact viewport)" : ""}`, async ({ page }) => {
      if (compact) await page.setViewportSize({ width: 760, height: 900 });
      await openDesktop(page, app.stage);
      const dialog = page.locator(`section[role="dialog"][aria-label="${app.title}"]`);
      const input = dialog.getByRole("textbox", { name: app.label, exact: true });
      const draft = `Unsaved ${app.name} draft — keep this exact text.`;
      await input.fill(draft);
      const original = await input.elementHandle();

      await dialog.getByRole("button", { name: "Minimise", exact: true }).click();
      await expect(dialog).toBeAttached();
      await expect(dialog).toBeHidden();
      await expect(dialog).toHaveCSS("display", "none");
      // Hidden windows must not retain a keyboard focus target.
      await original!.evaluate((element) => (element as HTMLElement).focus());
      expect(await original!.evaluate((element) => document.activeElement === element)).toBe(false);
      await expect(page.getByRole("dialog", { name: app.title, exact: true })).toHaveCount(0);

      await page.getByRole("navigation", { name: "Dock" }).getByRole("button", { name: new RegExp(`^${app.name}(?:,|$)`) }).click();
      await expect(dialog).toBeVisible();
      expect(await input.evaluate((element, prior) => element === prior, original!)).toBe(true);
      await expect(input).toHaveValue(draft);
      await input.fill(`${draft} Still editable.`);
      await expect(input).toHaveValue(`${draft} Still editable.`);
    });
  }
}

test("Notes text, placeholder and caret remain readable before and after restoring", async ({ page }) => {
  await openDesktop(page, "requirements");
  const dialog = page.getByRole("dialog", { name: "Notes — Requirements", exact: true });
  const input = dialog.getByRole("textbox", { name: "Requirements", exact: true });

  async function checkContrast(phase: string) {
    const colors = await input.evaluate((element) => {
      type Color = { r: number; g: number; b: number; alpha: number };
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      function parse(color: string): Color {
        // Canvas converts CSS Color 4/oklch computed styles into sRGB pixels.
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
        return { r, g, b, alpha: alpha / 255 };
      }
      function over(front: Color, back: Color): Color {
        const alpha = front.alpha + back.alpha * (1 - front.alpha);
        return {
          r: (front.r * front.alpha + back.r * back.alpha * (1 - front.alpha)) / alpha,
          g: (front.g * front.alpha + back.g * back.alpha * (1 - front.alpha)) / alpha,
          b: (front.b * front.alpha + back.b * back.alpha * (1 - front.alpha)) / alpha,
          alpha,
        };
      }
      let background = parse("white");
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
      for (const node of ancestors) background = over(parse(getComputedStyle(node).backgroundColor), background);
      const style = getComputedStyle(element);
      const placeholder = getComputedStyle(element, "::placeholder");
      const foreground = over(parse(style.color), background);
      const placeholderColor = parse(placeholder.color);
      placeholderColor.alpha *= Number(placeholder.opacity);
      const caret = over(parse(style.caretColor), background);
      function luminance(color: Color) {
        const channels = [color.r, color.g, color.b].map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      function contrast(color: Color) {
        const values = [luminance(color), luminance(background)].sort((a, b) => a - b);
        return (values[1] + 0.05) / (values[0] + 0.05);
      }
      return {
        foreground: contrast(foreground),
        placeholder: contrast(over(placeholderColor, background)),
        caretLuminance: luminance(caret),
      };
    });
    const path = test.info().outputPath(`notes-contrast-${phase}.json`);
    await writeFile(path, JSON.stringify(colors, null, 2));
    await test.info().attach(`notes-contrast-${phase}`, {
      path,
      contentType: "application/json",
    });
    expect(colors.foreground, "Notes foreground contrast").toBeGreaterThanOrEqual(7);
    expect(colors.placeholder, "Notes placeholder contrast").toBeGreaterThanOrEqual(4.5);
    expect(colors.caretLuminance, "Notes caret must be dark").toBeLessThan(0.1);
  }

  await expect(input).toBeVisible();
  await checkContrast("before");
  const draft = "需求草稿：取消预约时保留原记录；两位接待员不能预订同一时段。\nPreserve cancelled appointments and prevent simultaneous double bookings.";
  await input.fill(draft);
  await dialog.getByRole("button", { name: "Minimise", exact: true }).click();
  await page.getByRole("navigation", { name: "Dock" }).getByRole("button", { name: /^Notes(?:,|$)/ }).click();
  await checkContrast("after");
  await expect(input).toHaveValue(draft);
  await input.fill(`${draft}\n恢复后仍可继续编辑。`);
  await expect(input).toHaveValue(`${draft}\n恢复后仍可继续编辑。`);
  await page.screenshot({ path: test.info().outputPath("notes-restored.png"), fullPage: true });
});
