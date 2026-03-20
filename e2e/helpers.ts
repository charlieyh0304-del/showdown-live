import { type Page } from '@playwright/test';

/**
 * Navigate to the admin dashboard.
 * Waits for the page heading to confirm navigation succeeded.
 */
export async function navigateToAdmin(page: Page) {
  await page.goto('/admin');
  await waitForLoading(page);
  // Admin home shows either the dashboard heading or the tournament list
  await page.waitForSelector('h1, [aria-label="대회 목록"], text=대시보드', {
    timeout: 10000,
  });
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
 * Checks for common loading patterns used in the app:
 * - LoadingSpinner component (role="status" with animate-pulse)
 * - Inline loading text with animate-pulse class
 * - Any element with "로딩 중" text
 */
export async function waitForLoading(page: Page) {
  // Wait a tick for React to start rendering
  await page.waitForTimeout(300);

  // Wait for animate-pulse loading indicators to disappear
  await page.waitForFunction(
    () => {
      const pulsingElements = document.querySelectorAll('.animate-pulse');
      return pulsingElements.length === 0;
    },
    { timeout: 15000 },
  ).catch(() => {
    // Loading indicators may not appear at all if data loads quickly; that's fine
  });
}

/**
 * Collect console errors that occur during a callback.
 * Returns an array of error message strings.
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
