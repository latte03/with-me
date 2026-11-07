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

test('images: bare thumbnails, wechat sizing, viewer gestures, gallery', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);
  await page.click('.pill-dots');
  await page.getByText('新角色', { exact: true }).click();
  await page.fill('.role-form input[name=name]', '图片会话');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('.chat textarea');

  const pushed = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('with-me.session') as string);
    const token = session.token as string;
    const deviceId = session.device_id as string;
    const roleId = decodeURIComponent(location.hash.split('/')[2]);
    const specs = [
      { w: 400, h: 400, c: '#e0a45c' },
      { w: 600, h: 200, c: '#7c7cf8' },
      { w: 800, h: 200, c: '#7cf8e0' },
      { w: 200, h: 800, c: '#f87c7c' },
    ];
    const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const images: { hash: string; w: number; h: number }[] = [];
    for (const s of specs) {
      const canvas = document.createElement('canvas');
      canvas.width = s.w;
      canvas.height = s.h;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = s.c;
      ctx.fillRect(0, 0, s.w, s.h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, s.w / 2, s.h / 2);
      const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
      const hash = hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
      const fd = new FormData();
      fd.append('file', blob, `${s.w}x${s.h}.png`);
      fd.append('hash', hash);
      const up = await fetch('/api/blobs', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      if (!up.ok) throw new Error(`blob upload failed ${up.status} ${await up.text()}`);
      images.push({ hash, w: s.w, h: s.h });
    }
    const base = Date.now() - 4000;
    const ops = images.map((im, k) => {
      const t = new Date(base + k * 1000).toISOString();
      return {
        op_id: crypto.randomUUID(),
        device_id: deviceId,
        seq: k + 1,
        type: 'message.create',
        client_created_at: t,
        payload: {
          id: crypto.randomUUID(),
          role_id: roleId,
          type: 'image',
          text: '',
          attachment_ref: im.hash,
          side: 'right',
          todo_done: false,
          created_at: t,
          updated_at: t,
          width: im.w,
          height: im.h,
        },
      };
    });
    const push = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
    });
    if (!push.ok) throw new Error(`push failed ${push.status} ${await push.text()}`);
    return { roleId, count: images.length };
  });
  expect(pushed.count).toBe(4);

  await page.reload();
  await page.waitForSelector('.chat textarea');
  await expect(page.locator('.msg-img')).toHaveCount(4, { timeout: 20000 });
  await expect(page.locator('.bubble .msg-img')).toHaveCount(0);

  const ratios = await page.locator('.msg-img').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetWidth / (e as HTMLElement).offsetHeight));
  const expected = [1, 3, 3, 1 / 3];
  for (let k = 0; k < 4; k++) expect(Math.abs(ratios[k] - expected[k]), `ratio ${k} = ${ratios[k]}`).toBeLessThan(0.05);

  await page.locator('.img-msg').first().click();
  await expect(page.locator('.img-overlay')).toBeVisible();
  await expect(page.locator('.img-count')).toHaveText('1 / 4');
  await expect(page.locator('.img-slide img[data-slot=cur]')).toHaveAttribute('src', /.+/);
  await expect(page.locator('.img-slide img[data-slot=next]')).toHaveAttribute('src', /.+/);

  const vp = page.viewportSize() as { width: number; height: number };
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy, { steps: 12 });
  const trackX = await page.locator('.img-track').evaluate((node) => {
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(node).transform);
    return m ? Number(m[1].split(',')[4]) : Number.NaN;
  });
  expect(Number.isFinite(trackX)).toBe(true);
  expect(Math.abs(Math.round(trackX + vp.width))).toBeGreaterThan(60);
  await expect(page.locator('.img-slide img[data-slot=cur]')).toBeVisible();
  await expect(page.locator('.img-slide img[data-slot=next]')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.img-count')).toHaveText('2 / 4');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.img-count')).toHaveText('3 / 4');

  await page.keyboard.press('Escape');
  await expect(page.locator('.img-overlay')).toHaveCount(0);
  await expect(page.locator('.fab')).toHaveCount(0);

  await page.locator('.img-msg').first().click();
  await expect(page.locator('.img-overlay')).toBeVisible();
  await page.locator('.img-overlay .fab').click();
  await page.waitForSelector('.gal-grid');
  await expect(page.locator('.gal-cell')).toHaveCount(4);

  await page.locator('.gal-cell').first().click();
  await expect(page.locator('.img-overlay')).toBeVisible();
  await expect(page.locator('.img-overlay .fab')).toHaveCount(0);
  await page.locator('.img-x').click();
  await expect(page.locator('.img-overlay')).toHaveCount(0);

  await page.locator('.gallery .back').click();
  await page.waitForSelector('.chat');
  await expect(page.locator('.chat')).toBeVisible();
});