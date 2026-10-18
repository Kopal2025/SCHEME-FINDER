// db.js
// Connects to the PostgreSQL database given in the DATABASE_URL environment
// variable, creates all tables if they don't exist yet, and inserts the seed
// data (demo accounts + sample schemes) the first time.
//
// Every route file does `const db = require('../db')` and then uses:
//   await db.get(sql, params)  -> the first row (or undefined)
//   await db.all(sql, params)  -> an array of rows
//   await db.run(sql, params)  -> the full result (result.rowCount, result.rows)
// Values are passed separately as $1, $2, ... so they can never break the SQL
// (this is what protects us from SQL injection).

const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// ---------------------------------------------------------------------------
// 1. CONNECT
// ---------------------------------------------------------------------------

// The connection details (host, user, password) live ONLY in DATABASE_URL:
// on Render it is set in the dashboard, locally it comes from .env.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set. Add your PostgreSQL connection URL to .env (or to Render\'s Environment settings).');
  process.exit(1);
}

// Render's *internal* database URL (used by the web service on Render) does not
// need SSL. The *external* URL (to connect from your laptop) ends in
// ".render.com" and requires SSL. DATABASE_SSL=true forces SSL for other hosts.
const useSsl = process.env.DATABASE_SSL === 'true' || /\.render\.com/.test(connectionString);

// A pool keeps a few connections open and reuses them for every request
const pool = new Pool(useSsl
  ? { connectionString, ssl: { rejectUnauthorized: false } }
  : { connectionString });

// If an idle connection drops (e.g. the database restarts), log it instead of crashing
pool.on('error', (err) => console.error('PostgreSQL connection error:', err.message));

// By default pg turns DATE and TIMESTAMP columns into JavaScript Date objects.
// We keep them as plain text ('2026-10-22', '2026-10-22 09:30:00'), exactly
// like the SQLite version did, so the rest of the code and the API stay the same.
types.setTypeParser(1082, (value) => value); // DATE
types.setTypeParser(1114, (value) => value); // TIMESTAMP

async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function get(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0];
}

async function run(sql, params = []) {
  return pool.query(sql, params);
}

// Runs several queries as ONE transaction: either all of them are saved, or
// (if any fails) none are. `work` receives a client and uses client.query().
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // give the connection back to the pool
  }
}

// ---------------------------------------------------------------------------
// 2. TABLES
// List-type columns (allowed_states, allowed_categories, ...) are stored as
// comma-separated text, e.g. "SC,ST". An empty value means "no restriction".
// "IF NOT EXISTS" makes this safe to run on every start: existing tables
// and their data are left alone.
// ---------------------------------------------------------------------------
const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- One profile row per user. Every field is optional, because a user may
  -- fill the profile partly (then schemes show "Possibly Eligible").
  CREATE TABLE IF NOT EXISTS profiles (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    date_of_birth   DATE,
    gender          TEXT,              -- 'male' | 'female' | 'other'
    state           TEXT,              -- e.g. 'Karnataka'
    category        TEXT,              -- 'General' | 'OBC' | 'SC' | 'ST' | 'EWS'
    annual_income   INTEGER,           -- family income in rupees per year
    education_level TEXT,              -- 'class10' | 'class12' | 'diploma' | 'ug' | 'pg'
    marks_percent   DOUBLE PRECISION,  -- last exam percentage
    has_disability  INTEGER            -- 1 = yes, 0 = no
  );

  CREATE TABLE IF NOT EXISTS schemes (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    provider            TEXT NOT NULL CHECK (provider IN ('government', 'private')),
    type                TEXT NOT NULL CHECK (type IN ('scholarship', 'welfare')),
    description         TEXT,
    benefit             TEXT,
    deadline            DATE,                        -- NULL = open all year
    official_link       TEXT,
    -- eligibility rules (empty / NULL = no restriction)
    allowed_states      TEXT NOT NULL DEFAULT '',    -- e.g. 'Karnataka'
    allowed_categories  TEXT NOT NULL DEFAULT '',    -- e.g. 'SC,ST'
    allowed_education   TEXT NOT NULL DEFAULT '',    -- e.g. 'ug,pg'
    gender              TEXT NOT NULL DEFAULT 'any', -- 'any' | 'female' | 'male'
    max_income          INTEGER,
    min_marks           DOUBLE PRECISION,
    min_age             INTEGER,
    max_age             INTEGER,
    disability_required INTEGER NOT NULL DEFAULT 0,  -- 1 = only for persons with disability
    required_documents  TEXT NOT NULL DEFAULT ''     -- e.g. 'Aadhaar Card,Income Certificate'
  );

  CREATE TABLE IF NOT EXISTS applications (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheme_id  INTEGER NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'saved'
               CHECK (status IN ('saved', 'applied', 'under_review', 'approved', 'rejected')),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, scheme_id)   -- one application row per user per scheme
  );

  CREATE TABLE IF NOT EXISTS document_checklist (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheme_id     INTEGER NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    document_name TEXT NOT NULL,
    is_done       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, scheme_id, document_name)
  );
`;

// ---------------------------------------------------------------------------
// 3. SEED DATA
// ---------------------------------------------------------------------------

// Returns a date N days from today as 'YYYY-MM-DD' (local time).
function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// SAMPLE DATA: these schemes are based on real Indian schemes, but the
// amounts, limits and deadlines are simplified for this project and may not
// match the official rules. Always check the official link.
// Deadlines are set relative to the day the schemes are first inserted.
// (They are only inserted when the schemes table is empty, so an admin can
// update the deadlines later from the Admin page.)
const sampleSchemes = [
  {
    name: 'Post Matric Scholarship for SC Students',
    provider: 'government', type: 'scholarship',
    description: 'Central government scholarship for Scheduled Caste students studying after Class 10, covering fees and a monthly maintenance allowance.',
    benefit: 'Full tuition fee + maintenance allowance up to ₹1,200 per month',
    deadline: daysFromToday(5),
    official_link: 'https://scholarships.gov.in',
    allowed_states: '', allowed_categories: 'SC', allowed_education: 'class12,diploma,ug,pg',
    gender: 'any', max_income: 250000, min_marks: null, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Caste Certificate,Income Certificate,Previous Year Marksheet,Bank Passbook,Fee Receipt'
  },
  {
    name: 'Post Matric Scholarship for ST Students',
    provider: 'government', type: 'scholarship',
    description: 'Scholarship by the Ministry of Tribal Affairs for Scheduled Tribe students in post-matric courses.',
    benefit: 'Full tuition fee + maintenance allowance up to ₹1,200 per month',
    deadline: daysFromToday(12),
    official_link: 'https://scholarships.gov.in',
    allowed_states: '', allowed_categories: 'ST', allowed_education: 'class12,diploma,ug,pg',
    gender: 'any', max_income: 250000, min_marks: null, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Tribe Certificate,Income Certificate,Previous Year Marksheet,Bank Passbook'
  },
  {
    name: 'Central Sector Scheme of Scholarships for College Students',
    provider: 'government', type: 'scholarship',
    description: 'Merit-based scholarship for students who scored in the top 20 percentile in Class 12 and are pursuing regular college degrees.',
    benefit: '₹12,000 per year for UG, ₹20,000 per year for PG',
    deadline: daysFromToday(20),
    official_link: 'https://scholarships.gov.in',
    allowed_states: '', allowed_categories: '', allowed_education: 'ug,pg',
    gender: 'any', max_income: 450000, min_marks: 80, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Class 12 Marksheet,Income Certificate,College Admission Proof,Bank Passbook'
  },
  {
    name: 'AICTE Pragati Scholarship for Girls',
    provider: 'government', type: 'scholarship',
    description: 'AICTE scholarship to encourage girl students in technical education (diploma or degree) at AICTE-approved institutions.',
    benefit: '₹50,000 per year for tuition fee and other expenses',
    deadline: daysFromToday(3),
    official_link: 'https://www.aicte-india.org/schemes/students-development-schemes',
    allowed_states: '', allowed_categories: '', allowed_education: 'diploma,ug',
    gender: 'female', max_income: 800000, min_marks: null, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Income Certificate,Admission Letter,Fee Receipt,Bank Passbook'
  },
  {
    name: 'AICTE Saksham Scholarship',
    provider: 'government', type: 'scholarship',
    description: 'AICTE scholarship for specially-abled students (40% or more disability) in technical diploma or degree courses.',
    benefit: '₹50,000 per year for tuition fee and other expenses',
    deadline: daysFromToday(30),
    official_link: 'https://www.aicte-india.org/schemes/students-development-schemes',
    allowed_states: '', allowed_categories: '', allowed_education: 'diploma,ug',
    gender: 'any', max_income: 800000, min_marks: null, min_age: null, max_age: null, disability_required: 1,
    required_documents: 'Aadhaar Card,Disability Certificate,Income Certificate,Admission Letter,Bank Passbook'
  },
  {
    name: 'Karnataka SSP Post-Matric Scholarship',
    provider: 'government', type: 'scholarship',
    description: 'Karnataka State Scholarship Portal scholarship for SC, ST and OBC students of Karnataka studying after Class 10.',
    benefit: 'Fee reimbursement + yearly allowance (amount depends on course)',
    deadline: daysFromToday(9),
    official_link: 'https://ssp.postmatric.karnataka.gov.in',
    allowed_states: 'Karnataka', allowed_categories: 'SC,ST,OBC', allowed_education: 'class12,diploma,ug,pg',
    gender: 'any', max_income: 250000, min_marks: null, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Caste Certificate,Income Certificate,Karnataka Domicile Certificate,Previous Year Marksheet,Bank Passbook'
  },
  {
    name: 'HDFC Badhte Kadam Scholarship',
    provider: 'private', type: 'scholarship',
    description: 'Private scholarship that supports meritorious students from low-income families to continue their college education.',
    benefit: 'Up to ₹1,00,000 one-time support',
    deadline: daysFromToday(45),
    official_link: 'https://www.buddy4study.com',
    allowed_states: '', allowed_categories: '', allowed_education: 'ug,pg',
    gender: 'any', max_income: 600000, min_marks: 60, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Previous Year Marksheet,Income Certificate,Admission Proof,Bank Passbook'
  },
  {
    name: 'Reliance Foundation Undergraduate Scholarship',
    provider: 'private', type: 'scholarship',
    description: 'Merit-cum-means scholarship for first-year undergraduate students in any stream across India.',
    benefit: 'Up to ₹2,00,000 over the duration of the degree',
    deadline: daysFromToday(60),
    official_link: 'https://scholarships.reliancefoundation.org',
    allowed_states: '', allowed_categories: '', allowed_education: 'ug',
    gender: 'any', max_income: 1500000, min_marks: 60, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Class 12 Marksheet,Income Certificate,College Admission Proof'
  },
  {
    name: 'Kotak Kanya Scholarship',
    provider: 'private', type: 'scholarship',
    description: 'Scholarship for meritorious girl students from low-income families pursuing professional graduation courses.',
    benefit: '₹1,50,000 per year',
    deadline: daysFromToday(25),
    official_link: 'https://kotakeducation.org',
    allowed_states: '', allowed_categories: '', allowed_education: 'ug',
    gender: 'female', max_income: 600000, min_marks: 85, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Class 12 Marksheet,Income Certificate,Admission Letter,Fee Receipt,Bank Passbook'
  },
  {
    name: 'National Means-cum-Merit Scholarship (NMMS)',
    provider: 'government', type: 'scholarship',
    description: 'Scholarship for meritorious school students from economically weaker families to prevent dropouts after Class 8.',
    benefit: '₹12,000 per year',
    deadline: daysFromToday(-10), // already closed, to show how past deadlines look
    official_link: 'https://scholarships.gov.in',
    allowed_states: '', allowed_categories: '', allowed_education: 'class10',
    gender: 'any', max_income: 350000, min_marks: 55, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,School Marksheet,Income Certificate,Bank Passbook'
  },
  {
    name: 'PM-KISAN Samman Nidhi',
    provider: 'government', type: 'welfare',
    description: 'Income support scheme for landholding farmer families, paid directly into their bank account in three instalments.',
    benefit: '₹6,000 per year in three instalments of ₹2,000',
    deadline: null, // open all year
    official_link: 'https://pmkisan.gov.in',
    allowed_states: '', allowed_categories: '', allowed_education: '',
    gender: 'any', max_income: null, min_marks: null, min_age: 18, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Land Ownership Records,Bank Passbook'
  },
  {
    name: 'Ayushman Bharat (PM-JAY)',
    provider: 'government', type: 'welfare',
    description: 'Health insurance scheme for poor and vulnerable families covering hospital treatment at empanelled hospitals.',
    benefit: 'Health cover up to ₹5,00,000 per family per year',
    deadline: null, // open all year
    official_link: 'https://pmjay.gov.in',
    allowed_states: '', allowed_categories: '', allowed_education: '',
    gender: 'any', max_income: 300000, min_marks: null, min_age: null, max_age: null, disability_required: 0,
    required_documents: 'Aadhaar Card,Ration Card,Income Certificate'
  }
];

// Adds the demo accounts and sample schemes ONLY if they are missing.
// It never deletes or changes existing rows, so user data survives restarts.
async function seed(client) {
  // Admin account: admin@test.com / admin123
  // ON CONFLICT (email) DO NOTHING = skip it if that email already exists
  const admin = await client.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    ['Admin', 'admin@test.com', bcrypt.hashSync('admin123', 10)]
  );
  if (admin.rowCount === 1) console.log('Seeded admin account: admin@test.com / admin123');

  // Sample student with a filled profile: student@test.com / student123
  const student = await client.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'user')
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    ['Priya Sharma', 'student@test.com', bcrypt.hashSync('student123', 10)]
  );
  // RETURNING only gives a row when the account was really created just now,
  // so an existing student's profile is never overwritten.
  if (student.rowCount === 1) {
    await client.query(
      `INSERT INTO profiles (user_id, date_of_birth, gender, state, category, annual_income,
                             education_level, marks_percent, has_disability)
       VALUES ($1, '2005-06-15', 'female', 'Karnataka', 'SC', 200000, 'ug', 82, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [student.rows[0].id]
    );
    console.log('Seeded sample student: student@test.com / student123');
  }

  // Sample schemes: only when the table is completely empty (first start)
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM schemes');
  if (rows[0].count === 0) {
    for (const s of sampleSchemes) {
      await client.query(
        `INSERT INTO schemes (name, provider, type, description, benefit, deadline, official_link,
           allowed_states, allowed_categories, allowed_education, gender, max_income, min_marks,
           min_age, max_age, disability_required, required_documents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [s.name, s.provider, s.type, s.description, s.benefit, s.deadline, s.official_link,
          s.allowed_states, s.allowed_categories, s.allowed_education, s.gender, s.max_income, s.min_marks,
          s.min_age, s.max_age, s.disability_required, s.required_documents]
      );
    }
    console.log(`Seeded ${sampleSchemes.length} sample schemes`);
  }
}

// Called once by index.js before the server starts listening.
// Everything runs in one transaction: if anything fails, nothing half-done is saved.
async function initDb() {
  await transaction(async (client) => {
    // If two copies of the server start at the same moment (e.g. during a
    // Render deploy), this lock makes the second one wait for the first.
    await client.query('SELECT pg_advisory_xact_lock(20261018)');
    await client.query(CREATE_TABLES);
    await seed(client);
  });
  console.log('Connected to PostgreSQL, tables are ready');
}

module.exports = { get, all, run, transaction, initDb, pool };
