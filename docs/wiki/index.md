# Catalogo Documentazione Tecnica (Wiki Mealy)

Benvenuto nella documentazione tecnica interna del progetto **Mealy**. Questo indice cataloga tutte le pagine della wiki organizzate per categorie (Topic, Concetti, Entità).

## Topics (Aggregati Tematici)

- [[e0-fondamenta]] — Panoramica dell'architettura fondamentale (Feature 1), dallo scaffold Next.js 16 al layer DB e alla shell UI. (2026-09-15)

## Concetti Architetturali & Design

- [[single-source-of-truth-types]] — Principio vincolante che stabilisce gli schemi Zod in `lib/domain/types.ts` come unica fonte di verità dei tipi. (2026-09-15)
- [[database-architecture]] — Architettura del database relazionale PostgreSQL 16 con estensione `pg_trgm`, Drizzle ORM e migrazioni. (2026-09-15)
- [[design-system-and-tokens]] — Filosofia visiva editoriale, configurazione `@theme` in Tailwind CSS v4, palette cromatiche e caratteri `Fraunces`/`Figtree`. (2026-09-15)
- [[shell-navigation-pattern]] — Pattern di shell applicativa mobile-first persistente con navigazione a 4 tab e gestione dei padding. (2026-09-15)

## Entità di Dominio, Dati & UI

- [[domain-types]] — Schemi Zod di validazione runtime, tipi TypeScript inferiti e 9 liste chiuse enum di dominio (`lib/domain/types.ts`). (2026-09-15)
- [[database-schema]] — Modello dati relazionale a 9 tabelle Drizzle con indici GIN, trigram e vincoli a cascata (`lib/db/schema.ts`). (2026-09-15)
- [[household-repo]] — Repository per l'accesso e la gestione idempotente del singleton nucleo familiare (`lib/db/repositories/household-repo.ts`). (2026-09-15)
- [[recipe-repo]] — Repository transazionale per inserimento atomico, recupero e cancellazione in cascata delle ricette (`lib/db/repositories/recipe-repo.ts`). (2026-09-15)
- [[bottom-nav]] — Barra di navigazione fissa inferiore mobile-first a 4 tab con safe-area padding (`components/navigation/bottom-nav.tsx`). (2026-09-15)
- [[meal-card]] — Scheda del pasto pianificato con eyebrow, titolo Fraunces, pulsante swap tomato e stella saffron (`components/cards/meal-card.tsx`). (2026-09-15)
- [[recipe-sheet]] — Pannello modale scorrevole dal basso per dettaglio ricetta, scala porzioni, gradimento ingredienti e voto (`components/sheets/recipe-sheet.tsx`). (2026-09-15)
- [[shopping-item-row]] — Riga articolo della spesa interamente toccabile con stato barrato e feedback accessibile (`components/shopping/shopping-item-row.tsx`). (2026-09-15)
- [[chip-filter]] — Chip a pillola per filtraggio multi-criterio per tag e regimi alimentari (`components/filters/chip-filter.tsx`). (2026-09-15)
- [[empty-state]] — Componente di cortesia con icona centrata, titolo Fraunces e pulsante di azione primaria (`components/feedback/empty-state.tsx`). (2026-09-15)

---
*Per lo storico delle modifiche e delle operazioni della wiki, consulta il [[log]].*
