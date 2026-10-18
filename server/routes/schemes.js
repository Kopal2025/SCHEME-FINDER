// routes/schemes.js
// List schemes with search + filters, each labelled with the user's eligibility.
// Mounted at /api/schemes in index.js.
//
// HOW A FILTER TRAVELS (server side; the browser side is in public/js/schemes.js)
//   1. The browser calls e.g.  GET /api/schemes?type=scholarship&state=Karnataka&match=eligible
//   2. Express turns the part after "?" into an object:
//        req.query = { type: 'scholarship', state: 'Karnataka', match: 'eligible' }
//   3. search, type and provider are simple columns, so we filter in SQL by adding
//      "AND ..." to the WHERE clause with a numbered placeholder ($1, $2, ...)
//      for each value.
//   4. state and education are stored as comma-separated lists ("SC,ST"), and the
//      match status doesn't exist in the database at all (we calculate it), so
//      those filters are done in JavaScript with .filter() on the rows SQL gave us.
//   5. We send back the remaining schemes as JSON and the browser draws the cards.

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkEligibility, toList, joinWords } = require('../utils/eligibility');

const router = express.Router();

// Only create the Claude API client if a key is in .env. Without a key the
// "Explain in simple words" button uses the rule-based explanation instead.
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ timeout: 30000, maxRetries: 1 }) // reads ANTHROPIC_API_KEY itself
  : null;

// Today's date as 'YYYY-MM-DD' (local time), so it can be compared with deadlines
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Number of days from date a to date b (both 'YYYY-MM-DD')
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// '2026-10-22' -> '22 Oct 2026'
function prettyDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

// Reads the :id from the URL and returns the scheme row, or null.
// (2147483647 is the biggest number a PostgreSQL INTEGER column can hold.)
async function findScheme(idText) {
  const id = Number(idText);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) return null;
  return (await db.get('SELECT * FROM schemes WHERE id = $1', [id])) || null;
}

const TYPES = ['scholarship', 'welfare'];
const PROVIDERS = ['government', 'private'];
const EDUCATION_LEVELS = ['class10', 'class12', 'diploma', 'ug', 'pg'];
const MATCHES = ['eligible', 'possible', 'not'];

// ---------------------------------------------------------------------------
// GET /api/schemes?search=&type=&provider=&state=&education=&match=
// Request:  optional query parameters (all empty = show everything):
//             search    -> part of the scheme name
//             type      -> 'scholarship' | 'welfare'
//             provider  -> 'government' | 'private'
//             state     -> e.g. 'Karnataka' (schemes open to that state)
//             education -> 'class10' | 'class12' | 'diploma' | 'ug' | 'pg'
//             match     -> 'eligible' | 'possible' | 'not'
// Database: SELECTs this user's profile, and SELECTs schemes (filtered by
//           search/type/provider in SQL)
// Response: 200 { schemes: [ {...scheme, eligibility: { status, summary, details }} ],
//                 profileComplete: true/false }
//           400 if a filter value is not one of the allowed options
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  // Step 2: read the filters from the URL (missing ones become '')
  const search = (req.query.search || '').trim();
  const type = req.query.type || '';
  const provider = req.query.provider || '';
  const state = req.query.state || '';
  const education = req.query.education || '';
  const match = req.query.match || '';

  // Backend validation: only allow the values our dropdowns offer
  if (search.length > 100) return res.status(400).json({ error: 'Search text is too long.' });
  if (type && !TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type filter.' });
  if (provider && !PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Invalid provider filter.' });
  if (education && !EDUCATION_LEVELS.includes(education)) return res.status(400).json({ error: 'Invalid education filter.' });
  if (match && !MATCHES.includes(match)) return res.status(400).json({ error: 'Invalid match filter.' });

  // Step 3: build the SQL query piece by piece.
  // "WHERE 1 = 1" is always true; it just lets every filter start with "AND".
  // Values go into params (never pasted into the SQL text) to avoid SQL injection.
  // Each value we push gets the next number: the first is $1, the second $2...
  let sql = 'SELECT * FROM schemes WHERE 1 = 1';
  const params = [];

  if (search) {
    // ILIKE = LIKE that ignores capital letters. % and _ are wildcards in LIKE,
    // so we put a \ in front of any the user typed, to search for them as plain text.
    params.push('%' + search.replace(/[\\%_]/g, '\\$&') + '%');
    sql += ` AND name ILIKE $${params.length}`;
  }
  if (type) {
    params.push(type);
    sql += ` AND type = $${params.length}`;
  }
  if (provider) {
    params.push(provider);
    sql += ` AND provider = $${params.length}`;
  }
  sql += ' ORDER BY name';

  let schemes = await db.all(sql, params);

  // Step 4a: state / education filters in JavaScript.
  // An empty list on the scheme means "open to all", so it always passes.
  if (state) {
    schemes = schemes.filter((s) => {
      const states = toList(s.allowed_states);
      return states.length === 0 || states.includes(state);
    });
  }
  if (education) {
    schemes = schemes.filter((s) => {
      const levels = toList(s.allowed_education);
      return levels.length === 0 || levels.includes(education);
    });
  }

  // Step 4b: work out eligibility for every scheme using the user's profile
  const profile = await db.get('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
  schemes = schemes.map((s) => ({ ...s, eligibility: checkEligibility(profile, s) }));

  // ...and then filter by match status if one was chosen
  if (match) {
    schemes = schemes.filter((s) => s.eligibility.status === match);
  }

  // Is every profile field filled? (the page shows a reminder if not)
  const profileComplete = !!profile && [
    'date_of_birth', 'gender', 'state', 'category', 'annual_income',
    'education_level', 'marks_percent', 'has_disability'
  ].every((field) => profile[field] !== null);

  // Step 5: send the result back to the browser
  res.json({ schemes, profileComplete });
});

// ---------------------------------------------------------------------------
// GET /api/schemes/deadlines
// (This route must come BEFORE '/:id', otherwise Express would think
//  "deadlines" is a scheme id.)
// Request:  no body, just the Authorization header
// Database: SELECTs schemes whose deadline is today or later (closest first),
//           the user's profile, and the user's rows in applications
// Response: 200 { deadlines: [ { id, name, provider, type, deadline, days_left,
//                                eligibility_status, application_status } ] }
//           Only schemes the user is Eligible for OR has saved/applied to.
// ---------------------------------------------------------------------------
router.get('/deadlines', requireAuth, async (req, res) => {
  const today = todayString();

  // deadline is a DATE column, so PostgreSQL compares and sorts it as a real date
  const schemes = await db.all(
    'SELECT * FROM schemes WHERE deadline IS NOT NULL AND deadline >= $1 ORDER BY deadline',
    [today]
  );
  const profile = await db.get('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
  const applications = await db.all('SELECT scheme_id, status FROM applications WHERE user_id = $1', [req.user.id]);

  // { schemeId: status } so we can look up a scheme's status quickly
  const statusByScheme = {};
  for (const a of applications) statusByScheme[a.scheme_id] = a.status;

  const deadlines = [];
  for (const s of schemes) {
    const eligibilityStatus = checkEligibility(profile, s).status;
    const applicationStatus = statusByScheme[s.id] || null;

    if (eligibilityStatus === 'eligible' || applicationStatus) {
      deadlines.push({
        id: s.id,
        name: s.name,
        provider: s.provider,
        type: s.type,
        deadline: s.deadline,
        days_left: daysBetween(today, s.deadline),
        eligibility_status: eligibilityStatus,
        application_status: applicationStatus
      });
    }
  }

  res.json({ deadlines });
});

// ---------------------------------------------------------------------------
// GET /api/schemes/:id
// Request:  scheme id in the URL, e.g. /api/schemes/3
// Database: SELECTs the scheme, the user's profile, the user's ticked
//           documents (document_checklist) and the application row
// Response: 200 { scheme, eligibility: { status, summary, criteria },
//                 documents: [ { name, is_done } ], application: { status, updated_at } | null }
//           404 if there is no scheme with that id
// ---------------------------------------------------------------------------
router.get('/:id', requireAuth, async (req, res) => {
  const scheme = await findScheme(req.params.id);
  if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });

  const profile = await db.get('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);

  // Which documents has the user already ticked for this scheme?
  const doneRows = await db.all(
    'SELECT document_name FROM document_checklist WHERE user_id = $1 AND scheme_id = $2 AND is_done = 1',
    [req.user.id, scheme.id]
  );
  const doneNames = doneRows.map((row) => row.document_name);

  const documents = toList(scheme.required_documents).map((name) => ({
    name,
    is_done: doneNames.includes(name)
  }));

  const application = (await db.get(
    'SELECT status, updated_at FROM applications WHERE user_id = $1 AND scheme_id = $2',
    [req.user.id, scheme.id]
  )) || null;

  res.json({
    scheme,
    eligibility: checkEligibility(profile, scheme),
    documents,
    application
  });
});

// Builds the "Explain in simple words" text from the scheme's own data.
// No AI needed: we just fill sentences with the values from the database.
function ruleBasedExplanation(scheme, eligibility) {
  const lines = [];
  const kind = scheme.type === 'welfare' ? 'welfare scheme' : 'scholarship';
  const runBy = scheme.provider === 'government' ? 'the government' : 'a private organisation';

  lines.push(`${scheme.name} is a ${kind} run by ${runBy}.`);
  if (scheme.benefit) lines.push(`What you get: ${scheme.benefit}.`);

  if (eligibility.criteria.length > 0) {
    lines.push(`Who can apply: ${eligibility.criteria.map((c) => c.requirement).join('; ')}.`);
  } else {
    lines.push('Who can apply: anyone. There are no special conditions.');
  }

  lines.push(`What this means for you: ${eligibility.summary}`);

  if (!scheme.deadline) {
    lines.push('You can apply at any time of the year.');
  } else if (scheme.deadline < todayString()) {
    lines.push(`The last date (${prettyDate(scheme.deadline)}) has already passed. Check the website for the next round.`);
  } else {
    lines.push(`Last date to apply: ${prettyDate(scheme.deadline)}.`);
  }

  const documents = toList(scheme.required_documents);
  if (documents.length > 0) {
    lines.push(`Keep these documents ready: ${joinWords(documents)}.`);
  }

  lines.push('To apply, open the official website and fill in the online form.');
  return lines.join('\n');
}

// Asks Claude to explain the scheme. Only used when ANTHROPIC_API_KEY is set.
// We send the scheme's details and the eligibility summary (no name or email).
async function aiExplanation(scheme, eligibility) {
  const facts = {
    name: scheme.name,
    provider: scheme.provider,
    type: scheme.type,
    description: scheme.description,
    benefit: scheme.benefit,
    deadline: scheme.deadline ? prettyDate(scheme.deadline) : 'open all year',
    who_can_apply: eligibility.criteria.map((c) => c.requirement),
    required_documents: toList(scheme.required_documents),
    result_for_this_user: eligibility.summary
  };

  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    output_config: { effort: 'low' }, // a short, simple answer doesn't need deep thinking
    // If the model declines, the API automatically retries on a fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'You explain Indian scholarships and welfare schemes to students and families in very simple English. ' +
      'Write 5 to 7 short sentences, one per line, in plain text with no markdown, headings or bullet symbols. ' +
      'Use only the facts given. Do not invent amounts, dates or rules. ' +
      'Tell the reader whether they seem to qualify, using result_for_this_user.',
    messages: [{ role: 'user', content: 'Explain this scheme:\n' + JSON.stringify(facts, null, 2) }]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to answer.');
  }
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Empty answer from the model.');
  return text;
}

// ---------------------------------------------------------------------------
// GET /api/schemes/:id/explain
// Request:  scheme id in the URL
// Database: SELECTs the scheme and the user's profile (to say if they qualify)
// Response: 200 { explanation: "line 1\nline 2...", source: 'rules' | 'ai' }
//           404 if there is no scheme with that id
//           With no ANTHROPIC_API_KEY, or if the AI call fails, we use the
//           rule-based text, so this button always works.
// ---------------------------------------------------------------------------
router.get('/:id/explain', requireAuth, async (req, res) => {
  const scheme = await findScheme(req.params.id);
  if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });

  const profile = await db.get('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
  const eligibility = checkEligibility(profile, scheme);

  if (anthropic) {
    try {
      const explanation = await aiExplanation(scheme, eligibility);
      return res.json({ explanation, source: 'ai' });
    } catch (err) {
      console.error('AI explanation failed, using rule-based text instead:', err.message);
    }
  }

  res.json({ explanation: ruleBasedExplanation(scheme, eligibility), source: 'rules' });
});

module.exports = router;
