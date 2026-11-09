import type { Database } from '@/lib/supabase/types'

export type { Database }
export type FirmRole = Database['public']['Enums']['firm_role']
export type ConsultantType = Database['public']['Enums']['consultant_type']
export type ProjectStatus = Database['public']['Enums']['project_status']
export type TimesheetStatus = Database['public']['Enums']['timesheet_status']
export type InvoiceStatus = Database['public']['Enums']['invoice_status']
export type InvoiceLayout = Database['public']['Enums']['invoice_layout']
export type InvoiceLineKind = Database['public']['Enums']['invoice_line_kind']
export type InvoiceDiscountType = Database['public']['Enums']['invoice_discount_type']
export type PaymentMethod = Database['public']['Enums']['payment_method']
