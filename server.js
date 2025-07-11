const express = require('express');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || 'supersecret';

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend')));

// === API ROUTES ===

app.post('/api/register', async (req, res) => {
  const { username, password, role } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  db.run(
    `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
    [username, hashed, role],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, SECRET);
    res.json({ token });
  });
});

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Unauthorized' });
  }
}

app.get('/api/dashboard', auth, (req, res) => {
  db.get(`SELECT id, username, balance, role FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(`SELECT * FROM transactions WHERE userId = ? ORDER BY date DESC`, [req.user.id], (err, transactions) => {
      res.json({ user, transactions });
    });
  });
});

app.post('/api/transaction', auth, (req, res) => {
  const { type, amount } = req.body;
  db.get(`SELECT balance FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    let newBalance = user.balance;
    if (type === 'deposit') newBalance += amount;
    else if (type === 'withdraw') {
      if (user.balance < amount) return res.status(400).json({ error: 'Insufficient funds' });
      newBalance -= amount;
    }

    db.run(`UPDATE users SET balance = ? WHERE id = ?`, [newBalance, req.user.id]);
    db.run(`INSERT INTO transactions (userId, type, amount) VALUES (?, ?, ?)`, [req.user.id, type, amount]);
    res.json({ balance: newBalance });
  });
});

app.post('/api/reset/:userId', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const userId = req.params.userId;
  db.run(`UPDATE users SET balance = 0 WHERE id = ?`, [userId]);
  db.run(`DELETE FROM transactions WHERE userId = ?`, [userId]);
  res.json({ message: 'Account reset' });
});

// Catch-all route for SPA (Single Page App) — must come LAST
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
