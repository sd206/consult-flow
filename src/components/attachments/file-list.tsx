'use client'

import { Button } from '@/components/ui/button'
import type { FormResult } from '@/lib/form'
import { useRun } from '@/app/f/[firmId]/invoices/[id]/use-run'

export type FileItem = { id: string; fileName: string }

/**
 * Attached files with a Remove button (confirmed first). With `downloadBase`, names are links
 * to `${downloadBase}/{id}`; without it they are plain text.
 */
export function FileList({
  files,
  onRemove,
  downloadBase,
}: {
  files: FileItem[]
  onRemove: (attachmentId: string) => Promise<FormResult>
  downloadBase?: string
}) {
  const { pending, run, error } = useRun()
  if (files.length === 0) return null
  return (
    <ul className="flex w-full flex-col gap-1 text-sm">
      {files.map((a) => (
        <li key={a.id} className="flex items-center gap-2">
          {downloadBase ? (
            <a href={`${downloadBase}/${a.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {a.fileName}
            </a>
          ) : (
            <span>{a.fileName}</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`Remove ${a.fileName}`}
            onClick={() => {
              if (window.confirm(`Remove ${a.fileName}? This can't be undone.`)) {
                run(() => onRemove(a.id))
              }
            }}
          >
            Remove
          </Button>
        </li>
      ))}
      {error && (
        <li role="alert" className="text-destructive">
          {error}
        </li>
      )}
    </ul>
  )
}
