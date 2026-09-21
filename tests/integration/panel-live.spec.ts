import { test, expect } from "@playwright/test";

// S3.2: the panel inside a real Home Assistant with the integration installed and added.
// Skipped unless HA_URL and HA_TOKEN (a long-lived token) are set. The token stays in the environment, never in the repo.
// NOT YET RUN against a real HA: written to the plan, checked only for skipping cleanly.
const url = process.env.HA_URL;
const token = process.env.HA_TOKEN;
test.skip(!url || !token, "set HA_URL and HA_TOKEN to run against a real Home Assistant");

test("the panel loads the saved plan, a saved edit survives a page reload", async ({ page }) => {
  await page.addInitScript(({ url, token }) => {
    localStorage.setItem("hassTokens", JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: 1e9, hassUrl: url, clientId: url + "/", expires: Date.now() + 1e12, refresh_token: "" }));
  }, { url: url!, token: token! });
  await page.goto(`${url}/floorplan-studio`);
  const editor = page.locator("floorplan-studio-panel floorplan-studio-editor");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('details.menu > summary:text-is("File")').click();
  await editor.locator("#save").click();
  await expect(editor.getByText(/Saved to Home Assistant/)).toBeVisible();
  await page.reload();
  await expect(page.locator("floorplan-studio-panel floorplan-studio-editor")).toBeVisible({ timeout: 30_000 });
});
