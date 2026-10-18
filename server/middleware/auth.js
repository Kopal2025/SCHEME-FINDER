// middleware/auth.js
// Middleware = a function that runs BEFORE a route handler.
// requireAuth  -> checks the JWT token and puts the logged-in user on req.user
// requireAdmin -> (use after requireAuth) only lets admins through

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function requireAuth(req, res, next) {
  // The frontend sends the header:  Authorization: Bearer <token>
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Please log in first.' });
  }

  try {
    // jwt.verify checks the signature and expiry, and gives back the payload
    // we stored when logging in: { id, name, role }
    req.user = jwt.verify(token, JWT_SECRET);
    next(); // token is fine, continue to the route
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can do this.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, JWT_SECRET };
