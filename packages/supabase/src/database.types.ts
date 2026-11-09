
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
            "accounts": {
                  Row: {
                    "created_at": string | null,"created_by": string | null,"email": string | null,"id": string,"is_personal_account": boolean,"name": string,"picture_url": string | null,"primary_owner_user_id": string,"public_data": NonNullable<Json>,"slug": string | null,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"created_by"?: string | null,"email"?: string | null,"id"?: string,"is_personal_account"?: boolean,"name": string,"picture_url"?: string | null,"primary_owner_user_id"?: string,"public_data"?: NonNullable<Json>,"slug"?: string | null,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"created_by"?: string | null,"email"?: string | null,"id"?: string,"is_personal_account"?: boolean,"name"?: string,"picture_url"?: string | null,"primary_owner_user_id"?: string,"public_data"?: NonNullable<Json>,"slug"?: string | null,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"accounts_memberships": {
                  Row: {
                    "account_id": string,"account_role": string,"created_at": string,"created_by": string | null,"updated_at": string,"updated_by": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"account_role": string,"created_at"?: string,"created_by"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "account_id"?: string,"account_role"?: string,"created_at"?: string,"created_by"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounts_memberships_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounts_memberships_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounts_memberships_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounts_memberships_account_role_fkey"
      columns: ["account_role"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["name"]
    }
                  ]
                },"billing_customers": {
                  Row: {
                    "account_id": string,"customer_id": string,"email": string | null,"id": number,"provider": Database["public"]['Enums']["billing_provider"]
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"customer_id": string,"email"?: string | null,"id"?: number,"provider": Database["public"]['Enums']["billing_provider"]
                  }
                  Update: {
                    "account_id"?: string,"customer_id"?: string,"email"?: string | null,"id"?: number,"provider"?: Database["public"]['Enums']["billing_provider"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_customers_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "billing_customers_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "billing_customers_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"config": {
                  Row: {
                    "billing_provider": Database["public"]['Enums']["billing_provider"],"enable_account_billing": boolean,"enable_team_account_billing": boolean,"enable_team_accounts": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_provider"?: Database["public"]['Enums']["billing_provider"],"enable_account_billing"?: boolean,"enable_team_account_billing"?: boolean,"enable_team_accounts"?: boolean
                  }
                  Update: {
                    "billing_provider"?: Database["public"]['Enums']["billing_provider"],"enable_account_billing"?: boolean,"enable_team_account_billing"?: boolean,"enable_team_accounts"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"invitations": {
                  Row: {
                    "account_id": string,"created_at": string,"email": string,"expires_at": string,"id": number,"invite_token": string,"invited_by": string,"role": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: number,"invite_token": string,"invited_by": string,"role": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: number,"invite_token"?: string,"invited_by"?: string,"role"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_role_fkey"
      columns: ["role"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["name"]
    }
                  ]
                },"lm_account_credits": {
                  Row: {
                    "account_id": string,"created_at": string,"discovery_balance": number,"next_refill_at": string | null,"outreach_balance": number,"period_ends_at": string | null,"plan_id": string | null,"proxy_bytes_period": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"discovery_balance"?: number,"next_refill_at"?: string | null,"outreach_balance"?: number,"period_ends_at"?: string | null,"plan_id"?: string | null,"proxy_bytes_period"?: number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"discovery_balance"?: number,"next_refill_at"?: string | null,"outreach_balance"?: number,"period_ends_at"?: string | null,"plan_id"?: string | null,"proxy_bytes_period"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_account_credits_account_id_fkey"
      columns: ["account_id"]
isOneToOne: true
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_account_credits_account_id_fkey"
      columns: ["account_id"]
isOneToOne: true
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_account_credits_account_id_fkey"
      columns: ["account_id"]
isOneToOne: true
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_account_credits_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "lm_plans"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_attempts": {
                  Row: {
                    "account_id": string,"autopilot_id": string | null,"body": string | null,"campaign_id": string,"created_at": string,"created_by": string | null,"detail": string | null,"extra": NonNullable<Json>,"filled": NonNullable<Json>,"form_url": string | null,"id": string,"missing": NonNullable<Json>,"prospect_id": string,"protection_type": string | null,"screenshot_after": string | null,"screenshot_before": string | null,"sent_at": string | null,"space_id": string,"status": Database["public"]['Enums']["lm_attempt_status"],"subject": string | null,"template_name": string | null,"template_used": string | null,"updated_at": string,"updated_by": string | null,"validated_at": string | null,"validated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"autopilot_id"?: string | null,"body"?: string | null,"campaign_id": string,"created_at"?: string,"created_by"?: string | null,"detail"?: string | null,"extra"?: NonNullable<Json>,"filled"?: NonNullable<Json>,"form_url"?: string | null,"id"?: string,"missing"?: NonNullable<Json>,"prospect_id": string,"protection_type"?: string | null,"screenshot_after"?: string | null,"screenshot_before"?: string | null,"sent_at"?: string | null,"space_id": string,"status"?: Database["public"]['Enums']["lm_attempt_status"],"subject"?: string | null,"template_name"?: string | null,"template_used"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"validated_at"?: string | null,"validated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"autopilot_id"?: string | null,"body"?: string | null,"campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"detail"?: string | null,"extra"?: NonNullable<Json>,"filled"?: NonNullable<Json>,"form_url"?: string | null,"id"?: string,"missing"?: NonNullable<Json>,"prospect_id"?: string,"protection_type"?: string | null,"screenshot_after"?: string | null,"screenshot_before"?: string | null,"sent_at"?: string | null,"space_id"?: string,"status"?: Database["public"]['Enums']["lm_attempt_status"],"subject"?: string | null,"template_name"?: string | null,"template_used"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"validated_at"?: string | null,"validated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_attempts_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_attempts_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_attempts_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_attempts_autopilot_id_fkey"
      columns: ["autopilot_id"]
isOneToOne: false
      referencedRelation: "lm_autopilots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_attempts_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_attempts_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "lm_prospects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_attempts_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "lm_spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_autopilots": {
                  Row: {
                    "account_id": string,"campaign_id": string,"created_at": string,"created_by": string | null,"cursor_created_at": string | null,"cursor_prospect_id": string | null,"finished_at": string | null,"finished_reason": string | null,"id": string,"messages": (string)[],"schedule": Database["public"]['Enums']["lm_autopilot_schedule"],"space_id": string,"spread_days": number,"status": Database["public"]['Enums']["lm_autopilot_status"],"target": number,"ticked_at": string | null,"timezone": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"campaign_id": string,"created_at"?: string,"created_by"?: string | null,"cursor_created_at"?: string | null,"cursor_prospect_id"?: string | null,"finished_at"?: string | null,"finished_reason"?: string | null,"id"?: string,"messages": (string)[],"schedule"?: Database["public"]['Enums']["lm_autopilot_schedule"],"space_id": string,"spread_days"?: number,"status"?: Database["public"]['Enums']["lm_autopilot_status"],"target": number,"ticked_at"?: string | null,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"cursor_created_at"?: string | null,"cursor_prospect_id"?: string | null,"finished_at"?: string | null,"finished_reason"?: string | null,"id"?: string,"messages"?: (string)[],"schedule"?: Database["public"]['Enums']["lm_autopilot_schedule"],"space_id"?: string,"spread_days"?: number,"status"?: Database["public"]['Enums']["lm_autopilot_status"],"target"?: number,"ticked_at"?: string | null,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_autopilots_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_autopilots_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_autopilots_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_autopilots_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_autopilots_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "lm_spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_campaign_categories": {
                  Row: {
                    "abandoned": boolean,"account_id": string,"campaign_id": string,"cards": number,"cards_new": number,"gcid": string,"in_flight": number,"is_generic": boolean,"kept": number,"next_zone_idx": number,"proxy_bytes": number,"recent_kept": number | null,"removed": boolean,"searches": number
                  }
                  ComputedFields: never
                  Insert: {
                    "abandoned"?: boolean,"account_id": string,"campaign_id": string,"cards"?: number,"cards_new"?: number,"gcid": string,"in_flight"?: number,"is_generic"?: boolean,"kept"?: number,"next_zone_idx"?: number,"proxy_bytes"?: number,"recent_kept"?: number | null,"removed"?: boolean,"searches"?: number
                  }
                  Update: {
                    "abandoned"?: boolean,"account_id"?: string,"campaign_id"?: string,"cards"?: number,"cards_new"?: number,"gcid"?: string,"in_flight"?: number,"is_generic"?: boolean,"kept"?: number,"next_zone_idx"?: number,"proxy_bytes"?: number,"recent_kept"?: number | null,"removed"?: boolean,"searches"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_campaign_categories_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaign_categories_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaign_categories_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaign_categories_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaign_categories_gcid_fkey"
      columns: ["gcid"]
isOneToOne: false
      referencedRelation: "lm_categories"
      referencedColumns: ["gcid"]
    }
                  ]
                },"lm_campaign_zones": {
                  Row: {
                    "account_id": string,"campaign_id": string,"geoname_id": number,"idx": number,"label": string,"latitude": number | null,"longitude": number | null,"population": number,"pos": number,"removed": boolean,"zoom": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"campaign_id": string,"geoname_id": number,"idx": number,"label": string,"latitude"?: number | null,"longitude"?: number | null,"population"?: number,"pos": number,"removed"?: boolean,"zoom"?: number | null
                  }
                  Update: {
                    "account_id"?: string,"campaign_id"?: string,"geoname_id"?: number,"idx"?: number,"label"?: string,"latitude"?: number | null,"longitude"?: number | null,"population"?: number,"pos"?: number,"removed"?: boolean,"zoom"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_campaign_zones_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaign_zones_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaign_zones_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaign_zones_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_campaigns": {
                  Row: {
                    "account_id": string,"auto_validation": boolean,"country_code": string,"created_at": string,"created_by": string | null,"credits_per_prospect": number,"daily_limit": number,"estimate_id": string | null,"filters": NonNullable<Json>,"id": string,"name": string,"price_pending": boolean,"sender_id": string | null,"space_id": string,"status": Database["public"]['Enums']["lm_campaign_status"],"targeting": NonNullable<Json>,"templates": NonNullable<Json>,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"auto_validation"?: boolean,"country_code": string,"created_at"?: string,"created_by"?: string | null,"credits_per_prospect"?: number,"daily_limit"?: number,"estimate_id"?: string | null,"filters"?: NonNullable<Json>,"id"?: string,"name": string,"price_pending"?: boolean,"sender_id"?: string | null,"space_id": string,"status"?: Database["public"]['Enums']["lm_campaign_status"],"targeting"?: NonNullable<Json>,"templates"?: NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"auto_validation"?: boolean,"country_code"?: string,"created_at"?: string,"created_by"?: string | null,"credits_per_prospect"?: number,"daily_limit"?: number,"estimate_id"?: string | null,"filters"?: NonNullable<Json>,"id"?: string,"name"?: string,"price_pending"?: boolean,"sender_id"?: string | null,"space_id"?: string,"status"?: Database["public"]['Enums']["lm_campaign_status"],"targeting"?: NonNullable<Json>,"templates"?: NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_campaigns_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaigns_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaigns_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaigns_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "lm_sender_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_campaigns_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "lm_spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_categories": {
                  Row: {
                    "family": string,"gcid": string,"is_excluded": boolean,"is_generic": boolean,"label_en": string,"label_fr": string,"search_key": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "family": string,"gcid": string,"is_excluded"?: boolean,"is_generic"?: boolean,"label_en": string,"label_fr": string,"search_key"?: never
                  }
                  Update: {
                    "family"?: string,"gcid"?: string,"is_excluded"?: boolean,"is_generic"?: boolean,"label_en"?: string,"label_fr"?: string,"search_key"?: never
                  }
                  Relationships: [
                    
                  ]
                },"lm_country_coverage": {
                  Row: {
                    "country_code": string,"created_at": string,"form_rate": number | null,"languages": (string)[],"last_corpus_at": string | null,"name": string,"tier": Database["public"]['Enums']["lm_coverage_tier"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "country_code": string,"created_at"?: string,"form_rate"?: number | null,"languages"?: (string)[],"last_corpus_at"?: string | null,"name": string,"tier"?: Database["public"]['Enums']["lm_coverage_tier"],"updated_at"?: string
                  }
                  Update: {
                    "country_code"?: string,"created_at"?: string,"form_rate"?: number | null,"languages"?: (string)[],"last_corpus_at"?: string | null,"name"?: string,"tier"?: Database["public"]['Enums']["lm_coverage_tier"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lm_credit_ledger": {
                  Row: {
                    "account_id": string,"campaign_id": string | null,"created_at": string,"delta": number,"event_ref": string,"id": number,"kind": Database["public"]['Enums']["lm_credit_kind"],"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"campaign_id"?: string | null,"created_at"?: string,"delta": number,"event_ref": string,"id"?: never,"kind": Database["public"]['Enums']["lm_credit_kind"],"reason": string
                  }
                  Update: {
                    "account_id"?: string,"campaign_id"?: string | null,"created_at"?: string,"delta"?: number,"event_ref"?: string,"id"?: never,"kind"?: Database["public"]['Enums']["lm_credit_kind"],"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_credit_ledger_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_credit_ledger_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_credit_ledger_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_discovery_settings": {
                  Row: {
                    "abandon_zero_after": number,"chain_min": number,"created_at": string,"credit_tiers": NonNullable<Json>,"default_rate": number,"default_search_mb": number,"explore_share": number,"id": boolean,"max_results": number,"min_rate": number,"min_searches": number,"over_budget_tasks_per_account": number,"prior": number,"recent_weight": number,"tasks_per_campaign": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "abandon_zero_after"?: number,"chain_min"?: number,"created_at"?: string,"credit_tiers"?: NonNullable<Json>,"default_rate"?: number,"default_search_mb"?: number,"explore_share"?: number,"id"?: boolean,"max_results"?: number,"min_rate"?: number,"min_searches"?: number,"over_budget_tasks_per_account"?: number,"prior"?: number,"recent_weight"?: number,"tasks_per_campaign"?: number,"updated_at"?: string
                  }
                  Update: {
                    "abandon_zero_after"?: number,"chain_min"?: number,"created_at"?: string,"credit_tiers"?: NonNullable<Json>,"default_rate"?: number,"default_search_mb"?: number,"explore_share"?: number,"id"?: boolean,"max_results"?: number,"min_rate"?: number,"min_searches"?: number,"over_budget_tasks_per_account"?: number,"prior"?: number,"recent_weight"?: number,"tasks_per_campaign"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lm_estimate_places": {
                  Row: {
                    "estimate_id": string,"google_place_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "estimate_id": string,"google_place_id": string
                  }
                  Update: {
                    "estimate_id"?: string,"google_place_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_estimate_places_estimate_id_fkey"
      columns: ["estimate_id"]
isOneToOne: false
      referencedRelation: "lm_estimates"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_estimates": {
                  Row: {
                    "account_id": string,"cards": number,"country_code": string,"created_at": string,"created_by": string | null,"credits_per_prospect": number | null,"done_searches": number,"expected": number | null,"expected_high": number | null,"expected_low": number | null,"filters": NonNullable<Json>,"finished_at": string | null,"id": string,"matching": number,"mode": string,"overlap": number,"rate": number | null,"sample_searches": number,"status": string,"targeting": NonNullable<Json>,"total_searches": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"cards"?: number,"country_code": string,"created_at"?: string,"created_by"?: string | null,"credits_per_prospect"?: number | null,"done_searches"?: number,"expected"?: number | null,"expected_high"?: number | null,"expected_low"?: number | null,"filters"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: string,"matching"?: number,"mode": string,"overlap"?: number,"rate"?: number | null,"sample_searches": number,"status"?: string,"targeting": NonNullable<Json>,"total_searches": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"cards"?: number,"country_code"?: string,"created_at"?: string,"created_by"?: string | null,"credits_per_prospect"?: number | null,"done_searches"?: number,"expected"?: number | null,"expected_high"?: number | null,"expected_low"?: number | null,"filters"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: string,"matching"?: number,"mode"?: string,"overlap"?: number,"rate"?: number | null,"sample_searches"?: number,"status"?: string,"targeting"?: NonNullable<Json>,"total_searches"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_estimates_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_estimates_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_estimates_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_geo_cities": {
                  Row: {
                    "admin1_code": string | null,"ascii_name": string,"country_code": string,"geoname_id": number,"latitude": number,"longitude": number,"name": string,"population": number,"timezone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "admin1_code"?: string | null,"ascii_name": string,"country_code": string,"geoname_id": number,"latitude": number,"longitude": number,"name": string,"population"?: number,"timezone"?: string | null
                  }
                  Update: {
                    "admin1_code"?: string | null,"ascii_name"?: string,"country_code"?: string,"geoname_id"?: number,"latitude"?: number,"longitude"?: number,"name"?: string,"population"?: number,"timezone"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"lm_local_discovery_campaigns": {
                  Row: {
                    "campaign_id": string,"created_at": string,"enabled_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"enabled_by"?: string | null
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"enabled_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_local_discovery_campaigns_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: true
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_local_discovery_users": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lm_local_workers": {
                  Row: {
                    "seen_at": string,"worker_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "seen_at"?: string,"worker_id": string
                  }
                  Update: {
                    "seen_at"?: string,"worker_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lm_notification_preferences": {
                  Row: {
                    "disabled_groups": (string)[],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "disabled_groups"?: (string)[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "disabled_groups"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lm_notifications": {
                  Row: {
                    "account_id": string | null,"attempts": number,"campaign_id": string | null,"claimed_at": string | null,"created_at": string,"dedupe_key": string,"error": string | null,"id": number,"kind": string,"payload": NonNullable<Json>,"sent_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"attempts"?: number,"campaign_id"?: string | null,"claimed_at"?: string | null,"created_at"?: string,"dedupe_key": string,"error"?: string | null,"id"?: never,"kind": string,"payload"?: NonNullable<Json>,"sent_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"attempts"?: number,"campaign_id"?: string | null,"claimed_at"?: string | null,"created_at"?: string,"dedupe_key"?: string,"error"?: string | null,"id"?: never,"kind"?: string,"payload"?: NonNullable<Json>,"sent_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_notifications_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_notifications_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_notifications_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_notifications_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_place_searches": {
                  Row: {
                    "campaign_id": string | null,"cards": number,"complete": boolean,"country_code": string,"gcid": string,"geoname_id": number | null,"id": number,"latitude": number | null,"longitude": number | null,"place_ids": (string)[],"query": string | null,"searched_at": string,"source": string,"zone_key": string,"zoom": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id"?: string | null,"cards"?: number,"complete"?: boolean,"country_code": string,"gcid": string,"geoname_id"?: number | null,"id"?: never,"latitude"?: number | null,"longitude"?: number | null,"place_ids"?: (string)[],"query"?: string | null,"searched_at"?: string,"source"?: string,"zone_key": string,"zoom"?: number | null
                  }
                  Update: {
                    "campaign_id"?: string | null,"cards"?: number,"complete"?: boolean,"country_code"?: string,"gcid"?: string,"geoname_id"?: number | null,"id"?: never,"latitude"?: number | null,"longitude"?: number | null,"place_ids"?: (string)[],"query"?: string | null,"searched_at"?: string,"source"?: string,"zone_key"?: string,"zoom"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_place_searches_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_place_sightings": {
                  Row: {
                    "created_at": string,"google_place_id": string,"kept": boolean,"site_key": string | null,"space_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"google_place_id": string,"kept"?: boolean,"site_key"?: string | null,"space_id": string
                  }
                  Update: {
                    "created_at"?: string,"google_place_id"?: string,"kept"?: boolean,"site_key"?: string | null,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_place_sightings_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "lm_spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_places": {
                  Row: {
                    "address": string | null,"category": string | null,"city": string | null,"closed_at": string | null,"country_code": string,"details_at": string | null,"first_seen_at": string,"gcid": string | null,"geoname_id": number | null,"google_place_id": string,"is_chain": boolean,"last_seen_at": string,"latitude": number | null,"longitude": number | null,"maps_url": string | null,"name": string,"phone": string | null,"rating": number | null,"review_count": number | null,"site_key": string | null,"site_read_at": string | null,"site_status": string | null,"site_text": string | null,"updated_at": string,"website": string | null,"website_known": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"category"?: string | null,"city"?: string | null,"closed_at"?: string | null,"country_code": string,"details_at"?: string | null,"first_seen_at"?: string,"gcid"?: string | null,"geoname_id"?: number | null,"google_place_id": string,"is_chain"?: boolean,"last_seen_at"?: string,"latitude"?: number | null,"longitude"?: number | null,"maps_url"?: string | null,"name": string,"phone"?: string | null,"rating"?: number | null,"review_count"?: number | null,"site_key"?: string | null,"site_read_at"?: string | null,"site_status"?: string | null,"site_text"?: string | null,"updated_at"?: string,"website"?: string | null,"website_known"?: boolean
                  }
                  Update: {
                    "address"?: string | null,"category"?: string | null,"city"?: string | null,"closed_at"?: string | null,"country_code"?: string,"details_at"?: string | null,"first_seen_at"?: string,"gcid"?: string | null,"geoname_id"?: number | null,"google_place_id"?: string,"is_chain"?: boolean,"last_seen_at"?: string,"latitude"?: number | null,"longitude"?: number | null,"maps_url"?: string | null,"name"?: string,"phone"?: string | null,"rating"?: number | null,"review_count"?: number | null,"site_key"?: string | null,"site_read_at"?: string | null,"site_status"?: string | null,"site_text"?: string | null,"updated_at"?: string,"website"?: string | null,"website_known"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"lm_plan_variants": {
                  Row: {
                    "interval": string,"plan_id": string,"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "interval": string,"plan_id": string,"variant_id": string
                  }
                  Update: {
                    "interval"?: string,"plan_id"?: string,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_plan_variants_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "lm_plans"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_plans": {
                  Row: {
                    "active_campaigns": number | null,"auto_validation": boolean,"created_at": string,"discovery_credits": number,"id": string,"name": string,"outreach_credits": number,"proxy_gb_month": number | null,"seats": number | null,"spaces": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_campaigns"?: number | null,"auto_validation"?: boolean,"created_at"?: string,"discovery_credits": number,"id": string,"name": string,"outreach_credits": number,"proxy_gb_month"?: number | null,"seats"?: number | null,"spaces": number,"updated_at"?: string
                  }
                  Update: {
                    "active_campaigns"?: number | null,"auto_validation"?: boolean,"created_at"?: string,"discovery_credits"?: number,"id"?: string,"name"?: string,"outreach_credits"?: number,"proxy_gb_month"?: number | null,"seats"?: number | null,"spaces"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lm_prospects": {
                  Row: {
                    "account_id": string,"address": string | null,"campaign_id": string | null,"category": string | null,"city": string | null,"country_code": string | null,"created_at": string,"created_by": string | null,"email_checked_at": string | null,"excluded_at": string | null,"found_email": string | null,"google_place_id": string | null,"id": string,"is_chain": boolean,"maps_url": string | null,"name": string,"phone": string | null,"rating": number | null,"review_count": number | null,"site_key": string,"source": Database["public"]['Enums']["lm_prospect_source"],"space_id": string,"updated_at": string,"updated_by": string | null,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"address"?: string | null,"campaign_id"?: string | null,"category"?: string | null,"city"?: string | null,"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"email_checked_at"?: string | null,"excluded_at"?: string | null,"found_email"?: string | null,"google_place_id"?: string | null,"id"?: string,"is_chain"?: boolean,"maps_url"?: string | null,"name": string,"phone"?: string | null,"rating"?: number | null,"review_count"?: number | null,"site_key": string,"source"?: Database["public"]['Enums']["lm_prospect_source"],"space_id": string,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"address"?: string | null,"campaign_id"?: string | null,"category"?: string | null,"city"?: string | null,"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"email_checked_at"?: string | null,"excluded_at"?: string | null,"found_email"?: string | null,"google_place_id"?: string | null,"id"?: string,"is_chain"?: boolean,"maps_url"?: string | null,"name"?: string,"phone"?: string | null,"rating"?: number | null,"review_count"?: number | null,"site_key"?: string,"source"?: Database["public"]['Enums']["lm_prospect_source"],"space_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_prospects_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_prospects_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_prospects_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_prospects_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_prospects_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "lm_spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_replies": {
                  Row: {
                    "account_id": string,"attempt_id": string,"created_at": string,"created_by": string | null,"id": string,"kind": Database["public"]['Enums']["lm_reply_kind"],"note": string | null,"replied_at": string,"source": Database["public"]['Enums']["lm_reply_source"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"attempt_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["lm_reply_kind"],"note"?: string | null,"replied_at"?: string,"source"?: Database["public"]['Enums']["lm_reply_source"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"attempt_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["lm_reply_kind"],"note"?: string | null,"replied_at"?: string,"source"?: Database["public"]['Enums']["lm_reply_source"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_replies_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_replies_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_replies_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_replies_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: true
      referencedRelation: "lm_attempts"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_searches": {
                  Row: {
                    "account_id": string,"campaign_id": string,"cards_kept": number,"cards_new": number,"cards_seen": number,"category": string,"country_code": string,"created_at": string,"duration_ms": number | null,"error": string | null,"id": number,"proxy_bytes": number,"wave": number,"zone_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"campaign_id": string,"cards_kept"?: number,"cards_new"?: number,"cards_seen"?: number,"category": string,"country_code": string,"created_at"?: string,"duration_ms"?: number | null,"error"?: string | null,"id"?: never,"proxy_bytes"?: number,"wave"?: number,"zone_key": string
                  }
                  Update: {
                    "account_id"?: string,"campaign_id"?: string,"cards_kept"?: number,"cards_new"?: number,"cards_seen"?: number,"category"?: string,"country_code"?: string,"created_at"?: string,"duration_ms"?: number | null,"error"?: string | null,"id"?: never,"proxy_bytes"?: number,"wave"?: number,"zone_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_searches_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_searches_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_searches_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_searches_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "lm_campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_sender_profiles": {
                  Row: {
                    "account_id": string,"address": string | null,"city": string | null,"civility": string | null,"company": string,"country_code": string,"created_at": string,"created_by": string | null,"email": string,"first_name": string,"id": string,"is_default": boolean,"job_title": string | null,"last_name": string,"phone": string | null,"space_id": string,"updated_at": string,"updated_by": string | null,"website": string | null,"zip": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"address"?: string | null,"city"?: string | null,"civility"?: string | null,"company": string,"country_code": string,"created_at"?: string,"created_by"?: string | null,"email": string,"first_name": string,"id"?: string,"is_default"?: boolean,"job_title"?: string | null,"last_name": string,"phone"?: string | null,"space_id": string,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null,"zip"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"address"?: string | null,"city"?: string | null,"civility"?: string | null,"company"?: string,"country_code"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string,"first_name"?: string,"id"?: string,"is_default"?: boolean,"job_title"?: string | null,"last_name"?: string,"phone"?: string | null,"space_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null,"zip"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_sender_profiles_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_sender_profiles_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_sender_profiles_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_sender_profiles_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "lm_spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_spaces": {
                  Row: {
                    "account_id": string,"country_code": string | null,"created_at": string,"created_by": string | null,"id": string,"is_default": boolean,"language_code": string,"name": string,"ready_forms_cap": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_default"?: boolean,"language_code"?: string,"name": string,"ready_forms_cap"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_default"?: boolean,"language_code"?: string,"name"?: string,"ready_forms_cap"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_spaces_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_spaces_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_spaces_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_suppressions": {
                  Row: {
                    "account_id": string | null,"created_at": string,"created_by": string | null,"id": string,"reason": string | null,"site_key": string,"space_id": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string | null,"site_key": string,"space_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string | null,"site_key"?: string,"space_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_suppressions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_suppressions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_suppressions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_suppressions_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "lm_spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lm_tasks": {
                  Row: {
                    "account_id": string,"attempts": number,"created_at": string,"error": string | null,"finished_at": string | null,"id": number,"idempotency_key": string,"kind": Database["public"]['Enums']["lm_task_kind"],"locked_at": string | null,"max_attempts": number,"payload": NonNullable<Json>,"priority": number,"result": Json | null,"run_after": string,"status": Database["public"]['Enums']["lm_task_status"],"updated_at": string,"worker_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: never,"idempotency_key": string,"kind": Database["public"]['Enums']["lm_task_kind"],"locked_at"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"priority"?: number,"result"?: Json | null,"run_after"?: string,"status"?: Database["public"]['Enums']["lm_task_status"],"updated_at"?: string,"worker_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: never,"idempotency_key"?: string,"kind"?: Database["public"]['Enums']["lm_task_kind"],"locked_at"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"priority"?: number,"result"?: Json | null,"run_after"?: string,"status"?: Database["public"]['Enums']["lm_task_status"],"updated_at"?: string,"worker_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lm_tasks_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_tasks_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lm_tasks_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"nonces": {
                  Row: {
                    "client_token": string,"created_at": string,"expires_at": string,"id": string,"last_verification_at": string | null,"last_verification_ip": unknown,"last_verification_user_agent": string | null,"metadata": Json | null,"nonce": string,"purpose": string,"revoked": boolean,"revoked_reason": string | null,"scopes": (string)[] | null,"used_at": string | null,"user_id": string | null,"verification_attempts": number
                  }
                  ComputedFields: never
                  Insert: {
                    "client_token": string,"created_at"?: string,"expires_at": string,"id"?: string,"last_verification_at"?: string | null,"last_verification_ip"?: unknown,"last_verification_user_agent"?: string | null,"metadata"?: Json | null,"nonce": string,"purpose": string,"revoked"?: boolean,"revoked_reason"?: string | null,"scopes"?: (string)[] | null,"used_at"?: string | null,"user_id"?: string | null,"verification_attempts"?: number
                  }
                  Update: {
                    "client_token"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"last_verification_at"?: string | null,"last_verification_ip"?: unknown,"last_verification_user_agent"?: string | null,"metadata"?: Json | null,"nonce"?: string,"purpose"?: string,"revoked"?: boolean,"revoked_reason"?: string | null,"scopes"?: (string)[] | null,"used_at"?: string | null,"user_id"?: string | null,"verification_attempts"?: number
                  }
                  Relationships: [
                    
                  ]
                },"notifications": {
                  Row: {
                    "account_id": string,"body": string,"channel": Database["public"]['Enums']["notification_channel"],"created_at": string,"dismissed": boolean,"expires_at": string | null,"id": number,"link": string | null,"type": Database["public"]['Enums']["notification_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"body": string,"channel"?: Database["public"]['Enums']["notification_channel"],"created_at"?: string,"dismissed"?: boolean,"expires_at"?: string | null,"id"?: never,"link"?: string | null,"type"?: Database["public"]['Enums']["notification_type"]
                  }
                  Update: {
                    "account_id"?: string,"body"?: string,"channel"?: Database["public"]['Enums']["notification_channel"],"created_at"?: string,"dismissed"?: boolean,"expires_at"?: string | null,"id"?: never,"link"?: string | null,"type"?: Database["public"]['Enums']["notification_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "created_at": string,"id": string,"order_id": string,"price_amount": number | null,"product_id": string,"quantity": number,"updated_at": string,"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"order_id": string,"price_amount"?: number | null,"product_id": string,"quantity"?: number,"updated_at"?: string,"variant_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"order_id"?: string,"price_amount"?: number | null,"product_id"?: string,"quantity"?: number,"updated_at"?: string,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "account_id": string,"billing_customer_id": number,"billing_provider": Database["public"]['Enums']["billing_provider"],"created_at": string,"currency": string,"id": string,"status": Database["public"]['Enums']["payment_status"],"total_amount": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"billing_customer_id": number,"billing_provider": Database["public"]['Enums']["billing_provider"],"created_at"?: string,"currency": string,"id": string,"status": Database["public"]['Enums']["payment_status"],"total_amount": number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"billing_customer_id"?: number,"billing_provider"?: Database["public"]['Enums']["billing_provider"],"created_at"?: string,"currency"?: string,"id"?: string,"status"?: Database["public"]['Enums']["payment_status"],"total_amount"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_billing_customer_id_fkey"
      columns: ["billing_customer_id"]
isOneToOne: false
      referencedRelation: "billing_customers"
      referencedColumns: ["id"]
    }
                  ]
                },"role_permissions": {
                  Row: {
                    "id": number,"permission": Database["public"]['Enums']["app_permissions"],"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: number,"permission": Database["public"]['Enums']["app_permissions"],"role": string
                  }
                  Update: {
                    "id"?: number,"permission"?: Database["public"]['Enums']["app_permissions"],"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_role_fkey"
      columns: ["role"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["name"]
    }
                  ]
                },"roles": {
                  Row: {
                    "hierarchy_level": number,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hierarchy_level": number,"name": string
                  }
                  Update: {
                    "hierarchy_level"?: number,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"subscription_items": {
                  Row: {
                    "created_at": string,"id": string,"interval": string,"interval_count": number,"price_amount": number | null,"product_id": string,"quantity": number,"subscription_id": string,"type": Database["public"]['Enums']["subscription_item_type"],"updated_at": string,"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"interval": string,"interval_count": number,"price_amount"?: number | null,"product_id": string,"quantity"?: number,"subscription_id": string,"type": Database["public"]['Enums']["subscription_item_type"],"updated_at"?: string,"variant_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"interval"?: string,"interval_count"?: number,"price_amount"?: number | null,"product_id"?: string,"quantity"?: number,"subscription_id"?: string,"type"?: Database["public"]['Enums']["subscription_item_type"],"updated_at"?: string,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_items_subscription_id_fkey"
      columns: ["subscription_id"]
isOneToOne: false
      referencedRelation: "subscriptions"
      referencedColumns: ["id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "account_id": string,"active": boolean,"billing_customer_id": number,"billing_provider": Database["public"]['Enums']["billing_provider"],"cancel_at_period_end": boolean,"created_at": string,"currency": string,"id": string,"period_ends_at": string,"period_starts_at": string,"status": Database["public"]['Enums']["subscription_status"],"trial_ends_at": string | null,"trial_starts_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"active": boolean,"billing_customer_id": number,"billing_provider": Database["public"]['Enums']["billing_provider"],"cancel_at_period_end": boolean,"created_at"?: string,"currency": string,"id": string,"period_ends_at": string,"period_starts_at": string,"status": Database["public"]['Enums']["subscription_status"],"trial_ends_at"?: string | null,"trial_starts_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"active"?: boolean,"billing_customer_id"?: number,"billing_provider"?: Database["public"]['Enums']["billing_provider"],"cancel_at_period_end"?: boolean,"created_at"?: string,"currency"?: string,"id"?: string,"period_ends_at"?: string,"period_starts_at"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"trial_ends_at"?: string | null,"trial_starts_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_account_workspace"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "user_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_billing_customer_id_fkey"
      columns: ["billing_customer_id"]
isOneToOne: false
      referencedRelation: "billing_customers"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "user_account_workspace": {
                  Row: {
                    "id": string | null,"name": string | null,"picture_url": string | null,"subscription_status": Database["public"]['Enums']["subscription_status"] | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"user_accounts": {
                  Row: {
                    "id": string | null,"name": string | null,"picture_url": string | null,"role": string | null,"slug": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "accounts_memberships_account_role_fkey"
      columns: ["role"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["name"]
    }
                  ]
                }
          }
          Functions: {
            "accept_invitation":
{ Args: { "token": string,"user_id": string }; Returns: string
                           },
"add_invitations_to_account":
{ Args: { "account_slug": string,"invitations": (Database["public"]['CompositeTypes']["invitation"])[],"invited_by": string }; Returns: (Database["public"]['Tables']["invitations"]['Row'])[]
                           },
"can_action_account_member":
{ Args: { "target_team_account_id": string,"target_user_id": string }; Returns: boolean
                           },
"create_invitation":
{ Args: { "account_id": string,"email": string,"role": string }; Returns: {
              "account_id": string,
"created_at": string,
"email": string,
"expires_at": string,
"id": number,
"invite_token": string,
"invited_by": string,
"role": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "invitations"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_nonce":
{ Args: { "p_expires_in_seconds"?: number,"p_metadata"?: Json,"p_purpose"?: string,"p_revoke_previous"?: boolean,"p_scopes"?: (string)[],"p_user_id"?: string }; Returns: Json
                           },
"create_team_account":
{ Args: { "account_name": string,"account_slug"?: string,"user_id": string }; Returns: {
              "created_at": string | null,
"created_by": string | null,
"email": string | null,
"id": string,
"is_personal_account": boolean,
"name": string,
"picture_url": string | null,
"primary_owner_user_id": string,
"public_data": NonNullable<Json>,
"slug": string | null,
"updated_at": string | null,
"updated_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "accounts"
        isOneToOne: true
        isSetofReturn: false
      } },
"get_account_invitations":
{ Args: { "account_slug": string }; Returns: {
              "account_id": string,"created_at": string,"email": string,"expires_at": string,"id": number,"invited_by": string,"inviter_email": string,"inviter_name": string,"role": string,"updated_at": string
            }[]
                           },
"get_account_members":
{ Args: { "account_slug": string }; Returns: {
              "account_id": string,"created_at": string,"email": string,"id": string,"name": string,"picture_url": string,"primary_owner_user_id": string,"role": string,"role_hierarchy_level": number,"updated_at": string,"user_id": string
            }[]
                           },
"get_config":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_nonce_status":
{ Args: { "p_id": string }; Returns: Json
                           },
"get_upper_system_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"has_active_subscription":
{ Args: { "target_account_id": string }; Returns: boolean
                           },
"has_more_elevated_role":
{ Args: { "role_name": string,"target_account_id": string,"target_user_id": string }; Returns: boolean
                           },
"has_permission":
{ Args: { "account_id": string,"permission_name": Database["public"]['Enums']["app_permissions"],"user_id": string }; Returns: boolean
                           },
"has_role_on_account":
{ Args: { "account_id": string,"account_role"?: string }; Returns: boolean
                           },
"has_same_role_hierarchy_level":
{ Args: { "role_name": string,"target_account_id": string,"target_user_id": string }; Returns: boolean
                           },
"is_aal2":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_account_owner":
{ Args: { "account_id": string }; Returns: boolean
                           },
"is_account_team_member":
{ Args: { "target_account_id": string }; Returns: boolean
                           },
"is_mfa_compliant":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_set":
{ Args: { "field_name": string }; Returns: boolean
                           },
"is_super_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_team_member":
{ Args: { "account_id": string,"user_id": string }; Returns: boolean
                           },
"lm_add_search_bytes":
{ Args: { "p_bytes": number,"p_task_id": number }; Returns: undefined
                           },
"lm_attempt_counts":
{ Args: { "p_space_id": string }; Returns: {
              "status": Database["public"]['Enums']["lm_attempt_status"],"total": number
            }[]
                           },
"lm_attempt_is_clean":
{ Args: { "p_detail": string,"p_missing": Json,"p_protection_type": string,"p_status": Database["public"]['Enums']["lm_attempt_status"] }; Returns: boolean
                           },
"lm_attempt_repreparable":
{ Args: { "p_status": Database["public"]['Enums']["lm_attempt_status"] }; Returns: boolean
                           },
"lm_auto_validation_allowed":
{ Args: { "p_account_id": string }; Returns: boolean
                           },
"lm_autopilot_active":
{ Args: { "p_autopilot_id": string }; Returns: {
              "account_id": string,
"campaign_id": string,
"created_at": string,
"created_by": string | null,
"cursor_created_at": string | null,
"cursor_prospect_id": string | null,
"finished_at": string | null,
"finished_reason": string | null,
"id": string,
"messages": (string)[],
"schedule": Database["public"]['Enums']["lm_autopilot_schedule"],
"space_id": string,
"spread_days": number,
"status": Database["public"]['Enums']["lm_autopilot_status"],
"target": number,
"ticked_at": string | null,
"timezone": string,
"updated_at": string,
"updated_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "lm_autopilots"
        isOneToOne: true
        isSetofReturn: false
      } },
"lm_autopilot_ahead":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"lm_autopilot_check":
{ Args: { "p_campaign_id": string,"p_messages": (string)[] }; Returns: {
              "account_id": string,
"auto_validation": boolean,
"country_code": string,
"created_at": string,
"created_by": string | null,
"credits_per_prospect": number,
"daily_limit": number,
"estimate_id": string | null,
"filters": NonNullable<Json>,
"id": string,
"name": string,
"price_pending": boolean,
"sender_id": string | null,
"space_id": string,
"status": Database["public"]['Enums']["lm_campaign_status"],
"targeting": NonNullable<Json>,
"templates": NonNullable<Json>,
"updated_at": string,
"updated_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "lm_campaigns"
        isOneToOne: true
        isSetofReturn: false
      } },
"lm_autopilot_contactable":
{ Args: { "p_campaign_id": string }; Returns: number
                           },
"lm_autopilot_counts":
{ Args: { "p_autopilot_id": string }; Returns: {
              "aside": number,"in_flight": number,"preview_ready": number,"sent": number,"total": number
            }[]
                           },
"lm_autopilot_hold":
{ Args: { "p_autopilot_id": string,"p_sends_only": boolean }; Returns: undefined
                           },
"lm_autopilot_preview_size":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"lm_autopilot_slot":
{ Args: { "p_autopilot_id": string }; Returns: string
                           },
"lm_autopilot_summary":
{ Args: { "p_campaign_id": string }; Returns: {
              "aside": number,"autopilot_id": string,"balance": number,"contactable": number,"contacted_before": boolean,"finished_reason": string,"in_flight": number,"messages": (string)[],"next_send_at": string,"preview_ready": number,"schedule": Database["public"]['Enums']["lm_autopilot_schedule"],"sent": number,"spread_days": number,"started_at": string,"status": Database["public"]['Enums']["lm_autopilot_status"],"target": number,"timezone": string
            }[]
                           },
"lm_autopilot_tick":
{ Args: { "p_only"?: string }; Returns: number
                           },
"lm_autopilot_validate_clean":
{ Args: { "p_autopilot_id": string }; Returns: number
                           },
"lm_campaign_pricing":
{ Args: { "p_campaign_id": string }; Returns: {
              "credits_per_prospect": number,"done_searches": number,"estimate_id": string,"estimate_status": string,"frozen": boolean,"rate": number,"sample_searches": number
            }[]
                           },
"lm_campaign_progress":
{ Args: { "p_campaign_id": string }; Returns: {
              "abandoned": number,"cards": number,"categories": number,"in_flight": number,"last_search_at": string,"productive": number,"prospects": number,"searches_done": number,"searches_total": number,"zones": number
            }[]
                           },
"lm_campaign_sender":
{ Args: { "p_campaign_id": string }; Returns: {
              "account_id": string,
"address": string | null,
"city": string | null,
"civility": string | null,
"company": string,
"country_code": string,
"created_at": string,
"created_by": string | null,
"email": string,
"first_name": string,
"id": string,
"is_default": boolean,
"job_title": string | null,
"last_name": string,
"phone": string | null,
"space_id": string,
"updated_at": string,
"updated_by": string | null,
"website": string | null,
"zip": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "lm_sender_profiles"
        isOneToOne: false
        isSetofReturn: true
      } },
"lm_campaign_timezone":
{ Args: { "p_campaign_id": string }; Returns: string
                           },
"lm_cancel_autopilot":
{ Args: { "p_autopilot_id": string }; Returns: boolean
                           },
"lm_city_grid":
{ Args: { "p_lat": number,"p_lng": number,"p_population": number }; Returns: {
              "latitude": number,"longitude": number
            }[]
                           },
"lm_city_label":
{ Args: { "p_country_name": string,"p_name": string }; Returns: string
                           },
"lm_claim_local_task":
{ Args: { "p_worker_id": string }; Returns: {
              "account_id": string,
"attempts": number,
"created_at": string,
"error": string | null,
"finished_at": string | null,
"id": number,
"idempotency_key": string,
"kind": Database["public"]['Enums']["lm_task_kind"],
"locked_at": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"priority": number,
"result": Json | null,
"run_after": string,
"status": Database["public"]['Enums']["lm_task_status"],
"updated_at": string,
"worker_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "lm_tasks"
        isOneToOne: false
        isSetofReturn: true
      } },
"lm_claim_notifications":
{ Args: { "p_limit"?: number }; Returns: {
              "account_id": string,"account_slug": string,"campaign_id": string,"campaign_name": string,"created_at": string,"id": number,"kind": string,"payload": Json,"recipients": Json
            }[]
                           },
"lm_claim_task":
{ Args: { "p_kinds": (Database["public"]['Enums']["lm_task_kind"])[],"p_worker_id": string }; Returns: {
              "account_id": string,
"attempts": number,
"created_at": string,
"error": string | null,
"finished_at": string | null,
"id": number,
"idempotency_key": string,
"kind": Database["public"]['Enums']["lm_task_kind"],
"locked_at": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"priority": number,
"result": Json | null,
"run_after": string,
"status": Database["public"]['Enums']["lm_task_status"],
"updated_at": string,
"worker_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "lm_tasks"
        isOneToOne: false
        isSetofReturn: true
      } },
"lm_clean_website":
{ Args: { "p_url": string }; Returns: string
                           },
"lm_complete_task":
{ Args: { "p_id": number,"p_result": Json }; Returns: undefined
                           },
"lm_confirm_autopilot":
{ Args: { "p_autopilot_id": string }; Returns: number
                           },
"lm_create_estimate":
{ Args: { "p_account_id": string,"p_country_code": string,"p_filters": Json,"p_targeting": Json }; Returns: string
                           },
"lm_credit_usage":
{ Args: { "p_account_id": string,"p_days"?: number }; Returns: {
              "added": number,"campaign_id": string,"campaign_name": string,"day": string,"kind": Database["public"]['Enums']["lm_credit_kind"],"used": number
            }[]
                           },
"lm_credits_for_rate":
{ Args: { "p_rate": number }; Returns: number
                           },
"lm_debit_credits":
{ Args: { "p_account_id": string,"p_campaign_id"?: string,"p_event_ref": string,"p_kind": Database["public"]['Enums']["lm_credit_kind"],"p_quantity": number,"p_reason": string }; Returns: boolean
                           },
"lm_delete_prospects":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"lm_duplicate_campaign":
{ Args: { "p_campaign_id": string,"p_name": string }; Returns: string
                           },
"lm_estimate_campaign":
{ Args: { "p_country_code": string,"p_filters"?: Json,"p_targeting": Json }; Returns: {
              "categories": number,"cities": number,"expected_prospects": number,"rate": number,"searches": number
            }[]
                           },
"lm_exclude_attempts":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"lm_exclude_prospects":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"lm_fail_task":
{ Args: { "p_error": string,"p_id": number }; Returns: undefined
                           },
"lm_find_emails":
{ Args: { "p_ids": (string)[] }; Returns: {
              "queued": number,"skipped": number
            }[]
                           },
"lm_finish_emails":
{ Args: { "p_email": string,"p_prospect_id": string }; Returns: boolean
                           },
"lm_finish_notification":
{ Args: { "p_error"?: string,"p_id": number,"p_ok": boolean }; Returns: undefined
                           },
"lm_finish_prepare":
{ Args: { "p_attempt_id": string,"p_result": Json }; Returns: boolean
                           },
"lm_finish_search":
{ Args: { "p_campaign_id": string,"p_cards": number,"p_duration_ms": number,"p_error"?: string,"p_gcid": string,"p_kept": number,"p_new": number,"p_zone_idx": number }; Returns: undefined
                           },
"lm_finish_send":
{ Args: { "p_attempt_id": string,"p_result": Json }; Returns: boolean
                           },
"lm_has_plan":
{ Args: { "p_account_id": string }; Returns: boolean
                           },
"lm_import_prospects":
{ Args: { "p_rows": Json,"p_space_id": string }; Returns: {
              "duplicates": number,"inserted": number
            }[]
                           },
"lm_local_discovery_state":
{ Args: { "p_campaign_id": string }; Returns: Json
                           },
"lm_mark_attempts":
{ Args: { "p_ids": (string)[],"p_outcome": string }; Returns: number
                           },
"lm_mark_place_seen":
{ Args: { "p_place_id": string,"p_site_key": string,"p_space_id": string }; Returns: boolean
                           },
"lm_member":
{ Args: { "p_account_id": string }; Returns: boolean
                           },
"lm_normalize_filters":
{ Args: { "p_filters": Json }; Returns: Json
                           },
"lm_notify":
{ Args: { "p_account_id": string,"p_campaign_id": string,"p_dedupe_key": string,"p_kind": string,"p_payload": Json }; Returns: undefined
                           },
"lm_outreach_reserved":
{ Args: { "p_account_id": string }; Returns: number
                           },
"lm_pause_autopilot":
{ Args: { "p_autopilot_id": string }; Returns: boolean
                           },
"lm_pause_campaign":
{ Args: { "p_campaign_id": string,"p_reason"?: string }; Returns: undefined
                           },
"lm_place_zone_key":
{ Args: { "p_geoname_id": number,"p_latitude": number,"p_longitude": number,"p_zoom": number }; Returns: string
                           },
"lm_prepare_campaign":
{ Args: { "p_campaign_id": string }; Returns: {
              "queued": number,"skipped": number
            }[]
                           },
"lm_prepare_prospects":
{ Args: { "p_campaign_id"?: string,"p_ids": (string)[] }; Returns: {
              "queued": number,"skipped": number
            }[]
                           },
"lm_prospect_facets":
{ Args: { "p_space_id": string }; Returns: {
              "kind": string,"total": number,"value": string
            }[]
                           },
"lm_proxy_over_budget":
{ Args: { "p_account_id": string }; Returns: boolean
                           },
"lm_queue_sends":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"lm_rating_share":
{ Args: { "p_max": number,"p_min": number }; Returns: number
                           },
"lm_record_estimate_search":
{ Args: { "p_cards": number,"p_estimate_id": string,"p_is_grid": boolean,"p_place_ids": (string)[] }; Returns: undefined
                           },
"lm_record_prospect":
{ Args: { "p_campaign_id": string,"p_place": Json }; Returns: string
                           },
"lm_record_search_places":
{ Args: { "p_places": Json,"p_search": Json }; Returns: number
                           },
"lm_recount_in_flight":
{ Args: { "p_campaign_id": string }; Returns: number
                           },
"lm_refill_credits":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"lm_release_search":
{ Args: { "p_campaign_id": string,"p_gcid": string }; Returns: undefined
                           },
"lm_request_campaign_estimate":
{ Args: { "p_campaign_id": string }; Returns: string
                           },
"lm_request_estimate":
{ Args: { "p_account_id": string,"p_country_code": string,"p_filters": Json,"p_targeting": Json }; Returns: string
                           },
"lm_requeue_stale_tasks":
{ Args: { "p_stale"?: string }; Returns: number
                           },
"lm_reset_credits":
{ Args: { "p_account_id": string,"p_event_ref": string,"p_period_ends_at": string,"p_plan_id": string }; Returns: undefined
                           },
"lm_restore_prospects":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"lm_resume_autopilot":
{ Args: { "p_autopilot_id": string }; Returns: boolean
                           },
"lm_schedule_discovery":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"lm_seat_limit":
{ Args: { "p_account_id": string }; Returns: number
                           },
"lm_seats_available":
{ Args: { "p_account_id": string }; Returns: number
                           },
"lm_sends_today":
{ Args: { "p_campaign_id": string }; Returns: number
                           },
"lm_set_campaign_archived":
{ Args: { "p_archived": boolean,"p_campaign_id": string }; Returns: string
                           },
"lm_set_default_sender":
{ Args: { "p_sender_id": string }; Returns: undefined
                           },
"lm_set_local_discovery":
{ Args: { "p_campaign_id": string,"p_enabled": boolean }; Returns: boolean
                           },
"lm_site_known":
{ Args: { "p_site_key": string,"p_space_id": string }; Returns: boolean
                           },
"lm_site_suppressed":
{ Args: { "p_account_id": string,"p_site_key": string,"p_space_id": string }; Returns: boolean
                           },
"lm_skip_attempts":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"lm_skip_estimate_search":
{ Args: { "p_estimate_id": string }; Returns: undefined
                           },
"lm_space_limit":
{ Args: { "p_account_id": string }; Returns: number
                           },
"lm_start_autopilot":
{ Args: { "p_campaign_id": string,"p_messages": (string)[],"p_preview": boolean,"p_schedule": Database["public"]['Enums']["lm_autopilot_schedule"],"p_spread_days": number,"p_target": number }; Returns: string
                           },
"lm_start_campaign":
{ Args: { "p_campaign_id": string }; Returns: undefined
                           },
"lm_target_categories":
{ Args: { "p_targeting": Json }; Returns: {
              "gcid": string,"is_generic": boolean
            }[]
                           },
"lm_target_cities":
{ Args: { "p_country_code": string,"p_targeting": Json }; Returns: {
              "geoname_id": number,"label": string,"population": number
            }[]
                           },
"lm_target_zones":
{ Args: { "p_country_code": string,"p_targeting": Json }; Returns: {
              "geoname_id": number,"label": string,"latitude": number,"longitude": number,"population": number,"zoom": number
            }[]
                           },
"lm_templates_usable":
{ Args: { "p_templates": Json }; Returns: boolean
                           },
"lm_update_attempt":
{ Args: { "p_body": string,"p_extra": Json,"p_id": string,"p_subject": string }; Returns: boolean
                           },
"lm_update_autopilot":
{ Args: { "p_autopilot_id": string,"p_messages": (string)[],"p_schedule": Database["public"]['Enums']["lm_autopilot_schedule"],"p_spread_days": number,"p_target": number }; Returns: number
                           },
"lm_update_campaign":
{ Args: { "p_campaign_id": string,"p_country_code": string,"p_filters": Json,"p_name": string,"p_targeting": Json }; Returns: string
                           },
"lm_user_account_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"lm_validate_attempts":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"revoke_nonce":
{ Args: { "p_id": string,"p_reason"?: string }; Returns: boolean
                           },
"team_account_workspace":
{ Args: { "account_slug": string }; Returns: {
              "id": string,"name": string,"permissions": (Database["public"]['Enums']["app_permissions"])[],"picture_url": string,"primary_owner_user_id": string,"role": string,"role_hierarchy_level": number,"slug": string,"subscription_status": Database["public"]['Enums']["subscription_status"]
            }[]
                           },
"transfer_team_account_ownership":
{ Args: { "new_owner_id": string,"target_account_id": string }; Returns: undefined
                           },
"upsert_order":
{ Args: { "billing_provider": Database["public"]['Enums']["billing_provider"],"currency": string,"line_items": Json,"status": Database["public"]['Enums']["payment_status"],"target_account_id": string,"target_customer_id": string,"target_order_id": string,"total_amount": number }; Returns: {
              "account_id": string,
"billing_customer_id": number,
"billing_provider": Database["public"]['Enums']["billing_provider"],
"created_at": string,
"currency": string,
"id": string,
"status": Database["public"]['Enums']["payment_status"],
"total_amount": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "orders"
        isOneToOne: true
        isSetofReturn: false
      } },
"upsert_subscription":
{ Args: { "active": boolean,"billing_provider": Database["public"]['Enums']["billing_provider"],"cancel_at_period_end": boolean,"currency": string,"line_items": Json,"period_ends_at": string,"period_starts_at": string,"status": Database["public"]['Enums']["subscription_status"],"target_account_id": string,"target_customer_id": string,"target_subscription_id": string,"trial_ends_at"?: string,"trial_starts_at"?: string }; Returns: {
              "account_id": string,
"active": boolean,
"billing_customer_id": number,
"billing_provider": Database["public"]['Enums']["billing_provider"],
"cancel_at_period_end": boolean,
"created_at": string,
"currency": string,
"id": string,
"period_ends_at": string,
"period_starts_at": string,
"status": Database["public"]['Enums']["subscription_status"],
"trial_ends_at": string | null,
"trial_starts_at": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "subscriptions"
        isOneToOne: true
        isSetofReturn: false
      } },
"verify_nonce":
{ Args: { "p_ip"?: unknown,"p_max_verification_attempts"?: number,"p_purpose": string,"p_required_scopes"?: (string)[],"p_token": string,"p_user_agent"?: string,"p_user_id"?: string }; Returns: Json
                           }
          }
          Enums: {
            "app_permissions": "roles.manage"|"billing.manage"|"settings.manage"|"members.manage"|"invites.manage","billing_provider": "stripe"|"lemon-squeezy"|"paddle","lm_attempt_status": "pending"|"preparing"|"ready"|"incomplete"|"intervention_required"|"no_form"|"unreachable"|"validated"|"sending"|"sent"|"to_verify"|"failed"|"skipped"|"excluded","lm_autopilot_schedule": "office"|"spread"|"continuous","lm_autopilot_status": "preview"|"running"|"paused"|"done"|"cancelled","lm_campaign_status": "draft"|"running"|"paused"|"completed"|"archived","lm_coverage_tier": "verified"|"standard","lm_credit_kind": "discovery"|"outreach","lm_prospect_source": "maps"|"csv","lm_reply_kind": "interested"|"not_interested"|"question"|"stop"|"other","lm_reply_source": "manual"|"email","lm_task_kind": "discovery"|"prepare"|"send"|"dummy"|"estimate"|"emails","lm_task_status": "queued"|"running"|"done"|"failed"|"cancelled","notification_channel": "in_app"|"email","notification_type": "info"|"warning"|"error","payment_status": "pending"|"succeeded"|"failed","subscription_item_type": "flat"|"per_seat"|"metered","subscription_status": "active"|"trialing"|"past_due"|"canceled"|"unpaid"|"incomplete"|"incomplete_expired"|"paused"
          }
          CompositeTypes: {
            "invitation": {
                        "email": string | null,"role": string | null
                      }
          }
        },"storage": {
          Tables: {
            "buckets": {
                  Row: {
                    "allowed_mime_types": (string)[] | null,"avif_autodetection": boolean | null,"created_at": string | null,"file_size_limit": number | null,"id": string,"lifecycle_configuration": Json | null,"lifecycle_configuration_generation": string | null,"name": string,"owner": string | null,"owner_id": string | null,"public": boolean | null,"type": Database["storage"]['Enums']["buckettype"],"updated_at": string | null,"versioning_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_mime_types"?: (string)[] | null,"avif_autodetection"?: boolean | null,"created_at"?: string | null,"file_size_limit"?: number | null,"id": string,"lifecycle_configuration"?: Json | null,"lifecycle_configuration_generation"?: string | null,"name": string,"owner"?: string | null,"owner_id"?: string | null,"public"?: boolean | null,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string | null,"versioning_status"?: string
                  }
                  Update: {
                    "allowed_mime_types"?: (string)[] | null,"avif_autodetection"?: boolean | null,"created_at"?: string | null,"file_size_limit"?: number | null,"id"?: string,"lifecycle_configuration"?: Json | null,"lifecycle_configuration_generation"?: string | null,"name"?: string,"owner"?: string | null,"owner_id"?: string | null,"public"?: boolean | null,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string | null,"versioning_status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"buckets_analytics": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"format": string,"id": string,"name": string,"type": Database["storage"]['Enums']["buckettype"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"format"?: string,"id"?: string,"name": string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"format"?: string,"id"?: string,"name"?: string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"buckets_vectors": {
                  Row: {
                    "created_at": string,"id": string,"type": Database["storage"]['Enums']["buckettype"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"iceberg_namespaces": {
                  Row: {
                    "bucket_name": string,"catalog_id": string,"created_at": string,"id": string,"metadata": NonNullable<Json>,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_name": string,"catalog_id": string,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "bucket_name"?: string,"catalog_id"?: string,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
      columns: ["catalog_id"]
isOneToOne: false
      referencedRelation: "buckets_analytics"
      referencedColumns: ["id"]
    }
                  ]
                },"iceberg_tables": {
                  Row: {
                    "bucket_name": string,"catalog_id": string,"created_at": string,"id": string,"location": string,"name": string,"namespace_id": string,"remote_table_id": string | null,"shard_id": string | null,"shard_key": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_name": string,"catalog_id": string,"created_at"?: string,"id"?: string,"location": string,"name": string,"namespace_id": string,"remote_table_id"?: string | null,"shard_id"?: string | null,"shard_key"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "bucket_name"?: string,"catalog_id"?: string,"created_at"?: string,"id"?: string,"location"?: string,"name"?: string,"namespace_id"?: string,"remote_table_id"?: string | null,"shard_id"?: string | null,"shard_key"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "iceberg_tables_catalog_id_fkey"
      columns: ["catalog_id"]
isOneToOne: false
      referencedRelation: "buckets_analytics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "iceberg_tables_namespace_id_fkey"
      columns: ["namespace_id"]
isOneToOne: false
      referencedRelation: "iceberg_namespaces"
      referencedColumns: ["id"]
    }
                  ]
                },"migrations": {
                  Row: {
                    "executed_at": string | null,"hash": string,"id": number,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "executed_at"?: string | null,"hash": string,"id": number,"name": string
                  }
                  Update: {
                    "executed_at"?: string | null,"hash"?: string,"id"?: number,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"objects": {
                  Row: {
                    "archived_at": string | null,"bucket_id": string | null,"created_at": string | null,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"last_accessed_at": string | null,"metadata": Json | null,"name": string | null,"owner": string | null,"owner_id": string | null,"path_tokens": (string)[] | null,"updated_at": string | null,"user_metadata": Json | null,"version": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"bucket_id"?: string | null,"created_at"?: string | null,"id"?: string,"is_delete_marker"?: boolean,"is_versioned"?: boolean,"last_accessed_at"?: string | null,"metadata"?: Json | null,"name"?: string | null,"owner"?: string | null,"owner_id"?: string | null,"path_tokens"?: never,"updated_at"?: string | null,"user_metadata"?: Json | null,"version"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"bucket_id"?: string | null,"created_at"?: string | null,"id"?: string,"is_delete_marker"?: boolean,"is_versioned"?: boolean,"last_accessed_at"?: string | null,"metadata"?: Json | null,"name"?: string | null,"owner"?: string | null,"owner_id"?: string | null,"path_tokens"?: never,"updated_at"?: string | null,"user_metadata"?: Json | null,"version"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "objects_bucketId_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets"
      referencedColumns: ["id"]
    }
                  ]
                },"s3_multipart_uploads": {
                  Row: {
                    "bucket_id": string,"created_at": string,"id": string,"in_progress_size": number,"key": string,"metadata": Json | null,"owner_id": string | null,"upload_signature": string,"user_metadata": Json | null,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_id": string,"created_at"?: string,"id": string,"in_progress_size"?: number,"key": string,"metadata"?: Json | null,"owner_id"?: string | null,"upload_signature": string,"user_metadata"?: Json | null,"version": string
                  }
                  Update: {
                    "bucket_id"?: string,"created_at"?: string,"id"?: string,"in_progress_size"?: number,"key"?: string,"metadata"?: Json | null,"owner_id"?: string | null,"upload_signature"?: string,"user_metadata"?: Json | null,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets"
      referencedColumns: ["id"]
    }
                  ]
                },"s3_multipart_uploads_parts": {
                  Row: {
                    "bucket_id": string,"created_at": string,"etag": string,"id": string,"key": string,"owner_id": string | null,"part_number": number,"size": number,"upload_id": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_id": string,"created_at"?: string,"etag": string,"id"?: string,"key": string,"owner_id"?: string | null,"part_number": number,"size"?: number,"upload_id": string,"version": string
                  }
                  Update: {
                    "bucket_id"?: string,"created_at"?: string,"etag"?: string,"id"?: string,"key"?: string,"owner_id"?: string | null,"part_number"?: number,"size"?: number,"upload_id"?: string,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
      columns: ["upload_id"]
isOneToOne: false
      referencedRelation: "s3_multipart_uploads"
      referencedColumns: ["id"]
    }
                  ]
                },"vector_indexes": {
                  Row: {
                    "bucket_id": string,"created_at": string,"data_type": string,"dimension": number,"distance_metric": string,"id": string,"metadata_configuration": Json | null,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_id": string,"created_at"?: string,"data_type": string,"dimension": number,"distance_metric": string,"id"?: string,"metadata_configuration"?: Json | null,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "bucket_id"?: string,"created_at"?: string,"data_type"?: string,"dimension"?: number,"distance_metric"?: string,"id"?: string,"metadata_configuration"?: Json | null,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vector_indexes_bucket_id_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets_vectors"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "allow_any_operation":
{ Args: { "expected_operations": (string)[] }; Returns: boolean
                           },
"allow_only_operation":
{ Args: { "expected_operation": string }; Returns: boolean
                           },
"can_insert_object":
{ Args: { "bucketid": string,"metadata": Json,"name": string,"owner": string }; Returns: undefined
                           },
"extension":
{ Args: { "name": string }; Returns: string
                           },
"filename":
{ Args: { "name": string }; Returns: string
                           },
"foldername":
{ Args: { "name": string }; Returns: (string)[]
                           },
"get_common_prefix":
{ Args: { "p_delimiter": string,"p_key": string,"p_prefix": string }; Returns: string
                           },
"get_size_by_bucket":
{ Args: { "delete_markers"?: string,"noncurrent_versions"?: string }; Returns: {
              "bucket_id": string,"size": number
            }[]
                           },
"list_multipart_uploads_with_delimiter":
{ Args: { "bucket_id": string,"delimiter_param": string,"max_keys"?: number,"next_key_token"?: string,"next_upload_token"?: string,"prefix_param": string,"raw_prefix_param"?: string }; Returns: {
              "created_at": string,"id": string,"key": string
            }[]
                           },
"list_objects_with_delimiter":
{ Args: { "_bucket_id": string,"delete_markers"?: string,"delimiter_param": string,"max_keys"?: number,"next_token"?: string,"next_token_archived_at"?: string,"next_token_version"?: string,"noncurrent_versions"?: string,"prefix_param": string,"sort_order"?: string,"start_after"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           },
"operation":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"search":
{ Args: { "bucketname": string,"delete_markers"?: string,"levels"?: number,"limits"?: number,"noncurrent_versions"?: string,"offsets"?: number,"prefix": string,"search"?: string,"sortcolumn"?: string,"sortorder"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           },
"search_by_timestamp":
{ Args: { "delete_markers"?: string,"noncurrent_versions"?: string,"p_bucket_id": string,"p_level": number,"p_limit": number,"p_prefix": string,"p_sort_column": string,"p_sort_column_after": string,"p_sort_order": string,"p_start_after": string,"p_start_after_version"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"key": string,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           },
"search_v2":
{ Args: { "bucket_name": string,"delete_markers"?: string,"levels"?: number,"limits"?: number,"noncurrent_versions"?: string,"prefix": string,"sort_column"?: string,"sort_column_after"?: string,"sort_order"?: string,"start_after"?: string,"start_after_archived_at"?: string,"start_after_is_continuation"?: boolean,"start_after_version"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"key": string,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           }
          }
          Enums: {
            "buckettype": "STANDARD"|"ANALYTICS"|"VECTOR"
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
            "app_permissions": ["roles.manage", "billing.manage", "settings.manage", "members.manage", "invites.manage"],"billing_provider": ["stripe", "lemon-squeezy", "paddle"],"lm_attempt_status": ["pending", "preparing", "ready", "incomplete", "intervention_required", "no_form", "unreachable", "validated", "sending", "sent", "to_verify", "failed", "skipped", "excluded"],"lm_autopilot_schedule": ["office", "spread", "continuous"],"lm_autopilot_status": ["preview", "running", "paused", "done", "cancelled"],"lm_campaign_status": ["draft", "running", "paused", "completed", "archived"],"lm_coverage_tier": ["verified", "standard"],"lm_credit_kind": ["discovery", "outreach"],"lm_prospect_source": ["maps", "csv"],"lm_reply_kind": ["interested", "not_interested", "question", "stop", "other"],"lm_reply_source": ["manual", "email"],"lm_task_kind": ["discovery", "prepare", "send", "dummy", "estimate", "emails"],"lm_task_status": ["queued", "running", "done", "failed", "cancelled"],"notification_channel": ["in_app", "email"],"notification_type": ["info", "warning", "error"],"payment_status": ["pending", "succeeded", "failed"],"subscription_item_type": ["flat", "per_seat", "metered"],"subscription_status": ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]
          }
        },"storage": {
          Enums: {
            "buckettype": ["STANDARD", "ANALYTICS", "VECTOR"]
          }
        }
} as const
