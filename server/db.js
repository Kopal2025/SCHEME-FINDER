// db.js
// Opens the SQLite database file (data.sqlite), creates all tables if they
// don't exist yet, and inserts seed data the first time the app runs.
// Every route file does `const db = require('../db')` to use the same connection.

const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// The database is a single file in the project root
const db = new Database(path.join(__dirname, '..', 'data.sqlite'));

// SQLite does not enforce foreign keys unless we turn this on
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// 1. CREATE TABLES
// List-type columns (allowed_states, allowed_categories, ...) are stored as
// comma-separated text, e.g. "SC,ST". An empty value means "no restriction".
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One profile row per user. Every field is optional, because a user may
  -- fill the profile partly (then schemes show "Possibly Eligible").
  CREATE TABLE IF NOT EXISTS profiles (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    date_of_birth   TEXT,     -- 'YYYY-MM-DD'
    gender          TEXT,     -- 'male' | 'female' | 'other'
    state           TEXT,     -- e.g. 'Karnataka'
    category        TEXT,     -- 'General' | 'OBC' | 'SC' | 'ST' | 'EWS'
    annual_income   INTEGER,  -- family income in rupees per year
    education_level TEXT,     -- 'class10' | 'class12' | 'diploma' | 'ug' | 'pg'
    marks_percent   REAL,     -- last exam percentage
    has_disability  INTEGER   -- 1 = yes, 0 = no
  );

  CREATE TABLE IF NOT EXISTS schemes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    provider            TEXT NOT NULL CHECK (provider IN ('government', 'private')),
    type                TEXT NOT NULL CHECK (type IN ('scholarship', 'welfare')),
    description         TEXT,
    benefit             TEXT,
    deadline            TEXT,               -- 'YYYY-MM-DD', NULL = open all year
    official_link       TEXT,
    -- eligibility rules (empty / NULL = no restriction)
    allowed_states      TEXT DEFAULT '',    -- e.g. 'Karnataka'
    allowed_categories  TEXT DEFAULT '',    -- e.g. 'SC,ST'
    allowed_education   TEXT DEFAULT '',    -- e.g. 'ug,pg'
    gender              TEXT DEFAULT 'any', -- 'any' | 'female' | 'male'
    max_income          INTEGER,
    min_marks           REAL,
    min_age             INTEGER,
    max_age             INTEGER,
    disability_required INTEGER DEFAULT 0,  -- 1 = only for persons with disability
    required_documents  TEXT DEFAULT ''     -- e.g. 'Aadhaar Card,Income Certificate'
  );

  CREATE TABLE IF NOT EXISTS applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheme_id  INTEGER NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'saved'
               CHECK (status IN ('saved', 'applied', 'under_review', 'approved', 'rejected')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, scheme_id)   -- one application row per user per scheme
  );

  CREATE TABLE IF NOT EXISTS document_checklist (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheme_id     INTEGER NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    document_name TEXT NOT NULL,
    is_done       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, scheme_id, document_name)
  );
`);

// ---------------------------------------------------------------------------
// 2. SEED DATA
// ---------------------------------------------------------------------------

// Returns a date N days from today as 'YYYY-MM-DD' (local time).
function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Admin account: admin@test.com / admin123 (created only if it doesn't exist)
const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@test.com');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run('Admin', 'admin@test.com', hash);
  console.log('Seeded admin account: admin@test.com / admin123');
}

// Sample student account with a filled profile, for demos and testing:
// student@test.com / student123
const studentExists = db.prepare('SELECT id FROM users WHERE email = ?').get('student@test.com');
if (!studentExists) {
  const hash = bcrypt.hashSync('student123', 10);
  const result = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'user')")
    .run('Priya Sharma', 'student@test.com', hash);
  db.prepare(`
    INSERT INTO profiles (user_id, date_of_birth, gender, state, category, annual_income,
                          education_level, marks_percent, has_disability)
    VALUES (?, '2005-06-15', 'female', 'Karnataka', 'SC', 200000, 'ug', 82, 0)
  `).run(result.lastInsertRowid);
  console.log('Seeded sample student: student@test.com / student123');
}

// SAMPLE DATA: these schemes are based on real Indian schemes, but the
// amounts, limits and deadlines are simplified for this project and may not
// match the official rules. Always check the official link.
// Deadlines are set relative to the day the database is first created, so
// some are always upcoming. Delete data.sqlite and restart to re-seed.
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

// Insert sample schemes only if the schemes table is empty
const schemeCount = db.prepare('SELECT COUNT(*) AS count FROM schemes').get().count;
if (schemeCount === 0) {
  const insertScheme = db.prepare(`
    INSERT INTO schemes (name, provider, type, description, benefit, deadline, official_link,
      allowed_states, allowed_categories, allowed_education, gender, max_income, min_marks,
      min_age, max_age, disability_required, required_documents)
    VALUES (@name, @provider, @type, @description, @benefit, @deadline, @official_link,
      @allowed_states, @allowed_categories, @allowed_education, @gender, @max_income, @min_marks,
      @min_age, @max_age, @disability_required, @required_documents)
  `);
  for (const scheme of sampleSchemes) {
    insertScheme.run(scheme);
  }
  console.log(`Seeded ${sampleSchemes.length} sample schemes`);
}

module.exports = db;
