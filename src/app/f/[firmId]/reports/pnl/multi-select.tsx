'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { selectionSummary } from '@/modules/reports/selection-summary'

export type MultiSelectOption = { id: string; name: string }
/** A heading (e.g. the client name above its projects) or null for an ungrouped list. */
export type MultiSelectGroup = { heading: string | null; options: MultiSelectOption[] }

/**
 * A dropdown of checkboxes inside the surrounding GET form. The panel stays in
 * the DOM while hidden, so ticked boxes still submit under `name`.
 */
export function MultiSelect({
  label,
  name,
  groups,
  selected,
  noun,
  hint,
}: {
  label: string
  name: string
  groups: MultiSelectGroup[]
  selected: string[]
  noun: { all: string; plural: string }
  hint?: string
}) {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected))
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const labelId = useId()
  const buttonId = useId()
  const panelId = useId()

  // Close on a click outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
  }

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const names = groups.flatMap((g) => g.options).filter((o) => checked.has(o.id)).map((o) => o.name)
  const summary = selectionSummary(names, noun)

  const boxes = (options: MultiSelectOption[]) =>
    options.map((o) => (
      <label key={o.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-selected">
        <input type="checkbox" name={name} value={o.id} checked={checked.has(o.id)} onChange={() => toggle(o.id)} />
        {o.name}
      </label>
    ))

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1" onKeyDown={onKeyDown}>
      <span id={labelId}>{label}</span>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-labelledby={`${labelId} ${buttonId}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 w-48 items-center justify-between gap-2 rounded-lg border border-input bg-card px-2 text-left text-sm"
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="text-xs">
          {open ? '▴' : '▾'}
        </span>
      </button>
      <div
        id={panelId}
        role="group"
        aria-labelledby={labelId}
        hidden={!open}
        className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border bg-card p-2 shadow-md"
      >
        {hint && <p className="mb-1 px-1 text-muted-foreground">{hint}</p>}
        {groups.every((g) => g.options.length === 0) && <p className="px-1 text-muted-foreground">None yet</p>}
        {groups.map((g, i) =>
          g.heading === null ? (
            <div key={`group-${i}`}>{boxes(g.options)}</div>
          ) : (
            <fieldset key={`group-${i}`} className="mt-1 first:mt-0">
              <legend className="px-1 font-medium text-muted-foreground">{g.heading}</legend>
              {boxes(g.options)}
            </fieldset>
          ),
        )}
        <div className="mt-2 border-t pt-2">
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="inline-flex h-7 items-center rounded-lg border px-2 text-sm font-medium"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
