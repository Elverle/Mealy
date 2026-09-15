---
title: Stato Vuoto (empty-state)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [ui, components, feedback, empty-state, placeholders]
---

## File e Responsabilità

- **Percorso file**: `components/feedback/empty-state.tsx`
- **Scopo**: Fornire una schermata di cortesia informativa e visivamente curata in assenza di dati (ad esempio: piano settimanale non ancora generato, lista della spesa completata o nessun piatto trovato per i filtri di ricerca impostati).

## Interfaccia Props (`EmptyStateProps`)

```ts
export interface EmptyStateProps {
  icon?: React.ReactNode;     // Icona principale personalizzata (default: Utensils)
  title: string;              // Titolo in font Fraunces
  description: string;        // Spiegazione accogliente e chiara
  actionLabel?: string;       // Etichetta del pulsante CTA primario
  onAction?: () => void;      // Callback azionata dal pulsante
  className?: string;
}
```

## Struttura Visiva

1. **Badge Icona Centrale**:
   - Cerchio di diametro 64px (`h-16 w-16`) con sfondo neutro morbido `bg-stone/10 text-stone`.
   - Se non specificata, ricorre all'icona di default `Utensils` di Lucide con tratto fine (`stroke-[1.5]`).
2. **Tipografia e Copy**:
   - **Titolo**: renderizzato con il carattere display editoriale `Fraunces` (`font-display text-xl font-bold text-ink mb-2 max-w-sm`).
   - **Descrizione**: paragrafo compatto in grigio pietra `text-stone text-sm max-w-sm mb-6 leading-relaxed`, con tono orientato all'aiuto e mai colpevolizzante per l'utente.
3. **Pulsante d'Azione Primaria (CTA)**:
   - Se `actionLabel` e `onAction` sono valorizzati, renderizza un componente `<Button variant="default">` (in verde basilico `bg-basil`), guidando l'utente verso il passo logico successivo (es. "Genera piano" o "Aggiungi ricetta").

## Esempio d'Uso

```tsx
import { EmptyState } from '@/components/feedback/empty-state';
import { CalendarPlus } from 'lucide-react';

<EmptyState
  icon={<CalendarPlus className="h-8 w-8 stroke-[1.5]" />}
  title="Nessun pasto pianificato"
  description="Non hai ancora generato il menu per questa settimana. Genera un piano bilanciato in un tocco."
  actionLabel="Genera piano settimanale"
  onAction={() => handleGeneratePlan()}
/>
```

## Vedi anche

- [[design-system-and-tokens]] — Specifiche tipografiche di `Fraunces` e colori
- [[meal-card]] — Componente visualizzato dopo la popolazione del piano
- [[e0-fondamenta]] — Panoramica della Feature 1
