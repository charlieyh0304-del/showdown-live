import { type Page } from '@playwright/test';

/** Admin PIN for E2E tests (set via ADMIN_PIN env var, default '0000') */
const ADMIN_PIN = process.env.ADMIN_PIN || '0000';

/**
 * Navigate to the admin dashboard.
 * Handles PIN login if required.
 */
export async function navigateToAdmin(page: Page) {
  await page.goto('/admin');

  // Firebase takes time - wait longer for initial load
  await page.waitForTimeout(3000);

  // Check if login is required
  const loginHeading = page.locator('h1', { hasText: '관리자 로그인' });
  const pinSetupHeading = page.locator('h1', { hasText: '관리자 PIN 설정' });
  const dashboard = page.locator('h1', { hasText: '대시보드' });

  // Wait for one of: login, pin setup, or dashboard
  await loginHeading.or(pinSetupHeading).or(dashboard).waitFor({ timeout: 15000 });

  if (await loginHeading.isVisible()) {
    // Enter PIN and login
    const pinInput = page.locator('[aria-label="관리자 PIN 입력"]');
    await pinInput.fill(ADMIN_PIN);
    await page.locator('button', { hasText: '로그인' }).click();
    // Wait for dashboard to appear after login
    await page.waitForTimeout(3000);
    await waitForLoading(page);
  }
}

/**
 * Navigate to the referee login page.
 * Waits for the referee mode heading to appear.
 */
export async function navigateToReferee(page: Page) {
  await page.goto('/referee');
  await waitForLoading(page);
  await page.waitForSelector('text=심판 모드', { timeout: 10000 });
}

/**
 * Navigate to the spectator home page.
 * Waits for the tournament list heading to appear.
 */
export async function navigateToSpectator(page: Page) {
  await page.goto('/spectator');
  await waitForLoading(page);
  await page.waitForSelector('text=대회 목록', { timeout: 10000 });
}

/**
 * Wait for all loading indicators to disappear.
 */
export async function waitForLoading(page: Page) {
  await page.waitForTimeout(500);

  // Wait for animate-pulse loading indicators to disappear
  await page.waitForFunction(
    () => {
      const pulsingElements = document.querySelectorAll('.animate-pulse');
      return pulsingElements.length === 0;
    },
    { timeout: 15000 },
  ).catch(() => {
    // Loading indicators may not appear at all if data loads quickly
  });
}

/**
 * Collect console errors that occur during a callback.
 */
export async function collectConsoleErrors(
  page: Page,
  callback: () => Promise<void>,
): Promise<string[]> {
  const errors: string[] = [];
  const handler = (msg: import('@playwright/test').ConsoleMessage) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  };
  page.on('console', handler);
  await callback();
  page.off('console', handler);
  return errors;
}
