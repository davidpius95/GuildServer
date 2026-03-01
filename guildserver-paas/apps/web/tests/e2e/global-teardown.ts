import { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';

async function globalTeardown(config: FullConfig) {
  console.log('🧹 Cleaning up E2E test environment...');

  // Clean up authentication state
  try {
    if (fs.existsSync('tests/e2e/auth.json')) {
      fs.unlinkSync('tests/e2e/auth.json');
      console.log('✅ Authentication state cleaned up');
    }
  } catch (error) {
    console.error('⚠️ Failed to clean up auth state:', error);
  }

  // Clean up test database
  try {
    console.log('📊 Cleaning up test database...');
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/guildserver_e2e_test';
    
    // Drop all tables to clean up
    execSync('psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"', { 
      stdio: 'inherit',
      env: process.env
    });
    
    console.log('✅ Test database cleaned up');
  } catch (error) {
    console.error('⚠️ Failed to clean up test database:', error);
  }

  console.log('🎉 E2E test cleanup complete');
}

export default globalTeardown;