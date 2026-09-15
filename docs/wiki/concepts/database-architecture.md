---
title: Architettura del Database Relazionale e Migrazioni
type: concept
created: 2026-09-15
updated: 2026-09-15
tags: [database, postgresql, drizzle, migrations, pg_trgm, architecture]
---

## Scelte Architetturali

Il modello di persistenza di Mealy si basa su **PostgreSQL 16** e **Drizzle ORM**. La scelta del paradigma relazionale rispetto a un document store NoSQL è motivata dalle forti interrelazioni strutturali del dominio culinario:
- Le ricette compongono gli slot del piano settimanale;
- Le ricette possiedono una lista normalizzata di ingredienti;
- I piani generano liste della spesa con riferimenti tracciabili agli ingredienti e alle ricette d'origine;
- Le preferenze utente (rating, blocchi, gradimento ingredienti) alterano i pesi di selezione delle ricette nel tempo.

### Ambiente di Sviluppo e Produzione
- **Sviluppo locale**: container Docker basato su immagine `postgres:16-alpine` orchestrato via `docker-compose.dev.yml`. Lo script `docker/init-db.sql` assicura l'abilitazione automatica delle estensioni necessarie.
- **Produzione**: istanza PostgreSQL serverless (es. Neon) accessibile tramite connection string `DATABASE_URL`.
- **Driver client**: `postgres.js`, integrato in `lib/db/index.ts` con istanza singleton `db = drizzle(client, { schema })`.

## Estensioni e Strategie di Indicizzazione

### Estensione `pg_trgm` (Trigrammi)
Le ricette vengono cercate frequentemente dall'utente tramite digitazione parziale o approssimata nel campo di ricerca della libreria. Per consentire query ad alte prestazioni senza ricorrere a complessi motori di ricerca esterni (Elasticsearch o Meilisearch):
- Viene abilitata l'estensione PostgreSQL `CREATE EXTENSION IF NOT EXISTS pg_trgm;`.
- La tabella `recipes` include un indice GIN trigram sulla colonna `title`:
  ```ts
  index('recipes_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`)
  ```
  Questo permette ricerche con operatore `%` (o `similarity()`) e pattern matching `ILIKE '%termine%'` estremamente reattivi anche su librerie ampie.

### Indici GIN su Array Nativi Postgres
PostgreSQL supporta nativamente le colonne di tipo array (`text[].array()`). Nel modello di Mealy, tag e flag dietetici sono memorizzati come array di stringhe.
- `recipes_tags_idx`: indice `GIN` sulla colonna `tags`.
- `recipes_diet_flags_idx`: indice `GIN` sulla colonna `diet_flags`.

Questi indici consentono al generatore di piani e ai filtri della libreria di verificare la presenza o sovrapposizione di etichette (operatori `@>` o `&&`) in tempo sub-millisecondo.

## Integrità Referenziale e Vincoli a Cascata

La coerenza relazionale è salvaguardata a livello di engine DB:
- **Cascade Deletion (`ON DELETE CASCADE`)**:
  - L'eliminazione di un `household` rimuove automaticamente tutte le sue ricette e i piani associati.
  - L'eliminazione di una `recipe` cancella in cascata i relativi `recipe_ingredients` e le `recipe_prefs`.
  - L'eliminazione di un `meal_plan` rimuove tutti i suoi `plan_slots` e la corrispondente `shopping_list` con i rispettivi `shopping_items`.
- **Set Null Deletion (`ON DELETE SET NULL`)**:
  - Se una ricetta viene cancellata dalla libreria, gli slot storici o attivi del piano (`plan_slots`) mantengono la riga impostando `recipe_id = NULL`, preservando la traccia del pasto pianificato.
- **Indici Unici di Coerenza Temporale**:
  - `meal_plans`: `UNIQUE(household_id, week_start)` garantisce un solo piano per settimana per nucleo familiare.
  - `plan_slots`: `UNIQUE(plan_id, day, meal)` garantisce che in un piano non possano esistere slot duplicati per lo stesso giorno e pasto (es. due pranzi il lunedì).

## Transazionalità

Operazioni composite che coinvolgono entità figlie — come il salvataggio di una nuova ricetta con i suoi ingredienti e le preferenze iniziali (`insertRecipe`) — vengono sempre eseguite all'interno di transazioni atomiche (`db.transaction`). In caso di errore o violazione di vincolo durante l'inserimento di un ingrediente, l'intera operazione effettua un rollback automatico, impedendo la creazione di record orfani.

## Flusso delle Migrazioni

Il ciclo di vita dello schema è governato da `drizzle-kit`:
1. La configurazione in `drizzle.config.ts` punta a `./lib/db/schema.ts` e genera gli snapshot in `./lib/db/migrations`.
2. Il comando `pnpm db:generate` analizza le differenze TypeScript e produce file SQL versionati (es. `0000_init_schema.sql`).
3. Il comando `pnpm db:migrate` applica le modifiche sequenziali al database.
4. Nessun mock di database viene impiegato nei test di integrazione (`tests/db/schema.test.ts`): i test convalidano le migrazioni e le query direttamente sull'istanza PostgreSQL reale.

## Vedi anche

- [[database-schema]] — Descrizione dettagliata delle 9 tabelle e relazioni
- [[recipe-repo]] — Implementazione dei metodi con transazioni DB
- [[household-repo]] — Repository singleton del nucleo domestico
- [[e0-fondamenta]] — Panoramica della Feature 1
