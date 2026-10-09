# Feature Index

Ordine di esecuzione e mappatura: [`execution-strategy.md`](execution-strategy.md). Stati: `todo` → `planned` → `in-progress` → `reviewed` → `done`.

| # | Title | Status | Date | Plan |
|---|-------|--------|------|------|
| 1 | E0 Fondamenta (scaffold, schema DB, UI shell) | done | 2026-09-15 | feature/feature-1/plan.md |
| 2 | E1 Motore ricette (LLM adapter, generazione, fixtures) | done | 2026-09-17 | feature/feature-2/plan.md |
| 3 | E5 Impostazioni (onboarding e vincoli household) | done | 2026-09-17 | feature/feature-3/plan.md |
| 4 | E3 Pianificatore (selezione pesata, piano, swap, UI) | done | 2026-09-30 | feature/feature-4/plan.md |
| 5 | E2 Libreria e preferenze (ricetta + ingredienti) | done | 2026-10-06 | feature/feature-5/plan.md |
| 6 | E4 Lista della spesa (consolidamento, UI) | done | 2026-10-09 | feature/feature-6/plan.md |
| 7 | E6 Deploy (Raspberry Pi + Tailscale) | specified | 2026-09-14 | feature/feature-7/spec.md |

Note:
- Feature 4: la verifica manuale da telefono (genera → sheet → swap → blocco → conferma, navigatore e *Ripeti*) è rinviata a fine v1, su decisione dell'utente del 2026-09-30.
- Feature 5: nella stessa prova da telefono vanno guardati i punti non verificabili in jsdom (toast sopra la sheet, card di libreria con pulsante esteso, conferma di scarto su una ricetta lunga, tap target) e rivalutata la rimozione a un tap senza annulla in *I miei ingredienti*. Dettaglio in `feature/feature-5/code-review-2026-10-05.md`.
- Feature 6: nella stessa prova da telefono vanno guardati i punti di `feature/feature-6/requirements.md` §5 e il ritorno con *Indietro* sul Piano dopo aver creato la lista dal footer (il rimedio è coperto dai test, non riprodotto in browser). Limite noto: `pnpm db:seed:aliases` inserisce soltanto, quindi una voce corretta o tolta dopo il primo deploy non raggiunge il DB già popolato.
