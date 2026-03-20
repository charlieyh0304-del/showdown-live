import { test, expect } from '@playwright/test';
import { navigateToAdmin, waitForLoading } from './helpers';

test.describe('Tournament Creation Flow', () => {
  test('can navigate to tournament creation wizard', async ({ page }) => {
    await navigateToAdmin(page);

    // Click "새 대회 만들기" button
    const createButton = page.locator('button', { hasText: '새 대회 만들기' });

    // The button may be in the dashboard or we may need to wait for data to load
    await createButton.or(page.locator('[aria-label="새 대회 만들기"]')).click({ timeout: 10000 });

    await waitForLoading(page);

    // Verify we're on the creation page
    await expect(page.locator('h1', { hasText: '새 대회 만들기' })).toBeVisible();
  });

  test('wizard step 1: fill in basic tournament info', async ({ page }) => {
    await page.goto('/admin/tournament/new');
    await waitForLoading(page);

    // Verify step 1 is visible - "기본 정보" step
    await expect(page.locator('h1', { hasText: '새 대회 만들기' })).toBeVisible();

    // Fill in tournament name
    const nameInput = page.locator('#name');
    await nameInput.fill('E2E 테스트 대회');
    await expect(nameInput).toHaveValue('E2E 테스트 대회');

    // Verify type selection buttons exist
    const individualButton = page.locator('button', { hasText: '개인전' });
    const teamButton = page.locator('button', { hasText: '팀전' });
    await expect(individualButton).toBeVisible();
    await expect(teamButton).toBeVisible();

    // Individual should be selected by default (aria-pressed)
    await expect(individualButton).toHaveAttribute('aria-pressed', 'true');

    // Select team type and verify
    await teamButton.click();
    await expect(teamButton).toHaveAttribute('aria-pressed', 'true');

    // Switch back to individual
    await individualButton.click();
    await expect(individualButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('wizard step 1: preset selection navigates to step 2', async ({ page }) => {
    await page.goto('/admin/tournament/new');
    await waitForLoading(page);

    // Fill in required name first
    await page.locator('#name').fill('프리셋 테스트 대회');

    // Look for preset buttons in the "설정 방식" section
    const presetSection = page.locator('text=설정 방식');
    await expect(presetSection).toBeVisible();

    // Click "풀리그" preset if it exists, otherwise click the first preset
    const fullLeaguePreset = page.locator('button', { hasText: '풀리그' });
    const firstPreset = page.locator('[role="radio"]').first();

    const targetPreset = await fullLeaguePreset.isVisible() ? fullLeaguePreset : firstPreset;
    await targetPreset.click();

    await waitForLoading(page);

    // After selecting a preset, should move to step 2 (참가자 설정)
    await expect(page.locator('text=참가자 수')).toBeVisible({ timeout: 5000 });
  });

  test('wizard step 2: set participant count', async ({ page }) => {
    await page.goto('/admin/tournament/new');
    await waitForLoading(page);

    // Fill step 1 and navigate to step 2
    await page.locator('#name').fill('참가자 테스트');

    // Use custom setup to go step by step
    const customButton = page.locator('button', { hasText: '직접 설정' });
    await customButton.click();

    await waitForLoading(page);

    // Should be on step 2 now
    await expect(page.locator('text=참가자 수')).toBeVisible({ timeout: 5000 });

    // Quick-select buttons for participant count
    const btn16 = page.locator('button', { hasText: '16명' });
    if (await btn16.isVisible()) {
      await btn16.click();
    }
  });

  test('wizard navigation: can go forward and backward through steps', async ({ page }) => {
    await page.goto('/admin/tournament/new');
    await waitForLoading(page);

    // Fill step 1
    await page.locator('#name').fill('네비게이션 테스트');
    const customButton = page.locator('button', { hasText: '직접 설정' });
    await customButton.click();
    await waitForLoading(page);

    // Should be on step 2
    await expect(page.locator('text=참가자 수')).toBeVisible({ timeout: 5000 });

    // Click "다음" to go to step 3 or 4
    const nextButton = page.locator('button', { hasText: '다음' });
    await nextButton.click();
    await waitForLoading(page);

    // Click "이전" to go back
    const prevButton = page.locator('button', { hasText: '이전' });
    if (await prevButton.isVisible()) {
      await prevButton.click();
      await waitForLoading(page);
    }

    // Verify we can reach the preview step (step 4) eventually
    // Keep clicking next until we see "대회 생성" button or "미리보기"
    for (let i = 0; i < 3; i++) {
      const nextBtn = page.locator('button', { hasText: '다음' });
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
        await waitForLoading(page);
      } else {
        break;
      }
    }

    // Should eventually reach the final step with a submit button
    const submitButton = page.locator('button', { hasText: '대회 생성' });
    await expect(submitButton).toBeVisible({ timeout: 5000 });
  });

  test('wizard cancel button returns to admin home', async ({ page }) => {
    await page.goto('/admin/tournament/new');
    await waitForLoading(page);

    // Click cancel
    const cancelButton = page.locator('button', { hasText: '취소' });
    await cancelButton.click();

    await waitForLoading(page);

    // Should return to admin home
    await expect(page).toHaveURL(/\/admin\/?$/);
  });
});
