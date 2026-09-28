// PostgREST caps responses. Read deterministic pages instead of silently losing later items.
export async function readAllRows(query, isCurrent = () => true, pageSize = 500) {
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query().range(offset, offset + pageSize - 1)
    if (!isCurrent()) return { data: null, error: null, stale: true }
    if (error) return { data: null, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return { data: rows, error: null }
  }
}
