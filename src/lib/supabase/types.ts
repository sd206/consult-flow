
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
            "audit_log": {
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
            "change_client_rate":
{ Args: { "p_assignment": string,"p_from": string,"p_rate": number }; Returns: string
                           },
"create_firm_with_admin":
{ Args: { "p_admin": string,"p_name": string }; Returns: string
                           },
"has_role":
{ Args: { "p_firm": string,"p_roles": (Database["public"]['Enums']["firm_role"])[] }; Returns: boolean
                           },
"is_member":
{ Args: { "p_firm": string }; Returns: boolean
                           },
"is_platform_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"my_assignments":
{ Args: { "p_firm": string }; Returns: {
              "assignment_id": string,"client_name": string,"effective_from": string,"effective_to": string,"project_code": string,"project_id": string,"project_name": string
            }[]
                           },
"platform_list_firms":
{ Args: Record<PropertyKey, never>; Returns: {
              "admin_emails": (string)[],"created_at": string,"id": string,"name": string
            }[]
                           },
"storage_firm_id":
{ Args: { "p_name": string }; Returns: string
                           }
          }
          Enums: {
            "consultant_type": "employee"|"independent"|"vendor","firm_role": "admin"|"manager"|"consultant","project_status": "active"|"on_hold"|"closed"
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
            "consultant_type": ["employee", "independent", "vendor"],"firm_role": ["admin", "manager", "consultant"],"project_status": ["active", "on_hold", "closed"]
          }
        }
} as const
