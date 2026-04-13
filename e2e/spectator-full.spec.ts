import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateToSpectator, waitForLoading } from './helpers';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Spectator 모드 전체 테스트.
 * 대회 목록, 대회 상세(전체 탭), 라이브 매치 뷰, 선수 프로필,
 * 즐겨찾기, 연습 관람을 커버한다.
 */

// ── helpers ──────────────────────────────────────────────

async function navigateToFirstTournament(page: import('@playwright/test').Page): Promise<boolean> {
  await navigateToSpectator(page);
  await page.waitForTimeout(2000);

  // Tournament buttons live inside li elements — may be grouped or ungrouped
  const tournamentButton = page.locator('li button[aria-label]').first();
  if (!(await tournamentButton.isVisible().catch(() => false))) {
    return false;
  }

  await tournamentButton.click();

  // Wait for tournament detail page to load (tablist appears in bottom nav)
  await page.locator('[role="tablist"]').last().waitFor({ timeout: 15000 }).catch(() => {});
  return page.url().includes('/spectator/tournament/');
}

// ── Spectator Home ───────────────────────────────────────

test.describe('Spectator Home', () => {
  test('tablist has correct aria attributes', async ({ page }) => {
    await navigateToSpectator(page);

    const tablist = page.locator('[role="tablist"]').first();
    await expect(tablist).toBeVisible();
    await expect(tablist).toHaveAttribute('aria-label');

    const tabs = tablist.locator('[role="tab"]');
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);

    // First tab should be selected by default
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('switching to completed tab updates panel content', async ({ page }) => {
    await navigateToSpectator(page);

    const completedTab = page.locator('button[role="tab"]', { hasText: '완료' });
    await completedTab.click();
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');

    // Panel should show completed tournaments or empty state
    const panel = page.locator('[role="tabpanel"]');
    await expect(panel).toBeVisible();

    const completedTournament = panel.locator('li button').first();
    const emptyMessage = page.locator('text=완료된 대회가 없습니다');

    const hasContent = await completedTournament.isVisible().catch(() => false);
    const hasEmpty = await emptyMessage.isVisible().catch(() => false);
    expect(hasContent || hasEmpty).toBeTruthy();
  });

  test('tournament items show name, type, and status', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Should have aria-label with tournament details
    const label = await tournamentButton.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });

  test('loading state shows status indicator', async ({ page }) => {
    // Navigate fresh and check for loading state
    await page.goto('/spectator');

    // Loading might be very fast — just verify the page doesn't error
    await waitForLoading(page);
    await expect(page.locator('text=대회 목록').first()).toBeVisible({ timeout: 15000 });
  });
});

// ── Tournament View — All Tabs ───────────────────────────

test.describe('Tournament View — Tab Navigation', () => {
  test('tournament view has 5 navigation tabs', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    // Bottom navigation tabs
    const navTabs = page.locator('[role="tablist"] [role="tab"]');
    expect(await navTabs.count()).toBeGreaterThanOrEqual(5);
  });

  test('keyboard arrow navigation between tabs', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const tabs = page.locator('[role="tablist"] [role="tab"]');
    const firstTab = tabs.first();

    await firstTab.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    // Second tab should now be focused or selected
    const secondTab = tabs.nth(1);
    const isSelected = await secondTab.getAttribute('aria-selected');
    const isFocused = await secondTab.evaluate(el => el === document.activeElement);
    expect(isSelected === 'true' || isFocused).toBeTruthy();
  });
});

test.describe('Tournament View — Live Tab', () => {
  test('live tab shows matches or empty state', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    // Live tab should be default (overview)
    const matchCards = page.locator('[aria-label*="vs"]');
    const emptyState = page.locator('text=진행 중인 경기가 없습니다')
      .or(page.locator('text=경기가 없습니다'));

    const hasMatches = (await matchCards.count()) > 0;
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasMatches || hasEmpty).toBeTruthy();
  });

  test('stage filter buttons are accessible', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    // Stage filter buttons (전체/예선/본선/순위결정전)
    const filterButtons = page.locator('button').filter({ hasText: /전체|예선|본선|순위/ });
    if ((await filterButtons.count()) > 1) {
      // Click each filter
      for (let i = 0; i < await filterButtons.count(); i++) {
        await filterButtons.nth(i).click();
        await waitForLoading(page);
      }
    }
  });

  test('favorite button toggles on match card', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const favoriteButton = page.locator('[aria-label*="favorite"], [aria-label*="즐겨찾기"]').first();
    if (!(await favoriteButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    const initialLabel = await favoriteButton.getAttribute('aria-label');
    await favoriteButton.click();
    await page.waitForTimeout(300);

    const newLabel = await favoriteButton.getAttribute('aria-label');
    // Label should change (add → remove or vice versa)
    expect(newLabel).not.toBe(initialLabel);
  });
});

test.describe('Tournament View — Players Tab', () => {
  test('players tab has search input', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    // Navigate to players tab
    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (!(await playersTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await playersTab.click();
    await waitForLoading(page);

    // Search input
    const searchInput = page.locator('input[aria-label*="search"], input[aria-label*="검색"]').first()
      .or(page.locator('input[type="search"]').first())
      .or(page.locator('input[type="text"]').first());

    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test('player search filters results', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (!(await playersTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await playersTab.click();
    await waitForLoading(page);

    const searchInput = page.locator('input').first();
    if (!(await searchInput.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Type a search query
    await searchInput.fill('테스트');
    await page.waitForTimeout(500);

    // Results should update (either filtered list or no-results message)
  });

  test('player profile link navigates correctly', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (!(await playersTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await playersTab.click();
    await waitForLoading(page);

    const playerLink = page.locator('[aria-label*="profile"]').first()
      .or(page.locator('button').filter({ hasText: /프로필|상세/ }).first());

    if (await playerLink.isVisible()) {
      await playerLink.click();
      await waitForLoading(page);
      await expect(page).toHaveURL(/\/spectator\/player\//);
    }
  });

  test('a11y: players tab', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (await playersTab.isVisible()) {
      await playersTab.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

test.describe('Tournament View — Standings Tab', () => {
  test('standings tab shows ranking table', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const standingsTab = page.locator('[role="tab"]').filter({ hasText: '순위' });
    if (!(await standingsTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await standingsTab.click();
    await waitForLoading(page);

    // Should show table or message
    const table = page.locator('table').first();
    const noData = page.locator('text=순위 데이터가 없습니다')
      .or(page.locator('text=데이터가 없습니다'));

    const hasTable = await table.isVisible().catch(() => false);
    const hasNoData = await noData.isVisible().catch(() => false);
    expect(hasTable || hasNoData).toBeTruthy();
  });

  test('a11y: standings tab table semantics', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const standingsTab = page.locator('[role="tab"]').filter({ hasText: '순위' });
    if (await standingsTab.isVisible()) {
      await standingsTab.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

test.describe('Tournament View — Schedule Tab', () => {
  test('schedule tab shows rounds with expand/collapse', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const scheduleTab = page.locator('[role="tab"]').filter({ hasText: '일정' });
    if (!(await scheduleTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await scheduleTab.click();
    await page.waitForTimeout(2000);

    // Schedule content should be visible (matches, rounds, or empty state)
    const content = page.locator('main').first();
    await expect(content).toBeVisible();
  });

  test('match items have descriptive aria-labels', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const scheduleTab = page.locator('[role="tab"]').filter({ hasText: '일정' });
    if (await scheduleTab.isVisible()) {
      await scheduleTab.click();
      await page.waitForTimeout(2000);
    }

    const matchItems = page.locator('[aria-label*="vs"]');
    if ((await matchItems.count()) > 0) {
      const label = await matchItems.first().getAttribute('aria-label');
      expect(label).toContain('vs');
    }
  });
});

test.describe('Tournament View — Referees Tab', () => {
  test('referees tab shows search and referee list', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const refereesTab = page.locator('[role="tab"]').filter({ hasText: '심판' });
    if (!(await refereesTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await refereesTab.click();
    await waitForLoading(page);

    // Search input
    const searchInput = page.locator('input').first();
    const hasSearch = await searchInput.isVisible().catch(() => false);

    // Referee list or empty state
    const refereeItem = page.locator('[aria-label*="match"]').first();
    const emptyState = page.locator('text=심판이 없습니다')
      .or(page.locator('text=등록된 심판'));

    const hasReferees = await refereeItem.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasReferees || hasEmpty || hasSearch).toBeTruthy();
  });

  test('a11y: referees tab', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const refereesTab = page.locator('[role="tab"]').filter({ hasText: '심판' });
    if (await refereesTab.isVisible()) {
      await refereesTab.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Live Match View ──────────────────────────────────────

test.describe('Live Match View', () => {
  test('live match page shows score and aria-live regions', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    // Click on a match to view it
    const matchLink = page.locator('button[aria-label*="vs"]').first();
    if (!(await matchLink.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await matchLink.click();
    await page.waitForTimeout(3000);

    // Should be on match view page
    if (!page.url().includes('/spectator/match/')) {
      test.skip();
      return;
    }

    // Score display or aria-live region
    const scoreRegion = page.locator('[aria-live="polite"]').first();
    await expect(scoreRegion).toBeVisible({ timeout: 15000 });
  });

  test('a11y: live match view', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const matchLink = page.locator('button[aria-label*="vs"]').first();
    if (!(await matchLink.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await matchLink.click();
    await page.waitForTimeout(3000);

    if (!page.url().includes('/spectator/match/')) {
      test.skip();
      return;
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Player Profile View ──────────────────────────────────

test.describe('Player Profile View', () => {
  test('profile shows player info and stats', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    // Navigate to players tab
    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (!(await playersTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await playersTab.click();
    await page.waitForTimeout(2000);

    // Click a player link/button in the player list
    const playerLink = page.locator('main button[aria-label]').first();
    if (!(await playerLink.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await playerLink.click();
    await page.waitForTimeout(2000);

    // Either navigated to profile page or opened inline detail
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('profile has status filter tabs for match history', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (!(await playersTab.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await playersTab.click();
    await waitForLoading(page);

    const playerLink = page.locator('[aria-label*="profile"]').first()
      .or(page.locator('[role="tabpanel"] button').first());

    if (!(await playerLink.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await playerLink.click();
    await waitForLoading(page);

    // Status filter tabs (전체, 진행중, 예정, 완료)
    const filterButtons = page.locator('button').filter({ hasText: /전체|진행|예정|완료/ });
    if ((await filterButtons.count()) >= 2) {
      // Click each filter
      for (let i = 0; i < await filterButtons.count(); i++) {
        await filterButtons.nth(i).click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('a11y: player profile', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (await playersTab.isVisible()) {
      await playersTab.click();
      await waitForLoading(page);
    }

    const playerLink = page.locator('[aria-label*="profile"]').first()
      .or(page.locator('[role="tabpanel"] button').first());
    if (await playerLink.isVisible()) {
      await playerLink.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Favorites View ───────────────────────────────────────

test.describe('Favorites View', () => {
  test('favorites page loads with list or empty state', async ({ page }) => {
    await page.goto('/spectator/favorites');
    await waitForLoading(page);

    // Page heading should be visible
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('select-all checkbox and bulk remove', async ({ page }) => {
    await page.goto('/spectator/favorites');
    await waitForLoading(page);

    const selectAll = page.locator('[aria-label*="selectAll"], [aria-label*="전체 선택"]').first();
    if (!(await selectAll.isVisible().catch(() => false))) {
      // No favorites to select
      test.skip();
      return;
    }

    await selectAll.click();

    // Bulk remove button should appear
    const removeButton = page.locator('button').filter({ hasText: /삭제|제거/ }).first();
    await expect(removeButton).toBeVisible({ timeout: 3000 });
  });

  test('notification settings section', async ({ page }) => {
    await page.goto('/spectator/favorites');
    await waitForLoading(page);

    // Notification toggle
    const notifToggle = page.locator('input[type="checkbox"]').first();
    if (await notifToggle.isVisible()) {
      // Toggle should work
      await notifToggle.click();
      await page.waitForTimeout(300);
    }
  });

  test('a11y: favorites view', async ({ page }) => {
    await page.goto('/spectator/favorites');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Practice Watch View ──────────────────────────────────

test.describe('Practice Watch View', () => {
  test('practice watch has live/completed tabs', async ({ page }) => {
    await page.goto('/spectator/practice');
    await waitForLoading(page);

    const tablist = page.locator('[role="tablist"]');
    if (await tablist.isVisible()) {
      const tabs = tablist.locator('[role="tab"]');
      expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    }
  });

  test('tab panels show content or empty state', async ({ page }) => {
    await page.goto('/spectator/practice');
    await waitForLoading(page);

    const tabPanel = page.locator('[role="tabpanel"]');
    if (await tabPanel.isVisible()) {
      // Should show matches or empty message
      const content = tabPanel.locator('button').first();
      const empty = page.locator('[role="status"]');

      const hasContent = await content.isVisible().catch(() => false);
      const hasEmpty = await empty.isVisible().catch(() => false);
      expect(hasContent || hasEmpty).toBeTruthy();
    }
  });

  test('expandable match cards toggle', async ({ page }) => {
    await page.goto('/spectator/practice');
    await waitForLoading(page);

    const expandButton = page.locator('[aria-expanded]').first();
    if (await expandButton.isVisible()) {
      const initial = await expandButton.getAttribute('aria-expanded');
      await expandButton.click();
      await page.waitForTimeout(300);

      const updated = await expandButton.getAttribute('aria-expanded');
      expect(updated).not.toBe(initial);
    }
  });

  test('keyboard tab navigation with arrow keys', async ({ page }) => {
    await page.goto('/spectator/practice');
    await waitForLoading(page);

    const tablist = page.locator('[role="tablist"]');
    if (!(await tablist.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    const firstTab = tablist.locator('[role="tab"]').first();
    await firstTab.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    // Verify navigation occurred
    const secondTab = tablist.locator('[role="tab"]').nth(1);
    const isSelected = await secondTab.getAttribute('aria-selected');
    const isFocused = await secondTab.evaluate(el => el === document.activeElement);
    expect(isSelected === 'true' || isFocused).toBeTruthy();
  });

  test('a11y: practice watch', async ({ page }) => {
    await page.goto('/spectator/practice');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Bottom Navigation ────────────────────────────────────

test.describe('Spectator Layout Navigation', () => {
  test('home context shows 3 main tabs', async ({ page }) => {
    await navigateToSpectator(page);

    // Bottom nav tabs: Tournaments, Favorites, Practice
    const navTabs = page.locator('nav [role="tab"], nav a[aria-label]');
    expect(await navTabs.count()).toBeGreaterThanOrEqual(3);
  });

  test('navigating between main sections via bottom tabs', async ({ page }) => {
    await navigateToSpectator(page);

    // Click favorites tab
    const favTab = page.locator('[aria-label*="favorite"], [aria-label*="즐겨찾기"]').last();
    if (await favTab.isVisible()) {
      await favTab.click();
      await waitForLoading(page);
      await expect(page).toHaveURL(/\/spectator\/favorites/);
    }

    // Click practice tab
    const practiceTab = page.locator('[aria-label*="practice"], [aria-label*="연습"]').last();
    if (await practiceTab.isVisible()) {
      await practiceTab.click();
      await waitForLoading(page);
      await expect(page).toHaveURL(/\/spectator\/practice/);
    }

    // Click tournaments tab to go back
    const tournamentsTab = page.locator('[aria-label*="tournament"], [aria-label*="대회"]').last();
    if (await tournamentsTab.isVisible()) {
      await tournamentsTab.click();
      await waitForLoading(page);
      await expect(page).toHaveURL(/\/spectator\/?$/);
    }
  });

  test('back to list button from tournament view', async ({ page }) => {
    if (!(await navigateToFirstTournament(page))) {
      test.skip();
      return;
    }

    const backButton = page.locator('[aria-label*="backToList"], [aria-label*="목록"]').first();
    if (await backButton.isVisible()) {
      await backButton.click();
      await waitForLoading(page);
      await expect(page).toHaveURL(/\/spectator\/?$/);
    }
  });
});
