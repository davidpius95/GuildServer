import { test, expect } from '@playwright/test'
import { newUser, register, signIn, signOutButton, expectNoErrorBoundary } from './helpers'

test.describe('authentication', () => {
  test('a new user can register, sign out and sign back in', async ({ page }) => {
    const user = newUser('auth')
    await register(page, user)
    await expectNoErrorBoundary(page)

    await signOutButton(page).click()
    await expect(page).toHaveURL(/\/auth\/login/)

    await signIn(page, user)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(signOutButton(page)).toBeVisible()
  })

  test('a wrong password does not sign the user in', async ({ page }) => {
    const user = newUser('wrong-password')
    await register(page, user)
    await signOutButton(page).click()
    await expect(page).toHaveURL(/\/auth\/login/)

    await signIn(page, { email: user.email, password: `${user.password}-nope` })
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled()
    await expect(page).toHaveURL(/\/auth\/login/)
    expect(await page.evaluate(() => localStorage.getItem('guildserver-token'))).toBeNull()
  })

  test('signed-out visitors are sent from the dashboard to sign in', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})
