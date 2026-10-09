import { test, expect } from "@playwright/test";

// S26.13 (U22): "?" opens Help from the plan, as the button does. In a text field it is a character.
// Real keys on the focused editor (finding 3); the Outline filter is a real input.

const EDITOR = "floorplan-studio-editor";

test("? on the plan opens Help; in the Outline filter it types a question mark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  const help = page.locator(`${EDITOR} #helpClose`);
  await expect(help).toHaveCount(0);

  // a real press on empty canvas focuses the editor, then the key
  const c = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
  await page.mouse.click(c.x + 4, c.y + c.height - 4);
  await page.keyboard.press("?");
  await expect(help).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  // in a text field the key is a character and Help stays shut
  if (await page.locator(`${EDITOR} #tabOutline`).count() && !(await page.locator(`${EDITOR} #outlineFilter`).count())) await page.locator(`${EDITOR} #sideToggle, ${EDITOR} [aria-controls="sideBody"]`).first().click();
  const filter = page.locator(`${EDITOR} #outlineFilter`);
  await filter.click();
  await page.keyboard.type("a?b");
  await expect(filter).toHaveValue("a?b");
  await expect(help).toHaveCount(0);
});

// Opus review R3: Help showed only while the Inspector was in Selection. In Add, Place or Link the "?" key and the Help button
// did nothing visible. The guide shows in any mode; Escape closes it first and leaves the mode.
for (const mode of ["add", "place", "link"] as const) {
  test(`Help shows in the ${mode} mode, by the ? key and by the button; Escape closes Help and keeps the mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/standalone.html");
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
    await page.evaluate(([tag, m]) => {
      const ed = document.querySelector(tag as string) as any;
      ed.ha = { floors: [], areas: [], entities: [] }; // Link needs Home Assistant data
      if (m === "add") ed.openAddDev(); else if (m === "place") ed.openPlace(0); else ed.openLink();
    }, [EDITOR, mode] as const);
    await expect(page.locator(`${EDITOR} aside [role=tab][data-mode="${mode}"]`)).toHaveAttribute("aria-selected", "true");
    const controls = page.locator(`${EDITOR} #controls`);
    await expect(controls).toHaveCount(0);
    await page.locator(`${EDITOR} #help`).click();
    await expect(controls).toBeVisible();
    await page.locator(`${EDITOR} #helpClose`).click();
    await expect(controls).toHaveCount(0);
    // the key: a real press on empty canvas focuses the editor
    const c = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
    await page.mouse.click(c.x + 4, c.y + c.height - 4);
    await page.keyboard.press("?");
    await expect(controls).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(controls).toHaveCount(0);
    await expect(page.locator(`${EDITOR} aside [role=tab][data-mode="${mode}"]`)).toHaveAttribute("aria-selected", "true"); // Escape closed Help only
  });
}
