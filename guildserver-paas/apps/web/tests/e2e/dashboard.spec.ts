import { test, expect } from '@playwright/test';

test.describe('Dashboard Functionality', () => {
  test.use({ storageState: 'tests/e2e/auth.json' });

  test('dashboard overview displays key metrics', async ({ page }) => {
    await page.goto('/dashboard');

    // Check main dashboard elements
    await expect(page.locator('h1')).toContainText('Dashboard');
    
    // Check stats cards are present
    await expect(page.locator('text=Applications')).toBeVisible();
    await expect(page.locator('text=Databases')).toBeVisible();
    await expect(page.locator('text=Team Members')).toBeVisible();
    await expect(page.locator('text=Uptime')).toBeVisible();

    // Check recent activity section
    await expect(page.locator('text=Recent Activity')).toBeVisible();
    
    // Check system status section
    await expect(page.locator('text=System Status')).toBeVisible();
    
    // Check quick actions section
    await expect(page.locator('text=Quick Actions')).toBeVisible();
  });

  test('applications page functionality', async ({ page }) => {
    await page.goto('/dashboard/applications');

    // Check page header
    await expect(page.locator('h1')).toContainText('Applications');
    await expect(page.locator('text=Deploy Application')).toBeVisible();

    // Check search functionality
    const searchInput = page.locator('input[placeholder*="Search applications"]');
    await expect(searchInput).toBeVisible();
    
    // Test search
    await searchInput.fill('test');
    await page.waitForTimeout(500); // Wait for search to process
    
    // Clear search
    await searchInput.fill('');
    
    // Check if deploy button is clickable
    const deployButton = page.locator('text=Deploy Application').first();
    await expect(deployButton).toBeVisible();
  });

  test('databases page functionality', async ({ page }) => {
    await page.goto('/dashboard/databases');

    // Check page header
    await expect(page.locator('h1')).toContainText('Databases');
    await expect(page.locator('text=Create Database')).toBeVisible();

    // Check tabs are present
    await expect(page.locator('text=Databases')).toBeVisible();
    await expect(page.locator('text=Backups')).toBeVisible();
    await expect(page.locator('text=Monitoring')).toBeVisible();

    // Test tab navigation
    await page.click('text=Backups');
    await expect(page.locator('text=Backup History')).toBeVisible();

    await page.click('text=Monitoring');
    await expect(page.locator('text=Total Databases')).toBeVisible();
  });

  test('monitoring page displays metrics', async ({ page }) => {
    await page.goto('/dashboard/monitoring');

    // Check page header
    await expect(page.locator('h1')).toContainText('Monitoring');
    
    // Check system overview cards
    await expect(page.locator('text=CPU Usage')).toBeVisible();
    await expect(page.locator('text=Memory Usage')).toBeVisible();
    await expect(page.locator('text=Disk Usage')).toBeVisible();
    await expect(page.locator('text=Active Alerts')).toBeVisible();

    // Check tabs
    await expect(page.locator('text=Performance')).toBeVisible();
    await expect(page.locator('text=Applications')).toBeVisible();
    await expect(page.locator('text=Alerts')).toBeVisible();
    await expect(page.locator('text=Logs')).toBeVisible();

    // Test tab navigation
    await page.click('text=Alerts');
    await expect(page.locator('text=Active Alerts')).toBeVisible();

    await page.click('text=Logs');
    await expect(page.locator('text=Recent Logs')).toBeVisible();
  });

  test('team management page functionality', async ({ page }) => {
    await page.goto('/dashboard/team');

    // Check page header
    await expect(page.locator('h1')).toContainText('Team');
    await expect(page.locator('text=Invite Member')).toBeVisible();

    // Check stats cards
    await expect(page.locator('text=Total Members')).toBeVisible();
    await expect(page.locator('text=Pending Invites')).toBeVisible();

    // Check tabs
    await expect(page.locator('text=Members')).toBeVisible();
    await expect(page.locator('text=Invitations')).toBeVisible();
    await expect(page.locator('text=Roles & Permissions')).toBeVisible();
    await expect(page.locator('text=Audit Log')).toBeVisible();

    // Test member search
    const searchInput = page.locator('input[placeholder*="Search team members"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await searchInput.fill('');
    }
  });

  test('security page displays compliance status', async ({ page }) => {
    await page.goto('/dashboard/security');

    // Check page header
    await expect(page.locator('h1')).toContainText('Security');
    
    // Check security overview
    await expect(page.locator('text=Security Score')).toBeVisible();
    await expect(page.locator('text=Critical Issues')).toBeVisible();
    await expect(page.locator('text=Compliance')).toBeVisible();

    // Check tabs
    await expect(page.locator('text=Compliance')).toBeVisible();
    await expect(page.locator('text=Vulnerabilities')).toBeVisible();
    await expect(page.locator('text=Security Scans')).toBeVisible();
    await expect(page.locator('text=Policies')).toBeVisible();

    // Test tab navigation
    await page.click('text=Vulnerabilities');
    await expect(page.locator('text=Security Issues')).toBeVisible();

    await page.click('text=Policies');
    await expect(page.locator('text=Security Policies')).toBeVisible();
  });

  test('settings page functionality', async ({ page }) => {
    await page.goto('/dashboard/settings');

    // Check page header
    await expect(page.locator('h1')).toContainText('Settings');

    // Check tabs
    await expect(page.locator('text=Organization')).toBeVisible();
    await expect(page.locator('text=Profile')).toBeVisible();
    await expect(page.locator('text=API Keys')).toBeVisible();
    await expect(page.locator('text=Billing')).toBeVisible();

    // Test profile tab
    await page.click('text=Profile');
    await expect(page.locator('text=Profile Information')).toBeVisible();

    // Test API keys tab
    await page.click('text=API Keys');
    await expect(page.locator('text=Create API Key')).toBeVisible();

    // Test billing tab
    await page.click('text=Billing');
    await expect(page.locator('text=Current Plan')).toBeVisible();
  });

  test('workflows page functionality', async ({ page }) => {
    await page.goto('/dashboard/workflows');

    // Check page header
    await expect(page.locator('h1')).toContainText('Workflows');
    await expect(page.locator('text=Create Workflow')).toBeVisible();

    // Check tabs
    await expect(page.locator('text=Workflows')).toBeVisible();
    await expect(page.locator('text=Recent Runs')).toBeVisible();
    await expect(page.locator('text=Templates')).toBeVisible();

    // Test templates tab
    await page.click('text=Templates');
    await expect(page.locator('text=Node.js CI/CD')).toBeVisible();
    await expect(page.locator('text=Database Maintenance')).toBeVisible();
  });

  test('responsive design works on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/dashboard');

    // Check mobile menu button is visible
    const mobileMenuButton = page.locator('button').filter({ hasText: /menu/i }).first();
    await expect(mobileMenuButton).toBeVisible();

    // Open mobile menu
    await mobileMenuButton.click();
    
    // Navigation should be visible
    await expect(page.locator('text=Applications')).toBeVisible();
    await expect(page.locator('text=Databases')).toBeVisible();
    
    // Navigate to a page
    await page.click('text=Applications');
    await expect(page).toHaveURL('/dashboard/applications');
  });

  test('dark mode toggle works', async ({ page }) => {
    await page.goto('/dashboard');

    // Check if theme toggle exists (implementation depends on your theme system)
    const themeToggle = page.locator('[aria-label*="theme"], [data-testid*="theme"]').first();
    
    // If theme toggle exists, test it
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      
      // Check if dark mode is applied (check for dark class or data attribute)
      const htmlElement = page.locator('html');
      await expect(htmlElement).toHaveAttribute('class', /dark|theme-dark/);
      
      // Toggle back
      await themeToggle.click();
    }
  });

  test('search functionality works across pages', async ({ page }) => {
    // Test applications search
    await page.goto('/dashboard/applications');
    let searchInput = page.locator('input[placeholder*="Search"]').first();
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await searchInput.fill('');
    }

    // Test team search
    await page.goto('/dashboard/team');
    searchInput = page.locator('input[placeholder*="Search"]').first();
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await searchInput.fill('');
    }
  });

  test('error handling works correctly', async ({ page }) => {
    // Test navigation to non-existent page
    const response = await page.goto('/dashboard/nonexistent');
    
    // Should handle 404 gracefully
    expect(response?.status()).toBe(404);
    
    // Or should redirect to a valid page
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/dashboard/);
  });
});