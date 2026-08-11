export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-8 bg-gray-200 rounded-lg w-48 animate-pulse"></div>
        <div className="h-10 bg-gray-200 rounded-xl w-32 animate-pulse"></div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="h-10 bg-gray-200 rounded-xl flex-1 animate-pulse"></div>
        <div className="h-10 bg-gray-200 rounded-xl w-32 animate-pulse"></div>
        <div className="h-10 bg-gray-200 rounded-xl w-32 animate-pulse"></div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="h-5 bg-gray-200 rounded w-24 animate-pulse"></div>
        </div>

        <div className="divide-y divide-gray-50">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-6 py-4 flex items-center gap-4">
              {/* Avatar */}
              <div className="w-9 h-9 bg-gray-200 rounded-full animate-pulse flex-shrink-0"></div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <div className="h-4 bg-gray-200 rounded w-32 animate-pulse mb-1"></div>
                <div className="h-3 bg-gray-100 rounded w-24 animate-pulse"></div>
              </div>

              {/* Phone */}
              <div className="w-32">
                <div className="h-4 bg-gray-200 rounded w-28 animate-pulse"></div>
              </div>

              {/* Email */}
              <div className="w-48">
                <div className="h-4 bg-gray-200 rounded w-36 animate-pulse"></div>
              </div>

              {/* Join Date */}
              <div className="w-24">
                <div className="h-4 bg-gray-200 rounded w-20 animate-pulse"></div>
              </div>

              {/* Sub Status */}
              <div className="w-20">
                <div className="h-5 bg-gray-200 rounded-full w-16 animate-pulse"></div>
              </div>

              {/* Ins Status */}
              <div className="w-20">
                <div className="h-5 bg-gray-200 rounded-full w-16 animate-pulse"></div>
              </div>

              {/* Actions */}
              <div className="w-32 flex gap-2">
                <div className="h-8 bg-gray-200 rounded-lg w-8 animate-pulse"></div>
                <div className="h-8 bg-gray-200 rounded-lg w-8 animate-pulse"></div>
                <div className="h-8 bg-gray-200 rounded-lg w-8 animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}