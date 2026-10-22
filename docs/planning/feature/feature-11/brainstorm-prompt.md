# Feature 11 — Composizione del pasto: spunto per il brainstorming

Punto di partenza per `/feature-brainstorm`, scritto il 14 ottobre 2026 durante il brainstorming della Feature 8. Non è una specifica: raccoglie l'obiettivo, le decisioni già prese, i vincoli e le domande aperte.

Uso: `/agentic-feature-factory:feature-brainstorm 11 docs/planning/feature/feature-11/brainstorm-prompt.md`

Dipende da: Feature 8 (portate delle ricette, `../feature-8/spec.md`) e, per avere abbastanza contorni in libreria, Feature 10 (pacchetto iniziale, `../feature-10/brainstorm-prompt.md`).

---

## Obiettivo

Un pasto non è più per forza una sola ricetta. L'utente sceglie come comporre pranzo e cena:

| Composizione | Piatti |
|---|---|
| Piatto unico | 1 ricetta con portata `piatto-unico` |
| Primo | 1 ricetta `primo` |
| Primo + contorno | 1 `primo` + 1 `contorno` |
| Secondo | 1 ricetta `secondo` |
| Secondo + contorno | 1 `secondo` + 1 `contorno` |

Il contorno è di verdura e si può togliere: "primo + contorno" senza contorno diventa "primo".

## Decisioni già prese (14 ottobre 2026)

- **Dove si sceglie**: nelle Impostazioni, per pranzo e per cena, si indicano una o più composizioni ammesse (per esempio cena: secondo + contorno, piatto unico). Il planner le alterna in modo bilanciato nella settimana. Sulla card del pasto si può togliere o aggiungere il contorno e cambiare composizione.
- **Portate multiple**: una ricetta può valere per più portate (`courses[]`, Feature 8), quindi una `['secondo', 'piatto-unico']` è candidata per entrambe.
- **Etichetta di stile `piatto-unico`**: la Feature 8 la tiene legata alla portata; questa feature la toglie da `MEAL_STYLE_TAG_VALUES` e dalle preferenze salvate, perché la composizione la sostituisce.

## Modello dati proposto

Ogni piatto è uno slot a sé: `plan_slots` riceve una colonna `course` e l'indice unico passa da `(plan_id, day, meal)` a `(plan_id, day, meal, course)`. Un "pasto" è il gruppo di slot con lo stesso giorno e pasto. Vantaggi:

- swap, scelta, blocco e lista della spesa lavorano già per slot e restano quasi invariati;
- togliere il contorno elimina uno slot, aggiungerlo ne crea uno;
- `exclusionReason` passa dal controllo "portata principale" della Feature 8 a "ha la portata dello slot".

Alternative scartate nel brainstorming della Feature 8: una tabella figlia `slot_dishes` (riscrive tutta la logica degli slot), un `side_recipe_id` su `plan_slots` (duplica ogni azione).

## Punti da toccare

- `lib/domain/types.ts`: composizioni, `PlanSlotSchema`/`PlanSlotViewSchema` con `course`, impostazioni dell'household.
- `lib/db/schema.ts` e migrazione: `plan_slots.course`, indice, valore per gli slot esistenti; composizioni sull'household.
- `lib/domain/planner.ts`: slot per portata, scelta bilanciata della composizione, conteggio delle fresche e generazione per portata (anche contorni).
- `lib/plans/service.ts` e le rotte `app/api/plans/[id]/slots/[slotId]/*`: swap, scelta e blocco per piatto; aggiungere e togliere il contorno.
- `components/plan/plan-slot-card.tsx`, `plan-screen.tsx`, `slot-recipe-picker.tsx`: card con 1–2 piatti.
- Impostazioni e onboarding: scelta delle composizioni.
- Lista della spesa: dovrebbe funzionare già per slot; da verificare.

## Domande aperte

- Default delle composizioni per un household nuovo e per quello esistente (oggi un piatto per pasto).
- Bilanciamento: alternanza rigida o sorteggio pesato tra le composizioni ammesse.
- Cosa succede ai piani esistenti: restano a un piatto (portata dedotta dalla ricetta) o vengono ricomposti solo da *Rigenera*.
- Porzioni del contorno: le stesse del pasto.
- Card del pasto: due righe nella stessa card o due card; dove stanno *Cambia*, *Scegli* e ★ per ciascun piatto (`DESIGN.md §3`: cambiare idea deve costare un tap).
- Ripeti: copia anche la composizione.
- Primo + secondo + contorno (pasto completo): fuori ambito salvo richiesta.
