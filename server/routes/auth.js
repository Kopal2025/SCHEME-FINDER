// routes/auth.js
// Register, login and "who am I" routes. Mounted at /api/auth in index.js.
//
// Note on logout: with JWT there is nothing to delete on the server.
// The frontend simply removes the token from localStorage (see public/js/api.js).

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Simple email pattern: something@something.something
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Creates a token that the frontend will send back with every request
function createToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '1d' } // user has to log in again after 1 day
  );
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// Request:  JSON body { name, email, password }
// Database: checks users for an existing email, then INSERTs a new user
//           (password is stored as a bcrypt hash, never as plain text)
// Response: 201 { token, user: { id, name, email, role } }
//           400 if input is invalid, 409 if the email is already registered
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  const body = req.body || {}; // no JSON body at all -> treat as empty
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  // Backend validation (the frontend also checks, but never trust the client)
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are all required.' });
  }
  if (name.length < 2 || name.length > 50) {
    return res.status(400).json({ error: 'Name must be between 2 and 50 characters.' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = await db.get('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  let result;
  try {
    // RETURNING id gives us the id PostgreSQL just created for the new user
    result = await db.run(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'user') RETURNING id",
      [name, email, passwordHash]
    );
  } catch (err) {
    // 23505 = unique violation: someone registered the same email a moment ago
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    throw err;
  }

  const user = { id: result.rows[0].id, name, email, role: 'user' };
  res.status(201).json({ token: createToken(user), user });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// Request:  JSON body { email, password }
// Database: SELECTs the user by email, compares password with the stored hash
// Response: 200 { token, user: { id, name, email, role } }
//           400 if fields are empty, 401 if email/password is wrong
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter both email and password.' });
  }

  const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);

  // Same message for "no such user" and "wrong password", so nobody can
  // find out which emails are registered.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  res.json({
    token: createToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me   (protected: needs a valid token)
// Request:  no body, just the Authorization header
// Database: SELECTs the logged-in user's details by id (from the token)
// Response: 200 { user: { id, name, email, role, created_at } }
//           401 if the token is missing/invalid or the user no longer exists
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.get(
    'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
    [req.user.id]
  );

  if (!user) {
    return res.status(401).json({ error: 'User not found. Please log in again.' });
  }
  res.json({ user });
});

module.exports = router;
