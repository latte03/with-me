import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8093';
const OUT = process.env.OUT || 'E:/dev/tmp/ui-shots';
fs.mkdirSync(OUT, { recursive: true });
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

async function req(method, path, body, token) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const dev = uuid();
const boot = await req('POST', '/auth/bootstrap', { username: 'ui', password: 'pw123456', device_id: dev, device_name: 'shots' });
const token = boot.token;
const roles = [
  { id: uuid(), name: '随手记', avatar: '✏️', color: '#7c7cf8' },
  { id: uuid(), name: '灵感', avatar: '💡', color: '#f8b47c' },
  { id: uuid(), name: '情绪', avatar: '🫧', color: '#7cf8e0' },
];
let seq = 0;
const ops = [];
const op = (type, payload) => ops.push({ op_id: uuid(), device_id: dev, seq: ++seq, type, payload, client_created_at: now() });
for (const r of roles) op('role.create', { ...r, pinned: r.name === '随手记', hidden: false, created_at: now(), updated_at: now() });
const texts = [
  [roles[0], 'text', '把阳台那盆薄荷换个大一点的盆'],
  [roles[0], 'todo', '周五前把 NAS 备份脚本跑一遍'],
  [roles[0], 'text', '今天地铁上想到：记录应该像发消息一样轻'],
  [roles[1], 'text', '做一个只有我自己能看见的聊天框'],
  [roles[1], 'text', '月历格子能不能像纸一样，当天盖一枚小章'],
  [roles[2], 'text', '有点累，但把想法写下来就松了一点'],
];
for (const [r, type, text] of texts) op('message.create', { id: uuid(), role_id: r.id, type, text, attachment_ref: '', side: 'right', todo_done: false, created_at: now(), updated_at: now() });
await req('POST', '/sync/push', { ops: ops.splice(0) }, token);

const seed = fs.readFileSync(new URL('../微信图片_20261107180300_10_770.jpg', import.meta.url));
const seedHash = createHash('sha256').update(seed).digest('hex');
const fd = new FormData();
fd.append('file', new Blob([seed], { type: 'image/jpeg' }), 'seed.jpg');
fd.append('hash', seedHash);
const up = await fetch(BASE + '/api/blobs', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
if (!up.ok) throw new Error(`seed blob upload failed ${up.status}`);
op('message.create', { id: uuid(), role_id: roles[0].id, type: 'image', text: '', attachment_ref: seedHash, side: 'right', todo_done: false, created_at: now(), updated_at: now() });
await req('POST', '/sync/push', { ops: ops.splice(0) }, token);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const [w, h, tag, theme] of [[390, 844, 'mob', 'dark'], [1440, 900, 'desk', 'dark'], [390, 844, 'mob-light', 'light'], [1440, 900, 'desk-light', 'light'], [375, 667, 'small', 'dark'], [844, 390, 'land', 'dark']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([s, t]) => {
    localStorage.setItem('with-me.session', s);
    localStorage.setItem('with-me.theme', t);
  }, [JSON.stringify({ token, user: boot.user, device_id: dev }), theme]);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.role-list');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-chats.png` });
  await page.locator('.role-row').first().click();
  await page.waitForSelector('.chat textarea');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-chat.png` });
  await page.waitForSelector('.img-msg');
  await page.locator('.img-msg').first().click();
  await page.waitForSelector('.img-overlay');
  await page.waitForTimeout(300);
  await page.locator('.img-overlay .fab').click();
  await page.waitForSelector('.gal-grid');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-gallery.png` });
  await page.click('.tab[data-tab=calendar]');
  await page.click('.mode-seg button[data-mode=month]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-calendar.png` });
  await page.click('.tab[data-tab=settings]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-settings.png` });
  await ctx.close();
}
await browser.close();
console.log('SHOTS_OK', OUT);