import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateToReferee, waitForLoading } from './helpers';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Referee Scoring Flow', () => {
  test('referee login page shows tournament selection', async ({ page }) => {
    await navigateToReferee(page);

    // Should show "심판 모드" heading
    await expect(page.locator('h1', { hasText: '심판 모드' })).toBeVisible();

    // Should show "대회 선택" step
    await expect(page.locator('text=대회 선택')).toBeVisible();

    // Should have a "모드 선택으로" back button
    await expect(page.locator('text=모드 선택으로')).toBeVisible();

    // a11y scan after referee login loads
    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
    // TODO(a11y): triage referee login violations
  });

  test('referee login page shows practice mode button', async ({ page }) => {
    await navigateToReferee(page);

    // Practice mode button should be visible (text includes "연습 모드")
    const practiceButton = page.locator('[aria-label="심판 연습 모드 시작"]');
    await expect(practiceButton).toBeVisible();
  });

  test('back button on referee login returns to mode selector', async ({ page }) => {
    await navigateToReferee(page);

    const backButton = page.locator('text=모드 선택으로');
    await backButton.click();
    await waitForLoading(page);

    // Should return to mode selector
    await expect(page.getByRole('heading', { name: '쇼다운' })).toBeVisible({ timeout: 10000 });
  });

  test('tournament selection step shows tournament list or empty state', async ({ page }) => {
    await navigateToReferee(page);

    // Wait for tournaments to load - either we see tournament buttons or empty message
    const tournamentButton = page.locator('button.btn-primary').first();
    const emptyMessage = page.locator('text=등록된 대회가 없습니다');

    await expect(
      tournamentButton.or(emptyMessage),
    ).toBeVisible({ timeout: 15000 });
  });

  test('selecting a tournament shows referee selection step', async ({ page }) => {
    await navigateToReferee(page);
    await waitForLoading(page);

    // Try to find a tournament button
    const tournamentButton = page.locator('button.btn-primary').first();
    const emptyMessage = page.locator('text=등록된 대회가 없습니다');

    await expect(tournamentButton.or(emptyMessage)).toBeVisible({ timeout: 15000 });

    // Only proceed if there are tournaments
    if (await tournamentButton.isVisible()) {
      await tournamentButton.click();
      await page.waitForTimeout(3000);

      // Should show referee selection step
      await expect(page.locator('h2', { hasText: '심판 선택' })).toBeVisible({ timeout: 15000 });

      // Should have a back button
      await expect(page.locator('button', { hasText: '뒤로' })).toBeVisible();
    }
  });

  test('PIN entry step shows after referee selection', async ({ page }) => {
    await navigateToReferee(page);
    await waitForLoading(page);

    // Select tournament if available
    const tournamentButton = page.locator('button.btn-primary').first();
    const emptyTournaments = page.locator('text=등록된 대회가 없습니다');
    await expect(tournamentButton.or(emptyTournaments)).toBeVisible({ timeout: 15000 });

    if (!(await tournamentButton.isVisible())) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await page.waitForTimeout(3000);

    // Select referee if available
    const refereeButton = page.locator('button.btn-secondary').first();
    const emptyReferees = page.locator('text=등록된 심판이 없습니다');
    await expect(refereeButton.or(emptyReferees)).toBeVisible({ timeout: 15000 });

    if (!(await refereeButton.isVisible())) {
      test.skip();
      return;
    }

    await refereeButton.click();
    await page.waitForTimeout(2000);

    // Should show PIN entry
    await expect(page.locator('text=PIN 입력')).toBeVisible({ timeout: 5000 });

    // PIN input should be visible (aria-label based)
    const pinInput = page.locator('[aria-label="4자리 PIN 입력"]');
    await expect(pinInput).toBeVisible();

    // a11y scan on PIN entry screen (focus management critical for blind users)
    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
    // TODO(a11y): triage PIN entry violations

    // Login button should exist
    const loginButton = page.locator('[aria-label="로그인"]');
    await expect(loginButton).toBeVisible();

    // Enter a 4-digit PIN
    await pinInput.fill('1234');

    // Login button should now be enabled
    await expect(loginButton).toBeEnabled();
  });

  test('practice mode navigates to practice page', async ({ page }) => {
    await navigateToReferee(page);

    const practiceButton = page.locator('[aria-label="심판 연습 모드 시작"]');
    await practiceButton.click();
    await waitForLoading(page);

    // Should navigate to practice page
    await expect(page).toHaveURL(/\/referee\/practice/);
  });
});
