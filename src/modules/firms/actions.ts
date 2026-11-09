'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/context'
import { fail, type Result } from '@/lib/result'
import { createAdminDb } from '@/lib/supabase/admin'
import { createFirmWithAdmin } from './data'
import { createFirmSchema } from './schemas'

export async function createFirmAction(formData: FormData): Promise<Result<{ firmId: string }>> {
  const { isPlatformOwner } = await requireUser()
  if (!isPlatformOwner) return fail("You don't have permission to do that.")

  const parsed = createFirmSchema.safeParse({
    name: formData.get('name'),
    adminEmail: formData.get('adminEmail'),
  })
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form and try again.')

  const result = await createFirmWithAdmin(
    createAdminDb(),
    parsed.data,
    `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  )
  if (result.ok) revalidatePath('/platform/firms')
  return result
}
