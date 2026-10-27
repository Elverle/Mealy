ALTER TABLE "households" ADD COLUMN "meal_compositions" jsonb DEFAULT '{"pranzo":["piatto-unico","primo","primo-contorno","secondo","secondo-contorno"],"cena":["piatto-unico","primo","primo-contorno","secondo","secondo-contorno"]}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_slots" ADD COLUMN "course" text;
--> statement-breakpoint
UPDATE "plan_slots" AS s
SET "course" = coalesce(
  (
    SELECT CASE
      WHEN 'piatto-unico' = ANY(r."courses") THEN 'piatto-unico'
      WHEN 'primo' = ANY(r."courses") THEN 'primo'
      WHEN 'secondo' = ANY(r."courses") THEN 'secondo'
    END
    FROM "recipes" AS r
    WHERE r."id" = s."recipe_id"
  ),
  'piatto-unico'
);
--> statement-breakpoint
ALTER TABLE "plan_slots" ALTER COLUMN "course" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "plan_slots_plan_day_meal_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "plan_slots_plan_day_meal_side_idx" ON "plan_slots" USING btree ("plan_id","day","meal",("course" = 'contorno'));
