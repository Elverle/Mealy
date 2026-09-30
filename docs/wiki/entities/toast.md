---
title: Notifica Temporanea (toast)
type: entity
created: 2026-09-29
updated: 2026-09-29
tags: [ui, components, feedback, toast, accessibility, live-region, feature-4]
---

## File e Responsabilità

- **Percorso file**: `components/feedback/toast.tsx` (`"use client"`)
- **Scopo**: mostrare per qualche secondo un messaggio breve di conferma o di errore (es. `Piano generato`, `Piano confermato`, `Piano ripetuto`, gli errori di swap e blocco). È un componente **locale** e controllato dal genitore: non esiste un provider globale né una coda di messaggi (requirements P19). Oggi lo usa solo [[plan-screen]].

## Interfaccia Props (`ToastProps`)

```ts
export interface ToastProps {
  message: string | null;   // null → nessun messaggio visibile
  onDismiss: () => void;    // chiamata allo scadere della durata
  durationMs?: number;      // default TOAST_DEFAULT_DURATION_MS = 3000
  className?: string;       // classi del contenitore, es. per stare sopra un footer sticky
}
```

A ogni nuovo `message` non nullo parte un timer che chiama `onDismiss` dopo `durationMs` (ripulito al cambio di messaggio o allo smontaggio). `onDismiss` è letto da un ref, quindi un genitore che passa una nuova funzione a ogni render non riavvia il timer.

## Struttura e Accessibilità

- Il contenitore `role="status" aria-live="polite"` è **sempre montato** e vuoto a riposo; il testo compare al suo interno. Le live region inserite già piene sono annunciate male da VoiceOver iOS (fix m7 della code review).
- Posizione: `fixed inset-x-0 bottom-24 z-50`, centrato; pillola `rounded-xl bg-ink px-4 py-3 text-sm font-medium text-paper shadow-lg`.
- Il toast non ha azioni: contenitore e pillola sono `pointer-events-none`, così non intercetta i tap sugli elementi sottostanti. [[plan-screen]] lo alza con `className` sopra il footer sticky (*Conferma piano* / *Crea lista della spesa*) quando il footer è visibile.

## Esempio d'Uso

```tsx
const [toast, setToast] = React.useState<string | null>(null);

<Toast message={toast} onDismiss={() => setToast(null)} />;
// …
setToast('Piano confermato');
```

## Test

`tests/ui/toast.test.tsx` (jsdom, fake timers): messaggio visibile nella live region, `onDismiss` dopo 3000 ms, live region presente ma vuota con `message: null`.

## Vedi anche

- [[plan-screen]] — Unico consumatore attuale
- [[empty-state]] — Altro componente di feedback in `components/feedback/`
- [[design-system-and-tokens]] — Colori `ink` / `paper`
- [[e3-pianificatore]] — Panoramica della Feature 4
