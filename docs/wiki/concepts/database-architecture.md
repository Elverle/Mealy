---
title: Architettura del Database Relazionale e Migrazioni
type: concept
created: 2026-09-15
updated: 2026-10-11
tags: [database, postgresql, drizzle, migrations, pg_trgm, architecture, production, bootstrap]
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

> **Nota (Feature 7)**: la riga "Produzione" qui sopra è la descrizione originale della Feature 1 e diverge da ciò che è stato realizzato. La v1 è in produzione su un **Raspberry Pi con Docker Compose** (`ARCHITECTURE §8`, Opzione C): il database è un container `postgres:16-alpine`, la stessa immagine dello sviluppo, con i dati in un volume Docker e senza porte pubblicate ([[production-stack]]). L'istanza serverless (Neon, Opzione A) resta l'alternativa cloud futura, non lo stato attuale. `DATABASE_URL` in produzione la compone il compose a partire da `POSTGRES_PASSWORD`.

Differenze tra i due ambienti, dalla Feature 7 ([[e6-deploy]]):

| | Sviluppo e test | Produzione (Raspberry) |
|---|---|---|
| Avvio di Postgres | `docker-compose.dev.yml`, porta 5432 pubblicata | `docker-compose.prod.yml`, servizio `db`, nessuna porta pubblicata |
| Estensione `pg_trgm` | `docker/init-db.sql` all'inizializzazione del volume, e comunque la migrazione `0000` | Solo la migrazione `0000` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) |
| Migrazioni | `pnpm db:migrate` (drizzle-kit), a mano | All'avvio dell'app, con il migratore di `drizzle-orm` ([[db-bootstrap]]) |
| Alias degli ingredienti | `pnpm db:seed` oppure `pnpm db:seed:aliases` | All'avvio dell'app, dopo le migrazioni |
| Ricette di esempio e household | `pnpm db:seed` | Mai: la libreria parte vuota, l'household nasce alla prima lettura |
| Backup | Nessuno | Dump notturno e prima di ogni cambio di immagine ([[backup-service]]) |

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

### Uso effettivo degli indici (stato alla Feature 5)
Le due sezioni sopra descrivono l'intento di progetto della Feature 1. Il codice, alla Feature 5, si comporta in modo diverso:
- l'indice trigram `recipes_title_trgm_idx` è usato **solo** dalla deduplicazione dei titoli generati (`findSimilarRecipeTitle`, [[recipe-repo]]), non dalla ricerca della Libreria;
- la Libreria non interroga il DB per cercare o filtrare: la pagina legge tutte le ricette dell'household e ricerca, filtri e ordinamento avvengono **in memoria** con funzioni pure ([[library-service]], requirements P8 della Feature 5). Anche il planner filtra in memoria ([[planner]]);
- nessuna query del codice applicativo usa oggi gli indici GIN su `tags` e `diet_flags`.

La lettura completa della libreria a ogni richiesta è un costo noto e accettato per la v1; il rimedio previsto, se servirà, è un conteggio in SQL sull'indice `recipe_ingredients_canonical_name_idx` ([[e2-libreria-preferenze]]).

## Integrità Referenziale e Vincoli a Cascata

La coerenza relazionale è salvaguardata a livello di engine DB:
- **Cascade Deletion (`ON DELETE CASCADE`)**:
  - L'eliminazione di un `household` rimuove automaticamente tutte le sue ricette e i piani associati; dalla Feature 5 anche i suoi giudizi sugli ingredienti (`ingredient_prefs`).
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

### Migrazioni in produzione (Feature 7)

I passi sopra valgono per lo sviluppo e per il gate CI. In produzione il passo 3 non esiste come comando: `pnpm db:migrate` non gira mai sul Raspberry, perché l'immagine non contiene `drizzle-kit`. Le migrazioni le applica l'app **all'avvio**, prima di accettare richieste: `instrumentation.ts` chiama `runDbBootstrap`, che usa `migrate` di `drizzle-orm/postgres-js/migrator` sulla cartella `lib/db/migrations` copiata nell'immagine ([[db-bootstrap]]).

- I due strumenti condividono la tabella `drizzle.__drizzle_migrations`: un database migrato con l'uno è riconosciuto dall'altro.
- Il migratore applica le migrazioni il cui orario nel journal è successivo all'ultima applicata, tutte in una transazione. Non confronta l'elenco: per questo **una migrazione arrivata su `main` non si modifica, se ne aggiunge una nuova**, e un test controlla che il journal resti in ordine (`tests/db/bootstrap.test.ts`).
- Le migrazioni non tornano indietro. Il punto di ritorno è il dump `predeploy` che `scripts/deploy.sh` scrive prima di avviare un'immagine diversa ([[deploy-scripts]], [[backup-service]]).

## Vedi anche

- [[database-schema]] — Descrizione dettagliata delle 10 tabelle e relazioni
- [[db-bootstrap]] — Migrazioni e alias applicati all'avvio in produzione (Feature 7)
- [[production-stack]] — Servizio `db` del compose di produzione (Feature 7)
- [[recipe-repo]] — Implementazione dei metodi con transazioni DB
- [[household-repo]] — Repository singleton del nucleo domestico
- [[ingredient-pref-repo]] — Repository dei giudizi sugli ingredienti (Feature 5)
- [[e0-fondamenta]] — Panoramica della Feature 1
