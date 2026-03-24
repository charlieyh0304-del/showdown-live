import { test, expect } from '@playwright/test';
import { navigateToSpectator, waitForLoading } from './helpers';

test.describe('Spectator View', () => {
  test('spectator home shows tournament list heading', async ({ page }) => {
    await navigateToSpectator(page);
    await expect(page.locator('text=대회 목록').first()).toBeVisible();
  });

  test('spectator home has filter tabs for in-progress and completed', async ({ page }) => {
    await navigateToSpectator(page);

    const inProgressTab = page.locator('button[role="tab"]', { hasText: '진행중' });
    const completedTab = page.locator('button[role="tab"]', { hasText: '완료' });

    await expect(inProgressTab).toBeVisible();
    await expect(completedTab).toBeVisible();
    await expect(inProgressTab).toHaveAttribute('aria-selected', 'true');
  });

  test('switching filter tabs works', async ({ page }) => {
    await navigateToSpectator(page);

    const completedTab = page.locator('button[role="tab"]', { hasText: '완료' });
    await completedTab.click();
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');

    const tabPanel = page.locator('[role="tabpanel"]');
    await expect(tabPanel).toBeVisible();

    const inProgressTab = page.locator('button[role="tab"]', { hasText: '진행중' });
    await inProgressTab.click();
    await expect(inProgressTab).toHaveAttribute('aria-selected', 'true');
  });

  test('tournament list shows tournaments or empty state', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    // Tournament items are in a list, or empty state text
    const tournamentItem = page.locator('[role="tabpanel"] li button').first();
    const emptyInProgress = page.locator('text=진행 중인 대회가 없습니다');

    // Check either tournament exists or empty state
    const hasTournament = await tournamentItem.isVisible().catch(() => false);
    const hasEmpty = await emptyInProgress.isVisible().catch(() => false);
    expect(hasTournament || hasEmpty).toBeTruthy();
  });

  test('clicking a tournament navigates to tournament view', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    // Find tournament buttons in the tab panel list
    const tournamentButton = page.locator('[role="tabpanel"] li button').first();

    if (await tournamentButton.isVisible()) {
      await tournamentButton.click();
      await waitForLoading(page);
      await expect(page).toHaveURL(/\/spectator\/tournament\/.+/);
    }
  });

  test('tournament view shows tabs when tournament exists', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible())) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const liveTab = page.locator('button', { hasText: '실시간' });
    const rankingTab = page.locator('button', { hasText: '순위' });

    await expect(liveTab).toBeVisible({ timeout: 10000 });
    await expect(rankingTab).toBeVisible();
  });

  test('tournament view ranking tab shows ranking content', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible())) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const rankingTab = page.locator('button', { hasText: '순위' });
    if (!(await rankingTab.isVisible())) {
      test.skip();
      return;
    }

    await rankingTab.click();
    await waitForLoading(page);

    // Should show ranking table
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10000 });
  });

  test('spectator page is accessible (has proper aria labels)', async ({ page }) => {
    await navigateToSpectator(page);

    const tabList = page.locator('[role="tablist"][aria-label="대회 필터"]');
    await expect(tabList).toBeVisible();

    const tabPanel = page.locator('[role="tabpanel"]');
    await expect(tabPanel).toBeVisible();
  });
});
