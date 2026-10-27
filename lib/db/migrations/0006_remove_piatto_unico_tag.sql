UPDATE "households" SET "meal_style_tags" = array_remove("meal_style_tags", 'piatto-unico');
--> statement-breakpoint
UPDATE "recipes" SET "tags" = array_remove("tags", 'piatto-unico');
