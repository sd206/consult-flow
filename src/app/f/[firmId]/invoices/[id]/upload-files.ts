import { displayFileName } from '@/lib/domain/attachments'
import { createBrowserDb } from '@/lib/supabase/browser'
import { createUploadTargetsAction, finalizeUploadsAction } from '@/modules/payments/actions'

/** Chosen files only: browsers send one empty, nameless File when nothing was picked. */
export function takeFiles(formData: FormData): File[] {
  const files = formData
    .getAll('files')
    .filter((v): v is File => typeof v !== 'string')
    .filter((f) => !(f.size === 0 && f.name === ''))
  // File bytes never go through a server action; they go straight to storage.
  formData.delete('files')
  return files
}

/**
 * Sends the files straight to storage with signed upload targets, then has the server check
 * and attach them. Returns the names of the files that were not attached; never throws.
 */
export async function uploadPaymentFiles(
  firmId: string,
  invoiceId: string,
  paymentId: string,
  files: File[],
): Promise<string[]> {
  if (files.length === 0) return []
  const all = files.map((f) => displayFileName(f.name))
  try {
    const declared = files.map((f) => ({ name: f.name, size: f.size }))
    const t = await createUploadTargetsAction(firmId, invoiceId, paymentId, declared)
    if (!t.ok) return all
    const failed = t.data.rejected.map((r) => r.name)
    const storage = createBrowserDb().storage.from('firm-files')
    const items: { uploadPath: string; name: string }[] = []
    for (const target of t.data.targets) {
      const file = files[target.index]
      const up = await storage.uploadToSignedUrl(target.uploadPath, target.token, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (up.error) failed.push(displayFileName(file.name))
      else items.push({ uploadPath: target.uploadPath, name: file.name })
    }
    if (items.length === 0) return failed
    const fin = await finalizeUploadsAction(firmId, invoiceId, paymentId, items)
    if (!fin.ok) return [...failed, ...items.map((i) => displayFileName(i.name))]
    return [...failed, ...fin.data.rejected.map((r) => r.name)]
  } catch (e) {
    console.error('payment file upload failed', e)
    return all
  }
}
