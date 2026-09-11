import { test, expect } from '@playwright/test'
import { expectNoErrorBoundary, signOutButton } from './helpers'

const pages = [
  { name: 'Overview', path: '/dashboard' },
  { name: 'Applications', path: '/dashboard/applications' },
  { name: 'Stacks', path: '/dashboard/stacks' },
  { name: 'Deployments', path: '/dashboard/deployments' },
  { name: 'Databases', path: '/dashboard/databases' },
  { name: 'Templates', path: '/dashboard/templates' },
  { name: 'Workflows', path: '/dashboard/workflows' },
  { name: 'Monitoring', path: '/dashboard/monitoring' },
  { name: 'Team', path: '/dashboard/team' },
  { name: 'Security', path: '/dashboard/security' },
  { name: 'Billing', path: '/dashboard/billing' },
  { name: 'Settings', path: '/dashboard/settings' },
]

test.describe('dashboard', () => {
  for (const { name, path } of pages) {
    test(`${name} renders for a signed-in user`, async ({ page }) => {
      const failedApiCalls: string[] = []
      page.on('response', (response) => {
        if (response.url().includes('/trpc/') && response.status() >= 500) {
          failedApiCalls.push(`${response.status()} ${response.url()}`)
        }
      })

      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(signOutButton(page)).toBeVisible()
      await expect(page.getByRole('heading').first()).toBeVisible()
      await expectNoErrorBoundary(page)
      expect(failedApiCalls).toEqual([])
    })
  }

  test('the sidebar navigates between pages', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('link', { name: 'Applications' }).filter({ visible: true }).first().click()
    await expect(page).toHaveURL(/\/dashboard\/applications$/)
    await page.getByRole('link', { name: 'Settings' }).filter({ visible: true }).first().click()
    await expect(page).toHaveURL(/\/dashboard\/settings$/)
    await expectNoErrorBoundary(page)
  })
})
