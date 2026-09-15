# Mealy — Strategia di esecuzione v1

**Data:** 18 luglio 2026 · **Stato:** approvata
**Ruolo:** master-plan operativo per la pipeline `agentic-feature-factory`. Ogni `/feature-plan <n>` legge questo documento (insieme a `docs/BACKLOG.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`) come spec della feature `<n>`. Le story e i criteri di accettazione restano nel BACKLOG: qui vivono la mappatura in feature, l'ordine, i contratti trasversali e le note per la pianificazione.

---

## 1. Decisioni di strategia (brainstorming 2026-07-18)

| Decisione | Scelta | Motivo |
|---|---|---|
| Unità di consegna | **Feature del plugin = epic del backlog** (7 feature) | Semantica pulita; ogni epic si chiude con gate verde, code-review e wiki |
| Ordine di esecuzione | **E0 → E1 → E5 → E3 → E2 → E4 → E6** | Risolve le dipendenze incrociate S2.3→S3.1 e S3.2→S5.1 senza spostare story tra epic |
| Numerazione feature | Feature `n` = posizione nell'ordine di esecuzione (non il numero dell'epic) | `feature-index.md` si legge dall'alto in basso come cronologia |
| Layout planning | `plans_dir: docs/planning`, `wiki_dir: docs/wiki` (settings del plugin) | Root pulita per l'app Next.js; tutta la documentazione sotto `docs/` |
| Scaffold (S0.1) | Dentro la pipeline, WP in wave solitaria della Feature 1 | Il backlog resta integro; `create-next-app` gira con flag non-interattivi |
| `/arch-review` | Dalla Feature 2 in poi (dopo ogni `/feature-plan`) | La Feature 1 è greenfield: nessun codebase da rivedere |
| Commit | A chiusura di ogni feature, su conferma dell'utente | Coerente col design del plugin (mai commit non richiesti) |

## 2. Ciclo per ogni feature

```
/feature-plan <n>   →   /arch-review <n>  (da n=2)   →   /feature-dev <n>
   story → WP              piano vs codice reale           wave parallele + gate
                                                           → code-review high → wiki → commit
```

- `/feature-plan <n>` converte le story dell'epic in work package con percorsi file esatti, contratti scritti per esteso e mappa delle dipendenze. Le **decisioni implementative aperte** (elencate per feature in §3) le fissa lui, chiedendo all'utente solo ciò che cambia davvero il piano.
- Gate di verifica tra le wave: skill `node-frontend-build` (lint + typecheck + test + build). I test che toccano il DB richiedono il **Postgres di `docker-compose.dev.yml` attivo** — avviarlo prima di ogni sessione `/feature-dev` (da Feature 1, wave 2 in poi).
- Ogni feature si chiude con: criteri di accettazione del backlog verificati, gate verde, code-review `high` gestita, wiki aggiornata da `feature-documenter`, riga di `feature-index.md` aggiornata, commit confermato.

## 3. Le 7 feature

### Feature 1 — E0 Fondamenta

**Obiettivo:** repo Next.js pronto per lavorare in parallelo: scaffold con i token del design, schema DB migrabile, shell di navigazione a 4 tab.

| Wave | Story → WP | Note |
|---|---|---|
| 1 | S0.1 Scaffold (solitaria) | Blocca tutto: `create-next-app` (App Router, TS, Tailwind, flag non-interattivi), ESLint+Prettier, shadcn/ui, token colore/font da `DESIGN.md §2` (Fraunces + Figtree via `next/font`), struttura `app/ lib/domain/ lib/llm/ lib/db/ fixtures/`, Vitest, script `dev/test/db:*`, `.env.example` |
| 2 | S0.2 Schema DB ∥ S0.3 UI shell | File-disjoint: S0.2 su `lib/db/` + `lib/domain/types.ts` + `docker-compose.dev.yml`; S0.3 su `app/` + componenti con **dati finti hardcoded locali** (non importa `types.ts`, per restare disgiunta) |

**Contratti esposti** (consumati da tutte le feature successive):
- `lib/domain/types.ts` — schemi Zod e tipi derivati: `Recipe`, `Ingredient`, enum chiusi di unità (`g|ml|pz|qb`), reparti, tag pasto, diete, elettrodomestici (`ARCHITECTURE §4.1–4.2`)
- Schema Drizzle delle tabelle di `ARCHITECTURE §4.2` (senza `ingredient_prefs`, che arriva in Feature 5 come da backlog) + migrazioni + repository tipato base
- Shell di navigazione e componenti base: `MealCard`, `RecipeSheet`, `ShoppingItemRow`, `ChipFilter`, `EmptyState`

**Decisioni da fissare in `/feature-plan 1`:**
- Versioni (Next.js, Drizzle, shadcn) e opzioni scaffold (`--no-src-dir`? import alias?)
- **Liste chiuse degli enum** (tag tipo-pasto, diete, elettrodomestici, reparti): attraversano prompt LLM, schema DB e UI — vanno scritte per esteso nel piano, non lasciate ai singoli WP
- Seed del **singleton `households`** con valori di default: serve già ai test repository di S0.2 e all'app prima dell'onboarding (Feature 3)

**Chiusura:** accettazioni S0.1–S0.3 del backlog; `pnpm dev` parte, gate verde, migrazione da zero su Postgres Docker, navigazione tra le 4 tab conforme a `DESIGN.md`.

---

### Feature 2 — E1 Motore ricette

**Obiettivo:** dalla richiesta con vincoli alla libreria persistente: adapter LLM provider-agnostico, generazione con dedup, fixtures per sbloccare tutto il resto.

| Wave | Story → WP | Note |
|---|---|---|
| 1 | S1.1 LLM adapter ∥ S1.3 Seed+fixtures | Disgiunte: `lib/llm/` vs `fixtures/` + script seed. S1.3 sblocca UI e logica pura senza chiavi API |
| 2 | S1.2 Generazione e persistenza | `POST /api/recipes/generate`: adapter → dedup (titolo normalizzato + `pg_trgm` > 0.6) → insert transazionale ricetta+ingredienti+pref default |

**Contratti esposti:**
- `generateRecipes(constraints, n, excludeTitles) → Recipe[]` con contratto JSON di `ARCHITECTURE §5.1`, parse Zod + 1 retry di repair
- Factory `getModel()` da env `LLM_PROVIDER` + `LLM_MODEL` (openrouter | google | anthropic, fallback openai-compatible)
- `fixtures/recipes.json` (15–20 ricette conformi allo schema) + `pnpm db:seed` idempotente (ricette, alias, **household di default**)

**Decisioni da fissare in `/feature-plan 2`:** formato delle risposte LLM registrate per i test; provider di default per lo smoke test; `maxDuration` della route.

**Prerequisito esterno:** almeno una chiave API (OpenRouter free o Gemini) prima dello smoke test manuale di `/feature-dev 2` — i test automatici usano risposte registrate, senza rete.

**Chiusura:** accettazioni S1.1–S1.3; due chiamate consecutive non producono duplicati; provider cambiabile via env (smoke su due provider).

---

### Feature 3 — E5 Impostazioni

**Obiettivo:** i vincoli household entrano nel sistema: onboarding a step al primo avvio, form unico dopo.

| Wave | Story → WP | Note |
|---|---|---|
| 1 | S5.1 (probabile split in 2 WP: API/repo ∥ UI wizard+form) | `/feature-plan 3` decide lo split; se i WP condividono file, wave sequenziali |

**Contratti esposti:** `GET/PUT /api/settings` su `households`; i vincoli (persone, pasti, tipo pasti, esigenze, elettrodomestici) consumati dal planner (Feature 4) e già dalla generazione LLM (Feature 2, che finora li legge dal seed di default). Stesso componente per onboarding a step e form di modifica (`DESIGN §4.5`).

**Chiusura:** primo avvio forza il wizard; modifica vincoli → banner "il prossimo piano userà i nuovi vincoli"; i vincoli arrivano a planner e LLM.

---

### Feature 4 — E3 Pianificatore

**Obiettivo:** il cuore del prodotto: selezione pesata testata come funzione pura, piano end-to-end con generazione automatica quando il pool è scarso, swap, UI del piano.

| Wave | Story → WP | Note |
|---|---|---|
| 1 | S3.1 Algoritmo di selezione (solitaria) | Funzione pura: filtri hard + formula peso `ARCHITECTURE §5.2`, campionamento pesato senza reinserimento, RNG seedable, `planner-config.ts` |
| 2 | S3.2 Piano end-to-end | `POST /api/plans` (riempie slot, invoca generazione se `needMore`), `POST /api/plans/:id/confirm` (times_used/last_used_at), rigenerazione che rispetta i `locked` |
| 3 | S3.3 Swap ∥ S3.4 UI Piano | Disgiunte: API swap vs UI home (card-pasto, lock long-press, animazione flip, microcopy generazione) |

**Contratto chiave (da scrivere per esteso nel piano):** la firma del planner accetta **fin da subito le preferenze ingredienti come input** (`ingredientLikes/ingredientDislikes`, insiemi vuoti fino alla Feature 5): così S2.3 aggancerà `dislike` (filtro hard) e `ingredientAffinity` (boost) **senza modificare l'algoritmo**, solo cablando i dati. Il fattore `ingredientAffinity` della formula si implementa qui, alimentato da insiemi vuoti.

**Altri contratti esposti:** protocollo `needMore` verso il modulo recipes; API plans/swap/confirm; exclude-list dello swap (ricetta attuale + resto del piano); flag "lista da rigenerare" (consumato dalla Feature 6).

**Chiusura:** accettazioni S3.1–S3.4; RNG seedato ⇒ output riproducibile; su 1000 estrazioni le preferite ~1.5×; da DB quasi vuoto una chiamata produce un piano completo; flusso completo da telefono.

---

### Feature 5 — E2 Libreria e preferenze

**Obiettivo:** la libreria diventa navigabile e giudicabile: ricerca/filtri, preferenze ricetta (rating, ★, blocco) e preferenze ingrediente (like/dislike) cablate in planner e prompt LLM.

| Wave | Story → WP | Note |
|---|---|---|
| 1 | S2.1 Libreria UI | `GET /api/recipes` con filtri/ricerca; griglia card + `RecipeSheet` completo (quantità scalate sulle persone) |
| 2 | S2.2 Preferenze ricetta | `PUT /api/recipes/:id/pref`; controlli nel sheet e ★ sulla card; test d'integrazione col planner (S3.1 è già reale: le bloccate non escono mai) |
| 3 | S2.3 Preferenze ingredienti | Migrazione `ingredient_prefs` + API + toggle 👍/👎 con conferma d'impatto ("Escluderà N ricette") + sezione *I miei ingredienti* + cablaggio planner (dislike hard, like→affinity) + liste like/dislike nel prompt LLM |

**Nota per `/feature-dev 5`:** S2.3 tocca moduli di feature precedenti (planner di F4, adapter di F2). La firma del planner è già predisposta (vedi Feature 4): il cablaggio è additivo. Vale comunque "real code wins": verificare le firme reali prima di scrivere i brief.

**Chiusura:** accettazioni S2.1–S2.3; ingrediente scartato ⇒ mai più proposto né generato; con like attivi frequenza maggiore nel test statistico.

---

### Feature 6 — E4 Lista della spesa

**Obiettivo:** dal piano confermato alla spesa al supermercato: consolidamento deterministico puro e UI a prova di "una mano sola".

| Wave | Story → WP | Note |
|---|---|---|
| 1 | S4.1 Consolidamento (solitaria) | `buildShoppingList(slots, recipes) → items` pura: scala porzioni, aggrega `(canonical_name, unit)`, risolve alias, arrotonda, ordina per reparto (`ARCHITECTURE §5.5`); nessun accesso a rete/DB nei test |
| 2 | S4.2 API + UI lista | `POST/GET /api/plans/:id/shopping-list`, `PATCH /api/shopping-items/:id`; sezioni per reparto, riga intera = target di spunta, spuntati in fondo, progress, FAB item manuali; **spunta optimistic con persistenza immediata**; rigenerazione che preserva le spunte per `canonical_name` |

**Contratti consumati:** piano attivo e flag "lista da rigenerare" (Feature 4); `ingredient_aliases` (Feature 2, seed).

**Chiusura:** accettazioni S4.1–S4.2; uso reale al supermercato: spunte immediate con rete lenta, stato preservato al ritorno dal background.

---

### Feature 7 — E6 Deploy

**Obiettivo:** v1 in produzione su Raspberry Pi via Docker Compose e accesso sicuro via Tailscale (ADR di `ARCHITECTURE §8`).

| Wave | Story → WP | Note |
|---|---|---|
| 1 | S6.1 Self-host Raspberry Pi | Dockerfile multi-stage standalone, `docker-compose.prod.yml` (Next.js + Postgres 16 + backup cron con rotazione), script di deploy e migrazioni, guida/test connettività Tailscale |

**Nota:** feature con componenti operative — setup host e secret sul Raspberry a carico dell'utente; la pipeline prepara configurazione container, Dockerfile, compose, script di backup/deploy e documentazione. `/feature-plan 7` separa esplicitamente "cosa fa l'implementer nel repo" da "cosa fa l'utente sul Raspberry".

**Chiusura:** flusso completo in produzione dal telefono (anche fuori casa via Tailscale).

---

## 4. Contratti trasversali (da ribadire in ogni piano)

1. **`lib/domain/types.ts` è la single source of truth** (Zod → tipi): nessun WP ridefinisce tipi di dominio localmente.
2. **Contratto di generazione ricette** (`ARCHITECTURE §5.1`): ingredienti normalizzati alla fonte (`canonical_name`, enum `unit`, enum `category`) — vincola adapter (F2), planner (F4), preferenze ingredienti (F5) e consolidamento (F6).
3. **Firma del planner con preferenze ingredienti iniettate** dal primo giorno (vedi Feature 4): F5 cabla, non modifica.
4. **Solo `recipes` parla con `llm-adapter`** (`ARCHITECTURE §3`): planner, shopping-list e prefs restano funzioni pure + repository.
5. **Test senza rete**: le chiamate LLM nei test usano risposte registrate (fixture di F2); i test DB usano il Postgres Docker locale.
6. **Enum chiusi fissati in Feature 1**: ogni feature successiva li importa, mai li estende silenziosamente.

## 5. Ambiente e prerequisiti

| Prerequisito | Stato | Quando serve |
|---|---|---|
| Node v25, git, Docker | ✅ presenti | Sempre |
| pnpm (via `corepack enable`) | ✅ bootstrap | Sempre |
| Postgres locale (`docker-compose.dev.yml` up) | creato in F1 | Gate con test DB, da F1 wave 2 |
| Chiave API LLM (OpenRouter free / Gemini) | ⏳ da procurare | Smoke test in `/feature-dev 2` |
| Raspberry Pi con Docker + Tailscale | ⏳ da preparare | Feature 7 |

## 6. Cosa questo documento NON copre

Il dettaglio per work package (file esatti, passi, edge case, messaggi d'errore) è responsabilità di `/feature-plan <n>`, che lo produce in `docs/planning/feature/feature-<n>/plan.md` dopo aver analizzato il codice reale. Questo documento non va aggiornato a ogni feature: cambia solo se cambia la strategia (ordine, mappatura, contratti trasversali).
