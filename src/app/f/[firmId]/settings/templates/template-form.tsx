'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FormResult } from '@/lib/form'
import {
  createTemplateAction,
  deleteTemplateAction,
  setDefaultTemplateAction,
  updateTemplateAction,
} from '@/modules/invoice-templates/actions'
import type { TemplateOptions } from '@/modules/invoice-templates/schemas'

type FormTemplate = {
  id: string | null
  name: string
  baseLayout: 'classic' | 'modern' | 'compact'
  options: TemplateOptions
}

const CHECKS = [
  ['showConsultant', 'Show consultant'],
  ['showProject', 'Show project'],
  ['showQuantity', 'Show quantity'],
  ['showRate', 'Show rate'],
  ['showTaskNotes', 'Show task notes'],
  ['showDailyDetail', 'Add hours detail page'],
] as const

const HEX = /^#[0-9A-Fa-f]{6}$/

export function TemplateForm({ firmId, listHref, template }: { firmId: string; listHref: string; template: FormTemplate }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<FormResult<unknown> | null>(null)
  const [color, setColor] = useState(template.options.accentColor)
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {}
  const o = template.options

  return (
    <form
      className="mt-6 flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        startTransition(async () => {
          const r = template.id
            ? await updateTemplateAction(firmId, template.id, fd)
            : await createTemplateAction(firmId, fd)
          setResult(r)
          if (r.ok) router.push(listHref)
        })
      }}
    >
      <h2 className="text-lg font-medium">{template.id ? 'Edit template' : 'New template'}</h2>

      <div className="flex flex-col gap-1">
        <Label htmlFor="tpl-name">Name</Label>
        <Input id="tpl-name" name="name" defaultValue={template.name} aria-invalid={!!errors.name} />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="tpl-layout">Layout</Label>
        <select
          id="tpl-layout"
          name="baseLayout"
          defaultValue={template.baseLayout}
          className="h-8 rounded-lg border bg-card px-2 text-sm"
        >
          <option value="classic">Classic</option>
          <option value="modern">Modern</option>
          <option value="compact">Compact</option>
        </select>
        {errors.baseLayout && <p className="text-xs text-destructive">{errors.baseLayout}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="tpl-accent">Accent colour</Label>
        <div className="flex items-center gap-2">
          <Input
            id="tpl-accent"
            name="accentColor"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-invalid={!!errors.accentColor}
            className="max-w-40"
          />
          <input
            type="color"
            tabIndex={-1}
            aria-hidden="true"
            value={HEX.test(color) ? color.toLowerCase() : '#000000'}
            onChange={(e) => setColor(e.target.value.toUpperCase())}
            className="h-8 w-10 cursor-pointer rounded border bg-transparent"
          />
        </div>
        {errors.accentColor && <p className="text-xs text-destructive">{errors.accentColor}</p>}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Show on invoice</legend>
        {CHECKS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={key} defaultChecked={o[key]} />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor="tpl-terms">Payment terms</Label>
        <textarea
          id="tpl-terms"
          name="paymentTermsText"
          rows={3}
          defaultValue={o.paymentTermsText}
          aria-invalid={!!errors.paymentTermsText}
          className="rounded-md border bg-card p-2 text-sm"
        />
        {errors.paymentTermsText && <p className="text-xs text-destructive">{errors.paymentTermsText}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="tpl-footer">Footer</Label>
        <textarea
          id="tpl-footer"
          name="footerText"
          rows={2}
          defaultValue={o.footerText}
          aria-invalid={!!errors.footerText}
          className="rounded-md border bg-card p-2 text-sm"
        />
        {errors.footerText && <p className="text-xs text-destructive">{errors.footerText}</p>}
      </div>

      {result && !result.ok && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save template
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => router.push(listHref)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function TemplateRowActions({ firmId, id, isDefault }: { firmId: string; id: string; isDefault: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<FormResult>) =>
    startTransition(async () => {
      const r = await fn()
      setError(r.ok ? null : r.error)
      if (r.ok) router.refresh()
    })

  if (isDefault) return null
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => setDefaultTemplateAction(firmId, id))}
      >
        Make default
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (window.confirm('Delete this template? This cannot be undone.')) run(() => deleteTemplateAction(firmId, id))
        }}
      >
        Delete
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
