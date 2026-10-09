---
title: Notifica Temporanea (toast)
type: entity
created: 2026-09-29
updated: 2026-10-09
tags: [ui, components, feedback, toast, accessibility, live-region, z-index, feature-4]
---

## File e Responsabilità

- **Percorso file**: `components/feedback/toast.tsx` (`"use client"`)
- **Scopo**: mostrare per qualche secondo un messaggio breve di conferma o di errore (es. `Piano generato`, `Piano confermato`, `Piano ripetuto`, gli errori di swap e blocco). È un componente **locale** e controllato dal genitore: non esiste un provider globale né una coda di messaggi (requirements P19). Nella Feature 4 lo usava solo [[plan-screen]]; dalla Feature 5 anche [[library-screen]], ed entrambe ci mostrano i messaggi che [[recipe-detail-sheet]] passa con `onNotify` (es. `Non la proporrò più.`, `Non proporrò più ricette con cipolla: vale dai prossimi piani.`, gli errori di salvataggio delle preferenze). Dalla Feature 6 lo usa anche [[shopping-screen]] (`Lista creata`, `Lista aggiornata`, `Ci sono spunte in attesa di rete: riprova quando torna la connessione.`, gli errori di creazione, aggiornamento, rimozione e delle spunte scartate), e [[plan-screen]] ci mostra l'errore della creazione della lista dal footer.

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
- Posizione: `fixed inset-x-0 bottom-24 z-[60]`, centrato; pillola `rounded-xl bg-ink px-4 py-3 text-sm font-medium text-paper shadow-lg`. Fino alla Feature 4 era `z-50`, lo stesso livello della sheet (`components/ui/sheet.tsx`, senza portal), e stava sopra solo perché veniva dopo nel DOM. I messaggi della Feature 5 compaiono **mentre la sheet è aperta**, quindi il livello è stato alzato a `z-[60]`: il toast sta sopra la sheet qualunque sia l'ordine nel DOM (proposta R5 della review architetturale). Nessun test lo verifica (jsdom non ha layout): va controllato su un dispositivo reale.
- Il toast non ha azioni: contenitore e pillola sono `pointer-events-none`, così non intercetta i tap sugli elementi sottostanti. [[plan-screen]] lo alza con `className` sopra il footer sticky (*Conferma piano* / *Crea lista della spesa*) quando il footer è visibile. [[shopping-screen]] fa lo stesso sopra il pulsante flottante *Aggiungi* (`bottom-[calc(9.5rem+env(safe-area-inset-bottom))]`), quando il pulsante è visibile; che il toast non lo copra davvero è tra le verifiche da telefono rinviate a fine v1.

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

- [[plan-screen]] — Primo consumatore (Feature 4)
- [[library-screen]] — Secondo consumatore (Feature 5)
- [[shopping-screen]] — Terzo consumatore (Feature 6)
- [[recipe-detail-sheet]] — Origine dei messaggi sulle preferenze, tramite `onNotify`
- [[empty-state]] — Altro componente di feedback in `components/feedback/`
- [[design-system-and-tokens]] — Colori `ink` / `paper`
- [[e3-pianificatore]] — Panoramica della Feature 4
