import { test as setup } from '@playwright/test'
import { STORAGE_STATE } from '../../playwright.config'
import { newUser, register } from './helpers'

setup('register a user for the dashboard tests', async ({ page }) => {
  await register(page, newUser('dashboard'))
  // The session token lives in localStorage, which storageState captures.
  await page.context().storageState({ path: STORAGE_STATE })
})
