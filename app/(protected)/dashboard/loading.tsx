export default function Loading() {
  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <div className="h-9 bg-gray-200 rounded-lg w-64 animate-pulse mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-48 animate-pulse"></div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 bg-gray-200 rounded-2xl animate-pulse flex-shrink-0"></div>
            <div>
              <div className="h-8 bg-gray-200 rounded w-16 animate-pulse mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-24 animate-pulse mb-1"></div>
              <div className="h-3 bg-gray-100 rounded w-20 animate-pulse"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Admin Stats (if applicable) */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 bg-gray-200 rounded-2xl animate-pulse flex-shrink-0"></div>
            <div>
              <div className="h-8 bg-gray-200 rounded w-16 animate-pulse mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-24 animate-pulse"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Renewals */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="h-5 bg-gray-200 rounded w-32 animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-16 animate-pulse"></div>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-32 animate-pulse mb-1"></div>
                  <div className="h-3 bg-gray-100 rounded w-24 animate-pulse"></div>
                </div>
                <div className="h-5 bg-gray-200 rounded-full w-16 animate-pulse"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Notifications */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="h-5 bg-gray-200 rounded w-24 animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-16 animate-pulse"></div>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-40 animate-pulse mb-1"></div>
                  <div className="h-3 bg-gray-100 rounded w-28 animate-pulse"></div>
                </div>
                <div className="h-6 bg-gray-200 rounded-lg w-12 animate-pulse"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}