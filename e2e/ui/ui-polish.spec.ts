import { test, expect, type Page } from '@playwright/test';

const USER = 'admin';
const PW = 'pw123456';
// 角色名带运行后缀：同一台 dev server 上重跑不会和上一轮的同名角色撞车
const RUN = Date.now().toString(36);
const MOBILE = { width: 375, height: 812 };

async function login(page: Page, username = USER) {
  await page.goto('/');
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', PW);
  await page.click('.submit');
  await page.waitForSelector('.role-list');
}

// 走 header 的 ＋ 建角色并发一条消息，回到会话列表（日历/搜索用例的公共种子）
async function seed(page: Page, name: string, text: string) {
  await page.click('.page-head .new-role');
  await page.waitForSelector('.role-form');
  await page.fill('.role-form input[name=name]', name);
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');
  await page.fill('.chat textarea', text);
  await page.click('.chat .send');
  await page.waitForSelector(`.msg-text:has-text("${text}")`);
  await page.click('.chat .back');
  await page.waitForSelector('.role-list');
}

const box = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, hitW: el.offsetWidth, hitH: el.offsetHeight };
  });

// 一次 evaluate 里量完整组盒子：分多次量会撞上断点重挂，读到已卸载的旧节点（rect 全 0）
const colBoxes = (page: Page) =>
  page.evaluate(() => {
    const r = (s: string) => {
      const el = document.querySelector(s);
      if (!el) return { x: 0, w: 0, mid: 0 };
      const b = el.getBoundingClientRect();
      return { x: b.x, w: b.width, mid: b.x + b.width / 2 };
    };
    return { col: r('.msg-col'), row: r('.composer-row'), head: r('.chat-head'), sep: r('.time-sep'), list: r('.msg-list') };
  });

// 跨过 1024px 断点会整块重挂 chat：给旧实例打探针，等新实例真的挂上且有布局再继续
async function switchViewport(page: Page, size: { width: number; height: number }) {
  await page.evaluate(() => {
    const el = document.querySelector('.chat') as HTMLElement | null;
    if (el) el.dataset.probe = 'stale';
  });
  await page.setViewportSize(size);
  await page.waitForFunction(() => {
    const el = document.querySelector('.chat') as HTMLElement | null;
    return !!el && el.dataset.probe !== 'stale' && el.getBoundingClientRect().width > 0 && !!document.querySelector('.msg-col');
  });
}

test('mobile: chats header ＋ is visible, >=44px and opens the 新角色 modal', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page);
  const plus = page.locator('.page-head .new-role');
  await expect(plus).toBeVisible();
  await expect(plus).toHaveAttribute('aria-label', '新角色');
  const size = await box(page, '.page-head .new-role');
  expect(size.hitW, `＋ width ${size.hitW}`).toBeGreaterThanOrEqual(44);
  expect(size.hitH, `＋ height ${size.hitH}`).toBeGreaterThanOrEqual(44);
  // 搜索与 ⋯ 仍是各自独立的按钮，且都够 44px
  for (const sel of ['.page-head .search-pill', '.page-head .pill-dots']) {
    const b = await box(page, sel);
    expect(b.hitW, `${sel} width`).toBeGreaterThanOrEqual(44);
    expect(b.hitH, `${sel} height`).toBeGreaterThanOrEqual(44);
  }
  await plus.click();
  await expect(page.locator('.role-form')).toBeVisible();
  await expect(page.locator('.modal-head h3')).toHaveText('新角色');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  // 搜索按钮保留原行为
  await page.click('.page-head .search-pill');
  await expect(page.locator('.search-input')).toBeVisible();
});

test('desktop 1280x800: message column and composer share one <=820px centered column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await seed(page, `列宽会话${RUN}`, '桌面列宽检查');
  await page.locator('.role-row', { hasText: `列宽会话${RUN}` }).first().click();
  await page.waitForSelector('.msg-text:has-text("桌面列宽检查")');

  const { col, row, head, sep } = await colBoxes(page);
  expect(col.w, `msg-col width ${col.w}`).toBeLessThanOrEqual(820);
  expect(row.w, `composer-row width ${row.w}`).toBeLessThanOrEqual(820);
  expect(Math.abs(col.w - row.w), 'same column width').toBeLessThanOrEqual(2);
  expect(Math.abs(col.mid - row.mid), `center diff ${col.mid} vs ${row.mid}`).toBeLessThanOrEqual(2);
  // time-sep 在列内居中；chat-head 仍全宽
  expect(Math.abs(sep.mid - col.mid)).toBeLessThanOrEqual(2);
  expect(sep.x).toBeGreaterThanOrEqual(col.x - 1);
  expect(head.w).toBeGreaterThan(col.w);
  // 移动视口下不收窄：消息列铺满可用宽度（375 - 左右各 16 padding）
  await switchViewport(page, MOBILE);
  const mob = await colBoxes(page);
  expect(mob.col.w).toBeLessThanOrEqual(MOBILE.width);
  expect(Math.abs(mob.col.w - (mob.list.w - 32))).toBeLessThanOrEqual(2);
});

test('search 薄荷: mark highlight, role color dot and 1 条结果 count', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.setViewportSize(MOBILE);
  await login(page);
  // 独立账号：保证「薄荷」在全库里只有一条命中，计数断言才是真的 1
  const account = `polish-${RUN}`;
  await page.click('.tab[data-tab=settings]');
  await page.click('.new-user');
  await page.fill('.modal input[name=username]', account);
  await page.fill('.modal input[name=password]', PW);
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0);

  const ctx = await browser.newContext({ viewport: MOBILE });
  try {
    const p = await ctx.newPage();
    await login(p, account);
    await p.click('.page-head .new-role');
    await p.waitForSelector('.role-form');
    await p.fill('.role-form input[name=name]', `薄荷会话${RUN}`);
    await p.click('.swatch[aria-label="#f87c7c"]');
    await p.getByRole('button', { name: '保存' }).click();
    await p.waitForSelector('.chat textarea');
    await p.fill('.chat textarea', '把阳台那盆薄荷换个更大一点的盆');
    await p.click('.chat .send');
    await p.waitForSelector('.msg-text:has-text("薄荷")');
    await p.click('.chat .back');
    // 等服务端真的收到这条 op，线上搜索才查得到
    await expect(p.locator('.sync-dot')).toBeHidden({ timeout: 20000 });
    await p.click('.page-head .search-pill');
    await p.waitForSelector('.search-input');
    await p.fill('.search-input', '薄荷');
    const row = p.locator('.search-row').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(p.locator('.search-count')).toHaveText('1 条结果');
    await expect(row.locator('mark')).toHaveCount(1);
    await expect(row.locator('mark').first()).toHaveText('薄荷');
    // 行首角色色点用的是角色色
    await expect(row.locator('.search-dot')).toBeVisible();
    await expect(row.locator('.search-dot')).toHaveCSS('background-color', 'rgb(248, 124, 124)');
    // 0 条时保留原空态，不显示计数
    await p.fill('.search-input', '查无此词zzz');
    await expect(p.locator('.search-results .empty')).toHaveText('没有找到相关记录', { timeout: 15000 });
    await expect(p.locator('.search-count')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('month view: empty days are borderless/transparent, recorded days show dots + N 条', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page);
  await seed(page, `月格会话${RUN}`, '月格计数检查');
  await page.click('.tab[data-tab=calendar]');
  await page.click('.mode-seg button[data-mode=month]');
  await page.waitForSelector('.month-grid');

  const today = page.locator('.month-cell.today');
  await expect(today).toHaveClass(/has-records/);
  await expect(today.locator('.cell-count')).toHaveText(/^\d+ 条$/);
  const dots = today.locator('.cell-dots i');
  const dotCount = await dots.count();
  expect(dotCount).toBeGreaterThanOrEqual(1);
  expect(dotCount).toBeLessThanOrEqual(3);
  const dot = await box(page, '.month-cell.today .cell-dots i');
  expect(dot.hitW).toBe(6);
  expect(dot.hitH).toBe(6);
  await expect(today.locator('.cell-preview')).toHaveCount(0);
  // today 的橙色圆保留
  await expect(today.locator('.cell-num')).toHaveCSS('background-color', 'rgb(224, 164, 92)');

  const emptyCell = page.locator('.month-cell:not(.has-records):not(.empty-cell)').first();
  await expect(emptyCell).toBeVisible();
  const emptyStyle = await emptyCell.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, bg: cs.backgroundColor, text: (el.textContent ?? '').trim() };
  });
  expect(emptyStyle.border).toBe('0px');
  expect(emptyStyle.bg).toBe('rgba(0, 0, 0, 0)');
  expect(emptyStyle.text).toMatch(/^\d+$/);
  const emptyBox = await box(page, '.month-cell:not(.has-records):not(.empty-cell)');
  expect(emptyBox.hitH, `cell height ${emptyBox.hitH}`).toBeGreaterThanOrEqual(64);
  expect(emptyBox.hitW).toBeGreaterThanOrEqual(44);

  // 点击行为不变：点有记录日回到日视图并列出当天记录
  await today.click();
  await expect(page.locator('.mode-seg button[data-mode=day]')).toHaveClass(/on/);
  await expect(page.locator('.day-row', { hasText: '月格计数检查' })).toBeVisible();
});

test('calendar day row: role name resolves to --text, preview to --muted', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page);
  await seed(page, `日行会话${RUN}`, '日行层级检查');
  await page.click('.tab[data-tab=calendar]');
  const row = page.locator('.day-row', { hasText: '日行层级检查' }).first();
  await expect(row).toBeVisible();
  const got = await row.evaluate((el) => {
    // 把 CSS 变量解析成 computed rgb：借一个临时探针元素，不写死主题色值
    const resolve = (v: string) => {
      const probe = document.createElement('span');
      probe.style.color = v.trim();
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    const cs = getComputedStyle(document.documentElement);
    const name = el.querySelector('.day-role') as HTMLElement;
    const preview = el.querySelector('.day-preview') as HTMLElement;
    const ns = getComputedStyle(name);
    const ps = getComputedStyle(preview);
    return {
      name: ns.color,
      preview: ps.color,
      text: resolve(cs.getPropertyValue('--text')),
      muted: resolve(cs.getPropertyValue('--muted')),
      nameSize: parseFloat(ns.fontSize),
      nameWeight: Number(ns.fontWeight),
      previewSize: parseFloat(ps.fontSize),
    };
  });
  expect(got.name).toBe(got.text);
  expect(got.preview).toBe(got.muted);
  expect(got.nameWeight).toBeGreaterThanOrEqual(600);
  expect(got.nameSize).toBeGreaterThanOrEqual(got.previewSize);
  // avatar small 与时间不变
  await expect(row.locator('.avatar.small')).toBeVisible();
  await expect(row.locator('.role-time')).toHaveText(/^\d{2}:\d{2}$/);
});

test('chat title: >=18px / >=600 with an 8px role-color dot', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page);
  await page.click('.page-head .new-role');
  await page.waitForSelector('.role-form');
  await page.fill('.role-form input[name=name]', `标题会话${RUN}`);
  await page.click('.swatch[aria-label="#7cb4f8"]');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');
  const title = page.locator('.chat-title');
  await expect(title).toHaveText(`标题会话${RUN}`);
  const style = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.chat-title') as HTMLElement);
    return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), family: cs.fontFamily, align: cs.justifyContent };
  });
  expect(style.size, `chat-title fontSize ${style.size}`).toBeGreaterThanOrEqual(18);
  expect(style.weight, `chat-title fontWeight ${style.weight}`).toBeGreaterThanOrEqual(600);
  expect(style.family).not.toContain('Songti');
  expect(style.align).toBe('center');
  const dot = page.locator('.chat-title .title-dot');
  await expect(dot).toBeVisible();
  await expect(dot).toHaveCSS('background-color', 'rgb(124, 180, 248)');
  const dotBox = await box(page, '.chat-title .title-dot');
  expect(dotBox.hitW).toBe(8);
  expect(dotBox.hitH).toBe(8);
  // 桌面左对齐，字号不变
  await switchViewport(page, { width: 1280, height: 800 });
  const desk = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.chat-title') as HTMLElement);
    return { align: cs.justifyContent, size: parseFloat(cs.fontSize) };
  });
  expect(desk.align).toBe('flex-start');
  expect(desk.size).toBeGreaterThanOrEqual(18);
});