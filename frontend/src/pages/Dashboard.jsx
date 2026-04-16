import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import ExpenseList from '../components/ExpenseList'
import ExpenseForm from '../components/ExpenseForm'
import ExpenseFilters from '../components/ExpenseFilters'

export default function Dashboard() {
  const [expenses, setExpenses] = useState([])
  const [filters,  setFilters]  = useState({ status: '', from: '', to: '' })
  const navigate                = useNavigate()
  const user                    = JSON.parse(localStorage.getItem('user') || '{}')

  const fetchExpenses = useCallback(async () => {
    const params = {}
    if (filters.status) params.status = filters.status
    if (filters.from)   params.from   = filters.from
    if (filters.to)     params.to     = filters.to
    const { data } = await api.get('/expenses', { params })
    setExpenses(data)
  }, [filters])

  useEffect(() => { fetchExpenses() }, [fetchExpenses])

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  const totalPending = expenses.filter(e => e.status === 'pending').reduce((s, e) => s + parseFloat(e.amount), 0)
  const totalPaid    = expenses.filter(e => e.status === 'paid').reduce((s, e) => s + parseFloat(e.amount), 0)

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h2 style={{ margin: 0 }}>Billing Tracker</h2>
        <span>Hello, {user.name} — <button style={styles.logoutBtn} onClick={handleLogout}>Logout</button></span>
      </header>

      <div style={styles.summary}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryLabel}>Pending</div>
          <div style={styles.summaryAmount}>€{totalPending.toFixed(2)}</div>
          <div>{expenses.filter(e => e.status === 'pending').length} expenses</div>
        </div>
        <div style={{ ...styles.summaryCard, borderColor: '#52c41a' }}>
          <div style={styles.summaryLabel}>Paid</div>
          <div style={{ ...styles.summaryAmount, color: '#52c41a' }}>€{totalPaid.toFixed(2)}</div>
          <div>{expenses.filter(e => e.status === 'paid').length} expenses</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryLabel}>Total</div>
          <div style={styles.summaryAmount}>€{(totalPending + totalPaid).toFixed(2)}</div>
          <div>{expenses.length} expenses</div>
        </div>
      </div>

      <ExpenseForm onCreated={fetchExpenses} />
      <ExpenseFilters filters={filters} onChange={setFilters} />
      <ExpenseList expenses={expenses} onRefresh={fetchExpenses} />
    </div>
  )
}

const styles = {
  page:          { maxWidth: '900px', margin: '0 auto', padding: '1rem' },
  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', padding: '1rem', background: '#1677ff', color: '#fff', borderRadius: '8px' },
  logoutBtn:     { background: 'transparent', border: '1px solid #fff', color: '#fff', padding: '0.3rem 0.8rem', cursor: 'pointer', borderRadius: '4px' },
  summary:       { display: 'flex', gap: '1rem', marginBottom: '1.5rem' },
  summaryCard:   { flex: 1, background: '#fff', border: '2px solid #1677ff', borderRadius: '8px', padding: '1rem', textAlign: 'center' },
  summaryLabel:  { fontWeight: 'bold', marginBottom: '0.5rem' },
  summaryAmount: { fontSize: '1.5rem', fontWeight: 'bold', color: '#1677ff' }
}
