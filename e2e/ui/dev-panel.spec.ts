import { test, expect, type Page } from '@playwright/test';

const USER = 'admin';
const PW = 'pw123456';
const PANEL = '.dev-panel';
const EXTRA_KEY = 'with-me.dev.tabbarExtra';
// 面板走动态 import 单独分包，chunk 名由 vite 生成（dev-panel-<hash>.js）
const DEV_CHUNK = /\/dev-panel-[^/]+\.js/;

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PW);
  await page.click('.submit');
  await page.waitForSelector('.role-list');
}

// 登录后再带 ?dev=1 进页面：面板贴顶右侧，会盖住居中的登录卡，先登录免得点不到 .submit
async function loginWithDev(page: Page) {
  await login(page);
  await page.goto('/?dev=1');
  await page.waitForSelector('.role-list');
}

// 只取 computed marginBottom 的 px 数值：断言用差值，不写死 8px/安全区（真机 inset 非 0）
function tabbarMargin(page: Page): Promise<number> {
  return page.locator('.tabbar').evaluate((bar) => Number.parseFloat(getComputedStyle(bar).marginBottom));
}

test('dev panel: 不带 ?dev=1 时零痕迹（不渲染、不下载 chunk、不动默认底距）', async ({ page }) => {
  // 移动端视口才有 fixed tabbar；>=1024px 走侧栏，margin 恒为 0
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await login(page);

  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator('.dev-probe')).toHaveCount(0);
  expect(requested.some((u) => DEV_CHUNK.test(u))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--tabbar-extra'))).toBe('');
});

test('dev panel: ?dev=1 读真值 + 滑杆调底距 + 刷新保持 + 重置', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginWithDev(page);
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('.dev-note')).toContainText('仅诊断用');

  // 读数是真值而不是占位：innerHeight 与浏览器实测一致，四个安全区探针都有读数
  const inner = page.locator('.dev-row[data-key="innerHeight"] .dev-val');
  await expect(inner).toHaveText(/^\d+(\.\d+)?$/);
  expect(await inner.textContent()).toBe(String(await page.evaluate(() => window.innerHeight)));
  await expect(page.locator('.dev-row[data-key^="inset"] .dev-val')).toHaveCount(4);
  await expect(page.locator('.dev-row[data-key="ua"] .dev-val')).not.toHaveText('');

  // 面板要盖在 tabbar 之上，又不能挡住 tabbar：调底距时得一直看得见它
  const zPanel = await page.locator(PANEL).evaluate((n) => Number(getComputedStyle(n).zIndex));
  const zBar = await page.locator('.tabbar').evaluate((n) => Number(getComputedStyle(n).zIndex));
  expect(zPanel).toBeGreaterThan(zBar);
  const panelBox = await page.locator(PANEL).boundingBox();
  const barBox = await page.locator('.tabbar').boundingBox();
  expect(panelBox && barBox && panelBox.y + panelBox.height <= barBox.y).toBe(true);

  const range = page.locator('.dev-range');
  // 先归零取基线，与本机历史存储无关
  await page.locator('.dev-reset').click();
  await expect(range).toHaveValue('0');
  const base = await tabbarMargin(page);

  await range.fill('24');
  await expect(page.locator('.dev-value')).toHaveText('24px');
  expect(await tabbarMargin(page) - base).toBe(24);
  expect(await page.evaluate((k) => localStorage.getItem(k), EXTRA_KEY)).toBe('24');

  // 刷新后仍是 24：localStorage 持久化 + 面板挂载即应用
  await page.reload();
  await page.waitForSelector('.role-list');
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(range).toHaveValue('24');
  expect(await tabbarMargin(page) - base).toBe(24);

  // 重置回 0：观感与存储都回到默认
  await page.locator('.dev-reset').click();
  await expect(range).toHaveValue('0');
  await expect(page.locator('.dev-value')).toHaveText('0px');
  expect(await tabbarMargin(page)).toBe(base);
  expect(await page.evaluate((k) => localStorage.getItem(k), EXTRA_KEY)).toBe('0');

  // 关闭面板：DOM 与内联变量都清掉，默认观感恢复（数值留在存储里，下次打开继续用）
  await page.locator('.dev-close').click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator('.dev-probe')).toHaveCount(0);
  expect(await tabbarMargin(page)).toBe(base);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--tabbar-extra'))).toBe('');
});