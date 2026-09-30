// Segnaposto: la Feature 5 (S2.3) lo sostituisce con le liste reali di ingredient_prefs.

import * as React from "react";
import { Card } from "@/components/ui/card";

export function IngredientPrefsPlaceholder(): React.JSX.Element {
  return (
    <Card className="p-4 space-y-1">
      <h2 className="font-display text-base font-bold text-ink">I miei ingredienti</h2>
      <p className="text-xs text-stone">
        Qui ritroverai gli ingredienti che segni con 👍 o 👎 nelle ricette.
      </p>
    </Card>
  );
}
