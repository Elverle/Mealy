---
title: Repository Nucleo Domestico (household-repo)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [database, repository, household, singleton, drizzle]
---

## File e Responsabilità

- **Percorso file**: `lib/db/repositories/household-repo.ts`
- **Scopo**: Fornire un'interfaccia tipata e robusta per la lettura, la creazione idempotente e l'aggiornamento dei dati del nucleo familiare nella tabella `households`. Tutti i dati estratti vengono validati con `HouseholdSchema.parse()` prima della restituzione.

## Metodi Esportati

### `getHouseholdById(id: string): Promise<Household | null>`
Esegue una query `findFirst` sulla tabella `households` tramite `drizzle.query`. Se il record viene individuato, ne esegue il parsing con lo schema Zod `HouseholdSchema`. In caso contrario restituisce `null`.

### `ensureDefaultHousehold(): Promise<Household>`
Garantisce in modo **idempotente** che il nucleo familiare di default (`DEFAULT_HOUSEHOLD_ID = '00000000-0000-0000-0000-000000000001'`) sia presente nel database:
1. Verifica preventivamente se il record esiste già.
2. In caso di assenza, tenta l'inserimento con `.onConflictDoNothing()`.
3. Gestisce eventuali race-condition concorrenti recuperando il record appena creato.

### `getDefaultHousehold(): Promise<Household>`
Metodo di comodo utilizzato dalle schermate e dai servizi in v1. Prova il recupero del singleton tramite `getHouseholdById` e, in caso di esito negativo, invoca `ensureDefaultHousehold()`.

### `updateHousehold(data: Partial<Omit<Household, 'id' | 'created_at' | 'updated_at'>>, id?: string): Promise<Household>`
Aggiorna i parametri di configurazione del nucleo (default: `DEFAULT_HOUSEHOLD_ID`):
- Supporta aggiornamenti parziali di: `persons`, `meals`, `diet_tags`, `meal_style_tags`, `appliances`.
- Aggiorna automaticamente la colonna `updated_at` alla data/ora corrente.
- Solleva un errore esplicito qualora l'ID indicato non esista.

## Esempio d'Uso

```ts
import { getDefaultHousehold, updateHousehold } from '@/lib/db/repositories/household-repo';

// Recupero impostazioni correnti
const household = await getDefaultHousehold();
console.log(`Persone a tavola: ${household.persons}`);

// Aggiornamento esigenze dietetiche
const updated = await updateHousehold({
  diet_tags: ['vegetariano'],
  persons: 3,
});
```

## Vedi anche

- [[domain-types]] — Tipi `Household` e costante `DEFAULT_HOUSEHOLD`
- [[database-schema]] — Tabella `households` in Drizzle
- [[database-architecture]] — Strategia relazionale e migrazioni
