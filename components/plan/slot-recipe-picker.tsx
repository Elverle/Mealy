"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { RecipeCard } from "@/components/library/recipe-card";
import {
  RecipeDetailSheet,
  type RecipePrefChanges,
} from "@/components/recipes/recipe-detail-sheet";
import { RecipeProposalSheet } from "@/components/recipes/recipe-proposal-sheet";
import { RecipeRequestBox } from "@/components/recipes/recipe-request-box";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { filterLibraryCards } from "@/lib/domain/library";
import {
  EMPTY_LIBRARY_FILTER,
  LIBRARY_QUERY_MAX,
  MEAL_TYPE_LABELS,
  type GeneratedRecipe,
  type PlanSlotView,
  type PlanView,
  type Recipe,
  type SlotCandidates,
} from "@/lib/domain/types";
import { ApiRequestError, apiErrorMessage } from "@/lib/http/client";
import { requestSaveRecipe } from "@/lib/library/client";
import { formatDayLabel } from "@/lib/plans/format";
import { fetchSlotCandidates, requestAssignSlotRecipe } from "@/lib/plans/client";

export interface SlotRecipePickerProps {
  planId: string;
  /** Slot per cui si sceglie. Il componente va montato solo a selettore aperto. */
  slot: PlanSlotView;
  /** Chiusura senza assegnazione (✕, Esc, sfondo), oppure dopo `onPlanStale`. */
  onClose: () => void;
  /** Assegnazione riuscita: riceve il piano aggiornato. Chi riceve smonta il selettore. */
  onAssigned: (plan: PlanView) => void;
  /** Slot o piano non più modificabili: chi riceve rilegge il piano. Chiamata subito prima di `onClose`. */
  onPlanStale: () => void;
  /** Messaggi da mostrare come toast dal genitore. */
  onNotify: (message: string) => void;
  /** Giudizi salvati dal dettaglio aperto nel selettore. */
  onRecipePrefsChange?: (recipeId: string, changed: RecipePrefChanges) => void;
}

type LoadState = "loading" | "ready" | "error";

const STALE_PLAN_CODES: ReadonlySet<string> = new Set([
  "slot_locked",
  "slot_past",
  "plan_archived",
  "plan_not_found",
  "slot_not_found",
]);
const UNAVAILABLE_RECIPE_CODES: ReadonlySet<string> = new Set([
  "recipe_not_eligible",
  "recipe_not_found",
]);
const DUPLICATE_RECIPE_CODE = "recipe_duplicate";
const SAVED_NOT_ASSIGNED =
  "Ricetta aggiunta alla libreria, ma non sono riuscito a metterla nel piano.";
const IN_PLAN_BADGE = "Già nel piano";
const SKELETON_ROWS = [0, 1, 2];

const errorCode = (err: unknown): string => (err instanceof ApiRequestError ? err.code : "");

/**
 * Selettore di una ricetta per uno slot del piano: elenco delle ricette della libreria adatte
 * al pasto, ricerca, dettaglio con «Metti nel piano» e richiesta all'LLM con salvataggio.
 */
export function SlotRecipePicker({
  planId,
  slot,
  onClose,
  onAssigned,
  onPlanStale,
  onNotify,
  onRecipePrefsChange,
}: SlotRecipePickerProps): React.JSX.Element {
  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const [candidates, setCandidates] = React.useState<SlotCandidates | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [requestText, setRequestText] = React.useState<string | null>(null);
  const [assigning, setAssigning] = React.useState(false);

  const mountedRef = React.useRef(true);
  const loadIdRef = React.useRef(0);
  const assigningRef = React.useRef(false);
  const slotId = slot.id;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Una risposta vecchia non sovrascrive una nuova (Riprova rapido, ricarica dopo un errore).
  const load = React.useCallback(() => {
    const id = ++loadIdRef.current;
    setLoadState("loading");
    fetchSlotCandidates(planId, slotId).then(
      (next) => {
        if (!mountedRef.current || loadIdRef.current !== id) return;
        setCandidates(next);
        setLoadState("ready");
      },
      (err: unknown) => {
        if (!mountedRef.current || loadIdRef.current !== id) return;
        setLoadError(apiErrorMessage(err));
        setLoadState("error");
      }
    );
  }, [planId, slotId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const visible = React.useMemo(
    () =>
      candidates === null
        ? []
        : filterLibraryCards(candidates.recipes, { ...EMPTY_LIBRARY_FILTER, q: query }),
    [candidates, query]
  );
  const inPlan = React.useMemo(
    () => new Set(candidates?.in_plan_recipe_ids ?? []),
    [candidates]
  );

  // Giudizi dal dettaglio: si fondono nella card e si inoltrano al genitore.
  const handlePrefsChange = (recipeId: string, changed: RecipePrefChanges): void => {
    setCandidates((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            recipes: prev.recipes.map((card) => {
              if (card.id !== recipeId) return card;
              const next = { ...card };
              if (changed.rating !== undefined) next.rating = changed.rating ?? null;
              if (changed.favorite !== undefined) next.favorite = changed.favorite;
              if (changed.blocked !== undefined) next.blocked = changed.blocked;
              if (next.blocked) next.favorite = false;
              return next;
            }),
          }
    );
    onRecipePrefsChange?.(recipeId, changed);
  };

  // «Metti nel piano» dal dettaglio.
  const assign = async (recipeId: string): Promise<void> => {
    if (assigningRef.current) return;
    assigningRef.current = true;
    setAssigning(true);
    try {
      const result = await requestAssignSlotRecipe(planId, slotId, recipeId);
      onAssigned(result.plan);
    } catch (err) {
      const code = errorCode(err);
      onNotify(apiErrorMessage(err));
      if (STALE_PLAN_CODES.has(code)) {
        onPlanStale();
        onClose();
      } else if (UNAVAILABLE_RECIPE_CODES.has(code)) {
        setDetailId(null);
        load();
      }
      // Ogni altro errore (rete, 500): il dettaglio resta aperto e si può riprovare.
    } finally {
      assigningRef.current = false;
      if (mountedRef.current) setAssigning(false);
    }
  };

  // «Metti nel piano» dalla proposta: salvataggio, poi assegnazione.
  const acceptProposal = async (recipe: GeneratedRecipe): Promise<void> => {
    let saved: Recipe;
    try {
      saved = await requestSaveRecipe(recipe);
    } catch (err) {
      onNotify(apiErrorMessage(err));
      if (errorCode(err) !== DUPLICATE_RECIPE_CODE) throw err; // la sheet di proposta resta aperta
      // Già in libreria: la proposta si chiude e l'elenco si rilegge, così la ricetta compare tra le candidate.
      setRequestText(null);
      load();
      return;
    }
    try {
      const result = await requestAssignSlotRecipe(planId, slotId, saved.id);
      onAssigned(result.plan);
    } catch (err) {
      // La ricetta è in libreria: non si rilancia, la sheet di proposta si chiude.
      onNotify(SAVED_NOT_ASSIGNED);
      setRequestText(null);
      if (STALE_PLAN_CODES.has(errorCode(err))) {
        onPlanStale();
        onClose();
      } else {
        load();
      }
    }
  };

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent className="h-[92dvh]">
          <SheetHeader>
            <SheetTitle>{`Scegli per ${formatDayLabel(slot.day)} · ${MEAL_TYPE_LABELS[slot.meal]}`}</SheetTitle>
          </SheetHeader>

          {/* Campo di ricerca fisso sopra l'elenco: stesse classi di LibraryFilters, senza autoFocus */}
          <div className="shrink-0 px-4 pb-3 sm:px-6">
            <div className="relative">
              <Search
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Cerca tra le ricette adatte"
                placeholder="Cerca ricetta o ingrediente…"
                maxLength={LIBRARY_QUERY_MAX}
                className="min-h-[44px] w-full rounded-xl border border-stone/20 bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
              />
            </div>
          </div>

          <SheetBody>
            {loadState === "loading" && (
              <div
                role="status"
                aria-label="Caricamento delle ricette"
                className="mt-3 space-y-3"
              >
                {SKELETON_ROWS.map((row) => (
                  <div
                    key={row}
                    className="h-20 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none"
                  />
                ))}
              </div>
            )}

            {loadState === "error" && (
              <div className="mt-3 space-y-3">
                <p
                  role="alert"
                  className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink"
                >
                  {loadError}
                </p>
                <Button variant="outline" onClick={() => load()}>
                  Riprova
                </Button>
              </div>
            )}

            {loadState === "ready" && candidates !== null && (
              <>
                {candidates.recipes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-stone">
                    {"Nessun'altra ricetta adatta a questo pasto"}
                  </p>
                ) : visible.length === 0 ? (
                  <p className="py-8 text-center text-sm text-stone">Nessuna ricetta trovata</p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {visible.map((card) => (
                      <RecipeCard
                        key={card.id}
                        recipe={card}
                        onOpen={setDetailId}
                        badge={inPlan.has(card.id) ? IN_PLAN_BADGE : undefined}
                      />
                    ))}
                  </div>
                )}
                <RecipeRequestBox query={query} onRequest={setRequestText} />
              </>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <RecipeDetailSheet
        recipeId={detailId}
        servings={slot.servings}
        onClose={() => setDetailId(null)}
        onRecipePrefsChange={handlePrefsChange}
        onNotify={onNotify}
        primaryAction={{
          label: "Metti nel piano",
          onAction: (id) => void assign(id),
          busy: assigning,
        }}
      />

      <RecipeProposalSheet
        request={requestText}
        mealType={slot.meal}
        servings={slot.servings}
        acceptLabel="Metti nel piano"
        onAccept={acceptProposal}
        onClose={() => setRequestText(null)}
      />
    </>
  );
}
