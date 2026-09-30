---
title: Guardia di Onboarding e Route Group (app)
type: concept
created: 2026-09-28
updated: 2026-09-29
tags: [architecture, app-router, route-group, layout, redirect, onboarding, server-components, feature-3]
---

## Il Problema

L'household di default esiste già prima del primo avvio (lo crea `ensureDefaultHousehold()` o `pnpm db:seed`), quindi la sua presenza non distingue un utente nuovo. Serve un segnale esplicito (colonna `households.onboarded_at`, v. [[database-schema]]) e un punto unico che impedisca di usare le tab dell'app finché il wizard non è stato completato, **senza** flash del contenuto e senza un middleware che debba accedere al DB.

## La Soluzione: Route Group con Layout di Guardia

Le 4 tab vivono in un **route group** di Next.js App Router, `app/(app)/`. Le parentesi escludono il segmento dall'URL: `/`, `/lista`, `/libreria`, `/impostazioni` restano invariati, ma condividono un layout dedicato.

```
app/
├── layout.tsx               # root: font, metadata, <body> con solo {children} (nessuna BottomNav)
├── (app)/
│   ├── layout.tsx           # guardia di onboarding + BottomNav
│   ├── page.tsx             # Piano       → /
│   ├── lista/page.tsx       # Lista       → /lista
│   ├── libreria/page.tsx    # Libreria    → /libreria
│   └── impostazioni/page.tsx# Impostazioni→ /impostazioni
├── benvenuto/page.tsx       # wizard → /benvenuto (fuori dal gruppo, senza BottomNav)
└── api/…                    # route handler, non toccati dalla guardia
```

`app/(app)/layout.tsx` è un server component:

```tsx
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const settings = await getSettings();
  if (!settings.onboarded) redirect('/benvenuto');
  return (
    <>
      <div className="flex-1 pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
```

### Proprietà del pattern

- **Redirect lato server**: `redirect()` avviene prima di qualsiasi render della pagina richiesta, quindi nessun contenuto delle tab appare, nemmeno per un frame, a un utente non onboardato.
- **`await connection()`** (`next/server`): marca layout e pagine come dinamici, così `next build` non tenta di interrogare il DB durante il prerender.
- **Guardia simmetrica**: `app/benvenuto/page.tsx` fa il contrario (`if (settings.onboarded) redirect('/')`), quindi a onboarding completato il wizard non è più raggiungibile ([[onboarding-wizard]]).
- **Chrome per gruppo**: la `BottomNav` e il padding `pb-24` sono proprietà del gruppo `(app)`, non della root; le pagine fuori dal gruppo (oggi solo `/benvenuto`) sono a schermo intero.
- **Nessuna gestione speciale degli errori**: un DB irraggiungibile produce l'errore standard di Next.
- Le route API (`app/api/…`) non passano dal layout e restano raggiungibili indipendentemente dall'onboarding.

### Ritorno dal wizard

Al completamento il wizard esegue `router.replace('/')` seguito da `router.refresh()`: il refresh forza la rivalutazione del layout `(app)` con `onboarded: true` invece di riusare payload in cache.

## Conseguenze per le Feature Successive

- **Percorsi dei file (R2 della review)**: la pagina Piano è `app/(app)/page.tsx` (non più `app/page.tsx`); ogni nuova schermata con la barra di navigazione va creata sotto `app/(app)/`. I test importano le pagine da `@/app/(app)/…`.
- **Doppia lettura dell'household (Q1)**: il layout chiama `getSettings()` e anche le pagine del gruppo possono chiamarlo (oggi `/impostazioni`, in F4 il Piano). Il piano della Feature 4 deve valutare `React.cache()` su `getSettings` / `loadHousehold` per deduplicare la lettura nella stessa richiesta. **Esito (Feature 4)**: non adottato. La pagina Piano (`app/(app)/page.tsx`, [[plan-screen]]) segue lo stesso schema di `/impostazioni` (`await connection()` + servizio + componente client) e legge l'household tramite `getPlanScreen`; la doppia lettura resta e su una LAN domestica è stata giudicata accettabile.
- **Autenticazione**: la guardia verifica solo l'onboarding, non l'identità; in v1 l'app è raggiungibile solo in locale (Raspberry + Tailscale, `ARCHITECTURE §8`).

## Test

`tests/app/app-layout.test.tsx` (node, con `next/server`, `next/navigation` e `@/lib/settings/service` mockati): con `onboarded: false` il layout rifiuta con `NEXT_REDIRECT` e `redirect('/benvenuto')` è stato chiamato; con `onboarded: true` ritorna un elemento senza redirect; `connection()` è chiamato in entrambi i casi.

## Vedi anche

- [[shell-navigation-pattern]] — Shell a 4 tab, ora montata dal layout del gruppo
- [[bottom-nav]] — Barra di navigazione inferiore
- [[onboarding-wizard]] — Pagina `/benvenuto` e completamento dell'onboarding
- [[settings-service]] — `getSettings()` e campo `onboarded`
- [[e5-impostazioni]] — Panoramica della Feature 3
- [[plan-screen]] — Pagina Piano del gruppo `(app)` (Feature 4)
