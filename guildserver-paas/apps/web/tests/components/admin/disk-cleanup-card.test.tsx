import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { DiskCleanupCard, formatBytes } from '../../../src/components/admin/disk-cleanup-card'
import { renderWithProviders } from '../../helpers/render'
import { server } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'
const SAFE = `sha256:${'a'.repeat(64)}`
const THIRD_PARTY = `sha256:${'b'.repeat(64)}`

const report = {
  mode: 'report',
  deletesPerformed: 0,
  generatedAt: '2026-09-11T12:00:00.000Z',
  policy: { rollbackKeepPerApp: 5, rollbackRetentionDays: 14, buildCacheIdleDays: 7, stoppedContainerDays: 30, warnPercent: 80, criticalPercent: 90 },
  filesystem: { totalBytes: 100, freeBytes: 40, usedBytes: 60, usedPercent: 60, status: 'ok' },
  summary: { imageCandidates: 2, imageBytesUpTo: 3 * 1024 ** 3, imageBytesAtLeast: 1024 ** 3, buildCacheTotalBytes: 0, buildCacheReclaimableBytes: 512 * 1024 ** 2, stoppedContainers: 0, volumesToReview: 4 },
  imageCandidates: [
    { id: SAFE, tags: ['gs-app-shop:old'], category: 'expired-build', confidence: 'safe', sizeBytes: 2 * 1024 ** 3, exclusiveBytes: 1024 ** 3, createdAt: '2026-08-01T00:00:00.000Z' },
    { id: THIRD_PARTY, tags: ['nginx:1.25'], category: 'unused-image', confidence: 'review', sizeBytes: 1024 ** 3, exclusiveBytes: 0, createdAt: '2026-08-01T00:00:00.000Z' },
  ],
  protectedImages: [],
  stoppedContainers: [],
  volumesToReview: [],
  warnings: [],
  notes: [],
}

describe('DiskCleanupCard', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })

  it('only lets safe images be selected, dry-runs first, and removes after typed confirmation', async () => {
    const bodies: any[] = []
    server.use(
      rest.get(`${BASE}/monitoring.diskReport`, (_req, res, ctx) => res(ctx.json({ result: { data: report } }))),
      rest.post(`${BASE}/monitoring.diskCleanup`, async (req, res, ctx) => {
        const body = await req.json()
        bodies.push(body)
        return res(
          ctx.json({
            result: {
              data: { dryRun: body.dryRun, images: [{ id: SAFE, tags: ['gs-app-shop:old'], sizeBytes: 2 * 1024 ** 3 }], skipped: [], failed: [], buildCache: null, volumesRemoved: 0 },
            },
          }),
        )
      }),
    )
    renderWithProviders(<DiskCleanupCard />)

    fireEvent.click(screen.getByRole('button', { name: 'Generate disk report' }))
    expect(await screen.findByText('gs-app-shop:old')).toBeInTheDocument()
    expect(screen.getByText(/4 volume\(s\) listed for review are never removed/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select nginx:1.25' })).toBeDisabled()

    const remove = screen.getByRole('button', { name: 'Remove selected' })
    expect(remove).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select gs-app-shop:old' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dry run' }))
    await waitFor(() => expect(bodies[0]).toEqual({ imageIds: [SAFE], includeBuildCache: false, dryRun: true }))
    expect(await screen.findByText(/Dry run: would remove 1 image/)).toBeInTheDocument()

    await waitFor(() => expect(remove).toBeEnabled())
    fireEvent.click(remove)
    const confirm = screen.getByRole('button', { name: 'Remove images' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'remove' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(bodies[1]).toEqual({ imageIds: [SAFE], includeBuildCache: false, dryRun: false }))
  })
})
