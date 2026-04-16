export default function ExpenseFilters({ filters, onChange }) {
  const set = (key, value) => onChange({ ...filters, [key]: value })

  return (
    <div style={styles.card}>
      <strong>Filters: </strong>
      <select style={styles.input} value={filters.status} onChange={(e) => set('status', e.target.value)}>
        <option value="">All statuses</option>
        <option value="pending">Pending</option>
        <option value="paid">Paid</option>
      </select>
      <label style={styles.label}>From</label>
      <input style={styles.input} type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
      <label style={styles.label}>To</label>
      <input style={styles.input} type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
      <button style={styles.clearBtn} onClick={() => onChange({ status: '', from: '', to: '' })}>Clear</button>
    </div>
  )
}

const styles = {
  card:     { background: '#fff', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  input:    { padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' },
  label:    { fontWeight: 'bold' },
  clearBtn: { padding: '0.4rem 0.8rem', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }
}
