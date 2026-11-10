
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "attachments": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expense_id": string | null,"file_name": string,"firm_id": string,"id": string,"mime_type": string,"payment_id": string | null,"size_bytes": number,"storage_path": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expense_id"?: string | null,"file_name": string,"firm_id": string,"id"?: string,"mime_type": string,"payment_id"?: string | null,"size_bytes": number,"storage_path": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expense_id"?: string | null,"file_name"?: string,"firm_id"?: string,"id"?: string,"mime_type"?: string,"payment_id"?: string | null,"size_bytes"?: number,"storage_path"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_expense_fk"
      columns: ["firm_id","expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "attachments_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_payment_fk"
      columns: ["firm_id","payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"after": Json | null,"at": string,"before": Json | null,"entity_id": string,"entity_type": string,"firm_id": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity_id": string,"entity_type": string,"firm_id": string,"id"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity_id"?: string,"entity_type"?: string,"firm_id"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "active": boolean,"billing_address": string | null,"billing_contact_name": string | null,"billing_email": string | null,"billing_phone": string | null,"created_at": string,"created_by": string | null,"firm_id": string,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"billing_address"?: string | null,"billing_contact_name"?: string | null,"billing_email"?: string | null,"billing_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"firm_id": string,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"billing_address"?: string | null,"billing_contact_name"?: string | null,"billing_email"?: string | null,"billing_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"firm_id"?: string,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"consultant_cost_rates": {
                  Row: {
                    "consultant_id": string,"created_at": string,"created_by": string | null,"effective_from": string,"firm_id": string,"hourly_cost": number,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consultant_id": string,"created_at"?: string,"created_by"?: string | null,"effective_from": string,"firm_id": string,"hourly_cost": number,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "consultant_id"?: string,"created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"firm_id"?: string,"hourly_cost"?: number,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consultant_cost_rates_consultant_fk"
      columns: ["firm_id","consultant_id"]
isOneToOne: false
      referencedRelation: "consultants"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "consultant_cost_rates_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"consultants": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"email": string,"firm_id": string,"id": string,"name": string,"type": Database["public"]['Enums']["consultant_type"],"updated_at": string,"user_id": string | null,"vendor_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"email": string,"firm_id": string,"id"?: string,"name": string,"type": Database["public"]['Enums']["consultant_type"],"updated_at"?: string,"user_id"?: string | null,"vendor_id"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"email"?: string,"firm_id"?: string,"id"?: string,"name"?: string,"type"?: Database["public"]['Enums']["consultant_type"],"updated_at"?: string,"user_id"?: string | null,"vendor_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "consultants_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consultants_member_fk"
      columns: ["firm_id","user_id"]
isOneToOne: false
      referencedRelation: "firm_members"
      referencedColumns: ["firm_id","user_id"]
    },{
      foreignKeyName: "consultants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "consultants_vendor_fk"
      columns: ["firm_id","vendor_id"]
isOneToOne: false
      referencedRelation: "vendors"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"expense_categories": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"firm_id": string,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"firm_id": string,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"firm_id"?: string,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_categories_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount": number,"category_id": string,"client_id": string | null,"created_at": string,"created_by": string | null,"firm_id": string,"id": string,"notes": string | null,"payee": string,"project_id": string | null,"spent_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"category_id": string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"firm_id": string,"id"?: string,"notes"?: string | null,"payee": string,"project_id"?: string | null,"spent_on": string,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"category_id"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"firm_id"?: string,"id"?: string,"notes"?: string | null,"payee"?: string,"project_id"?: string | null,"spent_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_category_fk"
      columns: ["firm_id","category_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "expenses_client_fk"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "expenses_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_project_fk"
      columns: ["firm_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"firm_members": {
                  Row: {
                    "created_at": string,"created_by": string | null,"firm_id": string,"id": string,"role": Database["public"]['Enums']["firm_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"firm_id": string,"id"?: string,"role": Database["public"]['Enums']["firm_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"firm_id"?: string,"id"?: string,"role"?: Database["public"]['Enums']["firm_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "firm_members_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "firm_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"firms": {
                  Row: {
                    "address": string | null,"contact_email": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"currency": string,"default_payment_terms_days": number,"default_tax_percent": number,"id": string,"invoice_next_seq": number,"invoice_number_pattern": string,"logo_path": string | null,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"default_payment_terms_days"?: number,"default_tax_percent"?: number,"id"?: string,"invoice_next_seq"?: number,"invoice_number_pattern"?: string,"logo_path"?: string | null,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"default_payment_terms_days"?: number,"default_tax_percent"?: number,"id"?: string,"invoice_next_seq"?: number,"invoice_number_pattern"?: string,"logo_path"?: string | null,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"invoice_lines": {
                  Row: {
                    "amount": number,"consultant_id": string | null,"created_at": string,"created_by": string | null,"description": string,"firm_id": string,"id": string,"invoice_id": string,"kind": Database["public"]['Enums']["invoice_line_kind"],"project_id": string | null,"quantity": number,"sort_order": number,"unit_price": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"consultant_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description": string,"firm_id": string,"id"?: string,"invoice_id": string,"kind": Database["public"]['Enums']["invoice_line_kind"],"project_id"?: string | null,"quantity": number,"sort_order"?: number,"unit_price": number,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"consultant_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"firm_id"?: string,"id"?: string,"invoice_id"?: string,"kind"?: Database["public"]['Enums']["invoice_line_kind"],"project_id"?: string | null,"quantity"?: number,"sort_order"?: number,"unit_price"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_lines_consultant_fk"
      columns: ["firm_id","consultant_id"]
isOneToOne: false
      referencedRelation: "consultants"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "invoice_lines_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_lines_invoice_fk"
      columns: ["firm_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "invoice_lines_project_fk"
      columns: ["firm_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"invoice_templates": {
                  Row: {
                    "base_layout": Database["public"]['Enums']["invoice_layout"],"created_at": string,"created_by": string | null,"firm_id": string,"id": string,"is_default": boolean,"name": string,"options": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_layout"?: Database["public"]['Enums']["invoice_layout"],"created_at"?: string,"created_by"?: string | null,"firm_id": string,"id"?: string,"is_default"?: boolean,"name": string,"options"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "base_layout"?: Database["public"]['Enums']["invoice_layout"],"created_at"?: string,"created_by"?: string | null,"firm_id"?: string,"id"?: string,"is_default"?: boolean,"name"?: string,"options"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_templates_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "amount_paid": number,"bill_to_address": string | null,"bill_to_contact_name": string | null,"bill_to_email": string | null,"bill_to_name": string | null,"bill_to_phone": string | null,"client_id": string,"consultant_filter": (string)[] | null,"created_at": string,"created_by": string | null,"currency": string,"discount_amount": number,"discount_label": string | null,"discount_type": Database["public"]['Enums']["invoice_discount_type"],"discount_value": number,"due_date": string,"firm_id": string,"from_address": string | null,"from_contact_email": string | null,"from_contact_name": string | null,"from_contact_phone": string | null,"from_logo_path": string | null,"from_name": string | null,"id": string,"issue_date": string,"issued_at": string | null,"issued_by": string | null,"number": string | null,"pdf_path": string | null,"period_end": string,"period_start": string,"status": Database["public"]['Enums']["invoice_status"],"subject": string | null,"subtotal": number,"tax_amount": number,"tax_percent": number,"template_id": string,"total": number,"updated_at": string,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_paid"?: number,"bill_to_address"?: string | null,"bill_to_contact_name"?: string | null,"bill_to_email"?: string | null,"bill_to_name"?: string | null,"bill_to_phone"?: string | null,"client_id": string,"consultant_filter"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"currency": string,"discount_amount"?: number,"discount_label"?: string | null,"discount_type"?: Database["public"]['Enums']["invoice_discount_type"],"discount_value"?: number,"due_date": string,"firm_id": string,"from_address"?: string | null,"from_contact_email"?: string | null,"from_contact_name"?: string | null,"from_contact_phone"?: string | null,"from_logo_path"?: string | null,"from_name"?: string | null,"id"?: string,"issue_date": string,"issued_at"?: string | null,"issued_by"?: string | null,"number"?: string | null,"pdf_path"?: string | null,"period_end": string,"period_start": string,"status"?: Database["public"]['Enums']["invoice_status"],"subject"?: string | null,"subtotal"?: number,"tax_amount"?: number,"tax_percent"?: number,"template_id": string,"total"?: number,"updated_at"?: string,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_paid"?: number,"bill_to_address"?: string | null,"bill_to_contact_name"?: string | null,"bill_to_email"?: string | null,"bill_to_name"?: string | null,"bill_to_phone"?: string | null,"client_id"?: string,"consultant_filter"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"discount_amount"?: number,"discount_label"?: string | null,"discount_type"?: Database["public"]['Enums']["invoice_discount_type"],"discount_value"?: number,"due_date"?: string,"firm_id"?: string,"from_address"?: string | null,"from_contact_email"?: string | null,"from_contact_name"?: string | null,"from_contact_phone"?: string | null,"from_logo_path"?: string | null,"from_name"?: string | null,"id"?: string,"issue_date"?: string,"issued_at"?: string | null,"issued_by"?: string | null,"number"?: string | null,"pdf_path"?: string | null,"period_end"?: string,"period_start"?: string,"status"?: Database["public"]['Enums']["invoice_status"],"subject"?: string | null,"subtotal"?: number,"tax_amount"?: number,"tax_percent"?: number,"template_id"?: string,"total"?: number,"updated_at"?: string,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_client_fk"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "invoices_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_issued_by_fkey"
      columns: ["issued_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "invoices_template_fk"
      columns: ["firm_id","template_id"]
isOneToOne: false
      referencedRelation: "invoice_templates"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "invoices_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"firm_id": string,"id": string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"],"notes": string | null,"paid_on": string,"reference": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"firm_id": string,"id"?: string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"],"notes"?: string | null,"paid_on": string,"reference"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"firm_id"?: string,"id"?: string,"invoice_id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"notes"?: string | null,"paid_on"?: string,"reference"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_invoice_fk"
      columns: ["firm_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"email": string,"is_platform_owner": boolean,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"email": string,"is_platform_owner"?: boolean,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"email"?: string,"is_platform_owner"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"project_assignments": {
                  Row: {
                    "client_rate": number,"consultant_id": string,"created_at": string,"created_by": string | null,"effective_from": string,"effective_to": string | null,"firm_id": string,"id": string,"project_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_rate": number,"consultant_id": string,"created_at"?: string,"created_by"?: string | null,"effective_from": string,"effective_to"?: string | null,"firm_id": string,"id"?: string,"project_id": string,"updated_at"?: string
                  }
                  Update: {
                    "client_rate"?: number,"consultant_id"?: string,"created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"effective_to"?: string | null,"firm_id"?: string,"id"?: string,"project_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_assignments_consultant_fk"
      columns: ["firm_id","consultant_id"]
isOneToOne: false
      referencedRelation: "consultants"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "project_assignments_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_assignments_project_fk"
      columns: ["firm_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "client_id": string,"code": string | null,"created_at": string,"created_by": string | null,"end_date": string | null,"firm_id": string,"id": string,"name": string,"start_date": string | null,"status": Database["public"]['Enums']["project_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"code"?: string | null,"created_at"?: string,"created_by"?: string | null,"end_date"?: string | null,"firm_id": string,"id"?: string,"name": string,"start_date"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string
                  }
                  Update: {
                    "client_id"?: string,"code"?: string | null,"created_at"?: string,"created_by"?: string | null,"end_date"?: string | null,"firm_id"?: string,"id"?: string,"name"?: string,"start_date"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_client_fk"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "projects_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"time_entries": {
                  Row: {
                    "client_rate_snapshot": number | null,"cost_rate_snapshot": number | null,"created_at": string,"created_by": string | null,"firm_id": string,"hours": number,"id": string,"invoice_line_id": string | null,"note": string | null,"project_id": string,"timesheet_id": string,"updated_at": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_rate_snapshot"?: number | null,"cost_rate_snapshot"?: number | null,"created_at"?: string,"created_by"?: string | null,"firm_id": string,"hours": number,"id"?: string,"invoice_line_id"?: string | null,"note"?: string | null,"project_id": string,"timesheet_id": string,"updated_at"?: string,"work_date": string
                  }
                  Update: {
                    "client_rate_snapshot"?: number | null,"cost_rate_snapshot"?: number | null,"created_at"?: string,"created_by"?: string | null,"firm_id"?: string,"hours"?: number,"id"?: string,"invoice_line_id"?: string | null,"note"?: string | null,"project_id"?: string,"timesheet_id"?: string,"updated_at"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_entries_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_entries_invoice_line_fk"
      columns: ["firm_id","invoice_line_id"]
isOneToOne: false
      referencedRelation: "invoice_lines"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "time_entries_project_fk"
      columns: ["firm_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "time_entries_timesheet_fk"
      columns: ["firm_id","timesheet_id"]
isOneToOne: false
      referencedRelation: "timesheets"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"timesheets": {
                  Row: {
                    "consultant_id": string,"created_at": string,"created_by": string | null,"decided_at": string | null,"decided_by": string | null,"decision_comment": string | null,"firm_id": string,"id": string,"status": Database["public"]['Enums']["timesheet_status"],"submitted_at": string | null,"updated_at": string,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consultant_id": string,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_comment"?: string | null,"firm_id": string,"id"?: string,"status"?: Database["public"]['Enums']["timesheet_status"],"submitted_at"?: string | null,"updated_at"?: string,"week_start": string
                  }
                  Update: {
                    "consultant_id"?: string,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_comment"?: string | null,"firm_id"?: string,"id"?: string,"status"?: Database["public"]['Enums']["timesheet_status"],"submitted_at"?: string | null,"updated_at"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "timesheets_consultant_fk"
      columns: ["firm_id","consultant_id"]
isOneToOne: false
      referencedRelation: "consultants"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "timesheets_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "timesheets_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"vendors": {
                  Row: {
                    "address": string | null,"contact_name": string | null,"created_at": string,"created_by": string | null,"email": string | null,"firm_id": string,"id": string,"name": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"contact_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"firm_id": string,"id"?: string,"name": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"contact_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"firm_id"?: string,"id"?: string,"name"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vendors_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_expense_attachment":
{ Args: { "p_expense": string,"p_file_name": string,"p_mime": string,"p_size": number,"p_storage_path": string }; Returns: string
                           },
"add_firm_member":
{ Args: { "p_firm": string,"p_role": Database["public"]['Enums']["firm_role"],"p_user": string }; Returns: string
                           },
"add_payment_attachment":
{ Args: { "p_file_name": string,"p_mime": string,"p_payment": string,"p_size": number,"p_storage_path": string }; Returns: string
                           },
"approve_timesheet":
{ Args: { "p_timesheet": string }; Returns: undefined
                           },
"can_edit_consultant_time":
{ Args: { "p_consultant": string,"p_firm": string }; Returns: boolean
                           },
"change_client_rate":
{ Args: { "p_assignment": string,"p_from": string,"p_rate": number }; Returns: string
                           },
"create_firm_with_admin":
{ Args: { "p_admin": string,"p_name": string }; Returns: string
                           },
"create_invoice_draft":
{ Args: { "p_client": string,"p_consultants": (string)[],"p_end": string,"p_firm": string,"p_start": string,"p_template": string }; Returns: string
                           },
"delete_attachment":
{ Args: { "p_attachment": string }; Returns: string
                           },
"delete_invoice_draft":
{ Args: { "p_invoice": string }; Returns: undefined
                           },
"delete_manual_line":
{ Args: { "p_line": string }; Returns: undefined
                           },
"delete_payment":
{ Args: { "p_payment": string }; Returns: string[]
                           },
"expense_totals":
{ Args: { "p_category": string,"p_client": string,"p_firm": string,"p_from": string,"p_missing_receipt": boolean,"p_project": string,"p_to": string }; Returns: {
              "expense_count": number,"total": string
            }[]
                           },
"format_invoice_number":
{ Args: { "p_issue": string,"p_pattern": string,"p_seq": number }; Returns: string
                           },
"has_role":
{ Args: { "p_firm": string,"p_roles": (Database["public"]['Enums']["firm_role"])[] }; Returns: boolean
                           },
"invoice_apply_payments":
{ Args: { "p_invoice": string }; Returns: undefined
                           },
"invoice_candidates":
{ Args: { "p_client": string,"p_end": string,"p_firm": string,"p_start": string }; Returns: {
              "consultant_id": string,"consultant_name": string,"entry_count": number,"hours": string,"project_id": string,"project_name": string,"rate": string
            }[]
                           },
"invoice_generate_time_lines":
{ Args: { "p_consultants": (string)[],"p_invoice": string }; Returns: undefined
                           },
"invoice_lock_draft":
{ Args: { "p_invoice": string }; Returns: {
              "amount_paid": number,
"bill_to_address": string | null,
"bill_to_contact_name": string | null,
"bill_to_email": string | null,
"bill_to_name": string | null,
"bill_to_phone": string | null,
"client_id": string,
"consultant_filter": (string)[] | null,
"created_at": string,
"created_by": string | null,
"currency": string,
"discount_amount": number,
"discount_label": string | null,
"discount_type": Database["public"]['Enums']["invoice_discount_type"],
"discount_value": number,
"due_date": string,
"firm_id": string,
"from_address": string | null,
"from_contact_email": string | null,
"from_contact_name": string | null,
"from_contact_phone": string | null,
"from_logo_path": string | null,
"from_name": string | null,
"id": string,
"issue_date": string,
"issued_at": string | null,
"issued_by": string | null,
"number": string | null,
"pdf_path": string | null,
"period_end": string,
"period_start": string,
"status": Database["public"]['Enums']["invoice_status"],
"subject": string | null,
"subtotal": number,
"tax_amount": number,
"tax_percent": number,
"template_id": string,
"total": number,
"updated_at": string,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "invoices"
        isOneToOne: true
        isSetofReturn: false
      } },
"invoice_recalc":
{ Args: { "p_invoice": string }; Returns: undefined
                           },
"invoice_time_groups":
{ Args: { "p_client": string,"p_consultants": (string)[],"p_end": string,"p_firm": string,"p_start": string }; Returns: {
              "consultant_id": string,"consultant_name": string,"entry_count": number,"hours": number,"notes": string,"project_id": string,"project_name": string,"rate": number
            }[]
                           },
"is_member":
{ Args: { "p_firm": string }; Returns: boolean
                           },
"is_platform_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"issue_invoice":
{ Args: { "p_invoice": string }; Returns: string
                           },
"list_expenses":
{ Args: { "p_category": string,"p_client": string,"p_firm": string,"p_from": string,"p_limit": number,"p_missing_receipt": boolean,"p_offset": number,"p_project": string,"p_to": string }; Returns: {
              "amount": string,"category_id": string,"category_name": string,"client_id": string,"client_name": string,"id": string,"payee": string,"project_id": string,"project_name": string,"receipt_count": number,"spent_on": string
            }[]
                           },
"my_assignments":
{ Args: { "p_firm": string }; Returns: {
              "assignment_id": string,"client_name": string,"effective_from": string,"effective_to": string,"project_code": string,"project_id": string,"project_name": string
            }[]
                           },
"outstanding_summary":
{ Args: { "p_firm": string }; Returns: {
              "outstanding": string,"overdue": string,"overdue_count": number
            }[]
                           },
"payment_lock":
{ Args: { "p_missing": string,"p_payment": string }; Returns: {
              "amount": number,
"created_at": string,
"created_by": string | null,
"firm_id": string,
"id": string,
"invoice_id": string,
"method": Database["public"]['Enums']["payment_method"],
"notes": string | null,
"paid_on": string,
"reference": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"platform_list_firms":
{ Args: Record<PropertyKey, never>; Returns: {
              "admin_emails": (string)[],"created_at": string,"id": string,"name": string
            }[]
                           },
"pnl_facts":
{ Args: { "p_firm": string,"p_from": string,"p_to": string }; Returns: {
              "amount": number,"client_id": string,"fact_date": string,"measure": string,"project_id": string
            }[]
                           },
"pnl_report":
{ Args: { "p_clients": (string)[],"p_firm": string,"p_from": string,"p_group": string,"p_projects": (string)[],"p_to": string }; Returns: {
              "collected": string,"direct_expenses": string,"discounts": string,"fees": string,"gross": string,"group_key": string,"invoiced": string,"label": string,"labour": string,"margin": string,"net": string,"overhead": string,"revenue": string,"revenue_hours": string,"row_kind": string,"sort_key": string
            }[]
                           },
"record_payment":
{ Args: { "p_amount": number,"p_invoice": string,"p_method": Database["public"]['Enums']["payment_method"],"p_notes": string,"p_paid_on": string,"p_reference": string }; Returns: string
                           },
"regenerate_invoice_lines":
{ Args: { "p_consultants": (string)[],"p_invoice": string }; Returns: undefined
                           },
"reject_timesheet":
{ Args: { "p_comment": string,"p_timesheet": string }; Returns: undefined
                           },
"reopen_timesheet":
{ Args: { "p_timesheet": string }; Returns: undefined
                           },
"save_manual_line":
{ Args: { "p_description": string,"p_invoice": string,"p_line": string,"p_quantity": number,"p_unit_price": number }; Returns: string
                           },
"save_timesheet_week":
{ Args: { "p_consultant": string,"p_entries": Json,"p_firm": string,"p_week_start": string }; Returns: string
                           },
"set_default_template":
{ Args: { "p_template": string }; Returns: undefined
                           },
"set_invoice_discount":
{ Args: { "p_invoice": string,"p_label": string,"p_type": Database["public"]['Enums']["invoice_discount_type"],"p_value": number }; Returns: undefined
                           },
"set_invoice_line_description":
{ Args: { "p_description": string,"p_line": string }; Returns: undefined
                           },
"set_invoice_pdf":
{ Args: { "p_invoice": string,"p_path": string }; Returns: undefined
                           },
"storage_firm_id":
{ Args: { "p_name": string }; Returns: string
                           },
"submit_timesheet":
{ Args: { "p_timesheet": string }; Returns: undefined
                           },
"timesheet_entries":
{ Args: { "p_timesheet": string }; Returns: {
              "hours": string,"id": string,"note": string,"project_id": string,"work_date": string
            }[]
                           },
"timesheet_projects":
{ Args: { "p_timesheet": string }; Returns: {
              "client_name": string,"project_code": string,"project_id": string,"project_name": string
            }[]
                           },
"timesheet_totals":
{ Args: { "p_firm": string,"p_ids": (string)[] }; Returns: {
              "timesheet_id": string,"total_hours": string
            }[]
                           },
"unpaid_ageing":
{ Args: { "p_client": string,"p_firm": string }; Returns: {
              "balance_due": string,"bucket": string,"invoice_count": number
            }[]
                           },
"unpaid_invoices":
{ Args: { "p_client": string,"p_firm": string }; Returns: {
              "amount_paid": string,"balance_due": string,"client_id": string,"client_name": string,"days_overdue": number,"due_date": string,"invoice_id": string,"issue_date": string,"number": string,"total": string
            }[]
                           },
"update_invoice_draft":
{ Args: { "p_due_date": string,"p_invoice": string,"p_issue_date": string,"p_subject": string,"p_tax_percent": number,"p_template": string }; Returns: undefined
                           },
"update_invoice_period":
{ Args: { "p_consultants": (string)[],"p_end": string,"p_invoice": string,"p_start": string }; Returns: undefined
                           },
"update_payment_details":
{ Args: { "p_method": Database["public"]['Enums']["payment_method"],"p_notes": string,"p_paid_on": string,"p_payment": string,"p_reference": string }; Returns: undefined
                           },
"void_invoice":
{ Args: { "p_invoice": string }; Returns: undefined
                           },
"week_projects":
{ Args: { "p_consultant": string,"p_firm": string,"p_week_start": string }; Returns: {
              "assignment_id": string,"client_name": string,"effective_from": string,"effective_to": string,"project_code": string,"project_id": string,"project_name": string
            }[]
                           }
          }
          Enums: {
            "consultant_type": "employee"|"independent"|"vendor","firm_role": "admin"|"manager"|"consultant","invoice_discount_type": "none"|"percent"|"amount","invoice_layout": "classic"|"modern"|"compact","invoice_line_kind": "time"|"manual","invoice_status": "draft"|"issued"|"partly_paid"|"paid"|"void","payment_method": "bank_transfer"|"check"|"card"|"cash"|"other","project_status": "active"|"on_hold"|"closed","timesheet_status": "draft"|"submitted"|"approved"|"rejected"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "consultant_type": ["employee", "independent", "vendor"],"firm_role": ["admin", "manager", "consultant"],"invoice_discount_type": ["none", "percent", "amount"],"invoice_layout": ["classic", "modern", "compact"],"invoice_line_kind": ["time", "manual"],"invoice_status": ["draft", "issued", "partly_paid", "paid", "void"],"payment_method": ["bank_transfer", "check", "card", "cash", "other"],"project_status": ["active", "on_hold", "closed"],"timesheet_status": ["draft", "submitted", "approved", "rejected"]
          }
        }
} as const
