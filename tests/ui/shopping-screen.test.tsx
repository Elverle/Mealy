import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShoppingScreen } from "@/components/shopping/shopping-screen";
import { CHECK_RETRY_FIRST_DELAY_MS } from "@/lib/shopping/check-queue";
import { ApiRequestError } from "@/lib/http/client";
import {
  deleteShoppingItem,
  fetchPlanShoppingList,
  patchShoppingItem,
  postShoppingItem,
  requestBuildShoppingList,
} from "@/lib/shopping/client";
import type {
  PlanShoppingListView,
  ShoppingItemView,
  ShoppingListView,
  ShoppingPlanRef,
  ShoppingRecipeRef,
  ShoppingScreenView,
} from "@/lib/domain/types";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/lista",
}));

vi.mock("@/lib/shopping/client", () => ({
  fetchPlanShoppingList: vi.fn(),
  requestBuildShoppingList: vi.fn(),
  patchShoppingItem: vi.fn(),
  postShoppingItem: vi.fn(),
  deleteShoppingItem: vi.fn(),
}));

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAN_ID = "33333333-3333-4333-8333-333333333333";
const LIST_ID = "44444444-4444-4444-8444-444444444444";
const ID_CIPOLLA = "aaaaaaaa-0000-4000-8000-000000000001";
const ID_ZUCCHINA = "aaaaaaaa-0000-4000-8000-000000000002";
const ID_POLLO = "aaaaaaaa-0000-4000-8000-000000000003";
const ID_LATTE = "aaaaaaaa-0000-4000-8000-000000000004";
const ID_CARTA = "aaaaaaaa-0000-4000-8000-000000000005";
const ID_BASILICO = "aaaaaaaa-0000-4000-8000-000000000006";
const RECIPE_LIMONE = "bbbbbbbb-0000-4000-8000-000000000001";
const RECIPE_INSALATA = "bbbbbbbb-0000-4000-8000-000000000002";
const STORAGE_KEY = `mealy:shopping:pending:${PLAN_ID}`;
const GENERATED_AT = "2026-09-28T08:00:00.000Z";

const STALE_NOTICE = "Il piano è cambiato: aggiorna la lista per allinearla.";
const REBUILD_CONFIRM =
  "Aggiorno la lista dal piano di adesso? Le spunte restano dove la quantità non aumenta; gli articoli aggiunti a mano non cambiano.";
const READ_ONLY_NOTICE = "Questa settimana è conclusa: la lista si può solo consultare.";
const NETWORK_MESSAGE = "Connessione non disponibile.";
const PENDING_BLOCK_NOTICE =
  "Ci sono spunte in attesa di rete: riprova quando torna la connessione.";

const PLAN_REF: ShoppingPlanRef = {
  id: PLAN_ID,
  week_start: "2026-09-28",
  last_day: "2026-10-04",
  status: "active",
  has_list: true,
};

const RECIPES: ShoppingRecipeRef[] = [
  { id: RECIPE_LIMONE, title: "Pollo al limone" },
  { id: RECIPE_INSALATA, title: "Insalata di pollo" },
];

function cipolla(overrides: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: ID_CIPOLLA,
    canonical_name: "cipolla",
    qty: 2,
    unit: "pz",
    category: "ortofrutta",
    checked: false,
    manual: false,
    recipe_ids: [],
    ...overrides,
  };
}

function zucchina(overrides: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: ID_ZUCCHINA,
    canonical_name: "zucchina",
    qty: 300,
    unit: "g",
    category: "ortofrutta",
    checked: true,
    manual: false,
    recipe_ids: [],
    ...overrides,
  };
}

function petto(overrides: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: ID_POLLO,
    canonical_name: "petto di pollo",
    qty: 700,
    unit: "g",
    category: "macelleria",
    checked: false,
    manual: false,
    recipe_ids: [RECIPE_LIMONE, RECIPE_INSALATA],
    ...overrides,
  };
}

function latte(overrides: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: ID_LATTE,
    canonical_name: "latte",
    qty: null,
    unit: null,
    category: "banco-frigo",
    checked: false,
    manual: true,
    recipe_ids: [],
    ...overrides,
  };
}

function cartaForno(overrides: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: ID_CARTA,
    canonical_name: "carta forno",
    qty: null,
    unit: null,
    category: "altro",
    checked: false,
    manual: true,
    recipe_ids: [],
    ...overrides,
  };
}

function baseItems(): ShoppingItemView[] {
  return [cipolla(), zucchina(), petto()];
}

interface ViewOptions {
  items?: ShoppingItemView[];
  needsRegeneration?: boolean;
  editable?: boolean;
  canBuild?: boolean;
  /** `null` per la lista non ancora creata; assente per la lista di default. */
  list?: ShoppingListView | null;
  plan?: ShoppingPlanRef;
}

function makeView({
  items,
  needsRegeneration = false,
  editable = true,
  canBuild = true,
  list,
  plan = PLAN_REF,
}: ViewOptions = {}): PlanShoppingListView {
  const resolvedList: ShoppingListView | null =
    list === undefined
      ? {
          id: LIST_ID,
          generated_at: GENERATED_AT,
          needs_regeneration: needsRegeneration,
          items: items ?? baseItems(),
          recipes: RECIPES,
        }
      : list;
  return { plan, editable, can_build: canBuild, list: resolvedList };
}

function makeScreen(
  selected: PlanShoppingListView | null,
  plans: ShoppingPlanRef[] = [PLAN_REF]
): ShoppingScreenView {
  return { plans, selected };
}

function renderScreen(
  selected: PlanShoppingListView | null = makeView(),
  plans: ShoppingPlanRef[] = [PLAN_REF]
) {
  // Alla apertura la schermata rilegge la lista: di norma il server risponde con quella già a schermo.
  if (selected !== null) {
    vi.mocked(fetchPlanShoppingList).mockImplementation(() => Promise.resolve(selected));
  }
  return render(<ShoppingScreen initialScreen={makeScreen(selected, plans)} />);
}

/** Come `renderScreen`, ma aspetta la rilettura di apertura e ne azzera le chiamate. */
async function renderSettled(
  selected: PlanShoppingListView | null = makeView(),
  plans: ShoppingPlanRef[] = [PLAN_REF]
) {
  const utils = renderScreen(selected, plans);
  await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1));
  await act(async () => {});
  vi.mocked(fetchPlanShoppingList).mockClear();
  return utils;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function savedItem(itemId: string, checked: boolean): ShoppingItemView {
  const found = baseItems().find((item) => item.id === itemId);
  if (found === undefined) throw new Error(`Articolo sconosciuto nel test: ${itemId}`);
  return { ...found, checked };
}

function box(name: string): HTMLElement {
  return screen.getByRole("checkbox", { name: new RegExp(name) });
}

function sectionOf(label: string): HTMLElement {
  const section = screen.getByRole("heading", { level: 2, name: label }).closest("section");
  if (section === null) throw new Error(`Sezione non trovata: ${label}`);
  return section;
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchPlanShoppingList).mockImplementation(() => Promise.resolve(makeView()));
  vi.mocked(requestBuildShoppingList).mockImplementation(() => Promise.resolve(makeView()));
  vi.mocked(patchShoppingItem).mockImplementation((itemId, checked) =>
    Promise.resolve(savedItem(itemId, checked))
  );
});

afterEach(() => {
  vi.useRealTimers();
  // Ripristina il getter del prototipo, nascosto dai test che fingono il passaggio in secondo piano.
  Reflect.deleteProperty(document, "visibilityState");
});

describe("ShoppingScreen: lista e avanzamento", () => {
  it("shows the header, the week range, the sections in aisle order and the progress", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Lista della Spesa" })).toBeInTheDocument();
    expect(screen.getByText("Settimana 28 set – 4 ott")).toBeInTheDocument();

    const sectionHeadings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(sectionHeadings).toEqual(["Ortofrutta", "Macelleria"]);

    expect(within(sectionOf("Ortofrutta")).getByText("1/2")).toBeInTheDocument();
    expect(within(sectionOf("Macelleria")).getByText("0/1")).toBeInTheDocument();

    expect(screen.getByText("Progresso spesa")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    const progressBar = screen.getByRole("progressbar", { name: "Articoli presi" });
    expect(progressBar).toHaveAttribute("aria-valuenow", "1");
    expect(progressBar).toHaveAttribute("aria-valuemax", "3");
  });

  it("lists the items of a section by name, with quantities and the recipes of each item", () => {
    renderScreen();

    const ortofrutta = within(sectionOf("Ortofrutta")).getAllByRole("checkbox");
    expect(ortofrutta).toHaveLength(2);
    expect(ortofrutta[0]).toHaveTextContent("Cipolla");
    expect(ortofrutta[0]).toHaveTextContent("2 pz");
    expect(ortofrutta[1]).toHaveTextContent("Zucchina");
    expect(ortofrutta[1]).toHaveTextContent("300 g");
    expect(ortofrutta[1]).toHaveAttribute("aria-checked", "true");

    expect(within(sectionOf("Macelleria")).getByRole("checkbox")).toHaveTextContent("700 g");
    expect(screen.getByText("Per: Pollo al limone, Insalata di pollo")).toBeInTheDocument();
  });

  it("keeps every row in its place when an item is checked or unchecked", async () => {
    await renderSettled(makeView({ items: [cipolla(), zucchina({ checked: false }), petto()] }));
    const names = (): string[] =>
      within(sectionOf("Ortofrutta"))
        .getAllByRole("checkbox")
        .map((row) => (row.textContent?.includes("Cipolla") ? "cipolla" : "zucchina"));

    await act(async () => {
      fireEvent.click(box("Cipolla"));
    });

    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");
    expect(names()).toEqual(["cipolla", "zucchina"]);

    await act(async () => {
      fireEvent.click(box("Cipolla"));
    });

    expect(box("Cipolla")).toHaveAttribute("aria-checked", "false");
    expect(names()).toEqual(["cipolla", "zucchina"]);
  });

  it("shows a tap as checked at once and keeps it while the server confirms", async () => {
    const save = deferred<ShoppingItemView>();
    vi.mocked(patchShoppingItem).mockReturnValueOnce(save.promise);
    await renderSettled();

    fireEvent.click(box("Cipolla"));

    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(patchShoppingItem).toHaveBeenCalledWith(ID_CIPOLLA, true, expect.any(AbortSignal));

    await act(async () => {
      save.resolve(savedItem(ID_CIPOLLA, true));
    });

    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("sends one request while a tap is in flight and the opposite value once it settles", async () => {
    const first = deferred<ShoppingItemView>();
    vi.mocked(patchShoppingItem)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(savedItem(ID_CIPOLLA, false));
    renderScreen();

    fireEvent.click(box("Cipolla"));
    fireEvent.click(box("Cipolla"));

    expect(box("Cipolla")).toHaveAttribute("aria-checked", "false");
    expect(patchShoppingItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(savedItem(ID_CIPOLLA, true));
    });

    await waitFor(() => expect(patchShoppingItem).toHaveBeenCalledTimes(2));
    expect(patchShoppingItem).toHaveBeenNthCalledWith(2, ID_CIPOLLA, false, expect.any(AbortSignal));
    await waitFor(() => expect(box("Cipolla")).toHaveAttribute("aria-checked", "false"));
  });

  it("keeps a tap on screen when the network fails, shows the pending notice and retries by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(patchShoppingItem)
      .mockRejectedValueOnce(new ApiRequestError(0, "network_error", NETWORK_MESSAGE))
      .mockResolvedValueOnce(savedItem(ID_CIPOLLA, true));
    renderScreen();

    fireEvent.click(box("Cipolla"));

    expect(await screen.findByText("1 spunta in attesa di rete")).toBeInTheDocument();
    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(ID_CIPOLLA);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS);
    });

    await waitFor(() =>
      expect(screen.queryByText("1 spunta in attesa di rete")).not.toBeInTheDocument()
    );
    expect(patchShoppingItem).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");
  });

  it("restores the taps saved in the browser and sends them without any tap", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [ID_CIPOLLA]: true }));
    renderScreen();

    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(patchShoppingItem).toHaveBeenCalledWith(ID_CIPOLLA, true, expect.any(AbortSignal))
    );
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it("drops a tap refused with a final error, shows its message and rereads the list; a 404 rereads without a message", async () => {
    const refusal = "Questa settimana è conclusa: la lista si può solo consultare.";
    vi.mocked(patchShoppingItem)
      .mockRejectedValueOnce(new ApiRequestError(409, "plan_archived", refusal))
      .mockRejectedValueOnce(new ApiRequestError(404, "not_found", "Articolo non trovato."));
    await renderSettled();

    fireEvent.click(box("Cipolla"));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledWith(PLAN_ID));
    await waitFor(() => expect(box("Cipolla")).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(box("Cipolla"));

    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(box("Cipolla")).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText("Articolo non trovato.")).not.toBeInTheDocument();
  });

  it("rereads the list when the page comes back to the foreground or the network returns", async () => {
    await renderSettled();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetchPlanShoppingList).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    vi.mocked(fetchPlanShoppingList).mockResolvedValueOnce(
      makeView({ items: [cipolla(), zucchina({ checked: false }), petto()] })
    );
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledWith(PLAN_ID));
    await waitFor(() => expect(box("Zucchina")).toHaveAttribute("aria-checked", "false"));

    vi.mocked(fetchPlanShoppingList).mockResolvedValueOnce(
      makeView({ items: [cipolla({ checked: true }), zucchina(), petto()] })
    );
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(box("Cipolla")).toHaveAttribute("aria-checked", "true"));
  });
});

describe("ShoppingScreen: aggiornamento dal piano", () => {
  it("shows the stale notice with a single rebuild button and rebuilds without asking when nothing generated is checked", async () => {
    const items = [cipolla(), zucchina({ checked: false }), petto()];
    renderScreen(makeView({ items, needsRegeneration: true }));

    expect(screen.getByText(STALE_NOTICE)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Aggiorna lista" })).toHaveLength(1);

    vi.mocked(requestBuildShoppingList).mockResolvedValueOnce(
      makeView({ items, needsRegeneration: false })
    );
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna lista" }));

    expect(screen.queryByText(REBUILD_CONFIRM)).not.toBeInTheDocument();
    await waitFor(() => expect(requestBuildShoppingList).toHaveBeenCalledWith(PLAN_ID));
    expect(await screen.findByText("Lista aggiornata")).toBeInTheDocument();
    expect(screen.queryByText(STALE_NOTICE)).not.toBeInTheDocument();
  });

  it("asks for confirmation before rebuilding when generated items are checked", async () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Aggiorna lista" }));
    expect(screen.getByText(REBUILD_CONFIRM)).toBeInTheDocument();
    expect(requestBuildShoppingList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByText(REBUILD_CONFIRM)).not.toBeInTheDocument();
    expect(requestBuildShoppingList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Aggiorna lista" }));
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna" }));

    await waitFor(() => expect(requestBuildShoppingList).toHaveBeenCalledTimes(1));
    expect(requestBuildShoppingList).toHaveBeenCalledWith(PLAN_ID);
  });

  it("shows a single rebuild button in the header and no notice when the list is up to date", () => {
    renderScreen(makeView({ items: baseItems() }));

    const buttons = screen.getAllByRole("button", { name: "Aggiorna lista" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest("header")).not.toBeNull();
    expect(screen.queryByText(STALE_NOTICE)).not.toBeInTheDocument();
  });

  it("does not rebuild while checks are waiting for the network and says why", async () => {
    vi.mocked(patchShoppingItem).mockRejectedValue(
      new ApiRequestError(0, "network_error", NETWORK_MESSAGE)
    );
    renderScreen();

    fireEvent.click(box("Cipolla"));
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna lista" }));
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna" }));

    expect(await screen.findByText(PENDING_BLOCK_NOTICE)).toBeInTheDocument();
    expect(requestBuildShoppingList).not.toHaveBeenCalled();
  });

  it("offers to create the list when the confirmed plan has none and shows the new sections", async () => {
    renderScreen(makeView({ list: null }));

    expect(screen.getByRole("heading", { level: 3, name: "Lista da creare" })).toBeInTheDocument();
    expect(
      screen.getByText("Raccolgo gli ingredienti del piano 28 set – 4 ott e li ordino per reparto.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Crea lista della spesa" }));

    expect(await screen.findByText("Lista creata")).toBeInTheDocument();
    expect(requestBuildShoppingList).toHaveBeenCalledWith(PLAN_ID);
    expect(screen.getByRole("heading", { level: 2, name: "Ortofrutta" })).toBeInTheDocument();
  });
});

describe("ShoppingScreen: stati senza lista", () => {
  it("asks to finish the draft plan first, with a link back to the plan of that week", () => {
    renderScreen(
      makeView({ list: null, canBuild: false, plan: { ...PLAN_REF, status: "draft", has_list: false } })
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Piano non ancora confermato" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vai al piano" }));
    expect(router.push).toHaveBeenCalledWith("/?settimana=2026-09-28");
  });

  it("invites to open the plan when there is no shopping plan at all", () => {
    renderScreen(null, []);

    expect(
      screen.getByRole("heading", { level: 3, name: "Nessuna lista della spesa" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vai al piano" }));
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("explains a closed week that never had a list, with no action", () => {
    renderScreen(makeView({ list: null, editable: false, canBuild: false }));

    expect(
      screen.getByRole("heading", { level: 3, name: "Nessuna lista per questa settimana" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a closed week read-only: no taps, no add, no rebuild, no remove", () => {
    renderScreen(
      makeView({ items: [cipolla(), zucchina(), petto(), latte()], editable: false, canBuild: false })
    );

    expect(screen.getByText(READ_ONLY_NOTICE)).toBeInTheDocument();
    expect(box("Cipolla")).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(box("Cipolla"));
    expect(patchShoppingItem).not.toHaveBeenCalled();

    expect(
      screen.queryByRole("button", { name: "Aggiungi un articolo alla lista" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aggiorna lista" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rimuovi/ })).not.toBeInTheDocument();
  });
});

describe("ShoppingScreen: articoli a mano", () => {
  it("adds an item typed by hand from the floating button and confirms it in the sheet", async () => {
    const user = userEvent.setup();
    vi.mocked(postShoppingItem).mockResolvedValueOnce(latte());
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi un articolo alla lista" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Cosa manca?"), "latte{Enter}");

    expect(postShoppingItem).toHaveBeenCalledWith(PLAN_ID, "latte");
    expect(await screen.findByText("Aggiunto: Latte")).toBeInTheDocument();
    expect(screen.getByText("Freschi & Latticini")).toBeInTheDocument();
    expect(screen.getByText("Latte")).toBeInTheDocument();
    expect(screen.getByText("Aggiunto a mano")).toBeInTheDocument();
    expect(screen.getByText("1/4")).toBeInTheDocument();
  });

  it("removes a hand-added item at once, restores it on a server error and keeps it removed on 404", async () => {
    vi.mocked(deleteShoppingItem)
      .mockRejectedValueOnce(new ApiRequestError(500, "internal_error", "Errore del server."))
      .mockRejectedValueOnce(new ApiRequestError(404, "not_found", "Articolo non trovato."));
    renderScreen(makeView({ items: [cipolla(), zucchina(), petto(), latte(), cartaForno()] }));

    expect(screen.queryByRole("button", { name: "Rimuovi Cipolla" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi Latte" }));
    expect(screen.queryByText("Latte")).not.toBeInTheDocument();
    expect(deleteShoppingItem).toHaveBeenCalledWith(ID_LATTE);
    expect(await screen.findByText("Latte")).toBeInTheDocument();
    expect(screen.getByText("Errore del server.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi Carta forno" }));
    expect(screen.queryByText("Carta forno")).not.toBeInTheDocument();
    await waitFor(() => expect(deleteShoppingItem).toHaveBeenCalledWith(ID_CARTA));
    await waitFor(() => expect(screen.queryByText("Carta forno")).not.toBeInTheDocument());
    expect(screen.queryByText("Articolo non trovato.")).not.toBeInTheDocument();
  });
});

describe("ShoppingScreen: selettore, stati speciali e aggiornamenti dal server", () => {
  it("shows a week selector when two plans are open and marks the one on screen", () => {
    const nextWeek: ShoppingPlanRef = {
      id: OTHER_PLAN_ID,
      week_start: "2026-10-05",
      last_day: "2026-10-11",
      status: "active",
      has_list: false,
    };
    const { unmount } = renderScreen(makeView(), [PLAN_REF, nextWeek]);

    const nav = screen.getByRole("navigation", { name: "Liste della spesa" });
    const current = within(nav).getByRole("link", { name: "28 set – 4 ott" });
    expect(current).toHaveAttribute("href", `/lista?piano=${PLAN_ID}`);
    expect(current).toHaveAttribute("aria-current", "page");
    const other = within(nav).getByRole("link", { name: "5 ott – 11 ott" });
    expect(other).toHaveAttribute("href", `/lista?piano=${OTHER_PLAN_ID}`);
    expect(other).not.toHaveAttribute("aria-current");

    unmount();
    renderScreen(makeView());
    expect(screen.queryByRole("navigation", { name: "Liste della spesa" })).not.toBeInTheDocument();
  });

  it("celebrates when everything is checked and explains an empty list", () => {
    const { unmount } = renderScreen(
      makeView({ items: [cipolla({ checked: true }), zucchina(), petto({ checked: true })] })
    );
    expect(screen.getByText("Hai preso tutto.")).toBeInTheDocument();
    unmount();

    renderScreen(makeView({ items: [] }));
    expect(screen.getByText("Niente da comprare per i pasti che restano.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aggiungi un articolo alla lista" })
    ).toBeInTheDocument();
  });

  it("replaces the shown state when a new initial screen arrives for the same plan", async () => {
    const { rerender } = await renderSettled(makeView());
    expect(screen.getByText("Cipolla")).toBeInTheDocument();

    const basilico = cipolla({
      id: ID_BASILICO,
      canonical_name: "basilico",
      qty: 50,
      unit: "g",
    });
    rerender(<ShoppingScreen initialScreen={makeScreen(makeView({ items: [basilico] }))} />);

    expect(screen.getByText("Basilico")).toBeInTheDocument();
    expect(screen.queryByText("Cipolla")).not.toBeInTheDocument();
  });

  it("does not let a reread that started before a confirmed tap undo that tap", async () => {
    const staleReread = deferred<PlanShoppingListView>();
    const save = deferred<ShoppingItemView>();
    vi.mocked(patchShoppingItem).mockReturnValueOnce(save.promise);
    await renderSettled();
    vi.mocked(fetchPlanShoppingList)
      .mockReturnValueOnce(staleReread.promise)
      .mockResolvedValueOnce(makeView({ items: [cipolla({ checked: true }), zucchina(), petto()] }));

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1));

    fireEvent.click(box("Cipolla"));
    await act(async () => {
      save.resolve(savedItem(ID_CIPOLLA, true));
    });

    await act(async () => {
      staleReread.resolve(makeView());
    });
    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");

    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(box("Cipolla")).toHaveAttribute("aria-checked", "true"));
  });
});

describe("ShoppingScreen: spunta riuscita con risposta illeggibile", () => {
  it("rereads the list when the server answers 2xx but the body cannot be read, and shows what the server has", async () => {
    vi.mocked(patchShoppingItem).mockRejectedValueOnce(
      new ApiRequestError(200, "invalid_response", "Risposta non valida.")
    );
    await renderSettled();
    vi.mocked(fetchPlanShoppingList).mockResolvedValueOnce(
      makeView({ items: [cipolla({ checked: true }), zucchina(), petto()] })
    );

    fireEvent.click(box("Cipolla"));

    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(box("Cipolla")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });
});

describe("ShoppingScreen: modifiche durante una rilettura", () => {
  it("keeps an item added while a reread was in flight and rereads again", async () => {
    const user = userEvent.setup();
    const staleReread = deferred<PlanShoppingListView>();
    vi.mocked(postShoppingItem).mockResolvedValueOnce(latte());
    await renderSettled();
    vi.mocked(fetchPlanShoppingList)
      .mockReturnValueOnce(staleReread.promise)
      .mockResolvedValueOnce(makeView({ items: [...baseItems(), latte()] }));

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi un articolo alla lista" }));
    await user.type(screen.getByLabelText("Cosa manca?"), "latte{Enter}");
    expect(await screen.findByText("Aggiunto: Latte")).toBeInTheDocument();

    await act(async () => {
      staleReread.resolve(makeView());
    });

    expect(screen.getByText("Latte")).toBeInTheDocument();
    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Latte")).toBeInTheDocument();
  });

  it("keeps an item removed while a reread was in flight removed and rereads again", async () => {
    const items = [...baseItems(), latte()];
    const staleReread = deferred<PlanShoppingListView>();
    vi.mocked(deleteShoppingItem).mockResolvedValueOnce(undefined);
    await renderSettled(makeView({ items }));
    vi.mocked(fetchPlanShoppingList)
      .mockReturnValueOnce(staleReread.promise)
      .mockResolvedValueOnce(makeView({ items: baseItems() }));

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi Latte" }));
    await waitFor(() => expect(deleteShoppingItem).toHaveBeenCalledWith(ID_LATTE));
    await act(async () => {});

    await act(async () => {
      staleReread.resolve(makeView({ items }));
    });

    expect(screen.queryByText("Latte")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Latte")).not.toBeInTheDocument();
  });

  it("applies the rebuilt list and rereads when a tap was confirmed while the rebuild was in flight", async () => {
    const items = [cipolla(), zucchina({ checked: false }), petto()];
    const build = deferred<PlanShoppingListView>();
    const reread = deferred<PlanShoppingListView>();
    vi.mocked(requestBuildShoppingList).mockReturnValueOnce(build.promise);
    await renderSettled(makeView({ items, needsRegeneration: true }));
    vi.mocked(fetchPlanShoppingList).mockReturnValueOnce(reread.promise);

    fireEvent.click(screen.getByRole("button", { name: "Aggiorna lista" }));
    await waitFor(() => expect(requestBuildShoppingList).toHaveBeenCalledWith(PLAN_ID));

    fireEvent.click(box("Cipolla"));
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(patchShoppingItem).toHaveBeenCalledTimes(1);
    expect(fetchPlanShoppingList).not.toHaveBeenCalled();

    const basilico = cipolla({ id: ID_BASILICO, canonical_name: "basilico", qty: 50, unit: "g" });
    await act(async () => {
      build.resolve(makeView({ items: [basilico] }));
    });

    expect(screen.getByText("Basilico")).toBeInTheDocument();
    expect(screen.getByText("Lista aggiornata")).toBeInTheDocument();
    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1));

    await act(async () => {
      reread.resolve(makeView({ items: [basilico] }));
    });
    expect(screen.getByText("Basilico")).toBeInTheDocument();
  });
});

describe("ShoppingScreen: rilettura all'apertura", () => {
  it("rereads the list when the screen opens and shows what the server has now", async () => {
    vi.mocked(fetchPlanShoppingList).mockResolvedValueOnce(
      makeView({ items: [cipolla({ checked: true }), zucchina(), petto()] })
    );
    render(<ShoppingScreen initialScreen={makeScreen(makeView())} />);

    expect(box("Cipolla")).toHaveAttribute("aria-checked", "false");

    await waitFor(() => expect(box("Cipolla")).toHaveAttribute("aria-checked", "true"));
    expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1);
    expect(fetchPlanShoppingList).toHaveBeenCalledWith(PLAN_ID);
  });

  it("shows the list when the screen opens on the empty state but the server already has the list", async () => {
    vi.mocked(fetchPlanShoppingList).mockResolvedValueOnce(makeView());
    render(<ShoppingScreen initialScreen={makeScreen(makeView({ list: null }))} />);

    expect(screen.getByRole("heading", { level: 3, name: "Lista da creare" })).toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 2, name: "Ortofrutta" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Lista da creare" })).not.toBeInTheDocument();
    expect(box("Zucchina")).toHaveAttribute("aria-checked", "true");
  });

  it("waits for the saved taps to be sent before rereading", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [ID_CIPOLLA]: true }));
    const save = deferred<ShoppingItemView>();
    vi.mocked(patchShoppingItem).mockReturnValueOnce(save.promise);
    renderScreen();

    await waitFor(() => expect(patchShoppingItem).toHaveBeenCalledTimes(1));
    expect(fetchPlanShoppingList).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve(savedItem(ID_CIPOLLA, true));
    });

    await waitFor(() => expect(fetchPlanShoppingList).toHaveBeenCalledTimes(1));
  });

  it("does not reread when the screen is closed before the saved taps are sent", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [ID_CIPOLLA]: true }));
    const save = deferred<ShoppingItemView>();
    vi.mocked(patchShoppingItem).mockReturnValueOnce(save.promise);
    const { unmount } = renderScreen();
    await waitFor(() => expect(patchShoppingItem).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      save.resolve(savedItem(ID_CIPOLLA, true));
    });

    expect(fetchPlanShoppingList).not.toHaveBeenCalled();
  });
});

describe("ShoppingScreen: avviso di attesa rete e creazione della lista", () => {
  it("keeps the pending notice region mounted and empty until a tap is stuck, then fills it", async () => {
    vi.mocked(patchShoppingItem).mockRejectedValue(
      new ApiRequestError(0, "network_error", NETWORK_MESSAGE)
    );
    await renderSettled();
    const notice = screen.getAllByRole("status").find((region) => region.className === "");
    expect(notice).toBeDefined();
    expect(notice).toBeEmptyDOMElement();

    fireEvent.click(box("Cipolla"));

    const text = await screen.findByText("1 spunta in attesa di rete");
    expect(text).toBe(notice);
    expect(text).toHaveAttribute("role", "status");
    expect(text.className).toContain("border");
  });

  it("disables the create button and shows the waiting label while the list is being built", async () => {
    const build = deferred<PlanShoppingListView>();
    vi.mocked(requestBuildShoppingList).mockReturnValueOnce(build.promise);
    await renderSettled(makeView({ list: null }));

    fireEvent.click(screen.getByRole("button", { name: "Crea lista della spesa" }));

    const busy = screen.getByRole("button", { name: "Creo la lista…" });
    expect(busy).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Crea lista della spesa" })).not.toBeInTheDocument();
    fireEvent.click(busy);
    await waitFor(() => expect(requestBuildShoppingList).toHaveBeenCalledTimes(1));

    await act(async () => {
      build.resolve(makeView());
    });

    expect(await screen.findByText("Lista creata")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Ortofrutta" })).toBeInTheDocument();
  });
});
