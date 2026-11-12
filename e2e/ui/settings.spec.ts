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

async function deviceRows(page: Page) {
  await page.click('.tab[data-tab=settings]');
  await expect(page.locator('.device-list .device-row').first()).toBeVisible();
  return page.locator('.device-list .device-row').count();
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

// 全新浏览器上下文 = 存储被清空 / 主屏 PWA 与 Safari 互换 / 换入口域名：
// 同一台设备再登录也不该多出一行。
test('settings: 同设备换存储实例不重复记录', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    await login(a);
    const before = await deviceRows(a);

    const b = await ctxB.newPage();
    await login(b);
    expect(await deviceRows(b)).toBe(before);
    await expect(b.locator('.device-list .device-row .tag', { hasText: '本机' })).toHaveCount(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});