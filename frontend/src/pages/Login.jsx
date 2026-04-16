import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/client'

export default function Login() {
  const [form, setForm]     = useState({ name: '', password: '' })
  const [error, setError]   = useState('')
  const navigate            = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const { data } = await api.post('/auth/login', form)
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2>Billing Tracker</h2>
        <h3>Login</h3>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit}>
          <input
            style={styles.input}
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <button style={styles.button} type="submit">Login</button>
        </form>
        <p>Don't have an account? <Link to="/register">Register</Link></p>
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' },
  card:      { background: '#fff', padding: '2rem', borderRadius: '8px', width: '320px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' },
  input:     { display: 'block', width: '100%', marginBottom: '1rem', padding: '0.5rem', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' },
  button:    { width: '100%', padding: '0.6rem', background: '#1677ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  error:     { color: 'red', marginBottom: '1rem' }
}
