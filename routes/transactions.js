const express = require('express');
const router = express.Router();
const db = require('../database');
const authenticate = require('../middleware/auth');

const VALID_INCOME_CATEGORIES = ['salary', 'freelance', 'business', 'investment', 'gift', 'other'];
const VALID_EXPENSE_CATEGORIES = ['food', 'transport', 'rent', 'utilities', 'entertainment', 'shopping', 'health', 'education', 'other'];

router.use(authenticate);

// Get all transactions + summary for the logged-in user
router.get('/', (req, res) => {
  const transactions = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC'
  ).all(req.user.id);

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  res.json({
    transactions,
    summary: {
      income: totalIncome,
      expense: totalExpense,
      balance: totalIncome - totalExpense
    }
  });
});

// Add a transaction
router.post('/', (req, res) => {
  const { type, amount, category, note, date } = req.body;

  if (!type || !amount || !category || !date) {
    return res.status(400).json({ error: 'Type, amount, category, and date are required.' });
  }
  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'Type must be income or expense.' });
  }
  if (isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number.' });
  }

  const validCategories = type === 'income' ? VALID_INCOME_CATEGORIES : VALID_EXPENSE_CATEGORIES;
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: `Invalid category for ${type}.` });
  }

  const result = db.prepare(
    'INSERT INTO transactions (user_id, type, amount, category, note, date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, type, Number(amount), category, note || null, date);

  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(transaction);
});

// Delete a transaction
router.delete('/:id', (req, res) => {
  const transaction = db.prepare(
    'SELECT * FROM transactions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!transaction) return res.status(404).json({ error: 'Transaction not found.' });

  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ message: 'Transaction deleted.' });
});

// Get spending breakdown by category for the current month
router.get('/summary/monthly', (req, res) => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const rows = db.prepare(`
    SELECT type, category, SUM(amount) as total
    FROM transactions
    WHERE user_id = ? AND date LIKE ?
    GROUP BY type, category
    ORDER BY total DESC
  `).all(req.user.id, `${month}%`);

  res.json({ month, breakdown: rows });
});

module.exports = router;
