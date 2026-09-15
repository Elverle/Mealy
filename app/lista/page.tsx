"use client";

import * as React from "react";
import { Plus, RotateCcw, CheckCircle2 } from "lucide-react";
import {
  ShoppingItemRow,
  type ShoppingItem,
} from "@/components/shopping/shopping-item-row";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { CATEGORY_LABELS, type Category } from "@/lib/domain/types";

interface DepartmentSection {
  name: string;
  items: ShoppingItem[];
}

const INITIAL_SHOPPING_ITEMS: ShoppingItem[] = [
  // Ortofrutta
  {
    id: "shop-1",
    name: "Basilico fresco",
    amount: 50,
    unit: "g",
    category: "ortofrutta",
    isChecked: false,
  },
  {
    id: "shop-2",
    name: "Pomodorini ciliegino",
    amount: 300,
    unit: "g",
    category: "ortofrutta",
    isChecked: true,
  },
  {
    id: "shop-3",
    name: "Cetrioli",
    amount: 2,
    unit: "pz",
    category: "ortofrutta",
    isChecked: false,
  },
  {
    id: "shop-4",
    name: "Zucca mantovana",
    amount: 500,
    unit: "g",
    category: "ortofrutta",
    isChecked: false,
  },
  {
    id: "shop-5",
    name: "Limoni",
    amount: 2,
    unit: "pz",
    category: "ortofrutta",
    isChecked: false,
  },

  // Freschi & Latticini
  {
    id: "shop-6",
    name: "Parmigiano Reggiano 24 mesi",
    amount: 150,
    unit: "g",
    category: "banco-frigo",
    isChecked: true,
  },
  {
    id: "shop-7",
    name: "Feta DOP",
    amount: 200,
    unit: "g",
    category: "banco-frigo",
    isChecked: false,
  },
  {
    id: "shop-8",
    name: "Uova fresche bio",
    amount: 6,
    unit: "pz",
    category: "banco-frigo",
    isChecked: false,
  },

  // Macelleria & Pesce
  {
    id: "shop-9",
    name: "Petto di pollo a fette",
    amount: 400,
    unit: "g",
    category: "macelleria",
    isChecked: false,
  },
  {
    id: "shop-10",
    name: "Filetti di salmone fresco",
    amount: 350,
    unit: "g",
    category: "pescheria",
    isChecked: false,
  },

  // Dispensa
  {
    id: "shop-11",
    name: "Trofie liguri",
    amount: 500,
    unit: "g",
    category: "dispensa",
    isChecked: true,
  },
  {
    id: "shop-12",
    name: "Farro perlato",
    amount: 500,
    unit: "g",
    category: "dispensa",
    isChecked: false,
  },
  {
    id: "shop-13",
    name: "Pinoli italiani",
    amount: 50,
    unit: "g",
    category: "dispensa",
    isChecked: false,
  },
];

export default function ShoppingListPage() {
  const [items, setItems] = React.useState<ShoppingItem[]>(INITIAL_SHOPPING_ITEMS);
  const [newItemName, setNewItemName] = React.useState("");
  const [showAddModal, setShowAddModal] = React.useState(false);

  const totalCount = items.length;
  const checkedCount = items.filter((i) => i.isChecked).length;
  const progressPercent = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  const handleToggleItem = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, isChecked: !it.isChecked } : it))
    );
  };

  const handleResetChecklist = () => {
    setItems((prev) => prev.map((it) => ({ ...it, isChecked: false })));
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    const newItem: ShoppingItem = {
      id: `custom-${Date.now()}`,
      name: newItemName.trim(),
      category: "altro",
      isChecked: false,
    };
    setItems((prev) => [newItem, ...prev]);
    setNewItemName("");
    setShowAddModal(false);
  };

  // Group items by category
  const categories = React.useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    items.forEach((item) => {
      const cat = item.category || "altro";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    });

    // Sort items inside category: unchecked first, checked at bottom
    const result: DepartmentSection[] = [];
    map.forEach((catItems, catKey) => {
      const sorted = [...catItems].sort(
        (a, b) => Number(a.isChecked) - Number(b.isChecked)
      );
      const displayName = CATEGORY_LABELS[catKey as Category] ?? catKey;
      result.push({ name: displayName, items: sorted });
    });
    return result;
  }, [items]);

  return (
    <main className="min-h-screen px-4 py-6 max-w-xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">
              Lista della Spesa
            </h1>
            <p className="text-stone text-xs mt-0.5">
              Consolidata dal piano settimanale
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetChecklist}
              title="Azzera spunte"
              aria-label="Azzera tutte le spunte"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
              aria-label="Aggiungi ingrediente alla lista"
            >
              <Plus className="h-4 w-4" />
              <span>Aggiungi</span>
            </Button>
          </div>
        </div>

        {/* Progress Bar & Counters */}
        {totalCount > 0 && (
          <div className="mt-4 rounded-xl border border-stone/20 bg-white p-3.5">
            <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
              <span className="text-stone">Progresso spesa</span>
              <span className="text-basil tabular-nums">
                {checkedCount} di {totalCount} ({progressPercent}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-stone/15">
              <div
                className="h-full bg-basil transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Add Item Input Modal or inline card */}
      {showAddModal && (
        <form
          onSubmit={handleAddItem}
          className="mb-6 rounded-xl border border-basil/30 bg-white p-4 shadow-sm"
        >
          <label
            htmlFor="new-item-input"
            className="block text-xs font-bold uppercase tracking-wider text-stone mb-2"
          >
            Nuovo articolo
          </label>
          <div className="flex gap-2">
            <input
              id="new-item-input"
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Es. Latte d'avena, Caffè..."
              autoFocus
              className="flex-1 rounded-xl border border-stone/30 px-3 py-2 text-sm text-ink placeholder:text-stone/60 focus:border-basil focus:outline-none focus:ring-1 focus:ring-basil"
            />
            <Button type="submit" size="sm">
              Salva
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAddModal(false)}
            >
              Annulla
            </Button>
          </div>
        </form>
      )}

      {/* Items Grouped by Department */}
      {totalCount === 0 ? (
        <EmptyState
          title="Lista spesa vuota"
          description="Aggiungi gli ingredienti o confermali dal piano settimanale per vederli raggruppati qui per reparto."
          actionLabel="Aggiungi ingrediente"
          onAction={() => setShowAddModal(true)}
        />
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => (
            <section key={cat.name} className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="font-display text-base font-bold text-ink tracking-tight">
                  {cat.name}
                </h2>
                <span className="text-xs text-stone tabular-nums">
                  {cat.items.filter((i) => i.isChecked).length}/{cat.items.length}
                </span>
              </div>
              <div className="divide-y divide-stone/15 rounded-xl border border-stone/20 bg-white p-1">
                {cat.items.map((item) => (
                  <ShoppingItemRow
                    key={item.id}
                    item={item}
                    onToggle={handleToggleItem}
                  />
                ))}
              </div>
            </section>
          ))}

          {checkedCount === totalCount && totalCount > 0 && (
            <div className="mt-8 flex items-center justify-center gap-2 rounded-xl bg-basil/10 p-4 text-center text-sm font-semibold text-basil">
              <CheckCircle2 className="h-5 w-5" />
              <span>Tutti gli articoli sono stati spuntati! Ottimo lavoro!</span>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
