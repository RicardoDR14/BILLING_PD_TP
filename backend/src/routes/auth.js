const express = require('express')
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const pool    = require('../db/client')

const router = express.Router()

router.post('/register', async (req, res) => {
  const { name, password } = req.body
  if (!name || !password) {
    return res.status(400).json({ error: 'name and password are required' })
  }
  try {
    const hash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      'INSERT INTO users (name, password_hash) VALUES ($1, $2) RETURNING id, name',
      [name, hash]
    )
    return res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Name already taken' })
    }
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/login', async (req, res) => {
  const { name, password } = req.body
  if (!name || !password) {
    return res.status(400).json({ error: 'name and password are required' })
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE name = $1', [name])
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const user = result.rows[0]
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const token = jwt.sign(
      { id: user.id, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    )
    return res.json({ token, user: { id: user.id, name: user.name } })
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
