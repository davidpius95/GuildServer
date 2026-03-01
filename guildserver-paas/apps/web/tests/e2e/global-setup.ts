import { chromium, FullConfig } from '@playwright/test';
import { execSync } from 'child_process';

async function globalSetup(config: FullConfig) {
  console.log('🔧 Setting up E2E test environment...');

  // Set up test database
  try {
    console.log('📊 Setting up test database...');
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/guildserver_e2e_test';
    process.env.NODE_ENV = 'test';
    
    // Run database migrations for E2E tests
    execSync('npm run db:migrate --workspace=@guildserver/database', { 
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }
    });
    
    console.log('✅ Test database ready');
  } catch (error) {
    console.error('❌ Failed to setup test database:', error);
    throw error;
  }

  // Create test user and organization for authenticated tests
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('👤 Creating test user...');
    
    // Navigate to registration page
    await page.goto('/auth/register');
    
    // Fill registration form
    await page.fill('input[type="text"]', 'E2E Test User');
    await page.fill('input[type="email"]', 'e2e-test@example.com');
    await page.fill('input[type="password"]', 'e2e-test-password-123');
    
    // Submit registration
    await page.click('button[type="submit"]');
    
    // Wait for redirect to dashboard
    await page.waitForURL('/dashboard');
    
    // Save authentication state
    await context.storageState({ path: 'tests/e2e/auth.json' });
    
    console.log('✅ Test user created and authenticated');
  } catch (error) {
    console.error('❌ Failed to create test user:', error);
    // Don't throw here as some tests might not need authentication
  } finally {
    await browser.close();
  }

  console.log('🚀 E2E test environment ready');
}

export default globalSetup;