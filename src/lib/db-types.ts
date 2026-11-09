import type { Database } from '@/lib/supabase/types'

export type { Database }
export type FirmRole = Database['public']['Enums']['firm_role']
export type ConsultantType = Database['public']['Enums']['consultant_type']
