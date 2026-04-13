/**
 * 전체 페이지 접근성 스캔 (WCAG 2.1 AA).
 *
 * 이 앱의 핵심 사용자는 시각장애인(IBSA 쇼다운). a11y 회귀 방지를 위한
 * axe 스캔을 모든 접근 가능한 페이지/상태에서 수행한다.
 *
 * - expect()  → 위반 시 테스트 실패 (핵심 진입점)
 * - expect.soft() → 위반 보고만 (세부 페이지, CI 차단 없이 가시화)
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateToAdmin, navigateToReferee, navigateToSpectator, waitForLoading } from './helpers';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function formatViolations(violations: unknown[]) {
  return JSON.stringify(violations, null, 2);
}

// ── 핵심 진입점 (위반 시 hard fail) ──────────────────────

test.describe('A11y — 핵심 진입점 (hard fail)', () => {
  test('mode selector (home) — WCAG AA', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=쇼다운', { timeout: 10000 });

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('referee login (시각장애 심판 진입점) — WCAG AA', async ({ page }) => {
    await navigateToReferee(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('spectator home (시각장애 관람자 진입점) — WCAG AA', async ({ page }) => {
    await navigateToSpectator(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });
});

// ── Admin 페이지 (soft fail) ─────────────────────────────

test.describe('A11y — Admin 페이지', () => {
  test('admin login / dashboard', async ({ page }) => {
    await page.goto('/admin');
    await waitForLoading(page);
    await page.waitForTimeout(3000);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('tournament creation wizard step 1', async ({ page }) => {
    await navigateToAdmin(page);
    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.goto('/admin/tournament/new');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('player management', async ({ page }) => {
    await navigateToAdmin(page);
    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.goto('/admin/players');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('referee management', async ({ page }) => {
    await navigateToAdmin(page);
    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.goto('/admin/referees');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('court management', async ({ page }) => {
    await navigateToAdmin(page);
    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.goto('/admin/courts');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('admin settings', async ({ page }) => {
    await navigateToAdmin(page);
    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.goto('/admin/settings');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('tournament detail (first tournament)', async ({ page }) => {
    await navigateToAdmin(page);
    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const tournamentButton = page.locator('button[role="button"]').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });
});

// ── Referee 페이지 (soft fail) ───────────────────────────

test.describe('A11y — Referee 페이지', () => {
  test('referee login — tournament selection step', async ({ page }) => {
    await navigateToReferee(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('practice home', async ({ page }) => {
    await page.goto('/referee/practice');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('practice setup', async ({ page }) => {
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('practice history', async ({ page }) => {
    await page.goto('/referee/practice/history');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('practice scoring (active match)', async ({ page }) => {
    // Set up a quick practice match for scanning
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('A11y P1');
      await inputs.nth(1).fill('A11y P2');
    }

    const startButton = page.locator('button').filter({ hasText: '시작' }).first();
    if (!(await startButton.isVisible().catch(() => false)) || await startButton.isDisabled()) {
      test.skip();
      return;
    }

    await startButton.click();
    await waitForLoading(page);

    if (!page.url().includes('/play')) {
      test.skip();
      return;
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });
});

// ── Spectator 페이지 (soft fail) ─────────────────────────

test.describe('A11y — Spectator 페이지', () => {
  test('spectator home — in-progress tab', async ({ page }) => {
    await navigateToSpectator(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('spectator home — completed tab', async ({ page }) => {
    await navigateToSpectator(page);

    const completedTab = page.locator('button[role="tab"]', { hasText: '완료' });
    await completedTab.click();
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('tournament view — overview tab', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('tournament view — players tab', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const playersTab = page.locator('[role="tab"]').filter({ hasText: '선수' });
    if (await playersTab.isVisible()) {
      await playersTab.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('tournament view — standings tab', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const standingsTab = page.locator('[role="tab"]').filter({ hasText: '순위' });
    if (await standingsTab.isVisible()) {
      await standingsTab.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('tournament view — schedule tab', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const scheduleTab = page.locator('[role="tab"]').filter({ hasText: '일정' });
    if (await scheduleTab.isVisible()) {
      await scheduleTab.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('tournament view — referees tab', async ({ page }) => {
    await navigateToSpectator(page);
    await page.waitForTimeout(2000);

    const tournamentButton = page.locator('[role="tabpanel"] li button').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const refereesTab = page.locator('[role="tab"]').filter({ hasText: '심판' });
    if (await refereesTab.isVisible()) {
      await refereesTab.click();
      await waitForLoading(page);
    }

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('favorites view', async ({ page }) => {
    await page.goto('/spectator/favorites');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });

  test('practice watch view', async ({ page }) => {
    await page.goto('/spectator/practice');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, formatViolations(a11y.violations)).toEqual([]);
  });
});
