import { screen, fireEvent, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { BackupStorageCard } from '../../../src/components/settings/backup-storage-card'
import { renderWithProviders } from '../../helpers/render'
import { server, TEST_ORG_ID } from '../../mocks/server'

const BASE = 'http://localhost:4000/trpc'

const storages = [
  { id: 's1', name: 'R2 backups', endpoint: 'https://acct.r2.cloudflarestorage.com', region: 'auto', bucket: 'gs-backups', pathPrefix: 'prod', lastTestedAt: '2026-09-10T10:00:00.000Z', lastTestOk: true, lastTestError: null },
]
const databases = [{ id: 'db1', name: 'orders', type: 'postgresql', backupStorageId: null }]

function mockLists(storageList = storages) {
  server.use(
    rest.get(`${BASE}/backupStorage.list`, (_req, res, ctx) => res(ctx.json({ result: { data: storageList } }))),
    rest.get(`${BASE}/database.listByOrg`, (_req, res, ctx) => res(ctx.json({ result: { data: databases } }))),
  )
}

describe('BackupStorageCard', () => {
  it('lists storage and sends a database\'s backups off-site when chosen', async () => {
    let body: any
    mockLists()
    server.use(
      rest.post(`${BASE}/database.updateBackupSettings`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { id: 'db1' } } }))
      }),
    )
    renderWithProviders(<BackupStorageCard />)

    expect(await screen.findByText('R2 backups')).toBeInTheDocument()
    expect(screen.getByText(/gs-backups\/prod · https:\/\/acct\.r2\.cloudflarestorage\.com · auto/)).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()

    const destination = await screen.findByLabelText('Backup destination for orders')
    fireEvent.change(destination, { target: { value: 's1' } })
    await waitFor(() => expect(body).toEqual({ id: 'db1', backupStorageId: 's1' }))
  })

  it('submits new storage with the secret in a password field', async () => {
    let body: any
    mockLists([])
    server.use(
      rest.post(`${BASE}/backupStorage.create`, async (req, res, ctx) => {
        body = await req.json()
        return res(ctx.json({ result: { data: { id: 's2' } } }))
      }),
    )
    renderWithProviders(<BackupStorageCard />)

    fireEvent.click(await screen.findByRole('button', { name: /Add storage/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'MinIO' } })
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://minio.example.com' } })
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'backups' } })
    fireEvent.change(screen.getByLabelText('Access key ID'), { target: { value: 'AKIA123' } })
    const secret = screen.getByLabelText('Secret access key')
    expect(secret).toHaveAttribute('type', 'password')
    fireEvent.change(secret, { target: { value: 's3cr3t' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test and save' }))

    await waitFor(() => expect(body).toBeDefined())
    expect(body).toEqual({
      organizationId: TEST_ORG_ID, name: 'MinIO', endpoint: 'https://minio.example.com', region: 'us-east-1',
      bucket: 'backups', accessKeyId: 'AKIA123', secretAccessKey: 's3cr3t', forcePathStyle: true,
    })
  })
})
