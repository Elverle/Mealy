---
title: E0 Fondamenta — Scaffold, Dominio, DB e Shell UI
type: topic
created: 2026-09-15
updated: 2026-09-15
tags: [scaffold, architecture, domain, database, ui-shell, e0, feature-1]
---

## Panoramica

L'iniziativa **E0 Fondamenta** (implementata tramite la Feature 1) costituisce l'infrastruttura tecnologica e concettuale portante di Mealy. Fornisce la baseline stabile e non regressiva su cui poggiano tutte le feature successive del piano di sviluppo (generazione ricette, compilazione piano settimanale, lista della spesa, onboarding preferenze).

L'intervento ha coperto tre grandi macro-aree interconnesse:
1. **Scaffold tecnologico e Design System**: configurazione di Next.js 16 App Router, React 19, TypeScript strict mode, Tailwind CSS v4 con token palette definiti via `@theme`, Google Fonts (`Fraunces` e `Figtree`) e Vitest con ambiente `jsdom`.
2. **Dominio tipato e Persistenza Relazionale**: definizione della single source of truth dei tipi di dominio tramite schemi Zod, modellazione di 9 tabelle relazionali Drizzle per PostgreSQL 16 con estensione `pg_trgm`, migrazioni versionate e primi repository tipati per `households` e `recipes`.
3. **UI Kit e Shell di Navigazione Mobile-First**: barra di navigazione inferiore a 4 tab (`BottomNav`), componenti atomici e molecolari accessibili (`MealCard`, `RecipeSheet`, `ShoppingItemRow`, `ChipFilter`, `EmptyState`) e 4 route dimostrative funzionanti con mock data locali.

## Architettura a Livelli

```
+-------------------------------------------------------------+
|                UI Layer (App Router & Shell)                |
|  / (Piano)  ·  /lista (Spesa)  ·  /libreria  ·  /impostazioni|
|  BottomNav  ·  MealCard  ·  RecipeSheet  · ShoppingItemRow  |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|              Domain Layer (Zod Schemas & Types)             |
|                    lib/domain/types.ts                      |
|   Single source of truth per tipi TS ed enum chiusi         |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             Persistence Layer (Drizzle ORM & Repos)         |
|  lib/db/schema.ts  ·  lib/db/repositories/  ·  PostgreSQL    |
+-------------------------------------------------------------+
```

### 1. Scaffold e Configurazione
L'applicazione è configurata con una root pulita (`--no-src-dir`) e path alias `@/*` puntato su `./*`. La compilazione dei font avviene tramite `next/font/google` in `app/layout.tsx`, esponendo variabili CSS caricate globalmente:
- `--font-display`: `Fraunces` (serif moderno, usato per titoli di impatto culinario ed editoriali).
- `--font-sans`: `Figtree` (sans pulito e leggibile per testi di interfaccia e numeri compatti).

Il tema colore Tailwind v4 è registrato mediante la direttiva `@theme` in `app/globals.css`, eliminando la necessità del vecchio file `tailwind.config.js`.

### 2. Dominio e Database
La separazione delle responsabilità è rigorosa:
- Il modulo [[domain-types]] definisce gli schemi Zod per validare l'integrità dei dati a runtime (specialmente nei contratti con LLM e API esterne) e ne inferisce i tipi statici TypeScript.
- Il database relazionale PostgreSQL 16 locale è gestito via Docker Compose (`docker-compose.dev.yml`) con estensione trigram `pg_trgm` abilitata (`docker/init-db.sql`).
- Lo schema relazionale Drizzle in [[database-schema]] comprende 9 tabelle fortemente tipate con vincoli di integrità referenziale (`ON DELETE CASCADE`), indici trigram per ricerca testuale veloce e indici `GIN` su array Postgres (tag, diete).
- L'accesso ai dati è incapsulato dai repository [[household-repo]] e [[recipe-repo]].

### 3. UI Kit e Shell Mobile-First
L'interfaccia rispetta i vincoli di ergonomia per uso con una mano su smartphone (tipico contesto d'uso al supermercato o ai fornelli):
- Barra di navigazione fissa inferiore [[bottom-nav]] a 4 tab con area di tocco minima ≥ 48px e padding dinamico per la safe area degli schermi con notch (`env(safe-area-inset-bottom)`).
- Componenti specializzati:
  - [[meal-card]]: card pasto con eyebrow informativo, titolo in Fraunces, tag compatti, stella per preferiti e pulsante swap color `tomato`.
  - [[recipe-sheet]]: pannello modale a scorrimento dal basso con lista ingredienti proporzionabili, preferenze rapide 👍/👎, sequenza passi numerati e voto in stelle.
  - [[shopping-item-row]]: elemento spesa interamente toccabile (minimo 52px) con transizione barrata e conteggio quantità.
  - [[chip-filter]]: pillole filtraggio rapido attive/inattive con contrasto AA.
  - [[empty-state]]: schermata di cortesia per contesti privi di dati con chiamata all'azione primaria.

## Principi Guida Rispettati

- **Nessuna ridefinizione locale dei tipi**: tutti i tipi di dominio derivano da `lib/domain/types.ts` (`CLAUDE.md § Regole di architettura`).
- **Normalizzazione ingredienti alla fonte**: unità ristrette a `g | ml | pz | qb` e 9 categorie di reparto fisse per abilitare il consolidamento automatico della spesa.
- **Isolamento dei moduli e testabilità senza rete**: i test unitari e DB girano localmente tramite Vitest e PostgreSQL Docker (`CLAUDE.md § Stack`).
- **Libreria persistente come fulcro**: le ricette risiedono su tabella Postgres permanente; il piano settimanale è selezione ponderata e non rigenerazione casuale.

## Vedi anche

- [[single-source-of-truth-types]] — Approfondimento sul modello di validazione Zod
- [[database-architecture]] — Architettura del database relazionale Drizzle e migrazioni
- [[design-system-and-tokens]] — Palette colori, tipografia e convenzioni grafiche
- [[shell-navigation-pattern]] — Pattern di navigazione mobile e layout responsive
- [[domain-types]] — Specifiche dei tipi Zod e costanti enum
- [[database-schema]] — Struttura dettagliata delle tabelle Postgres
- [[household-repo]] — API del repository per il nucleo familiare
- [[recipe-repo]] — API del repository per la persistenza delle ricette
- [[bottom-nav]] — Componente shell di navigazione
