import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, jest } from '@jest/globals'
import { useState } from 'react'
import { EnvVarEditor, type EnvVarEntry } from '../../../src/components/env-var-editor'

/**
 * EnvVarEditor is a fully controlled component (`value` + `onChange`), so
 * these tests drive it through a small stateful wrapper — the same way a
 * real parent (e.g. the "New Application" form) would — rather than
 * re-rendering with new props by hand for every interaction.
 */
function ControlledEditor(props: Partial<React.ComponentProps<typeof EnvVarEditor>> & { onChangeSpy?: (entries: EnvVarEntry[]) => void }) {
  const [entries, setEntries] = useState<EnvVarEntry[]>(
    props.value ?? [{ key: '', value: '' }]
  )
  return (
    <EnvVarEditor
      value={entries}
      onChange={(next) => {
        setEntries(next)
        props.onChangeSpy?.(next)
      }}
      collapsible={props.collapsible}
      label={props.label}
    />
  )
}

describe('EnvVarEditor', () => {
  it('renders one empty row by default', () => {
    render(<ControlledEditor />)

    expect(screen.getByPlaceholderText('KEY')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('value')).toBeInTheDocument()
  })

  it('uppercases keys as the user types (env var convention)', () => {
    render(<ControlledEditor />)

    const keyInput = screen.getByPlaceholderText('KEY')
    fireEvent.change(keyInput, { target: { value: 'database_url' } })

    expect(keyInput).toHaveValue('DATABASE_URL')
  })

  it('adds a new row when "Add Variable" is clicked', () => {
    render(<ControlledEditor />)

    fireEvent.click(screen.getByRole('button', { name: /Add Variable/ }))

    expect(screen.getAllByPlaceholderText('KEY')).toHaveLength(2)
  })

  it('removes a row, but keeps one empty row instead of an empty list', () => {
    render(<ControlledEditor />)

    // Only one row exists — deleting it should not leave zero rows, since
    // the "New Application" form always needs at least one row to render
    // an add button next to.
    const [deleteButton] = screen.getAllByRole('button')
    fireEvent.click(deleteButton)

    const keyInputs = screen.getAllByPlaceholderText('KEY')
    expect(keyInputs).toHaveLength(1)
    expect(keyInputs[0]).toHaveValue('')
  })

  it('removes only the targeted row when multiple rows exist', () => {
    render(<ControlledEditor />)

    fireEvent.click(screen.getByRole('button', { name: /Add Variable/ }))
    const keyInputs = screen.getAllByPlaceholderText('KEY')
    fireEvent.change(keyInputs[0], { target: { value: 'FIRST' } })
    fireEvent.change(keyInputs[1], { target: { value: 'SECOND' } })

    // Delete (trash) buttons sit before "Add Variable" in the DOM, one per
    // row — remove the first row's.
    const trashButtons = screen.getAllByRole('button').filter((b) => b.textContent === '')
    fireEvent.click(trashButtons[0])

    const remaining = screen.getAllByPlaceholderText('KEY')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toHaveValue('SECOND')
  })

  it('shows a count of non-empty entries next to the label', () => {
    render(<ControlledEditor label="Environment Variables (optional)" />)

    fireEvent.change(screen.getByPlaceholderText('KEY'), { target: { value: 'PORT' } })

    expect(screen.getByText('Environment Variables (optional)')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  describe('collapsible mode', () => {
    it('starts collapsed and hides the rows until expanded', () => {
      render(<ControlledEditor collapsible label="Environment Variables (optional)" />)

      expect(screen.queryByPlaceholderText('KEY')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('Environment Variables (optional)'))

      expect(screen.getByPlaceholderText('KEY')).toBeInTheDocument()
    })

    it('starts expanded when collapsible is false', () => {
      render(<ControlledEditor collapsible={false} />)

      expect(screen.getByPlaceholderText('KEY')).toBeInTheDocument()
    })
  })

  it('calls onChange with the updated entries', () => {
    const onChangeSpy = jest.fn()
    render(<ControlledEditor onChangeSpy={onChangeSpy} />)

    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'secret' } })

    expect(onChangeSpy).toHaveBeenCalledWith([{ key: '', value: 'secret' }])
  })
})
