---
title: Pattern di Shell e Navigazione Mobile-First
type: concept
created: 2026-09-15
updated: 2026-09-28
tags: [ui, navigation, shell, mobile-first, layout, app-router, route-group]
---

## Il Pattern Shell

Mealy è concepita con un approccio **mobile-first nativo** (`docs/ARCHITECTURE.md §1.2`): pur essendo un'applicazione web accessibile anche da desktop, i principali casi d'uso (consultazione del piano in cucina con una mano, spunta dei prodotti tra le corsie del supermercato) avvengono su dispositivi mobili.

Per offrire un'esperienza affine alle applicazioni native, l'interfaccia adotta un'architettura a **Shell Applicativa Persistente**:

```
+-------------------------------------------------------------+
|               Top Bar / Header di Sezione                   |
|      Titolo pagina (Fraunces) · Controlli contestuali       |
+-------------------------------------------------------------+
|                                                             |
|                                                             |
|                  Area di Contenuto Scrollabile              |
|        <div className="flex-1 pb-24"> + <main> di pagina    |
|                                                             |
|                                                             |
+-------------------------------------------------------------+
|          Bottom Bar Fissa (fixed bottom-0 z-40)             |
|          [ Piano ]  [ Lista ]  [ Libreria ]  [ Impostazioni ]|
+-------------------------------------------------------------+
```

## Le 4 Route Cardine

La barra di navigazione inferiore indirizza l'utente verso le quattro sezioni fondamentali dell'applicazione:

1. **Piano (`/`)**:
   - Visualizzazione temporale del piano settimanale (dal lunedì alla domenica, per pranzo e cena).
   - Card pasto interattive con indicazione dello stato di blocco, preferenza e azione rapida di sostituzione ricetta ("Cambia").
2. **Lista (`/lista`)**:
   - Elenco della spesa derivato dalla pianificazione della settimana attiva.
   - Prodotti raggruppati per corsia/reparto del supermercato, spuntabili al tocco con barra di avanzamento visuale.
3. **Libreria (`/libreria`)**:
   - Archivio persistente di tutte le ricette memorizzate nel database.
   - Ricerca rapida con matching trigram e filtri per tag, tempo ed esigenze alimentari.
4. **Impostazioni (`/impostazioni`)**:
   - Gestione dei parametri del nucleo domestico: numero di coperti, pasti abituali, tipo di pasti, vincoli dietetici ed elettrodomestici disponibili. Dalla Feature 3 è un form reale con salvataggio esplicito ([[settings-editor]]).

## Dove Vive la Shell: il Route Group `(app)` (Feature 3)

Dalla Feature 3 la shell non è più montata dal root layout:
- **`app/layout.tsx`** (root) contiene solo font, metadata e `<body className="… min-h-screen … flex flex-col">{children}</body>`: nessuna `BottomNav`, nessun wrapper.
- **`app/(app)/layout.tsx`** (layout del route group) rende `<div className="flex-1 pb-24">{children}</div>` seguito da `<BottomNav />`, **dopo** la guardia di onboarding che reindirizza a `/benvenuto` gli household non ancora onboardati ([[onboarding-guard]]).
- Le 4 pagine sono state spostate in `app/(app)/page.tsx`, `app/(app)/lista/page.tsx`, `app/(app)/libreria/page.tsx`, `app/(app)/impostazioni/page.tsx`. Gli **URL non cambiano**: il segmento tra parentesi non compare nel percorso.
- Le pagine fuori dal gruppo (oggi solo `/benvenuto`, il wizard di primo avvio) sono a schermo intero, **senza barra di navigazione**.

Regola per le feature successive: ogni schermata che deve mostrare la barra inferiore va creata sotto `app/(app)/`.

## Risoluzione della Rotta Attiva

Il componente client `BottomNav` rileva la rotta corrente invocando l'hook `usePathname()` di Next.js:
- Per la root `/`, il confronto è esatto (`pathname === '/'`).
- Per le sezioni annidate (`/lista`, `/libreria`, `/impostazioni`), viene utilizzato `pathname.startsWith(...)`, consentendo alle future sottopagine (es. `/libreria/nuova` o `/impostazioni/diete`) di mantenere visivamente evidenziata la tab padre.

## Prevenzione di Sovrapposizioni e Padding Dinamico

Un problema frequente nelle layout web mobili con barre fisse è il mascheramento degli elementi inferiori dello scroll. Mealy risolve questo aspetto tramite una combinazione di padding dedicati:
1. Nel layout del gruppo (`app/(app)/layout.tsx`; fino alla Feature 2 era il root layout `app/layout.tsx`), il contenitore `<div className="flex-1 pb-24">` che avvolge le pagine applica `pb-24` (circa 96px), distanziando abbondantemente l'ultimo elemento della lista dalla barra inferiore.
2. In `components/navigation/bottom-nav.tsx`, la barra ha un'altezza base di 64px (`h-16`) combinata con `pb-[env(safe-area-inset-bottom)]` per rispettare la barra di navigazione gestuale degli smartphone moderni.
3. Lo sfondo della barra sfrutta `bg-paper/95 backdrop-blur-md`, lasciando intravedere con eleganza il passaggio del contenuto retrostante senza compromettere la leggibilità delle icone.

## Vedi anche

- [[bottom-nav]] — Componente React della barra di navigazione
- [[onboarding-guard]] — Route group `(app)` e guardia di onboarding che montano la shell
- [[meal-card]] — Componente visualizzato nella schermata Piano
- [[shopping-item-row]] — Componente della schermata Lista
- [[design-system-and-tokens]] — Standard di accessibilità e touch target
- [[e0-fondamenta]] — Panoramica della Feature 1
