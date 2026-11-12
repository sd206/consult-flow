'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { uploadStatementAction, type CsvPreview } from '@/modules/bank/actions'
import type { ImportOutcome } from '@/modules/bank/data'
import type { CsvMapping } from '@/modules/bank/types'

const select = 'h-8 rounded-lg border bg-card px-2 text-sm'
const SOMETHING_WRONG = 'Something went wrong. Please try again.'

export function UploadForm({ firmId, accountId, hasMapping }: { firmId: string; accountId: string; hasMapping: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [remap, setRemap] = useState(false)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isCsv = !!file && file.name.toLowerCase().endsWith('.csv')

  const send = (mapping: CsvMapping | null) => {
    if (!file) {
      setError('Choose a statement file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('This file is larger than 5 MB.')
      return
    }
    const fd = new FormData()
    fd.set('file', file)
    if (mapping) fd.set('mapping', JSON.stringify(mapping))
    if (remap && !mapping) fd.set('remap', '1')
    setError(null)
    setOutcome(null)
    start(async () => {
      try {
        const r = await uploadStatementAction(firmId, accountId, fd)
        if (!r.ok) {
          setError(r.error)
          return
        }
        if ('needsMapping' in r.data) {
          setPreview(r.data)
          return
        }
        setPreview(null)
        setOutcome(r.data)
        router.refresh()
      } catch (e) {
        console.error('upload failed', e)
        setError(SOMETHING_WRONG)
      }
    })
  }

  return (
    <section aria-labelledby="upload-heading" className="mt-6 rounded-xl border bg-card p-4">
      <h2 id="upload-heading" className="text-base font-semibold">
        Upload a statement
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Download transactions from your bank as OFX, QFX or CSV. Lines already imported are skipped automatically.
      </p>
      <form
        aria-label="Upload statement"
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(null)
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="stmt-file">Statement file</Label>
          <input
            id="stmt-file"
            type="file"
            accept=".ofx,.qfx,.csv"
            className="text-sm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setPreview(null)
              setOutcome(null)
              setError(null)
            }}
          />
        </div>
        {hasMapping && isCsv && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remap} onChange={(e) => setRemap(e.target.checked)} />
            Change CSV columns
          </label>
        )}
        <Button type="submit" disabled={pending || !file}>
          {pending ? 'Uploading…' : 'Upload'}
        </Button>
      </form>

      {preview && <MappingForm preview={preview} pending={pending} onSubmit={send} />}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {outcome && (
        <div role="status" className="mt-3 text-sm">
          <p className="font-medium">
            {outcome.inserted} new {outcome.inserted === 1 ? 'line' : 'lines'}, {outcome.duplicates} already imported
          </p>
          {outcome.errors.length > 0 && (
            <>
              <p className="mt-2">These rows couldn&apos;t be read and were skipped:</p>
              <ul className="mt-1 list-disc pl-5">
                {outcome.errors.slice(0, 50).map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function MappingForm({
  preview,
  pending,
  onSubmit,
}: {
  preview: CsvPreview
  pending: boolean
  onSubmit: (m: CsvMapping) => void
}) {
  const guess = (re: RegExp, fallback: number) => {
    const i = preview.header.findIndex((h) => re.test(h))
    return i >= 0 ? i : fallback
  }
  const [dateColumn, setDate] = useState(guess(/date/i, 0))
  const [dateFormat, setFormat] = useState<CsvMapping['dateFormat']>('MDY')
  const [descriptionColumn, setDesc] = useState(guess(/desc|detail|payee|name|memo/i, 1))
  const [mode, setMode] = useState<'signed' | 'inout'>(guess(/out|debit|withdraw/i, -1) >= 0 ? 'inout' : 'signed')
  const [column, setColumn] = useState(guess(/amount/i, 2))
  const [flip, setFlip] = useState(false)
  const [inColumn, setIn] = useState(guess(/in\b|credit|deposit/i, 2))
  const [outColumn, setOut] = useState(guess(/out|debit|withdraw/i, 3))

  const cols = preview.header.map((h, i) => ({ i, label: h.trim() || `Column ${i + 1}` }))
  const colSelect = (id: string, label: string, value: number, set: (n: number) => void) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={select} value={value} onChange={(e) => set(Number(e.target.value))}>
        {cols.map((c) => (
          <option key={c.i} value={c.i}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <form
      aria-label="CSV columns"
      className="mt-4 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          dateColumn,
          dateFormat,
          descriptionColumn,
          amount: mode === 'signed' ? { mode, column, flip } : { mode, inColumn, outColumn },
        })
      }}
    >
      <h3 className="text-sm font-semibold">Which columns are which?</h3>
      <p className="mt-1 text-sm text-muted-foreground">We&apos;ll remember this for the next CSV from this account.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="text-left text-xs">
          <thead>
            <tr className="border-b">
              {cols.map((c) => (
                <th key={c.i} scope="col" className="py-1 pr-4 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r, i) => (
              <tr key={i} className="border-b">
                {cols.map((c) => (
                  <td key={c.i} className="py-1 pr-4">
                    {r[c.i] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {colSelect('map-date', 'Date column', dateColumn, setDate)}
        <div className="grid gap-1.5">
          <Label htmlFor="map-format">Date format</Label>
          <select id="map-format" className={select} value={dateFormat} onChange={(e) => setFormat(e.target.value as CsvMapping['dateFormat'])}>
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
            <option value="YMD">YYYY-MM-DD</option>
          </select>
        </div>
        {colSelect('map-desc', 'Description column', descriptionColumn, setDesc)}
        <div className="grid gap-1.5">
          <Label htmlFor="map-mode">Amounts</Label>
          <select id="map-mode" className={select} value={mode} onChange={(e) => setMode(e.target.value as 'signed' | 'inout')}>
            <option value="signed">One amount column</option>
            <option value="inout">Separate money in / money out columns</option>
          </select>
        </div>
        {mode === 'signed' ? (
          <>
            {colSelect('map-amount', 'Amount column', column, setColumn)}
            <label className="flex items-center gap-2 pb-1.5 text-sm">
              <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
              Flip signs (purchases shown as positive)
            </label>
          </>
        ) : (
          <>
            {colSelect('map-in', 'Money in column', inColumn, setIn)}
            {colSelect('map-out', 'Money out column', outColumn, setOut)}
          </>
        )}
      </div>
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending ? 'Importing…' : 'Import with these columns'}
      </Button>
    </form>
  )
}
