# Mealy — "Cosa Mangio Oggi"

App web personale di meal planning: piano settimanale generato da una libreria di ricette persistente, preferenze esplicite, lista della spesa consolidata. Single user (predisposta per uso condiviso futuro).

## Documenti autoritativi (in ordine di consultazione)

1. `docs/ARCHITECTURE.md` — architettura, modello dati, logiche core, superficie API
2. `docs/DESIGN.md` — design system (palette, tipografia), mappa schermate, microcopy, qualità minima
3. `docs/BACKLOG.md` — epic → story → task con criteri di accettazione e grafo dipendenze
4. `docs/planning/execution-strategy.md` — mappatura backlog → feature della pipeline, ordine di esecuzione, contratti trasversali
5. `docs/planning/feature-index.md` — stato di avanzamento delle feature

Il principio guida del prodotto: **le ricette generate non sono usa-e-getta, sono la libreria** (`ARCHITECTURE §1.3`). Il piano è selezione pesata dalla libreria; l'LLM interviene solo quando il pool è insufficiente.

## Stack

Next.js (App Router, TypeScript) · Tailwind CSS + shadcn/ui · PostgreSQL 16 (Docker in dev e in prod) · Drizzle ORM + drizzle-kit · Zod · Vercel AI SDK (provider via env `LLM_PROVIDER` + `LLM_MODEL`) · Vitest · pnpm

Deploy v1: Raspberry Pi con Docker Compose (Next.js standalone + PostgreSQL 16) raggiungibile solo via LAN/Tailscale, **senza autenticazione** (`ARCHITECTURE §8`, Opzione C). Login e auth sono rinviati a una v2 (Opzione A Vercel + Neon resta l'alternativa cloud futura).

## Comandi

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres locale (necessario per i test DB)
pnpm dev            # sviluppo
pnpm test           # Vitest
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm build          # build di produzione
pnpm db:migrate     # migrazioni drizzle-kit
pnpm db:seed        # seed idempotente (fixtures + household default + alias)
pnpm llm:record     # registra una risposta LLM reale in tests/fixtures/llm/recorded/ (richiede chiave API)
```

Gate di verifica completo: `lint + typecheck + test + build` — tutti verdi. Lo stesso gate gira in CI su ogni pull request (`.github/workflows/gate.yml`).

## Regole di architettura (vincolanti)

- `lib/domain/types.ts` (schemi Zod) è la **single source of truth** dei tipi di dominio: mai ridefinire tipi localmente
- `planner`, `shopping-list`, `prefs` sono **funzioni pure + repository**: nessuna chiamata LLM al loro interno; solo il modulo `recipes` parla con `lib/llm/` (adapter unico)
- Il provider LLM è **configurazione, non codice**: si cambia via env, nessun altro modulo lo conosce
- Ingredienti **normalizzati alla fonte** (`canonical_name`, enum `unit` e `category` chiusi — `ARCHITECTURE §4.1`)
- **Test senza rete**: LLM con risposte registrate; DB sul Postgres Docker locale

## Convenzioni

- Codice e identificatori in **inglese**; valori di dominio come da `ARCHITECTURE §4.2` (es. `'pranzo'`, `'cena'`, reparti in italiano)
- UI copy e microcopy in **italiano**, dal tono di `DESIGN.md §5`
- Documentazione, wiki (`docs/wiki/`) e piani in **italiano**
- Mobile-first; tap target ≥ 44 px, contrasto AA, `prefers-reduced-motion` (`DESIGN.md §6`)

## Pipeline di sviluppo

Il progetto si sviluppa con il plugin `agentic-feature-factory` (`/feature-plan` → `/arch-review` → `/feature-dev`, poi `/feature-review` e `/feature-docs`); layout dei piani e comportamento git in `.claude/agentic-feature-factory.local.md` (`plans_dir: docs/planning`, `wiki_dir: docs/wiki`). Una feature alla volta, nell'ordine di `docs/planning/execution-strategy.md`, su un branch `feature/<n>-<slug>`. Un commit per work package a gate verde, poi un commit di chiusura con planning, wiki e versione; push e pull request su conferma esplicita.
