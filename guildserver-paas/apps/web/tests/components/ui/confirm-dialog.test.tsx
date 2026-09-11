import { render, screen, fireEvent, renderHook, act } from '@testing-library/react'
import { ConfirmDialog, useConfirmDialog } from '../../../src/components/ui/confirm-dialog'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={jest.fn()}
        title="Delete this?"
        description="This cannot be undone."
        onConfirm={jest.fn()}
      />
    )

    expect(screen.queryByText('Delete this?')).not.toBeInTheDocument()
  })

  it('renders the title, description and default labels when open', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={jest.fn()}
        title='Delete "my-app"?'
        description="This will permanently stop and remove the container."
        onConfirm={jest.fn()}
      />
    )

    expect(screen.getByText('Delete "my-app"?')).toBeInTheDocument()
    expect(
      screen.getByText('This will permanently stop and remove the container.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('calls onConfirm (without auto-closing) when the confirm button is clicked', () => {
    const onConfirm = jest.fn()
    const onOpenChange = jest.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete this?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    // The confirm action calls preventDefault() specifically so Radix
    // doesn't auto-close the dialog before an async onConfirm has a
    // chance to show its loading state — closing is left to the caller.
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes when the cancel button is clicked', () => {
    const onOpenChange = jest.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete this?"
        description="This cannot be undone."
        onConfirm={jest.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables both buttons while loading', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={jest.fn()}
        title="Delete this?"
        description="This cannot be undone."
        onConfirm={jest.fn()}
        loading
      />
    )

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeDisabled()
  })

  it.each([
    ['danger', 'Delete this?'],
    ['warning', 'Restart this?'],
    ['info', 'Continue?'],
  ] as const)('renders the %s variant', (variant: 'danger' | 'warning' | 'info', title: string) => {
    render(
      <ConfirmDialog
        open
        onOpenChange={jest.fn()}
        title={title}
        description="Description"
        variant={variant}
        onConfirm={jest.fn()}
      />
    )

    expect(screen.getByText(title)).toBeInTheDocument()
  })

  describe('with confirmationText', () => {
    function renderTyped(onConfirm = jest.fn()) {
      render(
        <ConfirmDialog
          open
          onOpenChange={jest.fn()}
          title="Delete Organization"
          description="This cannot be undone."
          confirmLabel="Delete Organization"
          confirmationText="acme-corp"
          onConfirm={onConfirm}
        />
      )
      return onConfirm
    }

    it('keeps the confirm button disabled until the exact text is typed', () => {
      const onConfirm = renderTyped()
      const button = screen.getByRole('button', { name: 'Delete Organization' })
      const input = screen.getByLabelText(/to confirm/)

      expect(button).toBeDisabled()
      fireEvent.change(input, { target: { value: 'acme' } })
      expect(button).toBeDisabled()
      fireEvent.change(input, { target: { value: 'Acme-Corp' } })
      expect(button).toBeDisabled()
      fireEvent.click(button)
      expect(onConfirm).not.toHaveBeenCalled()

      fireEvent.change(input, { target: { value: 'acme-corp' } })
      expect(button).toBeEnabled()
      fireEvent.click(button)
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('shows the text the user has to type', () => {
      renderTyped()
      expect(screen.getByText('acme-corp')).toBeInTheDocument()
    })
  })
})

describe('useConfirmDialog', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useConfirmDialog())
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('opens the dialog with the details passed to confirm()', () => {
    const { result } = renderHook(() => useConfirmDialog())
    const onConfirm = jest.fn()

    act(() => {
      result.current.confirm({
        title: 'Delete "my-app"?',
        description: 'This will permanently stop and remove the container.',
        confirmLabel: 'Delete',
        variant: 'danger',
        onConfirm,
      })
    })

    expect(result.current.dialogProps.open).toBe(true)
    expect(result.current.dialogProps.title).toBe('Delete "my-app"?')
    expect(result.current.dialogProps.confirmLabel).toBe('Delete')
    expect(result.current.dialogProps.variant).toBe('danger')
  })

  it('runs the stored onConfirm and resets state when the dialog confirms', () => {
    const { result } = renderHook(() => useConfirmDialog())
    const onConfirm = jest.fn()

    act(() => {
      result.current.confirm({
        title: 'Delete "my-app"?',
        description: 'This cannot be undone.',
        onConfirm,
      })
    })

    act(() => {
      result.current.dialogProps.onConfirm()
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('resets state when the dialog is dismissed without confirming', () => {
    const { result } = renderHook(() => useConfirmDialog())
    const onConfirm = jest.fn()

    act(() => {
      result.current.confirm({
        title: 'Delete "my-app"?',
        description: 'This cannot be undone.',
        onConfirm,
      })
    })

    act(() => {
      result.current.dialogProps.onOpenChange(false)
    })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('drives the ConfirmDialog component end-to-end', () => {
    const onConfirm = jest.fn()

    function Harness() {
      const { confirm, dialogProps } = useConfirmDialog()
      return (
        <>
          <button
            onClick={() =>
              confirm({
                title: 'Delete "my-app"?',
                description: 'This cannot be undone.',
                confirmLabel: 'Delete',
                onConfirm,
              })
            }
          >
            Trigger delete
          </button>
          <ConfirmDialog {...dialogProps} />
        </>
      )
    }

    render(<Harness />)

    expect(screen.queryByText('Delete "my-app"?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Trigger delete'))
    expect(screen.getByText('Delete "my-app"?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Delete "my-app"?')).not.toBeInTheDocument()
  })
})
