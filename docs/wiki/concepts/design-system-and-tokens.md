---
title: Design System e Design Tokens (Tailwind CSS v4)
type: concept
created: 2026-09-15
updated: 2026-09-15
tags: [design-system, tailwind-v4, typography, colors, mobile-first, accessibility]
---

## Filosofia Visiva

Il design system di Mealy (definito in `docs/DESIGN.md`) adotta un'estetica **editoriale culinaria**, calda, rassicurante e organica. L'interfaccia si allontana deliberatamente dal look "tecnologico/SaaS" asettico, traendo ispirazione dai ricettari cartacei, dalle carte alimentari da pacco e dai colori vividi degli ingredienti freschi del mercato.

## Integrazione Tailwind CSS v4

Con l'adozione di Tailwind CSS v4, la configurazione non risiede più in un file JavaScript `tailwind.config.js`, bensì direttamente nel foglio di stile `app/globals.css` tramite la direttiva `@theme`:

```css
@import "tailwindcss";

@theme {
  --color-paper: #FAF7F2;
  --color-ink: #26221B;
  --color-basil: #3E6B4F;
  --color-tomato: #C4482F;
  --color-saffron: #E0A83C;
  --color-stone: #8A8377;

  --font-display: var(--font-fraunces), serif;
  --font-sans: var(--font-figtree), sans-serif;
}
```

## Palette Cromatiche e Significato Semantico

| Token | Valore HEX | Significato Culinario & Funzione UI |
|---|---|---|
| `paper` | `#FAF7F2` | **Sfondo Primario**: Bianco caldo color carta da ricette non sbiancata. Riduce l'affaticamento visivo. |
| `ink` | `#26221B` | **Testo e Icone Principali**: Nero caldo con sottotono caffè, ad altissimo contrasto ma morbido. |
| `basil` | `#3E6B4F` | **Accento Primario & Azioni Positive**: Verde foglia di basilico. Utilizzato per bottoni principali, tab attive, spunte lista e badge confermati. |
| `tomato` | `#C4482F` | **Accento Distruttivo & Sostituzioni**: Rosso pomodoro maturo. Riservato all'azione "Cambia" ricetta e alle cancellazioni/blocchi. |
| `saffron` | `#E0A83C` | **Accento Preferenze & Valutazioni**: Giallo caldo zafferano. Identifica le ricette preferite (stella ★) e le valutazioni 1–5. |
| `stone` | `#8A8377` | **Neutro & Bordo**: Grigio pietra calda. Utilizzato per bordi tenui (`border-stone/20`), testi secondari, metadati e stati inattivi. |

## Tipografia

La gerarchia tipografica combina due caratteri caricati tramite `next/font/google` in `app/layout.tsx`:

1. **`Fraunces` (`font-display`)**:
   - Carattere serif variabile con optical sizing (144 pt) e morbidezza morbida (*softness*).
   - Utilizzato per: titoli delle pagine, nomi delle ricette nelle card e negli sheet, intestazioni del piano e stati vuoti.
   - Conferisce personalità editoriale e autorevolezza visiva.
2. **`Figtree` (`font-sans`)**:
   - Carattere sans-serif contemporaneo, pulito e compatto.
   - Utilizzato per: corpo del testo, righe della lista della spesa, pulsanti, etichette dei chip, dosaggi numerici (`tabular-nums`) e microcopy.

## Principi di Accessibilità e Mobile-First

1. **Tap Target Generosi (≥ 44px / 48px)**:
   - Ogni elemento interattivo (voci della barra di navigazione, bottoni swap, stelle preferito, righe della spesa, pulsanti +/− porzioni) dispone di un'area di tocco minima non inferiore a 44×44px, estendendosi fino a 48–52px nei flussi più dinamici.
2. **Rapporto di Contrasto WCAG AA**:
   - Tutte le combinazioni cromatiche di testo su sfondo (`ink` su `paper`, `paper` su `basil`, `tomato` su `paper`) rispettano o superano il rapporto di contrasto 4.5:1.
3. **Indicatori di Focus Accessibili**:
   - Tutti i controlli personalizzati (come i chip e le righe lista con ruolo checkbox) integrano `focus-visible:ring-2 focus-visible:ring-basil` per la navigazione da tastiera o switch-access.
4. **Adattamento alle Safe Areas**:
   - Il layout globale e la barra inferiore integrano `pb-[env(safe-area-inset-bottom)]` per prevenire sovrapposizioni con l'indicatore home o le barre di sistema di iOS e Android.

## Vedi anche

- [[bottom-nav]] — Utilizzo dei token nella barra di navigazione
- [[meal-card]] — Esempio pratico di applicazione di Fraunces, Basil, Tomato e Saffron
- [[recipe-sheet]] — Utilizzo tipografico avanzato e interazioni proporzioni
- [[shopping-item-row]] — Implementazione dei requisiti di touch target per la lista spesa
- [[e0-fondamenta]] — Panoramica della Feature 1
