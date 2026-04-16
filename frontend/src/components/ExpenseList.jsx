import api from '../api/client'

export default function ExpenseList({ expenses, onRefresh }) {
  const toggleStatus = async (expense) => {
    const next = expense.status === 'pending' ? 'paid' : 'pending'
    await api.patch(`/expenses/${expense.id}`, { status: next })
    onRefresh()
  }

  const handleDelete = async (id) => {
    await api.delete(`/expenses/${id}`)
    onRefresh()
  }

  if (expenses.length === 0) {
    return <div style={styles.empty}>No expenses found.</div>
  }

  return (
    <div style={styles.card}>
      <table style={styles.table}>
        <thead>
          <tr>
            {['Title', 'Entity', 'Amount', 'Status', 'Due Date', 'Actions'].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {expenses.map(e => (
            <tr key={e.id} style={e.status === 'paid' ? styles.paidRow : {}}>
              <td style={styles.td}>{e.title}</td>
              <td style={styles.td}>{e.entity || '—'}</td>
              <td style={styles.td}>€{parseFloat(e.amount).toFixed(2)}</td>
              <td style={styles.td}>
                <span style={e.status === 'paid' ? styles.badgePaid : styles.badgePending}>
                  {e.status}
                </span>
              </td>
              <td style={styles.td}>{e.due_date ? e.due_date.slice(0, 10) : '—'}</td>
              <td style={styles.td}>
                <button style={styles.toggleBtn} onClick={() => toggleStatus(e)}>
                  {e.status === 'pending' ? 'Mark paid' : 'Mark pending'}
                </button>
                <button style={styles.deleteBtn} onClick={() => handleDelete(e.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const styles = {
  card:         { background: '#fff', borderRadius: '8px', padding: '1rem', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', overflowX: 'auto' },
  table:        { width: '100%', borderCollapse: 'collapse' },
  th:           { textAlign: 'left', padding: '0.6rem', borderBottom: '2px solid #f0f0f0', background: '#fafafa' },
  td:           { padding: '0.6rem', borderBottom: '1px solid #f0f0f0' },
  paidRow:      { opacity: 0.6 },
  badgePending: { background: '#fff7e6', color: '#d46b08', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' },
  badgePaid:    { background: '#f6ffed', color: '#389e0d', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' },
  toggleBtn:    { marginRight: '0.4rem', padding: '0.3rem 0.6rem', background: '#1677ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' },
  deleteBtn:    { padding: '0.3rem 0.6rem', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' },
  empty:        { textAlign: 'center', padding: '2rem', color: '#999', background: '#fff', borderRadius: '8px' }
}
