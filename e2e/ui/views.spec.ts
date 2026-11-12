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

test('calendar day/month aggregates records; search online + offline fallback', async ({ page, context }) => {
  await login(page);
  // create a role + message so calendar/search have data
  await page.click('.pill-dots');
  await page.getByText('新角色', { exact: true }).click();
  await page.fill('.role-form input[name=name]', '日历测试');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');
  await page.fill('.chat textarea', '日历条目甲');
  await page.click('.chat .send');
  await page.waitForSelector('.msg-text:has-text("日历条目甲")');

  // calendar day view shows today's record (leave chat view first: it has no tabbar)
  await page.click('.chat .back');
  await page.click('.tab[data-tab=calendar]');
  await expect(page.locator('.day-row', { hasText: '日历条目甲' })).toBeVisible();
  // month view: today's cell carries role-color dots + a record count (preview lines are gone); drill into today
  await page.click('.mode-seg button[data-mode=month]');
  const todayCell = page.locator('.month-cell.today');
  await expect(todayCell).toHaveClass(/has-records/);
  await expect(todayCell.locator('.cell-count')).toHaveText(/^\d+ 条$/);
  expect(await todayCell.locator('.cell-dots i').count()).toBeGreaterThanOrEqual(1);
  expect(await todayCell.locator('.cell-dots i').count()).toBeLessThanOrEqual(3);
  await expect(page.locator('.month-grid .cell-preview')).toHaveCount(0);
  await page.click('.month-cell.today');
  await expect(page.locator('.day-row', { hasText: '日历条目甲' })).toBeVisible();

  // search online
  await page.click('.tab[data-tab=chats]');
  await page.click('.search-pill');
  await page.waitForSelector('.search-input');
  await page.fill('.search-input', '日历条目甲');
  await expect(page.locator('.search-row', { hasText: '日历条目甲' }).first()).toBeVisible({ timeout: 15000 });

  // search offline fallback (local substring)
  await context.setOffline(true);
  await page.fill('.search-input', '日历条目甲');
  await expect(page.locator('.search-note')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.search-row', { hasText: '日历条目甲' }).first()).toBeVisible();
  await context.setOffline(false);
});
test('shell is reused across tab switches (no full teardown)', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    (document.querySelector('.tabbar') as HTMLElement).dataset.probe = 'kept';
  });
  await page.click('.tab[data-tab=calendar]');
  await expect(page.locator('.head-title')).toHaveText('日历');
  expect(await page.locator('.tabbar').getAttribute('data-probe')).toBe('kept');
  await page.click('.tab[data-tab=settings]');
  await expect(page.locator('.head-title')).toHaveText('设置');
  expect(await page.locator('.tabbar').getAttribute('data-probe')).toBe('kept');
  await page.click('.tab[data-tab=chats]');
  await expect(page.locator('.head-title')).toHaveText('聊天');
  expect(await page.locator('.tabbar').getAttribute('data-probe')).toBe('kept');
});
