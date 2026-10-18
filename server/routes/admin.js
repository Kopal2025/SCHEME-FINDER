// routes/admin.js
// Admin-only routes: site counts and adding / editing / deleting schemes.
// Mounted at /api/admin in index.js.
//
// SECURITY: hiding the Admin link on the frontend is only for looks. Anyone
// could still call these URLs with fetch or curl, so the real protection is
// here: router.use() below runs requireAuth AND requireAdmin before EVERY
// route in this file. A normal user's token gets 403 "Only admins can do this."

const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const PROVIDERS = ['government', 'private'];
const TYPES = ['scholarship', 'welfare'];
const GENDERS = ['any', 'female', 'male'];
const CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS'];
const EDUCATION_LEVELS = ['class10', 'class12', 'diploma', 'ug', 'pg'];

// Accepts ['a', 'b'] or "a, b" and returns a clean array without duplicates
function toArray(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const cleaned = items.map((item) => String(item).trim()).filter(Boolean);
  return [...new Set(cleaned)];
}

// "" / null -> null, otherwise a number (or NaN if it isn't one)
function toNumberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return Number(value);
}

// true for a real calendar date like '2026-12-31'; false for '2026-02-30'
function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Turns the :id in the URL into a number, or null if it isn't a valid id.
// (2147483647 is the biggest number a PostgreSQL INTEGER column can hold.)
function parseId(idText) {
  const id = Number(idText);
  return Number.isInteger(id) && id >= 1 && id <= 2147483647 ? id : null;
}

// The 17 scheme values in the same order as the columns in the SQL below
function schemeValues(s) {
  return [s.name, s.provider, s.type, s.description, s.benefit, s.deadline, s.official_link,
    s.allowed_states, s.allowed_categories, s.allowed_education, s.gender, s.max_income,
    s.min_marks, s.min_age, s.max_age, s.disability_required, s.required_documents];
}

// Checks the form data sent by the admin page.
// Returns { error: '...' } if something is wrong, or { scheme: {...} } ready for the database.
function validateScheme(body) {
  body = body || {};
  const scheme = {
    name: String(body.name || '').trim(),
    provider: body.provider,
    type: body.type,
    description: String(body.description || '').trim(),
    benefit: String(body.benefit || '').trim(),
    deadline: String(body.deadline || '').trim() || null,
    official_link: String(body.official_link || '').trim() || null,
    allowed_states: toArray(body.allowed_states),
    allowed_categories: toArray(body.allowed_categories),
    allowed_education: toArray(body.allowed_education),
    gender: body.gender || 'any',
    max_income: toNumberOrNull(body.max_income),
    min_marks: toNumberOrNull(body.min_marks),
    min_age: toNumberOrNull(body.min_age),
    max_age: toNumberOrNull(body.max_age),
    disability_required: body.disability_required ? 1 : 0,
    required_documents: toArray(body.required_documents)
  };

  if (scheme.name.length < 3 || scheme.name.length > 150) return { error: 'Name must be between 3 and 150 characters.' };
  if (!PROVIDERS.includes(scheme.provider)) return { error: 'Provider must be government or private.' };
  if (!TYPES.includes(scheme.type)) return { error: 'Type must be scholarship or welfare.' };
  if (scheme.description.length > 1000) return { error: 'Description must be under 1000 characters.' };
  if (scheme.benefit.length > 200) return { error: 'Benefit must be under 200 characters.' };

  if (scheme.deadline !== null && !isRealDate(scheme.deadline)) {
    return { error: 'Deadline must be a valid date (or empty for "open all year").' };
  }
  if (scheme.official_link !== null && !/^https?:\/\//.test(scheme.official_link)) {
    return { error: 'Official link must start with http:// or https://' };
  }

  if (scheme.allowed_states.some((s) => s.length > 60)) return { error: 'Invalid state name.' };
  if (scheme.allowed_categories.some((c) => !CATEGORIES.includes(c))) return { error: 'Invalid category.' };
  if (scheme.allowed_education.some((e) => !EDUCATION_LEVELS.includes(e))) return { error: 'Invalid education level.' };
  if (!GENDERS.includes(scheme.gender)) return { error: 'Gender must be any, female or male.' };

  if (scheme.max_income !== null &&
      (!Number.isInteger(scheme.max_income) || scheme.max_income < 0 || scheme.max_income > 1000000000)) {
    return { error: 'Max income must be a whole number of rupees (up to 100 crore).' };
  }
  if (scheme.min_marks !== null && (isNaN(scheme.min_marks) || scheme.min_marks < 0 || scheme.min_marks > 100)) {
    return { error: 'Min marks must be between 0 and 100.' };
  }
  for (const field of ['min_age', 'max_age']) {
    const age = scheme[field];
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      return { error: 'Ages must be whole numbers between 0 and 120.' };
    }
  }
  if (scheme.min_age !== null && scheme.max_age !== null && scheme.min_age > scheme.max_age) {
    return { error: 'Min age cannot be more than max age.' };
  }

  // Lists are stored as comma-separated text in the database
  scheme.allowed_states = scheme.allowed_states.join(',');
  scheme.allowed_categories = scheme.allowed_categories.join(',');
  scheme.allowed_education = scheme.allowed_education.join(',');
  scheme.required_documents = scheme.required_documents.join(',');

  return { scheme };
}

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// Request:  no body (admin token required)
// Database: COUNTs rows in users (role 'user'), schemes and applications
// Response: 200 { users, schemes, applications }
// (PostgreSQL's COUNT gives a very big number type that pg returns as text,
//  so "::int" turns it into a normal number for the JSON.)
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  const users = (await db.get("SELECT COUNT(*)::int AS count FROM users WHERE role = 'user'")).count;
  const schemes = (await db.get('SELECT COUNT(*)::int AS count FROM schemes')).count;
  const applications = (await db.get('SELECT COUNT(*)::int AS count FROM applications')).count;
  res.json({ users, schemes, applications });
});

// ---------------------------------------------------------------------------
// GET /api/admin/schemes
// Request:  no body (admin token required)
// Database: SELECTs every scheme, newest first
// Response: 200 { schemes: [ ...all columns ] }
// ---------------------------------------------------------------------------
router.get('/schemes', async (req, res) => {
  const schemes = await db.all('SELECT * FROM schemes ORDER BY id DESC');
  res.json({ schemes });
});

// ---------------------------------------------------------------------------
// POST /api/admin/schemes
// Request:  JSON body with the scheme fields (lists can be arrays)
// Database: INSERTs one row into schemes
// Response: 201 { message, id }   or 400 { error } if the data is invalid
// ---------------------------------------------------------------------------
router.post('/schemes', async (req, res) => {
  const { error, scheme } = validateScheme(req.body);
  if (error) return res.status(400).json({ error });

  // RETURNING id gives us the id PostgreSQL just created
  const result = await db.run(`
    INSERT INTO schemes (name, provider, type, description, benefit, deadline, official_link,
      allowed_states, allowed_categories, allowed_education, gender, max_income, min_marks,
      min_age, max_age, disability_required, required_documents)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING id
  `, schemeValues(scheme));

  res.status(201).json({ message: 'Scheme added.', id: result.rows[0].id });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/schemes/:id
// Request:  scheme id in the URL + JSON body with all the scheme fields
// Database: UPDATEs that row in schemes
// Response: 200 { message }   400 if invalid, 404 if no scheme has that id
// ---------------------------------------------------------------------------
router.put('/schemes/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'Scheme not found.' });

  const { error, scheme } = validateScheme(req.body);
  if (error) return res.status(400).json({ error });

  const result = await db.run(`
    UPDATE schemes SET
      name = $1, provider = $2, type = $3, description = $4,
      benefit = $5, deadline = $6, official_link = $7,
      allowed_states = $8, allowed_categories = $9,
      allowed_education = $10, gender = $11, max_income = $12,
      min_marks = $13, min_age = $14, max_age = $15,
      disability_required = $16, required_documents = $17
    WHERE id = $18
  `, [...schemeValues(scheme), id]);

  // result.rowCount is how many rows were updated: 0 means the id doesn't exist
  if (result.rowCount === 0) return res.status(404).json({ error: 'Scheme not found.' });
  res.json({ message: 'Scheme updated.' });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/schemes/:id
// Request:  scheme id in the URL
// Database: DELETEs the scheme. Because of ON DELETE CASCADE (see db.js),
//           PostgreSQL also deletes its rows in applications and document_checklist.
// Response: 200 { message }   404 if no scheme has that id
// ---------------------------------------------------------------------------
router.delete('/schemes/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'Scheme not found.' });

  const result = await db.run('DELETE FROM schemes WHERE id = $1', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Scheme not found.' });
  res.json({ message: 'Scheme deleted.' });
});

module.exports = router;
