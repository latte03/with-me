import { test, expect, type Page } from '@playwright/test';

const USER = 'admin';
const PW = 'pw123456';

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PW);
  await page.click('.submit');
  await page.waitForSelector('.role-list');
}

async function expectMinSize(page: Page, selector: string, min: number) {
  // offset* is the layout hit box; boundingBox adds transform float noise (43.999998 for 44px)
  const box = await page.locator(selector).first().evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight }));
  expect(box.width, `${selector} width`).toBeGreaterThanOrEqual(min);
  expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(min);
}

test('mobile: primary controls >=44px, todo-check/chip-x >=24px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.click('.pill-dots');
  await page.getByText('新角色', { exact: true }).click();
  await page.fill('.role-form input[name=name]', '触控会话');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');

  await expectMinSize(page, '.chat .back', 44);
  await expectMinSize(page, '.chat .send', 44);
  await expectMinSize(page, '.chat .plus', 44);

  await page.click('.chat .plus');
  await page.waitForSelector('.menu-item');
  for (const item of await page.locator('.menu-item').all()) {
    const h = await item.evaluate((el) => el.offsetHeight);
    expect(h).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-overlay')).toHaveCount(0);

  await page.click('.chat .plus');
  await page.getByText('发成待办', { exact: true }).click();
  await expect(page.locator('.todo-chip')).toBeVisible();
  await expectMinSize(page, '.chip-x', 24);
  await page.fill('.chat textarea', '触控待办');
  await page.click('.chat .send');
  await page.waitForSelector('.bubble.todo .todo-check');
  await expectMinSize(page, '.bubble.todo .todo-check', 24);
});

test('keyboard: Esc closes menu/modal and restores focus; modal traps Tab', async ({ page }) => {
  await login(page);

  // menu: Esc closes, focus returns to the opener
  await page.click('.pill-dots');
  await page.waitForSelector('.menu-item');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-overlay')).toHaveCount(0);
  await expect(page.locator('.pill-dots')).toBeFocused();

  // role editor modal: Esc closes, focus returns to the opener
  await page.click('.pill-dots');
  await page.getByText('角色管理', { exact: true }).click();
  await page.waitForSelector('.manager-row');
  await page.locator('.manager-row button').first().click();
  await page.waitForSelector('.role-form');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  await expect(page.locator('.pill-dots')).toBeFocused();

  // Tab cycles inside the modal, never escapes
  await page.click('.pill-dots');
  await page.getByText('角色管理', { exact: true }).click();
  await page.locator('.manager-row button').first().click();
  await page.waitForSelector('.role-form');
  const insideModal = () =>
    page.evaluate(() => document.querySelector('.modal')?.contains(document.activeElement) ?? false);
  expect(await insideModal()).toBe(true);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    expect(await insideModal(), `Tab ${i + 1} should stay inside the modal`).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await insideModal(), `Shift+Tab ${i + 1} should stay inside the modal`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
});

test('deep links: #/calendar boots to calendar; chat survives reload; back works', async ({ page }) => {
  await page.goto('/#/calendar');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PW);
  await page.click('.submit');
  await page.waitForSelector('.mode-seg');
  await expect(page.locator('.cal-nav')).toBeVisible();

  await page.click('.tab[data-tab=chats]');
  await page.locator('.role-row').first().click();
  await page.waitForSelector('.chat textarea');
  await expect(page.locator('.chat-title')).not.toHaveText('');
  const title = await page.locator('.chat-title').textContent();
  await expect(page).toHaveURL(/#\/chat\/.+/);

  await page.reload();
  await page.waitForSelector('.chat textarea');
  await expect(page.locator('.chat-title')).toHaveText(title!);
  await expect(page.locator('.role-list')).toBeVisible();

  await page.goBack();
  await page.waitForSelector('.role-list');
  await expect(page.locator('.chat')).toHaveCount(0);
});