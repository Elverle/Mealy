CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persons" integer NOT NULL,
	"meals" text[] NOT NULL,
	"diet_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"meal_style_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"appliances" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"steps" jsonb NOT NULL,
	"meal_types" text[] NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"diet_flags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"appliances_required" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"servings_base" integer NOT NULL,
	"prep_minutes" integer NOT NULL,
	"kcal_est" integer,
	"macros_est" jsonb,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"qty" numeric,
	"unit" text NOT NULL,
	"category" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "recipe_prefs" (
	"recipe_id" uuid PRIMARY KEY NOT NULL,
	"rating" integer,
	"favorite" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"day" date NOT NULL,
	"meal" text NOT NULL,
	"recipe_id" uuid,
	"servings" integer NOT NULL,
	"locked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_lists_plan_id_unique" UNIQUE("plan_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"qty" numeric,
	"unit" text,
	"category" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"recipe_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recipe_prefs" ADD CONSTRAINT "recipe_prefs_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "recipes_household_id_idx" ON "recipes" USING btree ("household_id");
--> statement-breakpoint
CREATE INDEX "recipes_tags_idx" ON "recipes" USING gin ("tags");
--> statement-breakpoint
CREATE INDEX "recipes_diet_flags_idx" ON "recipes" USING gin ("diet_flags");
--> statement-breakpoint
CREATE INDEX "recipes_title_trgm_idx" ON "recipes" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients" USING btree ("recipe_id");
--> statement-breakpoint
CREATE INDEX "recipe_ingredients_canonical_name_idx" ON "recipe_ingredients" USING btree ("canonical_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plans_household_week_idx" ON "meal_plans" USING btree ("household_id","week_start");
--> statement-breakpoint
CREATE UNIQUE INDEX "plan_slots_plan_day_meal_idx" ON "plan_slots" USING btree ("plan_id","day","meal");
--> statement-breakpoint
CREATE INDEX "shopping_items_list_category_idx" ON "shopping_items" USING btree ("list_id","category");
