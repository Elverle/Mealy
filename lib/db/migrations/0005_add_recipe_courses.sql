ALTER TABLE "recipes" ADD COLUMN "courses" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
UPDATE "recipes" AS r
SET "tags" = CASE
  WHEN (SELECT count(*) FROM "recipe_ingredients" AS i WHERE i."recipe_id" = r."id" AND i."unit" <> 'qb') <= 6
    THEN CASE WHEN 'pochi-ingredienti' = ANY(r."tags") THEN r."tags" ELSE array_append(r."tags", 'pochi-ingredienti') END
  ELSE array_remove(r."tags", 'pochi-ingredienti')
END;
