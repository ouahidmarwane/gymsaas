export default function Loading() {
  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-9 bg-gray-200 rounded-lg w-48 animate-pulse mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-40 animate-pulse"></div>
        </div>
        <div className="h-9 bg-gray-200 rounded-xl w-32 animate-pulse"></div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        <div className="h-8 bg-gray-200 rounded-lg w-16 animate-pulse"></div>
        <div className="h-8 bg-gray-200 rounded-lg w-12 animate-pulse"></div>
      </div>

      {/* Notifications list */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-4 flex items-start gap-4">
            {/* Icon */}
            <div className="w-10 h-10 bg-gray-200 rounded-xl animate-pulse flex-shrink-0"></div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-4 bg-gray-200 rounded w-24 animate-pulse"></div>
                <div className="h-3 bg-gray-100 rounded w-16 animate-pulse"></div>
              </div>
              <div className="h-4 bg-gray-200 rounded w-48 animate-pulse mb-2"></div>
              <div className="flex items-center gap-4">
                <div className="h-3 bg-gray-100 rounded w-20 animate-pulse"></div>
                <div className="h-3 bg-gray-100 rounded w-24 animate-pulse"></div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <div className="h-8 bg-gray-200 rounded-lg w-16 animate-pulse"></div>
              <div className="h-8 bg-gray-200 rounded-lg w-12 animate-pulse"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}