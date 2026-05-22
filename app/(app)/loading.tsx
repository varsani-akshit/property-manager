export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-48 bg-muted rounded mb-2" />
      <div className="h-4 w-72 bg-muted rounded mb-6" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card">
            <div className="h-3 w-20 bg-muted rounded mb-2" />
            <div className="h-7 w-28 bg-muted rounded" />
          </div>
        ))}
      </div>

      <div className="card p-0">
        <div className="p-3 border-b border-border">
          <div className="h-3 w-32 bg-muted rounded" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-4 p-3 border-b border-border">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-4 w-48 bg-muted rounded" />
            <div className="h-4 w-24 bg-muted rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
