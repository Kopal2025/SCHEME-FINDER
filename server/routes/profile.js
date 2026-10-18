// routes/profile.js
// Read and save the logged-in user's eligibility profile.
// Mounted at /api/profile in index.js. Every route here needs a valid token.

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GENDERS = ['male', 'female', 'other'];
const CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS'];
const EDUCATION_LEVELS = ['class10', 'class12', 'diploma', 'ug', 'pg'];

// What we send when the user has not saved a profile yet
const EMPTY_PROFILE = {
  date_of_birth: null, gender: null, state: null, category: null, annual_income: null,
  education_level: null, marks_percent: null, has_disability: null
};

// "" / null / undefined -> null, otherwise the trimmed text
function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

// ---------------------------------------------------------------------------
// GET /api/profile
// Request:  no body, just the Authorization header
// Database: SELECTs the row in profiles for this user (if there is one)
// Response: 200 { profile: { date_of_birth, gender, state, ... } }
//           every field is null if the user has not saved a profile yet
// ---------------------------------------------------------------------------
router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  if (!row) {
    return res.json({ profile: EMPTY_PROFILE });
  }
  delete row.user_id; // the frontend doesn't need it
  res.json({ profile: row });
});

// ---------------------------------------------------------------------------
// PUT /api/profile
// Request:  JSON body with any of the profile fields. Every field is optional,
//           so a user can save a half-filled profile. Empty fields become NULL.
// Database: INSERTs a new row, or UPDATEs the existing one if this user
//           already has a profile ("upsert" using ON CONFLICT)
// Response: 200 { message, profile }
//           400 with an error message if any value is invalid
// ---------------------------------------------------------------------------
router.put('/', requireAuth, (req, res) => {
  const body = req.body || {};

  const profile = {
    date_of_birth: cleanText(body.date_of_birth),
    gender: cleanText(body.gender),
    state: cleanText(body.state),
    category: cleanText(body.category),
    annual_income: cleanText(body.annual_income),
    education_level: cleanText(body.education_level),
    marks_percent: cleanText(body.marks_percent),
    has_disability: cleanText(body.has_disability)
  };

  // ---- Backend validation: check each field that was filled in ----
  if (profile.date_of_birth !== null) {
    const isDateFormat = /^\d{4}-\d{2}-\d{2}$/.test(profile.date_of_birth);
    const date = new Date(profile.date_of_birth);
    if (!isDateFormat || isNaN(date)) {
      return res.status(400).json({ error: 'Date of birth must be a valid date.' });
    }
    if (date > new Date()) {
      return res.status(400).json({ error: 'Date of birth cannot be in the future.' });
    }
    if (date.getFullYear() < 1900) {
      return res.status(400).json({ error: 'Please enter a realistic date of birth.' });
    }
  }
  if (profile.gender !== null && !GENDERS.includes(profile.gender)) {
    return res.status(400).json({ error: 'Please choose a valid gender.' });
  }
  if (profile.state !== null && profile.state.length > 60) {
    return res.status(400).json({ error: 'Please choose a valid state.' });
  }
  if (profile.category !== null && !CATEGORIES.includes(profile.category)) {
    return res.status(400).json({ error: 'Please choose a valid category.' });
  }
  if (profile.education_level !== null && !EDUCATION_LEVELS.includes(profile.education_level)) {
    return res.status(400).json({ error: 'Please choose a valid education level.' });
  }
  if (profile.annual_income !== null) {
    const income = Number(profile.annual_income);
    if (!Number.isInteger(income) || income < 0 || income > 1000000000) {
      return res.status(400).json({ error: 'Annual income must be a whole number of rupees (0 or more).' });
    }
    profile.annual_income = income;
  }
  if (profile.marks_percent !== null) {
    const marks = Number(profile.marks_percent);
    if (isNaN(marks) || marks < 0 || marks > 100) {
      return res.status(400).json({ error: 'Marks must be a percentage between 0 and 100.' });
    }
    profile.marks_percent = marks;
  }
  if (profile.has_disability !== null) {
    if (profile.has_disability !== '0' && profile.has_disability !== '1') {
      return res.status(400).json({ error: 'Disability must be Yes or No.' });
    }
    profile.has_disability = Number(profile.has_disability);
  }

  // ---- Save: insert, or update if a row for this user already exists ----
  db.prepare(`
    INSERT INTO profiles (user_id, date_of_birth, gender, state, category, annual_income,
                          education_level, marks_percent, has_disability)
    VALUES (@user_id, @date_of_birth, @gender, @state, @category, @annual_income,
            @education_level, @marks_percent, @has_disability)
    ON CONFLICT (user_id) DO UPDATE SET
      date_of_birth   = excluded.date_of_birth,
      gender          = excluded.gender,
      state           = excluded.state,
      category        = excluded.category,
      annual_income   = excluded.annual_income,
      education_level = excluded.education_level,
      marks_percent   = excluded.marks_percent,
      has_disability  = excluded.has_disability
  `).run({ user_id: req.user.id, ...profile });

  res.json({ message: 'Profile saved.', profile });
});

module.exports = router;
