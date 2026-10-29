create type "public"."lm_attempt_status" as enum ('pending', 'preparing', 'ready', 'incomplete', 'intervention_required', 'no_form', 'unreachable', 'validated', 'sending', 'sent', 'to_verify', 'failed', 'skipped', 'excluded');

create type "public"."lm_campaign_status" as enum ('draft', 'running', 'paused', 'completed', 'archived');

create type "public"."lm_coverage_tier" as enum ('verified', 'standard');

create type "public"."lm_credit_kind" as enum ('discovery', 'outreach');

create type "public"."lm_prospect_source" as enum ('maps', 'csv');

create type "public"."lm_reply_kind" as enum ('interested', 'not_interested', 'question', 'stop', 'other');

create type "public"."lm_reply_source" as enum ('manual', 'email');

create type "public"."lm_task_kind" as enum ('discovery', 'prepare', 'send', 'dummy');

create type "public"."lm_task_status" as enum ('queued', 'running', 'done', 'failed', 'cancelled');


  create table "public"."lm_account_credits" (
    "account_id" uuid not null,
    "plan_id" text,
    "discovery_balance" integer not null default 0,
    "outreach_balance" integer not null default 0,
    "period_ends_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_account_credits" enable row level security;


  create table "public"."lm_attempts" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "space_id" uuid not null,
    "campaign_id" uuid not null,
    "prospect_id" uuid not null,
    "status" public.lm_attempt_status not null default 'pending'::public.lm_attempt_status,
    "template_name" text,
    "template_used" text,
    "subject" text,
    "body" text,
    "form_url" character varying(2000),
    "filled" jsonb not null default '{}'::jsonb,
    "missing" jsonb not null default '[]'::jsonb,
    "extra" jsonb not null default '{}'::jsonb,
    "protection_type" text,
    "screenshot_before" text,
    "screenshot_after" text,
    "detail" text,
    "validated_by" uuid,
    "validated_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_attempts" enable row level security;


  create table "public"."lm_campaigns" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "space_id" uuid not null,
    "name" character varying(255) not null,
    "status" public.lm_campaign_status not null default 'draft'::public.lm_campaign_status,
    "country_code" character(2) not null,
    "targeting" jsonb not null default '{}'::jsonb,
    "filters" jsonb not null default '{}'::jsonb,
    "templates" jsonb not null default '[]'::jsonb,
    "daily_limit" integer not null default 100,
    "auto_validation" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_campaigns" enable row level security;


  create table "public"."lm_country_coverage" (
    "country_code" character(2) not null,
    "name" text not null,
    "languages" text[] not null default '{}'::text[],
    "tier" public.lm_coverage_tier not null default 'standard'::public.lm_coverage_tier,
    "form_rate" numeric(5,4),
    "last_corpus_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_country_coverage" enable row level security;


  create table "public"."lm_credit_ledger" (
    "id" bigint generated always as identity not null,
    "account_id" uuid not null,
    "kind" public.lm_credit_kind not null,
    "delta" integer not null,
    "reason" text not null,
    "campaign_id" uuid,
    "event_ref" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_credit_ledger" enable row level security;


  create table "public"."lm_geo_cities" (
    "geoname_id" integer not null,
    "name" text not null,
    "ascii_name" text not null,
    "country_code" character(2) not null,
    "admin1_code" text,
    "population" integer not null default 0,
    "latitude" double precision not null,
    "longitude" double precision not null,
    "timezone" text
      );


alter table "public"."lm_geo_cities" enable row level security;


  create table "public"."lm_plan_variants" (
    "variant_id" text not null,
    "plan_id" text not null,
    "interval" text not null
      );


alter table "public"."lm_plan_variants" enable row level security;


  create table "public"."lm_plans" (
    "id" text not null,
    "name" text not null,
    "seats" integer,
    "spaces" integer not null,
    "discovery_credits" integer not null,
    "outreach_credits" integer not null,
    "daily_send_limit" integer not null,
    "active_campaigns" integer,
    "auto_validation" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_plans" enable row level security;


  create table "public"."lm_prospects" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "space_id" uuid not null,
    "google_place_id" text,
    "name" character varying(500) not null,
    "category" character varying(255),
    "rating" numeric(2,1),
    "review_count" integer,
    "address" text,
    "country_code" character(2),
    "phone" character varying(50),
    "website" character varying(1000),
    "site_key" text not null,
    "found_email" character varying(320),
    "maps_url" character varying(1000),
    "source" public.lm_prospect_source not null default 'maps'::public.lm_prospect_source,
    "is_chain" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_prospects" enable row level security;


  create table "public"."lm_replies" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "attempt_id" uuid not null,
    "kind" public.lm_reply_kind not null,
    "source" public.lm_reply_source not null default 'manual'::public.lm_reply_source,
    "note" text,
    "replied_at" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_replies" enable row level security;


  create table "public"."lm_searches" (
    "id" bigint generated always as identity not null,
    "account_id" uuid not null,
    "campaign_id" uuid not null,
    "country_code" character(2) not null,
    "category" text not null,
    "zone_key" text not null,
    "wave" integer not null default 1,
    "cards_seen" integer not null default 0,
    "cards_new" integer not null default 0,
    "cards_kept" integer not null default 0,
    "duration_ms" integer,
    "error" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_searches" enable row level security;


  create table "public"."lm_sender_profiles" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "space_id" uuid not null,
    "civility" character varying(50),
    "first_name" character varying(100) not null,
    "last_name" character varying(100) not null,
    "job_title" character varying(150),
    "company" character varying(255) not null,
    "email" character varying(320) not null,
    "phone" character varying(50),
    "website" character varying(500),
    "address" character varying(500),
    "zip" character varying(20),
    "city" character varying(150),
    "country_code" character(2) not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_sender_profiles" enable row level security;


  create table "public"."lm_spaces" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "name" character varying(255) not null,
    "country_code" character(2) not null,
    "language_code" character varying(5) not null default 'en'::character varying,
    "ready_forms_cap" integer not null default 500,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_spaces" enable row level security;


  create table "public"."lm_suppressions" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid,
    "space_id" uuid,
    "site_key" text not null,
    "reason" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_suppressions" enable row level security;


  create table "public"."lm_tasks" (
    "id" bigint generated always as identity not null,
    "account_id" uuid not null,
    "kind" public.lm_task_kind not null,
    "payload" jsonb not null default '{}'::jsonb,
    "idempotency_key" text not null,
    "status" public.lm_task_status not null default 'queued'::public.lm_task_status,
    "priority" integer not null default 100,
    "attempts" integer not null default 0,
    "max_attempts" integer not null default 3,
    "run_after" timestamp with time zone not null default now(),
    "worker_id" text,
    "locked_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "result" jsonb,
    "error" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_tasks" enable row level security;

CREATE INDEX ix_lm_attempts_account_id ON public.lm_attempts USING btree (account_id);

CREATE INDEX ix_lm_attempts_campaign_id_status ON public.lm_attempts USING btree (campaign_id, status);

CREATE INDEX ix_lm_attempts_space_id_status ON public.lm_attempts USING btree (space_id, status);

CREATE INDEX ix_lm_campaigns_account_id ON public.lm_campaigns USING btree (account_id);

CREATE INDEX ix_lm_campaigns_space_id_created_at ON public.lm_campaigns USING btree (space_id, created_at DESC);

CREATE INDEX ix_lm_credit_ledger_account_id_created_at ON public.lm_credit_ledger USING btree (account_id, created_at DESC);

CREATE INDEX ix_lm_geo_cities_ascii_name ON public.lm_geo_cities USING btree (ascii_name text_pattern_ops);

CREATE INDEX ix_lm_geo_cities_country_population ON public.lm_geo_cities USING btree (country_code, population DESC);

CREATE INDEX ix_lm_prospects_account_id ON public.lm_prospects USING btree (account_id);

CREATE INDEX ix_lm_prospects_space_id_created_at ON public.lm_prospects USING btree (space_id, created_at DESC);

CREATE INDEX ix_lm_prospects_space_id_google_place_id ON public.lm_prospects USING btree (space_id, google_place_id);

CREATE INDEX ix_lm_replies_account_id_replied_at ON public.lm_replies USING btree (account_id, replied_at DESC);

CREATE INDEX ix_lm_searches_campaign_id_created_at ON public.lm_searches USING btree (campaign_id, created_at DESC);

CREATE INDEX ix_lm_sender_profiles_account_id ON public.lm_sender_profiles USING btree (account_id);

CREATE INDEX ix_lm_spaces_account_id_created_at ON public.lm_spaces USING btree (account_id, created_at DESC);

CREATE INDEX ix_lm_suppressions_site_key ON public.lm_suppressions USING btree (site_key);

CREATE INDEX ix_lm_tasks_account_id_created_at ON public.lm_tasks USING btree (account_id, created_at DESC);

CREATE INDEX ix_lm_tasks_queue ON public.lm_tasks USING btree (kind, priority, run_after) WHERE (status = 'queued'::public.lm_task_status);

CREATE UNIQUE INDEX lm_account_credits_pkey ON public.lm_account_credits USING btree (account_id);

CREATE UNIQUE INDEX lm_attempts_pkey ON public.lm_attempts USING btree (id);

CREATE UNIQUE INDEX lm_attempts_prospect_unique_per_space ON public.lm_attempts USING btree (space_id, prospect_id);

CREATE UNIQUE INDEX lm_campaigns_pkey ON public.lm_campaigns USING btree (id);

CREATE UNIQUE INDEX lm_country_coverage_pkey ON public.lm_country_coverage USING btree (country_code);

CREATE UNIQUE INDEX lm_credit_ledger_event_ref_unique ON public.lm_credit_ledger USING btree (event_ref);

CREATE UNIQUE INDEX lm_credit_ledger_pkey ON public.lm_credit_ledger USING btree (id);

CREATE UNIQUE INDEX lm_geo_cities_pkey ON public.lm_geo_cities USING btree (geoname_id);

CREATE UNIQUE INDEX lm_plan_variants_pkey ON public.lm_plan_variants USING btree (variant_id);

CREATE UNIQUE INDEX lm_plans_pkey ON public.lm_plans USING btree (id);

CREATE UNIQUE INDEX lm_prospects_pkey ON public.lm_prospects USING btree (id);

CREATE UNIQUE INDEX lm_prospects_site_key_unique_per_space ON public.lm_prospects USING btree (space_id, site_key);

CREATE UNIQUE INDEX lm_replies_attempt_unique ON public.lm_replies USING btree (attempt_id);

CREATE UNIQUE INDEX lm_replies_pkey ON public.lm_replies USING btree (id);

CREATE UNIQUE INDEX lm_searches_pkey ON public.lm_searches USING btree (id);

CREATE UNIQUE INDEX lm_searches_unique_per_wave ON public.lm_searches USING btree (campaign_id, category, zone_key, wave);

CREATE UNIQUE INDEX lm_sender_profiles_pkey ON public.lm_sender_profiles USING btree (id);

CREATE UNIQUE INDEX lm_sender_profiles_space_unique ON public.lm_sender_profiles USING btree (space_id);

CREATE UNIQUE INDEX lm_spaces_name_unique_per_account ON public.lm_spaces USING btree (account_id, name);

CREATE UNIQUE INDEX lm_spaces_pkey ON public.lm_spaces USING btree (id);

CREATE UNIQUE INDEX lm_suppressions_pkey ON public.lm_suppressions USING btree (id);

CREATE UNIQUE INDEX lm_tasks_idempotency_key_unique ON public.lm_tasks USING btree (idempotency_key);

CREATE UNIQUE INDEX lm_tasks_pkey ON public.lm_tasks USING btree (id);

CREATE UNIQUE INDEX ux_lm_suppressions_scope_site_key ON public.lm_suppressions USING btree (COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(space_id, '00000000-0000-0000-0000-000000000000'::uuid), site_key);

alter table "public"."lm_account_credits" add constraint "lm_account_credits_pkey" PRIMARY KEY using index "lm_account_credits_pkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_pkey" PRIMARY KEY using index "lm_attempts_pkey";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_pkey" PRIMARY KEY using index "lm_campaigns_pkey";

alter table "public"."lm_country_coverage" add constraint "lm_country_coverage_pkey" PRIMARY KEY using index "lm_country_coverage_pkey";

alter table "public"."lm_credit_ledger" add constraint "lm_credit_ledger_pkey" PRIMARY KEY using index "lm_credit_ledger_pkey";

alter table "public"."lm_geo_cities" add constraint "lm_geo_cities_pkey" PRIMARY KEY using index "lm_geo_cities_pkey";

alter table "public"."lm_plan_variants" add constraint "lm_plan_variants_pkey" PRIMARY KEY using index "lm_plan_variants_pkey";

alter table "public"."lm_plans" add constraint "lm_plans_pkey" PRIMARY KEY using index "lm_plans_pkey";

alter table "public"."lm_prospects" add constraint "lm_prospects_pkey" PRIMARY KEY using index "lm_prospects_pkey";

alter table "public"."lm_replies" add constraint "lm_replies_pkey" PRIMARY KEY using index "lm_replies_pkey";

alter table "public"."lm_searches" add constraint "lm_searches_pkey" PRIMARY KEY using index "lm_searches_pkey";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_pkey" PRIMARY KEY using index "lm_sender_profiles_pkey";

alter table "public"."lm_spaces" add constraint "lm_spaces_pkey" PRIMARY KEY using index "lm_spaces_pkey";

alter table "public"."lm_suppressions" add constraint "lm_suppressions_pkey" PRIMARY KEY using index "lm_suppressions_pkey";

alter table "public"."lm_tasks" add constraint "lm_tasks_pkey" PRIMARY KEY using index "lm_tasks_pkey";

alter table "public"."lm_account_credits" add constraint "lm_account_credits_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_account_credits" validate constraint "lm_account_credits_account_id_fkey";

alter table "public"."lm_account_credits" add constraint "lm_account_credits_non_negative" CHECK (((discovery_balance >= 0) AND (outreach_balance >= 0))) not valid;

alter table "public"."lm_account_credits" validate constraint "lm_account_credits_non_negative";

alter table "public"."lm_account_credits" add constraint "lm_account_credits_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES public.lm_plans(id) ON DELETE SET NULL not valid;

alter table "public"."lm_account_credits" validate constraint "lm_account_credits_plan_id_fkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_account_id_fkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_campaign_id_fkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_created_by_fkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_prospect_id_fkey" FOREIGN KEY (prospect_id) REFERENCES public.lm_prospects(id) ON DELETE CASCADE not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_prospect_id_fkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_prospect_unique_per_space" UNIQUE using index "lm_attempts_prospect_unique_per_space";

alter table "public"."lm_attempts" add constraint "lm_attempts_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_space_id_fkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_updated_by_fkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_validated_by_fkey" FOREIGN KEY (validated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_validated_by_fkey";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_account_id_fkey";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_country_code_upper" CHECK (((country_code)::text = upper((country_code)::text))) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_country_code_upper";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_created_by_fkey";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_daily_limit_positive" CHECK ((daily_limit > 0)) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_daily_limit_positive";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_name_not_blank" CHECK ((length(TRIM(BOTH FROM name)) > 0)) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_name_not_blank";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_space_id_fkey";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_updated_by_fkey";

alter table "public"."lm_country_coverage" add constraint "lm_country_coverage_code_upper" CHECK (((country_code)::text = upper((country_code)::text))) not valid;

alter table "public"."lm_country_coverage" validate constraint "lm_country_coverage_code_upper";

alter table "public"."lm_credit_ledger" add constraint "lm_credit_ledger_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_credit_ledger" validate constraint "lm_credit_ledger_account_id_fkey";

alter table "public"."lm_credit_ledger" add constraint "lm_credit_ledger_delta_not_zero" CHECK ((delta <> 0)) not valid;

alter table "public"."lm_credit_ledger" validate constraint "lm_credit_ledger_delta_not_zero";

alter table "public"."lm_credit_ledger" add constraint "lm_credit_ledger_event_ref_unique" UNIQUE using index "lm_credit_ledger_event_ref_unique";

alter table "public"."lm_plan_variants" add constraint "lm_plan_variants_interval" CHECK (("interval" = ANY (ARRAY['month'::text, 'year'::text]))) not valid;

alter table "public"."lm_plan_variants" validate constraint "lm_plan_variants_interval";

alter table "public"."lm_plan_variants" add constraint "lm_plan_variants_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES public.lm_plans(id) ON DELETE CASCADE not valid;

alter table "public"."lm_plan_variants" validate constraint "lm_plan_variants_plan_id_fkey";

alter table "public"."lm_plans" add constraint "lm_plans_name_not_blank" CHECK ((length(TRIM(BOTH FROM name)) > 0)) not valid;

alter table "public"."lm_plans" validate constraint "lm_plans_name_not_blank";

alter table "public"."lm_prospects" add constraint "lm_prospects_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_account_id_fkey";

alter table "public"."lm_prospects" add constraint "lm_prospects_country_code_upper" CHECK (((country_code IS NULL) OR ((country_code)::text = upper((country_code)::text)))) not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_country_code_upper";

alter table "public"."lm_prospects" add constraint "lm_prospects_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_created_by_fkey";

alter table "public"."lm_prospects" add constraint "lm_prospects_site_key_not_blank" CHECK ((length(TRIM(BOTH FROM site_key)) > 0)) not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_site_key_not_blank";

alter table "public"."lm_prospects" add constraint "lm_prospects_site_key_unique_per_space" UNIQUE using index "lm_prospects_site_key_unique_per_space";

alter table "public"."lm_prospects" add constraint "lm_prospects_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_space_id_fkey";

alter table "public"."lm_prospects" add constraint "lm_prospects_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_updated_by_fkey";

alter table "public"."lm_replies" add constraint "lm_replies_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_replies" validate constraint "lm_replies_account_id_fkey";

alter table "public"."lm_replies" add constraint "lm_replies_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES public.lm_attempts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_replies" validate constraint "lm_replies_attempt_id_fkey";

alter table "public"."lm_replies" add constraint "lm_replies_attempt_unique" UNIQUE using index "lm_replies_attempt_unique";

alter table "public"."lm_replies" add constraint "lm_replies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_replies" validate constraint "lm_replies_created_by_fkey";

alter table "public"."lm_replies" add constraint "lm_replies_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_replies" validate constraint "lm_replies_updated_by_fkey";

alter table "public"."lm_searches" add constraint "lm_searches_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_searches" validate constraint "lm_searches_account_id_fkey";

alter table "public"."lm_searches" add constraint "lm_searches_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_searches" validate constraint "lm_searches_campaign_id_fkey";

alter table "public"."lm_searches" add constraint "lm_searches_unique_per_wave" UNIQUE using index "lm_searches_unique_per_wave";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_sender_profiles" validate constraint "lm_sender_profiles_account_id_fkey";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_country_code_upper" CHECK (((country_code)::text = upper((country_code)::text))) not valid;

alter table "public"."lm_sender_profiles" validate constraint "lm_sender_profiles_country_code_upper";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_sender_profiles" validate constraint "lm_sender_profiles_created_by_fkey";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_required_not_blank" CHECK (((length(TRIM(BOTH FROM first_name)) > 0) AND (length(TRIM(BOTH FROM last_name)) > 0) AND (length(TRIM(BOTH FROM company)) > 0) AND (length(TRIM(BOTH FROM email)) > 0))) not valid;

alter table "public"."lm_sender_profiles" validate constraint "lm_sender_profiles_required_not_blank";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_sender_profiles" validate constraint "lm_sender_profiles_space_id_fkey";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_space_unique" UNIQUE using index "lm_sender_profiles_space_unique";

alter table "public"."lm_sender_profiles" add constraint "lm_sender_profiles_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_sender_profiles" validate constraint "lm_sender_profiles_updated_by_fkey";

alter table "public"."lm_spaces" add constraint "lm_spaces_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_spaces" validate constraint "lm_spaces_account_id_fkey";

alter table "public"."lm_spaces" add constraint "lm_spaces_country_code_upper" CHECK (((country_code)::text = upper((country_code)::text))) not valid;

alter table "public"."lm_spaces" validate constraint "lm_spaces_country_code_upper";

alter table "public"."lm_spaces" add constraint "lm_spaces_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_spaces" validate constraint "lm_spaces_created_by_fkey";

alter table "public"."lm_spaces" add constraint "lm_spaces_name_not_blank" CHECK ((length(TRIM(BOTH FROM name)) > 0)) not valid;

alter table "public"."lm_spaces" validate constraint "lm_spaces_name_not_blank";

alter table "public"."lm_spaces" add constraint "lm_spaces_name_unique_per_account" UNIQUE using index "lm_spaces_name_unique_per_account";

alter table "public"."lm_spaces" add constraint "lm_spaces_ready_forms_cap_positive" CHECK ((ready_forms_cap > 0)) not valid;

alter table "public"."lm_spaces" validate constraint "lm_spaces_ready_forms_cap_positive";

alter table "public"."lm_spaces" add constraint "lm_spaces_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_spaces" validate constraint "lm_spaces_updated_by_fkey";

alter table "public"."lm_suppressions" add constraint "lm_suppressions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_suppressions" validate constraint "lm_suppressions_account_id_fkey";

alter table "public"."lm_suppressions" add constraint "lm_suppressions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_suppressions" validate constraint "lm_suppressions_created_by_fkey";

alter table "public"."lm_suppressions" add constraint "lm_suppressions_scope" CHECK (((space_id IS NULL) OR (account_id IS NOT NULL))) not valid;

alter table "public"."lm_suppressions" validate constraint "lm_suppressions_scope";

alter table "public"."lm_suppressions" add constraint "lm_suppressions_site_key_not_blank" CHECK ((length(TRIM(BOTH FROM site_key)) > 0)) not valid;

alter table "public"."lm_suppressions" validate constraint "lm_suppressions_site_key_not_blank";

alter table "public"."lm_suppressions" add constraint "lm_suppressions_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_suppressions" validate constraint "lm_suppressions_space_id_fkey";

alter table "public"."lm_suppressions" add constraint "lm_suppressions_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_suppressions" validate constraint "lm_suppressions_updated_by_fkey";

alter table "public"."lm_tasks" add constraint "lm_tasks_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_tasks" validate constraint "lm_tasks_account_id_fkey";

alter table "public"."lm_tasks" add constraint "lm_tasks_idempotency_key_unique" UNIQUE using index "lm_tasks_idempotency_key_unique";

alter table "public"."lm_tasks" add constraint "lm_tasks_max_attempts_positive" CHECK ((max_attempts > 0)) not valid;

alter table "public"."lm_tasks" validate constraint "lm_tasks_max_attempts_positive";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_claim_task(p_kinds public.lm_task_kind[], p_worker_id text)
 RETURNS SETOF public.lm_tasks
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.lm_tasks t
     set status = 'running',
         worker_id = p_worker_id,
         locked_at = now(),
         attempts = t.attempts + 1
   where t.id = (
     select id from public.lm_tasks
      where status = 'queued' and kind = any (p_kinds) and run_after <= now()
      order by priority, created_at
      for update skip locked
      limit 1
   )
  returning t.*;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_complete_task(p_id bigint, p_result jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.lm_tasks
     set status = 'done', result = p_result, finished_at = now(), error = null
   where id = p_id and status = 'running';
$function$
;

CREATE OR REPLACE FUNCTION public.lm_debit_credits(p_account_id uuid, p_kind public.lm_credit_kind, p_quantity integer, p_event_ref text, p_reason text, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_balance integer;
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  if exists (select 1 from public.lm_credit_ledger where event_ref = p_event_ref) then
    return false;
  end if;

  if p_kind = 'discovery' then
    select discovery_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  else
    select outreach_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  end if;

  if v_balance is null or v_balance < p_quantity then
    return false;
  end if;

  if p_kind = 'discovery' then
    update public.lm_account_credits set discovery_balance = discovery_balance - p_quantity
      where account_id = p_account_id;
  else
    update public.lm_account_credits set outreach_balance = outreach_balance - p_quantity
      where account_id = p_account_id;
  end if;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, campaign_id, event_ref)
    values (p_account_id, p_kind, -p_quantity, p_reason, p_campaign_id, p_event_ref);

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_enforce_seat_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  select count(*) into v_count from public.accounts_memberships where account_id = new.account_id;

  if v_count >= public.lm_seat_limit(new.account_id) then
    raise exception 'seat quota reached for account %', new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_enforce_space_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  select count(*) into v_count from public.lm_spaces where account_id = new.account_id;

  if v_count >= public.lm_space_limit(new.account_id) then
    raise exception 'space quota reached for account %', new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_fail_task(p_id bigint, p_error text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.lm_tasks
     set status = case when attempts >= max_attempts then 'failed'::public.lm_task_status else 'queued'::public.lm_task_status end,
         error = p_error,
         worker_id = null,
         locked_at = null,
         finished_at = case when attempts >= max_attempts then now() else null end,
         run_after = now() + make_interval(secs => 30 * power(2, attempts))
   where id = p_id and status = 'running';
$function$
;

CREATE OR REPLACE FUNCTION public.lm_requeue_stale_tasks(p_stale interval DEFAULT '00:15:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with stale as (
    update public.lm_tasks
       set status = case when attempts >= max_attempts then 'failed'::public.lm_task_status else 'queued'::public.lm_task_status end,
           error = coalesce(error, 'worker timeout'),
           worker_id = null,
           locked_at = null
     where status = 'running' and locked_at < now() - p_stale
    returning 1
  )
  select count(*) into v_count from stale;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_reset_credits(p_account_id uuid, p_plan_id text, p_period_ends_at timestamp with time zone, p_event_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.lm_plans%rowtype;
begin
  select * into v_plan from public.lm_plans where id = p_plan_id;

  if v_plan.id is null then
    raise exception 'unknown plan %', p_plan_id;
  end if;

  if exists (select 1 from public.lm_credit_ledger where event_ref = p_event_ref || ':discovery') then
    return;
  end if;

  insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance, period_ends_at)
    values (p_account_id, p_plan_id, v_plan.discovery_credits, v_plan.outreach_credits, p_period_ends_at)
  on conflict (account_id) do update set
    plan_id = excluded.plan_id,
    discovery_balance = excluded.discovery_balance,
    outreach_balance = excluded.outreach_balance,
    period_ends_at = excluded.period_ends_at;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    values (p_account_id, 'discovery', v_plan.discovery_credits, 'renewal', p_event_ref || ':discovery'),
           (p_account_id, 'outreach', v_plan.outreach_credits, 'renewal', p_event_ref || ':outreach');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_seat_limit(p_account_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Sans forfait, aucune limite : un compte sans abonnement n'a pas de crédits, donc inviter ne donne rien.
  select coalesce(p.seats, 2147483647)
  from public.lm_account_credits c
  left join public.lm_plans p on p.id = c.plan_id
  where c.account_id = p_account_id
  union all
  select 2147483647
  where not exists (select 1 from public.lm_account_credits where account_id = p_account_id)
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_space_limit(p_account_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(p.spaces, 1)
  from public.lm_account_credits c
  left join public.lm_plans p on p.id = c.plan_id
  where c.account_id = p_account_id
  union all
  select 1
  where not exists (select 1 from public.lm_account_credits where account_id = p_account_id)
  limit 1;
$function$
;

-- Supabase accorde par défaut references/trigger/truncate/maintain à anon, authenticated et service_role :
-- on retire tout avant d'accorder uniquement les verbes nécessaires (truncate contourne la RLS).
revoke all on public.lm_account_credits from anon, authenticated, service_role;
revoke all on public.lm_attempts from anon, authenticated, service_role;
revoke all on public.lm_campaigns from anon, authenticated, service_role;
revoke all on public.lm_country_coverage from anon, authenticated, service_role;
revoke all on public.lm_credit_ledger from anon, authenticated, service_role;
revoke all on public.lm_geo_cities from anon, authenticated, service_role;
revoke all on public.lm_plan_variants from anon, authenticated, service_role;
revoke all on public.lm_plans from anon, authenticated, service_role;
revoke all on public.lm_prospects from anon, authenticated, service_role;
revoke all on public.lm_replies from anon, authenticated, service_role;
revoke all on public.lm_searches from anon, authenticated, service_role;
revoke all on public.lm_sender_profiles from anon, authenticated, service_role;
revoke all on public.lm_spaces from anon, authenticated, service_role;
revoke all on public.lm_suppressions from anon, authenticated, service_role;
revoke all on public.lm_tasks from anon, authenticated, service_role;

grant select on table "public"."lm_account_credits" to "authenticated";

grant delete on table "public"."lm_account_credits" to "service_role";

grant insert on table "public"."lm_account_credits" to "service_role";

grant select on table "public"."lm_account_credits" to "service_role";

grant update on table "public"."lm_account_credits" to "service_role";

grant select on table "public"."lm_attempts" to "authenticated";

grant delete on table "public"."lm_attempts" to "service_role";

grant insert on table "public"."lm_attempts" to "service_role";

grant select on table "public"."lm_attempts" to "service_role";

grant update on table "public"."lm_attempts" to "service_role";

grant delete on table "public"."lm_campaigns" to "authenticated";

grant insert on table "public"."lm_campaigns" to "authenticated";

grant select on table "public"."lm_campaigns" to "authenticated";

grant delete on table "public"."lm_campaigns" to "service_role";

grant insert on table "public"."lm_campaigns" to "service_role";

grant select on table "public"."lm_campaigns" to "service_role";

grant update on table "public"."lm_campaigns" to "service_role";

grant select on table "public"."lm_country_coverage" to "authenticated";

grant delete on table "public"."lm_country_coverage" to "service_role";

grant insert on table "public"."lm_country_coverage" to "service_role";

grant select on table "public"."lm_country_coverage" to "service_role";

grant update on table "public"."lm_country_coverage" to "service_role";

grant select on table "public"."lm_credit_ledger" to "authenticated";

grant delete on table "public"."lm_credit_ledger" to "service_role";

grant insert on table "public"."lm_credit_ledger" to "service_role";

grant select on table "public"."lm_credit_ledger" to "service_role";

grant update on table "public"."lm_credit_ledger" to "service_role";

grant select on table "public"."lm_geo_cities" to "authenticated";

grant delete on table "public"."lm_geo_cities" to "service_role";

grant insert on table "public"."lm_geo_cities" to "service_role";

grant select on table "public"."lm_geo_cities" to "service_role";

grant update on table "public"."lm_geo_cities" to "service_role";

grant select on table "public"."lm_plan_variants" to "authenticated";

grant delete on table "public"."lm_plan_variants" to "service_role";

grant insert on table "public"."lm_plan_variants" to "service_role";

grant select on table "public"."lm_plan_variants" to "service_role";

grant update on table "public"."lm_plan_variants" to "service_role";

grant select on table "public"."lm_plans" to "authenticated";

grant delete on table "public"."lm_plans" to "service_role";

grant insert on table "public"."lm_plans" to "service_role";

grant select on table "public"."lm_plans" to "service_role";

grant update on table "public"."lm_plans" to "service_role";

grant insert on table "public"."lm_prospects" to "authenticated";

grant select on table "public"."lm_prospects" to "authenticated";

grant delete on table "public"."lm_prospects" to "service_role";

grant insert on table "public"."lm_prospects" to "service_role";

grant select on table "public"."lm_prospects" to "service_role";

grant update on table "public"."lm_prospects" to "service_role";

grant insert on table "public"."lm_replies" to "authenticated";

grant select on table "public"."lm_replies" to "authenticated";

grant delete on table "public"."lm_replies" to "service_role";

grant insert on table "public"."lm_replies" to "service_role";

grant select on table "public"."lm_replies" to "service_role";

grant update on table "public"."lm_replies" to "service_role";

grant select on table "public"."lm_searches" to "authenticated";

grant delete on table "public"."lm_searches" to "service_role";

grant insert on table "public"."lm_searches" to "service_role";

grant select on table "public"."lm_searches" to "service_role";

grant update on table "public"."lm_searches" to "service_role";

grant insert on table "public"."lm_sender_profiles" to "authenticated";

grant select on table "public"."lm_sender_profiles" to "authenticated";

grant delete on table "public"."lm_sender_profiles" to "service_role";

grant insert on table "public"."lm_sender_profiles" to "service_role";

grant select on table "public"."lm_sender_profiles" to "service_role";

grant update on table "public"."lm_sender_profiles" to "service_role";

grant delete on table "public"."lm_spaces" to "authenticated";

grant insert on table "public"."lm_spaces" to "authenticated";

grant select on table "public"."lm_spaces" to "authenticated";

grant delete on table "public"."lm_spaces" to "service_role";

grant insert on table "public"."lm_spaces" to "service_role";

grant select on table "public"."lm_spaces" to "service_role";

grant update on table "public"."lm_spaces" to "service_role";

grant delete on table "public"."lm_suppressions" to "authenticated";

grant insert on table "public"."lm_suppressions" to "authenticated";

grant select on table "public"."lm_suppressions" to "authenticated";

grant delete on table "public"."lm_suppressions" to "service_role";

grant insert on table "public"."lm_suppressions" to "service_role";

grant select on table "public"."lm_suppressions" to "service_role";

grant update on table "public"."lm_suppressions" to "service_role";

grant select on table "public"."lm_tasks" to "authenticated";

grant delete on table "public"."lm_tasks" to "service_role";

grant insert on table "public"."lm_tasks" to "service_role";

grant select on table "public"."lm_tasks" to "service_role";

grant update on table "public"."lm_tasks" to "service_role";


  create policy "lm_account_credits_read"
  on "public"."lm_account_credits"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_account_credits"
  on "public"."lm_account_credits"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_attempts_read"
  on "public"."lm_attempts"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_attempts"
  on "public"."lm_attempts"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_campaigns_delete"
  on "public"."lm_campaigns"
  as permissive
  for delete
  to authenticated
using (public.has_permission(( SELECT auth.uid() AS uid), account_id, 'settings.manage'::public.app_permissions));



  create policy "lm_campaigns_insert"
  on "public"."lm_campaigns"
  as permissive
  for insert
  to authenticated
with check ((public.has_role_on_account(account_id) AND (EXISTS ( SELECT 1
   FROM public.lm_spaces s
  WHERE ((s.id = lm_campaigns.space_id) AND (s.account_id = lm_campaigns.account_id))))));



  create policy "lm_campaigns_read"
  on "public"."lm_campaigns"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "lm_campaigns_update"
  on "public"."lm_campaigns"
  as permissive
  for update
  to authenticated
using (public.has_role_on_account(account_id))
with check (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_campaigns"
  on "public"."lm_campaigns"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_country_coverage_read"
  on "public"."lm_country_coverage"
  as permissive
  for select
  to authenticated
using (true);



  create policy "lm_credit_ledger_read"
  on "public"."lm_credit_ledger"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_credit_ledger"
  on "public"."lm_credit_ledger"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_geo_cities_read"
  on "public"."lm_geo_cities"
  as permissive
  for select
  to authenticated
using (true);



  create policy "lm_plan_variants_read"
  on "public"."lm_plan_variants"
  as permissive
  for select
  to authenticated
using (true);



  create policy "lm_plans_read"
  on "public"."lm_plans"
  as permissive
  for select
  to authenticated
using (true);



  create policy "lm_prospects_insert"
  on "public"."lm_prospects"
  as permissive
  for insert
  to authenticated
with check ((public.has_role_on_account(account_id) AND (EXISTS ( SELECT 1
   FROM public.lm_spaces s
  WHERE ((s.id = lm_prospects.space_id) AND (s.account_id = lm_prospects.account_id))))));



  create policy "lm_prospects_read"
  on "public"."lm_prospects"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_prospects"
  on "public"."lm_prospects"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_replies_insert"
  on "public"."lm_replies"
  as permissive
  for insert
  to authenticated
with check ((public.has_role_on_account(account_id) AND (EXISTS ( SELECT 1
   FROM public.lm_attempts a
  WHERE ((a.id = lm_replies.attempt_id) AND (a.account_id = lm_replies.account_id))))));



  create policy "lm_replies_read"
  on "public"."lm_replies"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "lm_replies_update"
  on "public"."lm_replies"
  as permissive
  for update
  to authenticated
using (public.has_role_on_account(account_id))
with check (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_replies"
  on "public"."lm_replies"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_searches_read"
  on "public"."lm_searches"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_searches"
  on "public"."lm_searches"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_sender_profiles_insert"
  on "public"."lm_sender_profiles"
  as permissive
  for insert
  to authenticated
with check ((public.has_role_on_account(account_id) AND (EXISTS ( SELECT 1
   FROM public.lm_spaces s
  WHERE ((s.id = lm_sender_profiles.space_id) AND (s.account_id = lm_sender_profiles.account_id))))));



  create policy "lm_sender_profiles_read"
  on "public"."lm_sender_profiles"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "lm_sender_profiles_update"
  on "public"."lm_sender_profiles"
  as permissive
  for update
  to authenticated
using (public.has_role_on_account(account_id))
with check (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_sender_profiles"
  on "public"."lm_sender_profiles"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_spaces_delete"
  on "public"."lm_spaces"
  as permissive
  for delete
  to authenticated
using (public.has_permission(( SELECT auth.uid() AS uid), account_id, 'settings.manage'::public.app_permissions));



  create policy "lm_spaces_insert"
  on "public"."lm_spaces"
  as permissive
  for insert
  to authenticated
with check (public.has_role_on_account(account_id));



  create policy "lm_spaces_read"
  on "public"."lm_spaces"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "lm_spaces_update"
  on "public"."lm_spaces"
  as permissive
  for update
  to authenticated
using (public.has_role_on_account(account_id))
with check (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_spaces"
  on "public"."lm_spaces"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_suppressions_delete"
  on "public"."lm_suppressions"
  as permissive
  for delete
  to authenticated
using (((account_id IS NOT NULL) AND public.has_role_on_account(account_id)));



  create policy "lm_suppressions_insert"
  on "public"."lm_suppressions"
  as permissive
  for insert
  to authenticated
with check (((account_id IS NOT NULL) AND public.has_role_on_account(account_id) AND ((space_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.lm_spaces s
  WHERE ((s.id = lm_suppressions.space_id) AND (s.account_id = lm_suppressions.account_id)))))));



  create policy "lm_suppressions_read"
  on "public"."lm_suppressions"
  as permissive
  for select
  to authenticated
using (((account_id IS NULL) OR public.has_role_on_account(account_id)));



  create policy "restrict_mfa_lm_suppressions"
  on "public"."lm_suppressions"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_tasks_read"
  on "public"."lm_tasks"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_tasks"
  on "public"."lm_tasks"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());


CREATE TRIGGER lm_accounts_memberships_seat_quota BEFORE INSERT ON public.accounts_memberships FOR EACH ROW EXECUTE FUNCTION public.lm_enforce_seat_quota();

CREATE TRIGGER lm_account_credits_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_account_credits FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_attempts_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_attempts FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_attempts_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_attempts FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

CREATE TRIGGER lm_campaigns_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_campaigns FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_campaigns_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_campaigns FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

CREATE TRIGGER lm_country_coverage_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_country_coverage FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_plans_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_plans FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_prospects_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_prospects FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_prospects_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_prospects FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

CREATE TRIGGER lm_replies_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_replies FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_replies_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_replies FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

CREATE TRIGGER lm_sender_profiles_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_sender_profiles FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_sender_profiles_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_sender_profiles FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

CREATE TRIGGER lm_spaces_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_spaces FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_spaces_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_spaces FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

CREATE TRIGGER lm_spaces_space_quota BEFORE INSERT ON public.lm_spaces FOR EACH ROW EXECUTE FUNCTION public.lm_enforce_space_quota();

CREATE TRIGGER lm_suppressions_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_suppressions FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_suppressions_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_suppressions FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

CREATE TRIGGER lm_tasks_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_tasks FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- Mises à jour colonne par colonne pour les utilisateurs : jamais les colonnes d'appartenance (id, account_id, space_id…)
grant update (name, country_code, language_code, ready_forms_cap) on table public.lm_spaces to authenticated;

grant update (civility, first_name, last_name, job_title, company, email, phone, website, address, zip, city, country_code)
  on table public.lm_sender_profiles to authenticated;

grant update (name, status, country_code, targeting, filters, templates, daily_limit, auto_validation)
  on table public.lm_campaigns to authenticated;

grant update (kind, source, note, replied_at) on table public.lm_replies to authenticated;

-- Abonnement supprimé (résiliation effective) : l'organisation perd son forfait et ses crédits.
create or replace function public.lm_on_subscription_deleted() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  update public.lm_account_credits
     set plan_id = null, discovery_balance = 0, outreach_balance = 0, period_ends_at = null
   where account_id = old.account_id;

  return old;
end;
$$;

revoke all on function public.lm_on_subscription_deleted() from public;

create trigger lm_subscriptions_after_delete
  after delete on public.subscriptions
  for each row execute function public.lm_on_subscription_deleted();

-- ---------------------------------------------------------------- Données de référence LeadMaker
-- Forfaits (cahier des charges, section 10). null = illimité.
insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, daily_send_limit, active_campaigns, auto_validation)
values
  ('growth',   'Growth',   2,    3,  15000,  5000,  500,  1,    false),
  ('business', 'Business', 5,    5,  45000,  15000, 1000, 3,    true),
  ('scale',    'Scale',    null, 10, 105000, 35000, 1500, null, true)
on conflict (id) do update set
  name = excluded.name, seats = excluded.seats, spaces = excluded.spaces,
  discovery_credits = excluded.discovery_credits, outreach_credits = excluded.outreach_credits,
  daily_send_limit = excluded.daily_send_limit, active_campaigns = excluded.active_campaigns,
  auto_validation = excluded.auto_validation;

-- Identifiants de prix : valeurs de substitution, remplacées par les prix Stripe réels (voir billing.config.ts)
insert into public.lm_plan_variants (variant_id, plan_id, interval)
values
  ('price_growth_monthly',   'growth',   'month'),
  ('price_growth_yearly',    'growth',   'year'),
  ('price_business_monthly', 'business', 'month'),
  ('price_business_yearly',  'business', 'year'),
  ('price_scale_monthly',    'scale',    'month'),
  ('price_scale_yearly',     'scale',    'year')
on conflict (variant_id) do nothing;

-- Paliers de couverture : France et États-Unis vérifiés (corpus du prototype), le reste arrive par GeoNames
insert into public.lm_country_coverage (country_code, name, languages, tier)
values
  ('FR', 'France',        array['fr'], 'verified'),
  ('US', 'United States', array['en'], 'verified')
on conflict (country_code) do update set tier = excluded.tier;
