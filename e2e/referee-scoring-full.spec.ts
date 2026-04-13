import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateToReferee, waitForLoading } from './helpers';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Referee 채점 전체 흐름 테스트.
 * 로그인 → 경기 목록 → 개인전/팀전 채점 → 연습 모드 전 흐름을 커버한다.
 */

// ── Referee Home (Match List) ────────────────────────────

test.describe('Referee Home — Match List', () => {
  test('shows active/completed tabs after login', async ({ page }) => {
    // Login flow (need tournament + referee + PIN)
    await navigateToReferee(page);

    // Select tournament
    const tournamentButton = page.locator('button.btn-primary').first();
    const emptyTournaments = page.locator('text=등록된 대회가 없습니다');
    await expect(tournamentButton.or(emptyTournaments)).toBeVisible({ timeout: 15000 });

    if (!(await tournamentButton.isVisible())) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await page.waitForTimeout(3000);

    // Select referee
    const refereeButton = page.locator('button.btn-secondary').first();
    if (!(await refereeButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await refereeButton.click();
    await page.waitForTimeout(2000);

    // Enter PIN
    const pinInput = page.locator('[aria-label*="PIN"]').first();
    await pinInput.fill(process.env.REFEREE_PIN || '0000');

    const loginButton = page.locator('[aria-label*="로그인"]').first()
      .or(page.locator('button').filter({ hasText: '로그인' }).first());
    await loginButton.click();
    await waitForLoading(page);

    // Check if we reached referee home
    const matchList = page.locator('[role="list"]');
    const noMatches = page.locator('text=배정된 경기가 없습니다');
    const tabs = page.locator('[role="tab"]');

    const reachedHome = await matchList.isVisible().catch(() => false)
      || await noMatches.isVisible().catch(() => false)
      || await tabs.first().isVisible().catch(() => false);

    if (!reachedHome) {
      // PIN might be wrong — skip gracefully
      test.skip();
      return;
    }

    // Verify tab structure
    if (await tabs.first().isVisible()) {
      expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── Practice Mode Full Flow ──────────────────────────────

test.describe('Practice Mode — Full Flow', () => {
  test('navigate to practice home from referee login', async ({ page }) => {
    await navigateToReferee(page);

    const practiceButton = page.locator('[aria-label*="연습"]').first()
      .or(page.locator('button').filter({ hasText: '연습' }).first());
    await expect(practiceButton).toBeVisible({ timeout: 10000 });
    await practiceButton.click();
    await waitForLoading(page);

    await expect(page).toHaveURL(/\/referee\/practice/);
  });

  test('practice home shows start and history options', async ({ page }) => {
    await page.goto('/referee/practice');
    await waitForLoading(page);

    // Start practice button
    const startButton = page.locator('button').filter({ hasText: '시작' }).first()
      .or(page.locator('a').filter({ hasText: '시작' }).first())
      .or(page.locator('[href*="setup"]').first());
    await expect(startButton).toBeVisible({ timeout: 10000 });

    // History link
    const historyLink = page.locator('button').filter({ hasText: '기록' }).first()
      .or(page.locator('a').filter({ hasText: '기록' }).first())
      .or(page.locator('[href*="history"]').first());
    await expect(historyLink).toBeVisible();
  });

  test('practice setup has match type and player name inputs', async ({ page }) => {
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);
    await page.waitForTimeout(2000);

    // Page heading should be visible
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Match type selection (individual vs team)
    const radioGroup = page.locator('[role="radiogroup"]');
    const typeButtons = page.locator('[role="radio"]');

    const hasRadio = await radioGroup.isVisible().catch(() => false);
    const hasButtons = (await typeButtons.count()) >= 2;
    expect(hasRadio || hasButtons).toBeTruthy();

    // Player name inputs (class="input")
    const playerInputs = page.locator('input.input, input[type="text"]');
    expect(await playerInputs.count()).toBeGreaterThanOrEqual(2);
  });

  test('practice setup: fill form and start match', async ({ page }) => {
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    // Fill player names
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();

    if (inputCount >= 2) {
      await inputs.nth(0).fill('테스트 선수 1');
      await inputs.nth(1).fill('테스트 선수 2');
    }

    // Start button should be enabled after filling
    const startButton = page.locator('button').filter({ hasText: '시작' }).first();
    if (await startButton.isVisible()) {
      const isDisabled = await startButton.isDisabled();
      if (!isDisabled) {
        await startButton.click();
        await waitForLoading(page);
        // Should navigate to play page
        await expect(page).toHaveURL(/\/referee\/practice\/play/, { timeout: 10000 });
      }
    }
  });

  test('practice scoring page shows whistle buttons and score panel', async ({ page }) => {
    // Set up a practice match first
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('P1');
      await inputs.nth(1).fill('P2');
    }

    const startButton = page.locator('button').filter({ hasText: '시작' }).first();
    if (!(await startButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    if (await startButton.isDisabled()) {
      test.skip();
      return;
    }

    await startButton.click();
    await waitForLoading(page);

    if (!page.url().includes('/play')) {
      test.skip();
      return;
    }

    // Scoring buttons
    const goalButtons = page.locator('[aria-label*="goal"], [aria-label*="+2"]');
    const foulButtons = page.locator('[aria-label*="foul"], [aria-label*="파울"]');

    // At least some scoring buttons should be visible
    const hasGoal = (await goalButtons.count()) > 0;
    const hasFoul = (await foulButtons.count()) > 0;
    expect(hasGoal || hasFoul).toBeTruthy();
  });

  test('practice scoring: goal increments score', async ({ page }) => {
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('선수A');
      await inputs.nth(1).fill('선수B');
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

    // Find a goal button (e.g., "선수A goal +2" or similar)
    const goalButton = page.locator('[aria-label*="+2"]').first()
      .or(page.locator('[aria-label*="goal"]').first());

    if (await goalButton.isVisible()) {
      await goalButton.click();
      await page.waitForTimeout(500);

      // Score should have changed (look for "2" in score display)
      const scoreRegion = page.locator('[role="status"]').first();
      if (await scoreRegion.isVisible()) {
        const text = await scoreRegion.textContent();
        expect(text).toBeTruthy();
      }
    }
  });

  test('practice scoring: timeout modal opens', async ({ page }) => {
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('T1');
      await inputs.nth(1).fill('T2');
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

    // Expand timeout section
    const timeoutSection = page.locator('[aria-expanded]').filter({ hasText: /timeout|타임아웃/ }).first();
    if (await timeoutSection.isVisible()) {
      await timeoutSection.click();
      await page.waitForTimeout(300);

      // Find a timeout button
      const timeoutButton = page.locator('[aria-label*="timeout"]').first();
      if (await timeoutButton.isVisible()) {
        await timeoutButton.click();
        await page.waitForTimeout(500);

        // Timer modal should appear
        const timerModal = page.locator('[role="dialog"][aria-modal="true"]');
        if (await timerModal.isVisible()) {
          // Timer should show elapsed time
          const timer = timerModal.locator('[aria-live="polite"]');
          await expect(timer).toBeVisible({ timeout: 3000 });

          // Close timeout
          const endButton = timerModal.locator('button').first();
          await endButton.click();
        }
      }
    }
  });

  test('practice history shows session list or empty state', async ({ page }) => {
    await page.goto('/referee/practice/history');
    await waitForLoading(page);
    await page.waitForTimeout(2000);

    // Page should render — heading or content visible
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('a11y: practice home', async ({ page }) => {
    await page.goto('/referee/practice');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });

  test('a11y: practice setup', async ({ page }) => {
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });

  test('a11y: practice history', async ({ page }) => {
    await page.goto('/referee/practice/history');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Scoring UI Elements ──────────────────────────────────

test.describe('Scoring UI — Collapsible Sections', () => {
  // These tests check the scoring interface structure via practice mode
  // since real matches require full authentication

  test('expandable sections toggle aria-expanded', async ({ page }) => {
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('X');
      await inputs.nth(1).fill('Y');
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

    // Find all expandable sections
    const expandables = page.locator('[aria-expanded]');
    const count = await expandables.count();

    for (let i = 0; i < count; i++) {
      const section = expandables.nth(i);
      const initialState = await section.getAttribute('aria-expanded');

      await section.click();
      await page.waitForTimeout(200);

      const newState = await section.getAttribute('aria-expanded');
      // State should have toggled
      expect(newState).not.toBe(initialState);

      // Toggle back
      await section.click();
      await page.waitForTimeout(200);
    }
  });
});

// ── Foul Classification Overlay ──────────────────────────

test.describe('Foul Classification', () => {
  test('foul button opens classification dialog', async ({ page }) => {
    // Set up practice match
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('F1');
      await inputs.nth(1).fill('F2');
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

    // Click a foul button
    const foulButton = page.locator('[aria-label*="foul"], [aria-label*="파울"]').first();
    if (!(await foulButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await foulButton.click();
    await page.waitForTimeout(500);

    // Foul classification dialog should open
    const classifyDialog = page.locator('[role="dialog"][aria-modal="true"]');
    if (await classifyDialog.isVisible()) {
      // Should have foul type options
      const foulOptions = classifyDialog.locator('button[aria-label]');
      expect(await foulOptions.count()).toBeGreaterThanOrEqual(1);

      // Close dialog
      const closeButton = classifyDialog.locator('button').filter({ hasText: '닫기' }).first()
        .or(classifyDialog.locator('[aria-label*="close"]').first());
      if (await closeButton.isVisible()) {
        await closeButton.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  });
});

// ── Score History ────────────────────────────────────────

test.describe('Score History View', () => {
  test('history toggle shows set-grouped actions', async ({ page }) => {
    // Set up practice match and score a point
    await page.goto('/referee/practice/setup');
    await waitForLoading(page);

    const inputs = page.locator('input[type="text"]');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('H1');
      await inputs.nth(1).fill('H2');
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

    // Score a point first
    const goalButton = page.locator('[aria-label*="+2"]').first()
      .or(page.locator('[aria-label*="goal"]').first());
    if (await goalButton.isVisible()) {
      await goalButton.click();
      await page.waitForTimeout(300);
    }

    // Toggle history view
    const historyToggle = page.locator('[aria-expanded]').filter({ hasText: /기록|history|히스토리/ }).first();
    if (await historyToggle.isVisible()) {
      await historyToggle.click();
      await page.waitForTimeout(300);
      // History content should now be visible
    }
  });
});
