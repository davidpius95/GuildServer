import { expect, type Page } from '@playwright/test'

export interface TestUser {
  name: string
  email: string
  password: string
}

/** A unique, clearly labelled account for one run. */
export function newUser(label = 'e2e'): TestUser {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    name: `E2E ${label}`,
    email: `gs-e2e-${label}-${stamp}@example.com`,
    password: `E2e-${stamp}-pw`,
  }
}

export function signOutButton(page: Page) {
  // The sidebar and the mobile menu both render one; use whichever is visible.
  return page.getByRole('button', { name: 'Sign Out' }).filter({ visible: true }).first()
}

/**
 * Fill and submit an auth form, retrying if the click beat hydration.
 *
 * Before React attaches its submit handler, a click does a native form submit
 * that simply reloads the page and clears the fields. Waiting for the tRPC
 * response proves the app, not the browser, handled the submit.
 */
async function submitAuthForm(page: Page, procedure: string, fill: () => Promise<void>, button: string) {
  await expect(async () => {
    await fill()
    const response = page.waitForResponse((r) => r.url().includes(`/trpc/${procedure}`), { timeout: 5_000 })
    await page.getByRole('button', { name: button }).click()
    await response
  }).toPass({ timeout: 45_000 })
}

export async function register(page: Page, user: TestUser): Promise<void> {
  await page.goto('/auth/register')
  await submitAuthForm(
    page,
    'auth.register',
    async () => {
      await page.locator('#name').fill(user.name)
      await page.locator('#email').fill(user.email)
      await page.locator('#password').fill(user.password)
    },
    'Create Account',
  )
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(signOutButton(page)).toBeVisible()
}

export async function signIn(page: Page, user: Pick<TestUser, 'email' | 'password'>): Promise<void> {
  await page.goto('/auth/login')
  await submitAuthForm(
    page,
    'auth.login',
    async () => {
      await page.locator('input[type="email"]').fill(user.email)
      await page.locator('input[type="password"]').fill(user.password)
    },
    'Sign In',
  )
}

/** Neither the app-wide nor the dashboard error boundary is showing. */
export async function expectNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Failed to load dashboard', { exact: true })).toHaveCount(0)
}
