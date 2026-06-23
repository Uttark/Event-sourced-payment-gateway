export function TransactionListSkeleton() {
    return (
        <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
                <div
                    key={i}
                    className="flex items-center gap-4 rounded-xl border border-white/[0.04] px-4 py-3.5"
                >
                    <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
                    <div className="flex-1 space-y-2">
                        <div className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
                        <div className="h-3 w-16 animate-pulse rounded bg-white/[0.05]" />
                    </div>
                    <div className="h-5 w-16 animate-pulse rounded-full bg-white/[0.05]" />
                    <div className="h-4 w-20 animate-pulse rounded bg-white/[0.05]" />
                </div>
            ))}
        </div>
    );
}