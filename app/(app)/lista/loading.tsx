const SKELETON_COUNT = 8;

export default function ShoppingListLoading() {
  return (
    <main aria-busy="true" className="px-4 py-6 max-w-xl mx-auto">
      <h1 className="font-display text-2xl font-bold text-ink">Lista della Spesa</h1>
      <div className="mt-5 space-y-2">
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <div
            key={index}
            className="h-12 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
    </main>
  );
}
