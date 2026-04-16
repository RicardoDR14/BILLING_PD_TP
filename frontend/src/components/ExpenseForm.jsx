import { useState } from 'react'
import api from '../api/client'

const empty = { title: '', amount: '', entity: '', description: '', due_date: '', status: 'pending' }

export default function ExpenseForm({ onCreated }) {
  const [form, setForm]   = useState(empty)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/expenses', { ...form, amount: parseFloat(form.amount) })
      setForm(empty)
      onCreated()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create expense')
    }
  }

  const field = (key, placeholder, type = 'text') => (
    <input
      style={styles.input}
      type={type}
      placeholder={placeholder}
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      required={key === 'title' || key === 'amount'}
    />
  )

  return (
    <div style={styles.card}>
      <h3 style={{ marginTop: 0 }}>New Expense</h3>
      {error && <p style={styles.error}>{error}</p>}
      <form onSubmit={handleSubmit} style={styles.row}>
        {field('title',       'Title *')}
        {field('amount',      'Amount *', 'number')}
        {field('entity',      'Entity')}
        {field('description', 'Description')}
        {field('due_date',    'Due date', 'date')}
        <select style={styles.input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
        </select>
        <button style={styles.button} type="submit">Add</button>
      </form>
    </div>
  )
}

const styles = {
  card:   { background: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  row:    { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  input:  { padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', minWidth: '120px', flex: 1 },
  button: { padding: '0.4rem 1rem', background: '#1677ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  error:  { color: 'red' }
}
