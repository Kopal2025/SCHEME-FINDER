// routes/applications.js
// The user's application status per scheme, and the document checklist.
// Mounted at /api/applications in index.js. Every route here needs a valid token.

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { toList } = require('../utils/eligibility');

const router = express.Router();

const STATUSES = ['saved', 'applied', 'under_review', 'approved', 'rejected'];

// Reads :schemeId from the URL and returns the scheme row, or null.
// (2147483647 is the biggest number a PostgreSQL INTEGER column can hold.)
async function findScheme(idText) {
  const id = Number(idText);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) return null;
  return (await db.get('SELECT * FROM schemes WHERE id = $1', [id])) || null;
}

// ---------------------------------------------------------------------------
// GET /api/applications
// Request:  no body, just the Authorization header
// Database: SELECTs the user's applications JOINed with schemes (to get the
//           name and deadline), plus the ticked documents for each one
// Response: 200 { applications: [ { scheme_id, name, provider, type, deadline,
//                 status, updated_at, docs_done, docs_total } ] }
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const rows = await db.all(`
    SELECT a.scheme_id, a.status, a.updated_at,
           s.name, s.provider, s.type, s.deadline, s.required_documents
    FROM applications a
    JOIN schemes s ON s.id = a.scheme_id
    WHERE a.user_id = $1
    ORDER BY a.updated_at DESC
  `, [req.user.id]);

  // All documents this user has ticked (for every scheme) in ONE query
  const doneRows = await db.all(
    'SELECT scheme_id, document_name FROM document_checklist WHERE user_id = $1 AND is_done = 1',
    [req.user.id]
  );

  const applications = rows.map((row) => {
    const required = toList(row.required_documents);
    const doneNames = doneRows.filter((d) => d.scheme_id === row.scheme_id).map((d) => d.document_name);
    // Only count documents that are still in the scheme's list
    const docsDone = required.filter((name) => doneNames.includes(name)).length;

    return {
      scheme_id: row.scheme_id,
      name: row.name,
      provider: row.provider,
      type: row.type,
      deadline: row.deadline,
      status: row.status,
      updated_at: row.updated_at,
      docs_done: docsDone,
      docs_total: required.length
    };
  });

  res.json({ applications });
});

// ---------------------------------------------------------------------------
// PUT /api/applications/:schemeId
// Request:  JSON body { status } — one of saved / applied / under_review / approved / rejected
// Database: INSERTs a row in applications, or UPDATEs the status if this user
//           already has one for this scheme (upsert)
// Response: 200 { message, status }
//           400 for an invalid status, 404 if the scheme doesn't exist
// ---------------------------------------------------------------------------
router.put('/:schemeId', requireAuth, async (req, res) => {
  const scheme = await findScheme(req.params.schemeId);
  if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });

  const status = (req.body && req.body.status) || '';
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Please choose a valid application status.' });
  }

  await db.run(`
    INSERT INTO applications (user_id, scheme_id, status, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, scheme_id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at
  `, [req.user.id, scheme.id, status]);

  res.json({ message: 'Application status updated.', status });
});

// ---------------------------------------------------------------------------
// DELETE /api/applications/:schemeId
// Request:  scheme id in the URL
// Database: DELETEs this user's application row for the scheme
//           (the document checklist is kept, in case they add it again)
// Response: 200 { message }
// ---------------------------------------------------------------------------
router.delete('/:schemeId', requireAuth, async (req, res) => {
  const scheme = await findScheme(req.params.schemeId);
  if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });

  await db.run('DELETE FROM applications WHERE user_id = $1 AND scheme_id = $2', [req.user.id, scheme.id]);
  res.json({ message: 'Removed from your applications.' });
});

// ---------------------------------------------------------------------------
// PUT /api/applications/:schemeId/documents
// Request:  JSON body { document_name, is_done: true/false }
// Database: INSERTs or UPDATEs one row in document_checklist
// Response: 200 { message, document_name, is_done }
//           400 if the document is not in this scheme's list, 404 if no scheme
// ---------------------------------------------------------------------------
router.put('/:schemeId/documents', requireAuth, async (req, res) => {
  const scheme = await findScheme(req.params.schemeId);
  if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });

  const body = req.body || {};
  const documentName = String(body.document_name || '').trim();
  if (!toList(scheme.required_documents).includes(documentName)) {
    return res.status(400).json({ error: 'This document is not required for this scheme.' });
  }
  if (typeof body.is_done !== 'boolean') {
    return res.status(400).json({ error: 'is_done must be true or false.' });
  }

  await db.run(`
    INSERT INTO document_checklist (user_id, scheme_id, document_name, is_done)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, scheme_id, document_name) DO UPDATE SET is_done = excluded.is_done
  `, [req.user.id, scheme.id, documentName, body.is_done ? 1 : 0]);

  res.json({ message: 'Checklist updated.', document_name: documentName, is_done: body.is_done });
});

module.exports = router;
