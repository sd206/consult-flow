'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  setCategoryActiveAction,
} from '@/modules/expense-categories/actions'
import type { CategoryRow as Category } from '@/modules/expense-categories/data'
import { useRun } from '@/components/use-run'

const td = 'py-2 pr-4 align-top'

export function AddCategoryForm({ firmId }: { firmId: string }) {
  const { pending, run, errors, error } = useRun()
  const [resets, setResets] = useState(0)
  return (
    <form
      key={resets}
      aria-label="Add category"
      className="mt-3 flex flex-wrap items-start gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        run(
          () => createCategoryAction(firmId, fd),
          () => setResets((n) => n + 1),
        )
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="cat-new-name">Name</Label>
        <Input id="cat-new-name" name="name" aria-invalid={!!errors.name} className="max-w-64" />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>
      <Button type="submit" disabled={pending} className="self-end">
        Add category
      </Button>
      {error && !errors.name && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function CategoryRow({ firmId, category: c }: { firmId: string; category: Category }) {
  const [renaming, setRenaming] = useState(false)
  const { pending, run, errors, error } = useRun()
  return (
    <tr className="border-b">
      <td className={td}>
        {renaming ? (
          <form
            aria-label={`Rename ${c.name}`}
            className="flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              run(
                () => renameCategoryAction(firmId, c.id, fd),
                () => setRenaming(false),
              )
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor={`cat-name-${c.id}`} className="sr-only">
                New name for {c.name}
              </Label>
              <Input id={`cat-name-${c.id}`} name="name" defaultValue={c.name} aria-invalid={!!errors.name} className="max-w-56" />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          c.name
        )}
      </td>
      <td className={td}>{c.active ? 'Active' : 'Retired'}</td>
      <td className={td}>{c.expenseCount}</td>
      <td className={td}>
        <div className="flex flex-wrap gap-2">
          {!renaming && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setRenaming(true)}>
              Rename<span className="sr-only"> {c.name}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setCategoryActiveAction(firmId, c.id, !c.active))}
          >
            {c.active ? 'Retire' : 'Restore'}
            <span className="sr-only"> {c.name}</span>
          </Button>
          {c.expenseCount === 0 && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete the category ${c.name}? This can't be undone.`)) {
                  run(() => deleteCategoryAction(firmId, c.id))
                }
              }}
            >
              Delete<span className="sr-only"> {c.name}</span>
            </Button>
          )}
        </div>
        {error && !errors.name && (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}
