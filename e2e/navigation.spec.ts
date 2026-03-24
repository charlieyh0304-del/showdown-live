import { test, expect } from '@playwright/test';
import { navigateToAdmin, waitForLoading } from './helpers';

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

    // Verify all three mode buttons exist (by aria-label)
    await expect(page.locator('[aria-label="관리자 모드 진입"]')).toBeVisible();
    await expect(page.locator('[aria-label="심판 모드 진입"]')).toBeVisible();
    await expect(page.locator('[aria-label="관람 모드 진입"]')).toBeVisible();

    const criticalErrors = errors.filter(
      (e) => !e.includes('Firebase') && !e.includes('firestore') && !e.includes('network'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('admin page loads and shows login or dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/admin');
    await waitForLoading(page);

    // Should show either admin login or dashboard (if already authenticated)
    const loginHeading = page.locator('h1', { hasText: '관리자 로그인' });
    const pinSetupHeading = page.locator('h1', { hasText: '관리자 PIN 설정' });
    const dashboard = page.locator('text=대시보드');

    await expect(loginHeading.or(pinSetupHeading).or(dashboard)).toBeVisible({ timeout: 10000 });

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

    await expect(page.locator('h1', { hasText: '심판 모드' })).toBeVisible({ timeout: 10000 });

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

    await expect(page.locator('text=대회 목록').first()).toBeVisible({ timeout: 10000 });

    const criticalErrors = errors.filter(
      (e) => !e.includes('Firebase') && !e.includes('firestore') && !e.includes('network'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('clicking mode buttons navigates correctly', async ({ page }) => {
    await page.goto('/');
    await waitForLoading(page);

    // Click admin button and verify navigation
    await page.locator('[aria-label="관리자 모드 진입"]').click();
    await waitForLoading(page);
    await expect(page).toHaveURL(/\/admin/);

    // Go back to home
    await page.goto('/');
    await waitForLoading(page);

    // Click referee button and verify navigation
    await page.locator('[aria-label="심판 모드 진입"]').click();
    await waitForLoading(page);
    await expect(page).toHaveURL(/\/referee/);

    // Go back to home
    await page.goto('/');
    await waitForLoading(page);

    // Click spectator button and verify navigation
    await page.locator('[aria-label="관람 모드 진입"]').click();
    await waitForLoading(page);
    await expect(page).toHaveURL(/\/spectator/);
  });

  test('unknown routes redirect to home', async ({ page }) => {
    await page.goto('/nonexistent-page');
    await waitForLoading(page);

    await expect(page.locator('text=쇼다운')).toBeVisible({ timeout: 10000 });
  });
});
