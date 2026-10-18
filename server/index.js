// index.js
// Entry point of the app. `npm start` runs this file.
// It creates the Express server, serves the frontend from /public,
// and mounts the API routes under /api.

require('dotenv').config(); // loads variables from .env into process.env

const path = require('path');
const express = require('express');
const { initDb } = require('./db'); // connects to PostgreSQL (DATABASE_URL)

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const schemeRoutes = require('./routes/schemes');
const applicationRoutes = require('./routes/applications');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.warn('Warning: JWT_SECRET is not set in .env, using a default development secret.');
}

// Read JSON request bodies into req.body
app.use(express.json());

// Serve the HTML/CSS/JS files. Visiting http://localhost:3000 opens public/index.html
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/schemes', schemeRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/admin', adminRoutes); // every route inside checks for an admin token

// Any other /api URL that doesn't exist -> JSON error instead of an HTML page
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// If any route throws an error, send a simple message instead of crashing
app.use((err, req, res, next) => {
  // express.json() could not read the body (e.g. broken JSON sent with curl)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// First make sure the tables + seed data exist, THEN start accepting requests.
// PORT comes from Render (or .env locally).
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Could not set up the database:', err.message);
    process.exit(1);
  });
