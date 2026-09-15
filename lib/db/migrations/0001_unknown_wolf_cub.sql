DROP INDEX "recipes_household_id_idx";--> statement-breakpoint
DROP INDEX "recipes_tags_idx";--> statement-breakpoint
DROP INDEX "recipes_diet_flags_idx";--> statement-breakpoint
DROP INDEX "recipes_title_trgm_idx";--> statement-breakpoint
DROP INDEX "recipe_ingredients_recipe_id_idx";--> statement-breakpoint
DROP INDEX "recipe_ingredients_canonical_name_idx";--> statement-breakpoint
DROP INDEX "meal_plans_household_week_idx";--> statement-breakpoint
DROP INDEX "plan_slots_plan_day_meal_idx";--> statement-breakpoint
DROP INDEX "shopping_items_list_category_idx";--> statement-breakpoint
CREATE INDEX "recipes_household_id_idx" ON "recipes" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "recipes_tags_idx" ON "recipes" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "recipes_diet_flags_idx" ON "recipes" USING gin ("diet_flags");--> statement-breakpoint
CREATE INDEX "recipes_title_trgm_idx" ON "recipes" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_canonical_name_idx" ON "recipe_ingredients" USING btree ("canonical_name");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plans_household_week_idx" ON "meal_plans" USING btree ("household_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_slots_plan_day_meal_idx" ON "plan_slots" USING btree ("plan_id","day","meal");--> statement-breakpoint
CREATE INDEX "shopping_items_list_category_idx" ON "shopping_items" USING btree ("list_id","category");