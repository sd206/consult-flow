
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
            "has_role":
{ Args: { "p_firm": string,"p_roles": (Database["public"]['Enums']["firm_role"])[] }; Returns: boolean
                           },
"is_member":
{ Args: { "p_firm": string }; Returns: boolean
                           },
"is_platform_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"platform_list_firms":
{ Args: Record<PropertyKey, never>; Returns: {
              "admin_emails": (string)[],"created_at": string,"id": string,"name": string
            }[]
                           }
          }
          Enums: {
            "consultant_type": "employee"|"independent"|"vendor","firm_role": "admin"|"manager"|"consultant"
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
            "consultant_type": ["employee", "independent", "vendor"],"firm_role": ["admin", "manager", "consultant"]
          }
        }
} as const
