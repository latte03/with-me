import { test, expect, type Page } from '@playwright/test';

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

test('chat actions: image attach, edit, delete, role rename/pin; second device converges', async ({ page, context, browser }) => {
  test.setTimeout(120000);
  await login(page);
  await page.click('.pill-dots');
  await page.getByText('新角色', { exact: true }).click();
  await page.fill('.role-form input[name=name]', '动作会话');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');

  // text then edit
  await page.fill('.chat textarea', '原始文本');
  await page.click('.chat .send');
  await page.waitForSelector('.msg-text:has-text("原始文本")');
  await page.click('.msg-row:has-text("原始文本") .bubble');
  await page.getByText('编辑', { exact: true }).click();
  await page.fill('.modal input[name=text]', '改后文本');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.msg-text', { hasText: '改后文本' })).toBeVisible();

  // image attach
  await page.setInputFiles('.chat input[type=file]', { name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.msg-img').first()).toBeVisible({ timeout: 15000 });

  // delete the edited text
  await page.click('.msg-row:has-text("改后文本") .bubble');
  await page.getByText('删除', { exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).last().click();
  await expect(page.locator('.msg-text', { hasText: '改后文本' })).toHaveCount(0);

  // role rename + pin via chat menu
  await page.click('.chat .more');
  await page.getByText('角色设置', { exact: true }).click();
  await page.fill('.role-form input[name=name]', '改名会话');
  await page.check('.role-form input[name=pinned]');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.chat-title')).toHaveText('改名会话');

  // drain uploads/ops then verify on a second device (cold sync)
  await page.click('.chat .back');
  await expect(page.locator('.sync-dot')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('.role-row', { hasText: '改名会话' }).first()).toBeVisible();

  const ctx2 = await browser.newContext();
  const B = await ctx2.newPage();
  await login(B);
  await B.locator('.role-row', { hasText: '改名会话' }).first().click();
  await B.waitForSelector('.chat textarea');
  await expect(B.locator('.msg-img').first()).toBeVisible({ timeout: 20000 });
  await expect(B.locator('.msg-text', { hasText: '改后文本' })).toHaveCount(0);
  await ctx2.close();
  await context.close();
});