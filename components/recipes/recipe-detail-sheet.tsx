"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { RecipeSheet } from "@/components/sheets/recipe-sheet";
import { findRecipeIngredient, toRecipeDetail } from "@/components/sheets/recipe-detail";
import { applyRecipePrefPatch, defaultRecipePref } from "@/lib/domain/prefs";
import { normalizeCanonicalName } from "@/lib/domain/recipe-text";
import type {
  IngredientPref,
  Recipe,
  RecipeDetailView,
  RecipeIngredientInfo,
  RecipePref,
  UpdateRecipePrefRequest,
} from "@/lib/domain/types";
import { apiErrorMessage } from "@/lib/http/client";
import { fetchRecipeDetail } from "@/lib/library/client";
import { putIngredientPref, putRecipePref } from "@/lib/prefs/client";

/** Campi di una preferenza ricetta che un salvataggio può aver cambiato. */
export type RecipePrefChanges = Partial<Pick<RecipePref, "rating" | "favorite" | "blocked">>;

export interface RecipeDetailSheetProps {
  /** Ricetta da mostrare; null = sheet chiusa. */
  recipeId: string | null;
  /** Porzioni su cui scalare le quantità all'apertura. */
  servings: number;
  /** Ricetta già nota a chi chiama (Piano): si mostra subito, mentre il dettaglio si carica. */
  initialRecipe?: Recipe | null;
  onClose: () => void;
  /**
   * Dopo ogni salvataggio riuscito delle preferenze della ricetta. `changed` contiene solo i campi
   * della richiesta (valori salvati), più `favorite` quando la richiesta contiene `blocked`
   * (bloccare toglie dalle preferite): chi riceve li fonde nel proprio stato.
   */
  onRecipePrefsChange?: (recipeId: string, changed: RecipePrefChanges) => void;
  /** Messaggi (conferme ed errori) da mostrare come toast dal genitore. */
  onNotify: (message: string) => void;
  /** Sostituisce il messaggio mostrato dopo "Non proporre più". */
  blockedMessage?: string;
  /**
   * Azione primaria in fondo al dettaglio (es. «Metti nel piano»). Compare solo a ricetta
   * caricata. Assente: il dettaglio è identico a quello di Libreria e Piano.
   */
  primaryAction?: { label: string; onAction: (recipeId: string) => void; busy?: boolean };
}

type LoadState = "idle" | "loading" | "ready" | "error";

const LOAD_PREFS_ERROR = "Non riesco a caricare le preferenze sugli ingredienti.";
const TOAST_BLOCKED = "Non la proporrò più.";
const TOAST_UNBLOCKED = "La ricetta torna tra le proposte.";
const dislikedToast = (name: string) =>
  `Non proporrò più ricette con ${name}: vale dai prossimi piani.`;

const EMPTY_INFO: ReadonlyMap<string, RecipeIngredientInfo> = new Map();

/** Campi cambiati da un salvataggio: quelli della richiesta (valori salvati) più `favorite` se blocca. */
function changedFields(patch: UpdateRecipePrefRequest, saved: RecipePref): RecipePrefChanges {
  const changed: RecipePrefChanges = {};
  if (patch.rating !== undefined) changed.rating = saved.rating;
  if (patch.favorite !== undefined) changed.favorite = saved.favorite;
  if (patch.blocked !== undefined) {
    changed.blocked = saved.blocked;
    changed.favorite = saved.favorite;
  }
  return changed;
}

/**
 * Dettaglio ricetta unico per Piano e Libreria: carica i dati, salva le preferenze in modo
 * ottimistico e mostra l'impatto prima di scartare un ingrediente.
 */
export function RecipeDetailSheet({
  recipeId,
  servings,
  initialRecipe,
  onClose,
  onRecipePrefsChange,
  onNotify,
  blockedMessage,
  primaryAction,
}: RecipeDetailSheetProps): React.JSX.Element {
  const [detail, setDetail] = React.useState<RecipeDetailView | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>("idle");
  const [prefsOverride, setPrefsOverride] = React.useState<RecipePref | null>(null);
  const [info, setInfo] = React.useState<ReadonlyMap<string, RecipeIngredientInfo>>(EMPTY_INFO);
  const [savingPrefs, setSavingPrefs] = React.useState(false);
  const [savingIngredient, setSavingIngredient] = React.useState(false);

  // Callback e ricetta iniziale in ref, aggiornati a ogni render: gli effetti non si rilanciano.
  const onCloseRef = React.useRef(onClose);
  const onNotifyRef = React.useRef(onNotify);
  const onRecipePrefsChangeRef = React.useRef(onRecipePrefsChange);
  const initialRecipeRef = React.useRef(initialRecipe);
  React.useEffect(() => {
    onCloseRef.current = onClose;
    onNotifyRef.current = onNotify;
    onRecipePrefsChangeRef.current = onRecipePrefsChange;
    initialRecipeRef.current = initialRecipe;
  });

  const mountedRef = React.useRef(true);
  const currentIdRef = React.useRef<string | null>(recipeId);
  const savingPrefsRef = React.useRef(false);
  const savingIngredientRef = React.useRef(false);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Apertura: dipende solo da recipeId. La pulizia annulla la richiesta in corso.
  React.useEffect(() => {
    currentIdRef.current = recipeId;
    setDetail(null);
    setPrefsOverride(null);
    setInfo(EMPTY_INFO);
    if (recipeId === null) {
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    let cancelled = false;
    fetchRecipeDetail(recipeId).then(
      (loaded) => {
        if (cancelled) return;
        setDetail(loaded);
        setInfo(new Map(loaded.ingredients.map((i) => [i.canonical_name, i])));
        setLoadState("ready");
      },
      (err: unknown) => {
        if (cancelled) return;
        if (initialRecipeRef.current?.id === recipeId) {
          setLoadState("error");
          onNotifyRef.current(LOAD_PREFS_ERROR);
        } else {
          onNotifyRef.current(apiErrorMessage(err));
          onCloseRef.current();
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  // Si usano solo dati della ricetta richiesta: evita un frame con quella precedente.
  const recipe: Recipe | null =
    recipeId === null
      ? null
      : detail?.recipe.id === recipeId
        ? detail.recipe
        : initialRecipe?.id === recipeId
          ? initialRecipe
          : null;
  const prefs: RecipePref | null =
    prefsOverride !== null && prefsOverride.recipe_id === recipe?.id
      ? prefsOverride
      : (recipe?.prefs ?? null);

  const view = React.useMemo(
    () =>
      recipe
        ? toRecipeDetail({ ...recipe, prefs }, servings, loadState === "ready" ? info : undefined)
        : null,
    [recipe, prefs, servings, loadState, info]
  );

  const savePrefs = async (patch: UpdateRecipePrefRequest): Promise<void> => {
    if (!recipe || savingPrefsRef.current) return;
    const id = recipe.id;
    const previous = prefs;
    const base = previous ?? defaultRecipePref(id);
    setPrefsOverride({ ...base, ...applyRecipePrefPatch(previous, patch) });
    savingPrefsRef.current = true;
    setSavingPrefs(true);
    try {
      const saved = await putRecipePref(id, patch);
      const changed = changedFields(patch, saved);
      onRecipePrefsChangeRef.current?.(id, changed);
      if (mountedRef.current && currentIdRef.current === id) {
        // Fonde solo i campi cambiati: una risposta tardiva non sovrascrive altri campi.
        setPrefsOverride((current) => ({ ...(current ?? base), ...changed }));
      }
      if (patch.blocked === true) onNotifyRef.current(blockedMessage ?? TOAST_BLOCKED);
      else if (patch.blocked === false) onNotifyRef.current(TOAST_UNBLOCKED);
    } catch (err) {
      if (mountedRef.current && currentIdRef.current === id) setPrefsOverride(previous);
      onNotifyRef.current(apiErrorMessage(err));
    } finally {
      savingPrefsRef.current = false;
      if (mountedRef.current) setSavingPrefs(false);
    }
  };

  const handleIngredientPreference = async (
    rowId: string,
    preference: "liked" | "disliked" | null
  ): Promise<void> => {
    if (!recipe || savingIngredientRef.current) return;
    const ingredient = findRecipeIngredient(recipe, rowId);
    if (!ingredient) return;
    const id = recipe.id;
    const name = normalizeCanonicalName(ingredient.canonical_name);
    const pref: IngredientPref | null =
      preference === "liked" ? "like" : preference === "disliked" ? "dislike" : null;
    const previous = info.get(name);
    const isCurrent = () => mountedRef.current && currentIdRef.current === id;
    const setEntry = (entry: RecipeIngredientInfo | undefined) =>
      setInfo((current) => {
        const next = new Map(current);
        if (entry) next.set(name, entry);
        else next.delete(name);
        return next;
      });

    setEntry({ canonical_name: name, pref, recipes_count: previous?.recipes_count ?? 0 });
    savingIngredientRef.current = true;
    setSavingIngredient(true);
    try {
      const result = await putIngredientPref(name, pref);
      if (isCurrent()) setEntry(result);
      if (pref === "dislike") onNotifyRef.current(dislikedToast(name));
    } catch (err) {
      if (isCurrent()) setEntry(previous);
      onNotifyRef.current(apiErrorMessage(err));
    } finally {
      savingIngredientRef.current = false;
      if (mountedRef.current) setSavingIngredient(false);
    }
  };

  return (
    <RecipeSheet
      recipe={view}
      isOpen={recipeId !== null}
      isLoading={recipeId !== null && view === null}
      onClose={onClose}
      onRate={(_, star) => void savePrefs({ rating: prefs?.rating === star ? null : star })}
      onToggleFavorite={() => void savePrefs({ favorite: !(prefs?.favorite ?? false) })}
      onToggleBlock={() => void savePrefs({ blocked: !(prefs?.blocked ?? false) })}
      actionsDisabled={savingPrefs}
      onIngredientPreference={
        loadState === "ready"
          ? (rowId, preference) => void handleIngredientPreference(rowId, preference)
          : undefined
      }
      ingredientsDisabled={savingIngredient}
      footer={
        primaryAction && recipe ? (
          <Button
            className="h-12 w-full text-base font-semibold"
            disabled={primaryAction.busy === true}
            onClick={() => primaryAction.onAction(recipe.id)}
          >
            {primaryAction.label}
          </Button>
        ) : undefined
      }
    />
  );
}
