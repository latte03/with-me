import { test, expect, type Page } from '@playwright/test';

const USER = 'admin';
const PW = 'pw123456';
// 图标数据走动态 import 单独分包，chunk 名由 vite 生成（role-icons-<hash>.js / icon-catalog-<hash>.js）
const ICON_CHUNK = /\/(role-icons|icon-catalog)-[^/]+\.js/;
// 角色名带运行后缀：同一台 dev server 上重跑不会和上一轮的同名角色撞车
const RUN = Date.now().toString(36);

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PW);
  await page.click('.submit');
  await page.waitForSelector('.role-list');
}

async function openNewRole(page: Page, name: string) {
  await page.click('.pill-dots');
  await page.getByText('新角色', { exact: true }).click();
  await page.waitForSelector('.role-form');
  await page.fill('.role-form input[name=name]', name);
}

async function openPicker(page: Page) {
  await page.click('.avatar-preview');
  await page.waitForSelector('.icon-modal');
  await page.waitForSelector('.icon-cell');
}

const cellSize = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight }));

test('role icons: pick → save → list svg → reload keeps icon → back to emoji', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await login(page);
  await openNewRole(page, `图标会话${RUN}`);
  // 新建默认仍是 💬
  await expect(page.locator('.avatar-preview .avatar')).toHaveText('💬');

  await openPicker(page);
  // 打开面板才真的去取图标数据（boot 已预载的情况同样计入）
  expect(requested.some((u) => ICON_CHUNK.test(u))).toBe(true);
  await page.fill('.icon-search', '猫');
  await expect(page.locator('.icon-cell[aria-label="小猫"]')).toBeVisible();
  await expect(page.locator('.icon-cell')).toHaveCount(2); // 小猫 + 猫头鹰
  await page.click('.icon-cell[aria-label="小猫"]');

  // 单击即选中并关闭；预览是 svg，emoji 框清空且 placeholder 是中文名
  await expect(page.locator('.icon-modal')).toHaveCount(0);
  await expect(page.locator('.avatar-preview .avatar svg')).toBeVisible();
  await expect(page.locator('.avatar-preview .avatar.icon')).toHaveCount(1);
  await expect(page.locator('.avatar-emoji')).toHaveValue('');
  await expect(page.locator('.avatar-emoji')).toHaveAttribute('placeholder', '小猫');

  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');
  await page.click('.chat .back');
  const row = page.locator('.role-row', { hasText: `图标会话${RUN}` }).first();
  await expect(row.locator('.avatar svg')).toBeVisible();
  await expect(row.locator('.avatar')).toHaveClass(/icon/);

  // 刷新后图标仍在（boot 预载注册表，首屏不闪兜底）；此时路由已回到会话列表
  await page.reload();
  await page.waitForSelector('.role-list');
  await expect(page.locator('.role-row', { hasText: `图标会话${RUN}` }).first().locator('.avatar svg')).toBeVisible();

  // 编辑改回 emoji：列表显示文本 emoji，不再是 svg
  await page.click('.pill-dots');
  await page.getByText('角色管理', { exact: true }).click();
  await page.waitForSelector('.manager-row');
  await expect(page.locator('.manager-row', { hasText: `图标会话${RUN}` }).locator('.avatar svg')).toBeVisible();
  await page.locator('.manager-row', { hasText: `图标会话${RUN}` }).getByRole('button', { name: '编辑' }).click();
  await page.waitForSelector('.role-form');
  await expect(page.locator('.avatar-preview .avatar svg')).toBeVisible();
  await page.fill('.avatar-emoji', '🔖');
  await expect(page.locator('.avatar-preview .avatar')).toHaveText('🔖');
  await expect(page.locator('.avatar-preview .avatar svg')).toHaveCount(0);
  await page.getByRole('button', { name: '保存' }).click();
  const emojiRow = page.locator('.role-row', { hasText: `图标会话${RUN}` }).first();
  await expect(emojiRow.locator('.avatar')).toHaveText('🔖');
  await expect(emojiRow.locator('.avatar svg')).toHaveCount(0);
});

test('icon picker: category chips + search stack, cells >=44px, Esc restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await openNewRole(page, `面板会话${RUN}`);
  await openPicker(page);
  await expect(page.locator('.icon-cell')).toHaveCount(731);
  await expect(page.locator('.icon-cat')).toHaveCount(19); // 全部 + 18 分类
  await expect(page.locator('.icon-cat[aria-pressed="true"]')).toHaveText('全部');

  const size = await cellSize(page, '.icon-cell');
  expect(size.width, `cell width ${size.width}`).toBeGreaterThanOrEqual(44);
  expect(size.height, `cell height ${size.height}`).toBeGreaterThanOrEqual(44);
  // 375px 宽下面板不横向溢出
  const overflow = await page.evaluate(() => {
    const m = document.querySelector('.icon-modal') as HTMLElement;
    const g = document.querySelector('.icon-grid-wrap') as HTMLElement;
    return { modal: m.scrollWidth - m.clientWidth, grid: g.scrollWidth - g.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(overflow.modal).toBeLessThanOrEqual(0);
  expect(overflow.grid).toBeLessThanOrEqual(0);
  expect(overflow.doc).toBeLessThanOrEqual(0);

  await page.click('.icon-cat[aria-pressed="false"]:has-text("动物")');
  await expect(page.locator('.icon-cat[aria-pressed="true"]')).toHaveText('动物');
  await expect(page.locator('.icon-cell')).toHaveCount(41);
  await expect(page.locator('.icon-cell[aria-label="小猫"]')).toBeVisible();
  await expect(page.locator('.icon-cell[aria-label="飞机"]')).toHaveCount(0);

  // 分类与搜索叠加
  await page.click('.icon-cat:has-text("交通工具")');
  await expect(page.locator('.icon-cell')).toHaveCount(38);
  await expect(page.locator('.icon-cell[aria-label="飞机"]')).toBeVisible();
  await page.fill('.icon-search', '旅行');
  await expect(page.locator('.icon-cell')).toHaveCount(1);
  await expect(page.locator('.icon-cell[aria-label="飞机"]')).toBeVisible();
  await page.fill('.icon-search', '不存在的词');
  await expect(page.locator('.icon-cell')).toHaveCount(0);
  await expect(page.locator('.icon-empty')).toBeVisible();
  await page.fill('.icon-search', '');
  await expect(page.locator('.icon-cell')).toHaveCount(38);

  // Esc 关闭且焦点回到预览按钮，头像不被改动
  await page.keyboard.press('Escape');
  await expect(page.locator('.icon-modal')).toHaveCount(0);
  await expect(page.locator('.avatar-preview')).toBeFocused();
  await expect(page.locator('.avatar-preview .avatar')).toHaveText('💬');
  await expect(page.locator('.role-form')).toBeVisible();

  // 取消按钮同样不改任何东西
  await openPicker(page);
  await page.click('.icon-cell[aria-label="企鹅"]');
  await expect(page.locator('.avatar-preview .avatar svg')).toBeVisible();
  await openPicker(page);
  await expect(page.locator('.icon-cell[aria-pressed="true"]')).toHaveAttribute('aria-label', '企鹅');
  await page.click('.icon-modal .cancel');
  await expect(page.locator('.icon-modal')).toHaveCount(0);
  await expect(page.locator('.avatar-preview .avatar svg')).toBeVisible();
});

test('icon avatars keep a light paper background in dark theme; emoji keeps its tint', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.click('.tab[data-tab=settings]');
  await page.click('.theme-seg button[data-pref=dark]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('.tab[data-tab=chats]');

  await openNewRole(page, `深色图标${RUN}`);
  await openPicker(page);
  const paper = 'rgb(232, 220, 192)';
  await expect(page.locator('.icon-cell').first()).toHaveCSS('background-color', paper);
  await page.fill('.icon-search', '企鹅');
  await page.click('.icon-cell[aria-label="企鹅"]');
  await expect(page.locator('.avatar-preview .avatar.icon')).toHaveCSS('background-color', paper);
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');
  await page.click('.chat .back');

  const iconAvatar = page.locator('.role-row', { hasText: `深色图标${RUN}` }).first().locator('.avatar');
  await expect(iconAvatar).toHaveCSS('background-color', paper);
  // 纸底亮度足够高，近黑描边才看得见（相对亮度 > 0.6）
  const lum = await iconAvatar.evaluate((el) => {
    const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  });
  expect(lum).toBeGreaterThan(0.6);
  // 角色色改作环，图标本身保持库里原色（多彩填充不被 currentColor 覆盖）
  const fills = await iconAvatar.locator('svg').evaluate((svg) =>
    [...svg.querySelectorAll('[fill]')].map((n) => n.getAttribute('fill')).filter((f) => f && f !== 'none'),
  );
  expect(new Set(fills).size).toBeGreaterThan(1);
  expect(fills).not.toContain('currentColor');

  // emoji 头像观感不变：仍是角色色 22 透明底，不是纸底
  await openNewRole(page, `深色 emoji${RUN}`);
  await page.fill('.avatar-emoji', '🔖');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');
  await page.click('.chat .back');
  const emojiAvatar = page.locator('.role-row', { hasText: `深色 emoji${RUN}` }).first().locator('.avatar');
  await expect(emojiAvatar).toHaveText('🔖');
  await expect(emojiAvatar).not.toHaveCSS('background-color', paper);
  const alpha = await emojiAvatar.evaluate((el) => {
    const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/)![1].split(',');
    return m.length === 4 ? Number(m[3]) : 1;
  });
  expect(alpha).toBeLessThan(1);
});

test('sync-delivered icon avatars lazy-load and repaint without reload', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openNewRole(page, `同步兜底会话${RUN}`);
  await openPicker(page);
  await page.click('.icon-cell[aria-label="狐狸"]');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');

  // 全新上下文：IDB 为空 → boot 不预载；同步送来图标角色后由渲染层兜底加载并 notify 重绘
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const p = await ctx.newPage();
    const asked: string[] = [];
    p.on('request', (r) => asked.push(r.url()));
    await login(p);
    await expect(p.locator('.role-row', { hasText: `同步兜底会话${RUN}` }).first().locator('.avatar svg')).toBeVisible({ timeout: 20000 });
    expect(asked.some((u) => /\/role-icons-[^/]+\.js/.test(u))).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('icon picker: chunk failure shows error + retry recovers', async ({ browser }) => {
  // 关掉 SW，保证 route 拦截真的作用到模块请求（SW 接管的请求不被 page.route 拦截）
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await login(page);
    await openNewRole(page, `重试会话${RUN}`);
    await page.route(ICON_CHUNK, (r) => r.abort());
    await page.click('.avatar-preview');
    await page.waitForSelector('.icon-modal');
    await expect(page.locator('.icon-status')).toHaveText('图标加载失败，请检查网络后重试');
    await expect(page.locator('.icon-retry')).toBeVisible();
    await expect(page.locator('.icon-cell')).toHaveCount(0);
    await page.unroute(ICON_CHUNK);
    await page.click('.icon-retry');
    await page.waitForSelector('.icon-cell');
    await expect(page.locator('.icon-cell')).toHaveCount(731);
    await page.click('.icon-cell[aria-label="小猫"]');
    await expect(page.locator('.avatar-preview .avatar svg')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('emoji-only usage never downloads icon chunks; icon usage does', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const adminAsked: string[] = [];
  page.on('request', (r) => adminAsked.push(r.url()));
  await login(page);
  // 另建一个干净账号：admin 名下已被其它用例留下图标角色，会污染「零增量」断言
  await page.click('.tab[data-tab=settings]');
  await page.click('.new-user');
  await page.fill('.modal input[name=username]', 'emoji-only');
  await page.fill('.modal input[name=password]', PW);
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const p = await ctx.newPage();
    const asked: string[] = [];
    p.on('request', (r) => asked.push(r.url()));
    await p.goto('/');
    await p.fill('input[name=username]', 'emoji-only');
    await p.fill('input[name=password]', PW);
    await p.click('.submit');
    await p.waitForSelector('.role-list');
    await p.click('.pill-dots');
    await p.getByText('新角色', { exact: true }).click();
    await p.fill('.role-form input[name=name]', `纯 emoji 会话${RUN}`);
    await p.fill('.avatar-emoji', '✏️');
    await p.getByRole('button', { name: '保存' }).click();
    await p.waitForSelector('.chat textarea');
    await p.fill('.chat textarea', '只用 emoji 的记录');
    await p.click('.chat .send');
    await p.waitForSelector('.msg-text:has-text("只用 emoji 的记录")');
    await p.click('.chat .back');
    await p.click('.tab[data-tab=calendar]');
    await expect(p.locator('.day-row').first()).toBeVisible();
    await p.click('.tab[data-tab=chats]');
    await p.reload();
    await p.waitForSelector('.role-list');
    await expect(p.locator('.role-row', { hasText: `纯 emoji 会话${RUN}` }).first().locator('.avatar')).toHaveText('✏️');
    const iconReqs = asked.filter((u) => ICON_CHUNK.test(u));
    expect(iconReqs, `纯 emoji 不应请求图标 chunk：${iconReqs.join(', ')}`).toEqual([]);
    expect(asked.some((u) => /\/index-[^/]+\.js/.test(u)), '应真的加载了主包').toBe(true);
  } finally {
    await ctx.close();
  }

  // 反向对照：选了图标之后刷新，boot 必须真的去取图标 chunk（证明上面的断言不是空转）
  await page.click('.tab[data-tab=chats]');
  await openNewRole(page, `对照图标会话${RUN}`);
  await openPicker(page);
  await page.click('.icon-cell[aria-label="企鹅"]');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');
  const mark = adminAsked.length;
  await page.reload();
  await page.waitForSelector('.chat textarea');
  expect(adminAsked.slice(mark).some((u) => /\/role-icons-[^/]+\.js/.test(u))).toBe(true);
});