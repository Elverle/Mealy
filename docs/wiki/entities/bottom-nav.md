---
title: Barra di Navigazione Mobile (bottom-nav)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [ui, navigation, bottom-nav, mobile-first, components]
---

## File e Responsabilità

- **Percorso file**: `components/navigation/bottom-nav.tsx`
- **Scopo**: Componente client di navigazione primaria mobile-first. Permette all'utente di spostarsi rapidamente tra le 4 aree dell'applicazione tramite una tab bar inferiore fissa.

## Struttura e Voci di Navigazione

Le 4 tab principali sono definite nell'array `NAV_ITEMS`:

| Tab | Rotta (`href`) | Icona Lucide | Condizione Attiva |
|---|---|---|---|
| **Piano** | `/` | `CalendarDays` | `pathname === "/"` |
| **Lista** | `/lista` | `ShoppingBag` | `pathname.startsWith("/lista")` |
| **Libreria** | `/libreria` | `BookOpen` | `pathname.startsWith("/libreria")` |
| **Impostazioni** | `/impostazioni` | `Settings` | `pathname.startsWith("/impostazioni")` |

## Ergonomia e Accessibilità

1. **Touch Target e Spaziatura**:
   - Ciascuna voce possiede un'area minima di `min-h-[48px]` e `min-w-[48px]` con distribuzione equa (`flex-1`), ideale per l'interazione con il pollice su dispositivi compatti.
2. **Safe Area Insets**:
   - Include la classe `pb-[env(safe-area-inset-bottom)]` per distanziare i controlli dall'indicatore di navigazione di sistema su iOS e Android.
3. **Stati Visivi**:
   - **Attivo**: colore `text-basil font-semibold`, tratto icona rinforzato (`stroke-[2.25]`), attributo semantico `aria-current="page"`.
   - **Inattivo**: colore `text-stone`, con transizione su hover/active verso `text-ink`.
   - **Feedback tattile**: micro-animazione al tocco (`active:scale-95`).
4. **Navigazione da Tastiera**:
   - Implementa anello di focus ad alto contrasto: `focus-visible:ring-2 focus-visible:ring-basil`.

## Integrazione nel Layout

Il componente è montato all'interno di `app/layout.tsx`:

```tsx
<body className={`${figtree.variable} ${fraunces.variable} antialiased bg-paper text-ink`}>
  <main className="pb-24 pt-4 px-4 max-w-2xl mx-auto min-h-screen">
    {children}
  </main>
  <BottomNav />
</body>
```

La classe `pb-24` sul contenitore `<main>` assicura che il contenuto delle pagine non venga mai nascosto dalla barra fissa.

## Vedi anche

- [[shell-navigation-pattern]] — Pattern concettuale di navigazione dell'app
- [[design-system-and-tokens]] — Palette `basil`, `stone` e accessibilità WCAG
- [[e0-fondamenta]] — Panoramica della Feature 1
