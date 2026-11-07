import { test, expect, type Page } from '@playwright/test';

// 局域网 http://<NAS-IP> 打开时页面处在非安全上下文：crypto.randomUUID / crypto.subtle 都不存在。
// 这里把两者提前摘掉，模拟这种访问方式，验证注册后仍能建角色、发文本和图片。
const USER = 'admin';
const PW = 'pw123456';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PW);
  await page.click('.submit');
  await page.waitForSelector('.role-list');
}

test('insecure context: 无 randomUUID / subtle 时仍可建角色并收发图片', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true });
    Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });
  });

  await login(page);
  // 先证明模拟生效，否则这条用例测不到兜底
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  expect(await page.evaluate(() => typeof crypto.subtle)).toBe('undefined');

  await page.click('.pill-dots');
  await page.getByText('新角色', { exact: true }).click();
  await page.fill('.role-form input[name=name]', '弱上下文会话');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');

  await page.fill('.chat textarea', '没有 randomUUID 也能发');
  await page.click('.chat .send');
  await expect(page.locator('.msg-text', { hasText: '没有 randomUUID 也能发' })).toBeVisible();

  await page.setInputFiles('.chat input[type=file]', { name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.msg-img').first()).toBeVisible({ timeout: 15000 });
});
