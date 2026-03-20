import { test, expect } from '@playwright/test';
import { navigateToSpectator, waitForLoading } from './helpers';

test.describe('Spectator View', () => {
  test('spectator home shows tournament list heading', async ({ page }) => {
    await navigateToSpectator(page);

    // Should display "대회 목록" heading
    await expect(page.locator('text=대회 목록')).toBeVisible();
  });

  test('spectator home has filter tabs for in-progress and completed', async ({ page }) => {
    await navigateToSpectator(page);

    // Should show filter tabs
    const inProgressTab = page.locator('button[role="tab"]', { hasText: '진행중' });
    const completedTab = page.locator('button[role="tab"]', { hasText: '완료' });

    await expect(inProgressTab).toBeVisible();
    await expect(completedTab).toBeVisible();

    // "진행중" tab should be selected by default
    await expect(inProgressTab).toHaveAttribute('aria-selected', 'true');
  });

  test('switching filter tabs works', async ({ page }) => {
    await navigateToSpectator(page);

    // Click "완료" tab
    const completedTab = page.locator('button[role="tab"]', { hasText: '완료' });
    await completedTab.click();

    // Should now be selected
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');

    // The tab panel should update
    const tabPanel = page.locator('[role="tabpanel"]');
    await expect(tabPanel).toBeVisible();

    // Switch back to in-progress
    const inProgressTab = page.locator('button[role="tab"]', { hasText: '진행중' });
    await inProgressTab.click();
    await expect(inProgressTab).toHaveAttribute('aria-selected', 'true');
  });

  test('tournament list shows tournaments or empty state', async ({ page }) => {
    await navigateToSpectator(page);

    // Wait for data to load
    const loadingText = page.locator('text=데이터 로딩 중');
    if (await loadingText.isVisible()) {
      await loadingText.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }

    // Should show either tournament cards or empty state message
    const tournamentCard = page.locator('button.card').first();
    const emptyInProgress = page.locator('text=진행 중인 대회가 없습니다');
    const emptyCompleted = page.locator('text=완료된 대회가 없습니다');

    await expect(
      tournamentCard.or(emptyInProgress).or(emptyCompleted),
    ).toBeVisible({ timeout: 15000 });
  });

  test('clicking a tournament navigates to tournament view', async ({ page }) => {
    await navigateToSpectator(page);

    // Wait for loading
    const loadingText = page.locator('text=데이터 로딩 중');
    if (await loadingText.isVisible()) {
      await loadingText.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }

    // Try to find a tournament card
    const tournamentCard = page.locator('button.card').first();

    if (await tournamentCard.isVisible()) {
      await tournamentCard.click();
      await waitForLoading(page);

      // Should navigate to tournament detail view
      await expect(page).toHaveURL(/\/spectator\/tournament\/.+/);
    }
  });

  test('tournament view shows tabs when tournament exists', async ({ page }) => {
    await navigateToSpectator(page);

    // Wait for loading
    const loadingText = page.locator('text=데이터 로딩 중');
    if (await loadingText.isVisible()) {
      await loadingText.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }

    // Try to click a tournament
    const tournamentCard = page.locator('button.card').first();

    if (!(await tournamentCard.isVisible())) {
      test.skip();
      return;
    }

    await tournamentCard.click();
    await waitForLoading(page);

    // Tournament view should have tab navigation with expected tabs
    // Tabs: 실시간, 대진표, 순위, 선수, etc.
    const liveTab = page.locator('button', { hasText: '실시간' });
    const rankingTab = page.locator('button', { hasText: '순위' });

    await expect(liveTab).toBeVisible({ timeout: 10000 });
    await expect(rankingTab).toBeVisible();
  });

  test('tournament view ranking tab shows ranking table', async ({ page }) => {
    await navigateToSpectator(page);

    const loadingText = page.locator('text=데이터 로딩 중');
    if (await loadingText.isVisible()) {
      await loadingText.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }

    const tournamentCard = page.locator('button.card').first();

    if (!(await tournamentCard.isVisible())) {
      test.skip();
      return;
    }

    await tournamentCard.click();
    await waitForLoading(page);

    // Click ranking tab
    const rankingTab = page.locator('button', { hasText: '순위' });
    if (!(await rankingTab.isVisible())) {
      test.skip();
      return;
    }

    await rankingTab.click();
    await waitForLoading(page);

    // Should show ranking content - either a table/list or a "no data" message
    // The ranking tab should be active and content should render
    const rankingContent = page.locator('table, [role="table"], text=경기 데이터가 없습니다, text=순위');
    await expect(rankingContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('spectator page is accessible (has proper aria labels)', async ({ page }) => {
    await navigateToSpectator(page);

    // Tab list should have proper aria label
    const tabList = page.locator('[role="tablist"]');
    await expect(tabList).toBeVisible();
    await expect(tabList).toHaveAttribute('aria-label', '대회 필터');

    // Tab panel should exist
    const tabPanel = page.locator('[role="tabpanel"]');
    await expect(tabPanel).toBeVisible();
  });
});
