import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const USER = 'admin';
const PW = 'pw123456'; // created by e2e/api-smoke.mjs against the same fresh server

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PW);
  await page.click('.submit');
  await page.waitForSelector('.role-list');
}

async function openRole(page: Page, name: string) {
  await page.locator('.role-row', { hasText: name }).first().click();
  await page.waitForSelector('.chat textarea');
}

async function send(page: Page, text: string) {
  await page.fill('.chat textarea', text);
  await page.click('.chat .send');
  await page.waitForSelector(`.msg-text:has-text("${text}")`);
}

async function texts(page: Page): Promise<string[]> {
  const t = await page.locator('.chat .msg-text').allTextContents();
  return t.slice().sort();
}

async function drained(page: Page) {
  await page.click('.chat .back');
  await expect(page.locator('.sync-dot')).toBeHidden({ timeout: 15000 });
}

test('two devices: offline record converges on reconnect; todo done syncs', async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA: BrowserContext = await browser.newContext();
  const ctxB: BrowserContext = await browser.newContext();
  const A: Page = await ctxA.newPage();
  const B: Page = await ctxB.newPage();

  await login(A);
  await A.click('.pill-dots');
  await A.getByText('新角色', { exact: true }).click();
  await A.fill('.role-form input[name=name]', '收敛会话');
  await A.getByRole('button', { name: '保存' }).click();
  await A.waitForSelector('.chat textarea');
  await send(A, '你好世界');
  await drained(A);
  await openRole(A, '收敛会话');

  // device B logs in and pulls role + message
  await login(B);
  await openRole(B, '收敛会话');
  await expect(B.locator('.msg-text', { hasText: '你好世界' })).toBeVisible({ timeout: 20000 });

  // A records offline (optimistic local), reconnects; B receives live
  await ctxA.setOffline(true);
  await send(A, '离线A记录');
  await ctxA.setOffline(false);
  await drained(A);
  await openRole(A, '收敛会话');
  await B.bringToFront();
  await expect(B.locator('.msg-text', { hasText: '离线A记录' })).toBeVisible({ timeout: 25000 });
  expect(await texts(A)).toEqual(await texts(B));

  // todo: A creates + completes; after A drains, B cold-syncs and sees done
  await A.click('.chat .plus');
  await A.getByText('发成待办', { exact: true }).click();
  await expect(A.locator('.todo-chip')).toBeVisible();
  await A.fill('.chat textarea', '买牛奶');
  await A.click('.chat .send');
  await A.waitForSelector('.bubble.todo');
  await A.click('.bubble.todo .todo-check');
  await expect(A.locator('.bubble.todo.done')).toBeVisible();
  await drained(A);
  await openRole(A, '收敛会话');

  await B.reload();
  await B.waitForSelector('.role-list');
  await openRole(B, '收敛会话');
  await expect(B.locator('.bubble.todo.done')).toBeVisible({ timeout: 20000 });
  await expect(B.locator('.msg-text', { hasText: '买牛奶' })).toBeVisible();

  expect(await texts(A)).toEqual(await texts(B));
  await ctxA.close();
  await ctxB.close();
});