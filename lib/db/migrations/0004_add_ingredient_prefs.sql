CREATE TABLE "ingredient_prefs" (
	"household_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"pref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_prefs_household_id_canonical_name_pk" PRIMARY KEY("household_id","canonical_name")
);
--> statement-breakpoint
ALTER TABLE "ingredient_prefs" ADD CONSTRAINT "ingredient_prefs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;