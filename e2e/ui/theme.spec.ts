import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[name=username]', 'admin');
  await page.fill('input[name=password]', 'pw123456');
  await page.click('.submit');
  await page.waitForSelector('.role-list');
}

test('theme: light/dark/auto persist, follow system, update theme-color', async ({ page }) => {
  await login(page);
  await page.click('.tab[data-tab=settings]');
  const html = page.locator('html');

  await page.click('.theme-seg button[data-pref=light]');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 244, 238)');
  await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', '#f7f4ee');

  await page.reload();
  await page.waitForSelector('.role-list');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.click('.tab[data-tab=settings]');
  await expect(page.locator('.theme-seg button[data-pref=light]')).toHaveClass(/on/);

  await page.click('.theme-seg button[data-pref=auto]');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.click('.theme-seg button[data-pref=dark]');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', '#161513');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.view > *').first()).toHaveCSS('animation-name', 'none');
});