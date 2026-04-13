import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateToSpectator } from './helpers';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Spectator View', () => {
  test('spectator home shows tournament list heading', async ({ page }) => {
    await navigateToSpectator(page);
    await expect(page.locator('text=대회 목록').first()).toBeVisible();

    // a11y scan on spectator home (primary blind-user landing)
    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
    // TODO(a11y): triage spectator home violations
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
    const tournamentItem = page.locator('li button[aria-label]').first();
    const emptyInProgress = page.locator('text=진행 중인 대회가 없습니다');

    // Check either tournament exists or empty state
    const hasTournament = await tournamentItem.isVisible().catch(() => false);
    const hasEmpty = await emptyInProgress.isVisible().catch(() => false);
    expect(hasTournament || hasEmpty).toBeTruthy();
  });

  test('clicking a tournament navigates to tournament view', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('li button[aria-label]').first();

    if (await tournamentButton.isVisible()) {
      await tournamentButton.click();
      await page.locator('[role="tablist"]').last().waitFor({ timeout: 15000 }).catch(() => {});
      await expect(page).toHaveURL(/\/spectator\/tournament\/.+/);
    }
  });

  test('tournament view shows tabs when tournament exists', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('li button[aria-label]').first();
    if (!(await tournamentButton.isVisible())) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await page.locator('[role="tablist"]').last().waitFor({ timeout: 15000 }).catch(() => {});

    // Tabs are in the bottom navigation tablist
    const tablist = page.locator('[role="tablist"]').last();
    await expect(tablist).toBeVisible({ timeout: 10000 });

    const tabs = tablist.locator('[role="tab"]');
    expect(await tabs.count()).toBeGreaterThanOrEqual(5);
  });

  test('tournament view ranking tab shows ranking content', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('li button[aria-label]').first();
    if (!(await tournamentButton.isVisible())) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await page.locator('[role="tablist"]').last().waitFor({ timeout: 15000 }).catch(() => {});

    const rankingTab = page.locator('[role="tab"]').filter({ hasText: '순위' });
    if (!(await rankingTab.isVisible())) {
      test.skip();
      return;
    }

    await rankingTab.click();
    await page.waitForTimeout(2000);

    // Should show ranking table
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10000 });

    // a11y scan on ranking table (table semantics critical for SR)
    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
    // TODO(a11y): triage ranking table violations
  });

  test('spectator page is accessible (has proper aria labels)', async ({ page }) => {
    await navigateToSpectator(page);

    const tabList = page.locator('[role="tablist"]').first();
    await expect(tabList).toBeVisible();

    const tabPanel = page.locator('[role="tabpanel"]');
    await expect(tabPanel).toBeVisible();
  });
});
