const SKELETON_COUNT = 6;

export default function LibraryLoading() {
  return (
    <main aria-busy="true" className="min-h-dvh px-4 py-6 max-w-xl mx-auto">
      <h1 className="font-display text-2xl font-bold text-ink">Libreria Ricette</h1>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <div
            key={index}
            className="h-28 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
    </main>
  );
}
