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

test('settings: quota, devices, admin create user, export download', async ({ page }) => {
  await login(page);
  await page.click('.tab[data-tab=settings]');
  await expect(page.locator('.quota-text')).toContainText('/');
  await expect(page.locator('.device-row').first()).toBeVisible();
  // admin card visible for admin
  await expect(page.locator('.admin-card')).toBeVisible();

  // admin creates a new account via modal
  await page.click('.new-user');
  await page.fill('input[name=username]', 'e2e-user');
  await page.fill('input[name=password]', 'pw123456');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.locator('.user-list')).toContainText('e2e-user');

  // export json triggers a download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.exp-json')]);
  expect(dl.suggestedFilename()).toContain('.json');

  // 版本号在设置页最后一行；出包时由 build-fpk.sh 注入，本地构建显示 dev
  await expect(page.locator('.about')).toHaveText(/^与我 · 版本 (dev|\d+\.\d+\.\d+)$/);
});