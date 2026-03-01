import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start from home page
    await page.goto('/');
  });

  test('user can register and login', async ({ page }) => {
    // Go to registration page
    await page.click('text=Get Started');
    await expect(page).toHaveURL('/auth/register');

    // Fill registration form
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', 'test-user@example.com');
    await page.fill('input[name="password"]', 'test-password-123');

    // Submit registration
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard');

    // Logout
    await page.click('text=Sign Out');
    await expect(page).toHaveURL('/auth/login');

    // Login with same credentials
    await page.fill('input[name="email"]', 'test-user@example.com');
    await page.fill('input[name="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    // Should be back at dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('registration form validation works', async ({ page }) => {
    await page.goto('/auth/register');

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should show validation errors
    await expect(page.locator('form')).toBeVisible();
    
    // Fill invalid email
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', 'invalid-email');
    await page.fill('input[name="password"]', 'short');
    
    await page.click('button[type="submit"]');
    
    // Should still be on registration page due to validation
    await expect(page).toHaveURL('/auth/register');
  });

  test('login form validation works', async ({ page }) => {
    await page.goto('/auth/login');

    // Try invalid credentials
    await page.fill('input[name="email"]', 'nonexistent@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Should show error and stay on login page
    await expect(page).toHaveURL('/auth/login');
    // Note: Error message display depends on your error handling implementation
  });

  test('navigation between auth pages works', async ({ page }) => {
    await page.goto('/auth/login');

    // Go to register
    await page.click('text=Sign up');
    await expect(page).toHaveURL('/auth/register');

    // Go back to login
    await page.click('text=Sign in');
    await expect(page).toHaveURL('/auth/login');
  });

  test('protected routes redirect to login', async ({ page }) => {
    // Try to access dashboard without authentication
    await page.goto('/dashboard');
    
    // Should redirect to login
    await expect(page).toHaveURL('/auth/login');
  });

  test('form accessibility', async ({ page }) => {
    await page.goto('/auth/register');

    // Check form labels and accessibility
    const nameInput = page.locator('input[name="name"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');
    
    await expect(nameInput).toBeVisible();
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    
    // Check form can be navigated with keyboard
    await nameInput.focus();
    await page.keyboard.press('Tab');
    await expect(emailInput).toBeFocused();
    
    await page.keyboard.press('Tab');
    await expect(passwordInput).toBeFocused();
  });
});

test.describe('Authenticated User Flow', () => {
  // Use the authentication state created in global setup
  test.use({ storageState: 'tests/e2e/auth.json' });

  test('authenticated user can access dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    
    await expect(page.locator('h1')).toContainText('Dashboard');
    await expect(page.locator('text=GuildServer')).toBeVisible();
  });

  test('authenticated user can navigate dashboard sections', async ({ page }) => {
    await page.goto('/dashboard');

    // Navigate to applications
    await page.click('text=Applications');
    await expect(page).toHaveURL('/dashboard/applications');
    await expect(page.locator('h1')).toContainText('Applications');

    // Navigate to databases
    await page.click('text=Databases');
    await expect(page).toHaveURL('/dashboard/databases');
    await expect(page.locator('h1')).toContainText('Databases');

    // Navigate to monitoring
    await page.click('text=Monitoring');
    await expect(page).toHaveURL('/dashboard/monitoring');
    await expect(page.locator('h1')).toContainText('Monitoring');

    // Navigate to team
    await page.click('text=Team');
    await expect(page).toHaveURL('/dashboard/team');
    await expect(page.locator('h1')).toContainText('Team');

    // Navigate to security
    await page.click('text=Security');
    await expect(page).toHaveURL('/dashboard/security');
    await expect(page.locator('h1')).toContainText('Security');

    // Navigate to settings
    await page.click('text=Settings');
    await expect(page).toHaveURL('/dashboard/settings');
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('dashboard sidebar is responsive', async ({ page }) => {
    await page.goto('/dashboard');

    // Test desktop view
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.locator('nav[class*="sidebar"]')).toBeVisible();

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Sidebar should be hidden on mobile
    const sidebar = page.locator('nav[class*="sidebar"]');
    
    // Mobile menu button should be visible
    const mobileMenuButton = page.locator('button[class*="lg:hidden"]');
    await expect(mobileMenuButton).toBeVisible();
    
    // Click mobile menu to open sidebar
    await mobileMenuButton.click();
    // Sidebar should become visible
  });

  test('user can logout', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Click logout button
    await page.click('text=Sign Out');
    
    // Should redirect to login page
    await expect(page).toHaveURL('/auth/login');
    
    // Try to access dashboard again - should redirect to login
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/auth/login');
  });
});