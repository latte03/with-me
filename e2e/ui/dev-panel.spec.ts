import { test, expect, type Page } from '@playwright/test';

const USER = 'admin';
const PW = 'pw123456';
const PANEL = '.dev-panel';
const EXTRA_KEY = 'with-me.dev.tabbarExtra';
const PANEL_KEY = 'with-me.dev.panel';
const DEV_CHECK = '.dev-card input[name="dev-panel"]';
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

// 面板贴顶右侧、最高 60dvh，会盖住设置页上半屏：把诊断卡滚到面板下沿之下，勾选行才点得到（真机同样要滚）
async function revealDevCard(page: Page) {
  await page.locator('.dev-card').evaluate((card) => {
    const view = card.closest('.view') as HTMLElement;
    const panel = document.querySelector('.dev-panel');
    const floor = panel ? panel.getBoundingClientRect().bottom + 12 : 0;
    view.scrollTop += card.getBoundingClientRect().top - floor;
  });
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

  // 关闭面板：DOM 与内联变量都清掉，默认观感恢复（滑杆数值留在存储里，下次打开继续用）
  await page.locator('.dev-close').click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator('.dev-probe')).toHaveCount(0);
  expect(await tabbarMargin(page)).toBe(base);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--tabbar-extra'))).toBe('');
  // 关闭=彻底关：主开关 stored 键一并清掉，滑杆数值键不动
  expect(await page.evaluate((k) => localStorage.getItem(k), PANEL_KEY)).toBe(null);
  expect(await page.evaluate((k) => localStorage.getItem(k), EXTRA_KEY)).toBe('0');
  // 去掉 query 再启动（主屏 PWA 场景）：不该自己回来
  await page.goto('/');
  await page.waitForSelector('.role-list');
  await expect(page.locator(PANEL)).toHaveCount(0);
});

test('dev panel: 设置页勾选 → 无 query 也开，刷新保持，取消后彻底关', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await login(page);
  await expect(page.locator(PANEL)).toHaveCount(0);

  await page.click('.tab[data-tab=settings]');
  const check = page.locator(DEV_CHECK);
  await expect(check).not.toBeChecked();
  await expect(page.locator('.dev-card .small-text')).toContainText('仅排查用');
  // 勾选前仍是零痕迹：面板 chunk 没被下载
  expect(requested.some((u) => DEV_CHUNK.test(u))).toBe(false);

  await check.check();
  await expect(page.locator(PANEL)).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), PANEL_KEY)).toBe('1');
  // 真挂上了而不是空壳：真值读数与滑杆都在，且 URL 没有任何 query（主屏 PWA 就是这样）
  await expect(page.locator('.dev-row[data-key="innerHeight"] .dev-val')).toHaveText(/^\d+(\.\d+)?$/);
  await expect(page.locator('.dev-range')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  // 刷新（依旧不带 query）：stored 键让它继续开，勾选状态也跟着回来
  await page.reload();
  await page.waitForSelector('.settings');
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(DEV_CHECK)).toBeChecked();

  // 取消勾选：面板与探针摘掉、键删掉、内联变量清掉
  await revealDevCard(page);
  await page.locator(DEV_CHECK).uncheck();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator('.dev-probe')).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), PANEL_KEY)).toBe(null);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--tabbar-extra'))).toBe('');

  // 再刷新也不回来，勾选框保持未选
  await page.reload();
  await page.waitForSelector('.settings');
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator(DEV_CHECK)).not.toBeChecked();
});

test('dev panel: ?dev=1 粘住 stored，去掉 query 重启仍在，设置里可关', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginWithDev(page);
  await expect(page.locator(PANEL)).toBeVisible();
  // URL 入口补写 stored，之后不带参数也开
  expect(await page.evaluate((k) => localStorage.getItem(k), PANEL_KEY)).toBe('1');

  await page.goto('/');
  await page.waitForSelector('.role-list');
  expect(new URL(page.url()).search).toBe('');
  await expect(page.locator(PANEL)).toBeVisible();

  // 设置里取消 = 彻底关，再启动也不回来
  await page.click('.tab[data-tab=settings]');
  await expect(page.locator(DEV_CHECK)).toBeChecked();
  await revealDevCard(page);
  await page.locator(DEV_CHECK).uncheck();
  await expect(page.locator(PANEL)).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), PANEL_KEY)).toBe(null);
  await page.goto('/');
  await page.waitForSelector('.role-list');
  await expect(page.locator(PANEL)).toHaveCount(0);
});