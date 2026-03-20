import { test, expect } from '@playwright/test';
import { waitForLoading } from './helpers';

test.describe('Navigation - All main routes load without errors', () => {
  test('home page (mode selector) loads and shows all three mode buttons', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await waitForLoading(page);

    // Verify mode selector heading
    await expect(page.locator('text=쇼다운')).toBeVisible();

    // Verify all three mode buttons exist
    await expect(page.locator('button', { hasText: '관리자' })).toBeVisible();
    await expect(page.locator('button', { hasText: '심판' })).toBeVisible();
    await expect(page.locator('button', { hasText: '관람' })).toBeVisible();

    // Filter out known non-critical errors (e.g. Firebase connection issues in test env)
    const criticalErrors = errors.filter(
      (e) => !e.includes('Firebase') && !e.includes('firestore') && !e.includes('network'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('admin page loads without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/admin');
    await waitForLoading(page);

    // Should show either the dashboard heading or a loading/empty state
    const heading = page.locator('text=대시보드');
    const loading = page.locator('text=대회 목록 로딩 중');
    await expect(heading.or(loading)).toBeVisible({ timeout: 10000 });

    const criticalErrors = errors.filter(
      (e) => !e.includes('Firebase') && !e.includes('firestore') && !e.includes('network'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('referee page loads without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/referee');
    await waitForLoading(page);

    // Referee login page should show "심판 모드" heading
    await expect(page.locator('text=심판 모드')).toBeVisible({ timeout: 10000 });

    const criticalErrors = errors.filter(
      (e) => !e.includes('Firebase') && !e.includes('firestore') && !e.includes('network'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('spectator page loads without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/spectator');
    await waitForLoading(page);

    // Spectator home should show "대회 목록" heading
    await expect(page.locator('text=대회 목록')).toBeVisible({ timeout: 10000 });

    const criticalErrors = errors.filter(
      (e) => !e.includes('Firebase') && !e.includes('firestore') && !e.includes('network'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('clicking mode buttons navigates correctly', async ({ page }) => {
    await page.goto('/');
    await waitForLoading(page);

    // Click admin button and verify navigation
    await page.locator('button', { hasText: '관리자' }).click();
    await waitForLoading(page);
    await expect(page).toHaveURL(/\/admin/);

    // Go back to home
    await page.goto('/');
    await waitForLoading(page);

    // Click referee button and verify navigation
    await page.locator('button', { hasText: '심판' }).click();
    await waitForLoading(page);
    await expect(page).toHaveURL(/\/referee/);

    // Go back to home
    await page.goto('/');
    await waitForLoading(page);

    // Click spectator button and verify navigation
    await page.locator('button', { hasText: '관람' }).click();
    await waitForLoading(page);
    await expect(page).toHaveURL(/\/spectator/);
  });

  test('unknown routes redirect to home', async ({ page }) => {
    await page.goto('/nonexistent-page');
    await waitForLoading(page);

    // Should redirect to home and show mode selector
    await expect(page.locator('text=쇼다운')).toBeVisible({ timeout: 10000 });
  });
});
