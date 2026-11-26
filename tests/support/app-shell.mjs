// Playwright helpers for the FORGE app shell (sidebar, command palette, preferences).
// Shared by tests/*.test.mjs and app/web/tests/*.mjs; drive only visible UI.

export const PALETTE_BUTTON = /^(Search and commands|ค้นหาและคำสั่ง)$/;
export const PREFERENCES_BUTTON = /^(Language & theme|ภาษาและธีม)$/;
export const LANGUAGE_SELECT = /^(Language|ภาษา)$/;

// Opens the command palette from the visible top-bar button (works at every width).
export async function openPalette(page) {
  await page.getByRole('button', { name: PALETTE_BUTTON }).click();
  const box = page.getByRole('dialog').getByRole('combobox');
  await box.waitFor();
  return box;
}

// Opens any of the 23 app routes by its exact visible name in the current language.
export async function openRoute(page, name) {
  const box = await openPalette(page);
  await box.fill(name);
  await page.getByRole('option', { name, exact: true }).and(page.locator('[data-kind="page"]')).click();
  await box.waitFor({ state: 'detached' });
}

async function withPreferences(page, fn) {
  const trigger = page.getByRole('button', { name: PREFERENCES_BUTTON });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await fn();
  if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
}

export async function setLanguage(page, lang) {
  await withPreferences(page, () => page.getByRole('dialog', { name: PREFERENCES_BUTTON })
    .getByRole('combobox', { name: LANGUAGE_SELECT }).selectOption(lang));
  await page.waitForFunction(value => document.documentElement.lang === value, lang);
}

// Chooses a named theme through the real theme chooser inside the preferences popover.
export async function chooseTheme(page, label) {
  await withPreferences(page, async () => {
    await page.getByRole('button', { name: /^(Choose theme|เลือกธีม)/ }).click();
    await page.getByRole('radio', { name: label, exact: true }).click();
  });
}

// Opens the theme chooser dialog and leaves the preferences popover open behind it.
export async function openThemePicker(page) {
  const trigger = page.getByRole('button', { name: PREFERENCES_BUTTON });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.getByRole('button', { name: /^(Choose theme|เลือกธีม)/ }).click();
}

// Switches the current project through the sidebar project switcher.
export async function switchProject(page, name) {
  if (!await page.locator('aside.sidebar .project-switcher-trigger').isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: /^(Switch project|เปลี่ยนโปรเจกต์):/ }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}
