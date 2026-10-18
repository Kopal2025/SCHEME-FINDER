# Scholarship & Welfare Scheme Finder

A web app that helps students and families find government and private scholarships and
welfare schemes they are eligible for. You fill in your details once (age, state, category,
income, education, marks, disability). The app checks every scheme and labels it
**Eligible**, **Possibly Eligible** or **Not Eligible**, and explains why in plain sentences.

Web Technology course project, built with **Node.js + Express + PostgreSQL + plain HTML/CSS/JavaScript**.

- How the whole app works, step by step: [FLOW.md](FLOW.md)
- Full test checklist and results: [TESTING.md](TESTING.md)

---

## 1. Setup

You need **Node.js 20 or newer** (we used Node 24; check with `node -v`) and a **PostgreSQL** database.

```bash
# 1. Install the packages listed in package.json
npm install

# 2. Create your .env file from the example
copy .env.example .env      # Windows
cp .env.example .env        # Mac / Linux

# 3. Open .env and set DATABASE_URL (your PostgreSQL URL) and JWT_SECRET (any long random text)

# 4. Start the server
npm start
```

Open **http://localhost:3000** in your browser.

The data is stored in **PostgreSQL**. On the first start the server creates all the tables and adds
12 sample schemes and the two test accounts below. Later starts keep everything that is already there.
If `DATABASE_URL` is missing, the server stops with a clear error message.

**Which database to use on your laptop:** the simplest option is the **External Database URL** of your
Render database (Render dashboard → your database → *Connections*). Your laptop and the live site then
share the same data. You can also install PostgreSQL locally. If you do, create the database with UTF-8
encoding (`CREATE DATABASE schemefinder ENCODING 'UTF8' TEMPLATE template0;`), because the scheme data
contains the ₹ symbol.

### `.env` settings

| Variable | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection URL, e.g. `postgres://user:password@host:5432/dbname`. Keep it secret. SSL is turned on automatically for Render's external URL (`...render.com`), or set `DATABASE_SSL=true` for another host that needs SSL. |
| `JWT_SECRET` | Yes | Secret used to sign login tokens. If it is missing, a default dev secret is used and a warning is printed. |
| `PORT` | No | Port to run on (default `3000`). |
| `ANTHROPIC_API_KEY` | No | Only for the "Explain in simple words" button. Without it, the app uses a rule-based explanation. Everything works without a key. |

### Deploying online (Render, free)

1. Push this project to a GitHub repository (`.env` and `node_modules` are not uploaded, see `.gitignore`).
2. On [render.com](https://render.com): **New → PostgreSQL** → create a free database.
3. **New → Web Service** → pick the repository. Settings: **Language** Node · **Build command** `npm install` ·
   **Start command** `npm start` · **Instance type** Free.
4. **Environment variables** of the web service:
   - `DATABASE_URL` = the database's **Internal Database URL** (database page → *Connections*)
   - `JWT_SECRET` = any long random text (Render's **Generate** button works)
   - `PORT` is set by Render automatically. Add `ANTHROPIC_API_KEY` only if you want the AI explanation.
5. Click **Deploy**. When the log shows `Connected to PostgreSQL, tables are ready` and `Server running`,
   open the `https://<name>.onrender.com` link.

**Good to know about the free plan:**
- Accounts, profiles, applications and checklists are stored in PostgreSQL, so they **survive restarts
  and new deploys**.
- After being idle, the first visit takes about 50 seconds while the app wakes up. Open the link a
  minute before a demo.
- Render's free PostgreSQL databases have an expiry date. Check it on the database's page in the Render
  dashboard and plan your demo before then.
- The sample deadlines are set relative to the day the schemes were first inserted. After a few weeks they
  will have passed. The admin can update them on the Admin page.

## 2. Test accounts

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin@test.com` | `admin123` | Can open the Admin page to add, edit and delete schemes. |
| Student | `student@test.com` | `student123` | Priya Sharma: female, Karnataka, SC, income ₹2,00,000, UG, 82%, no disability. Eligible for 8 of the 12 schemes. |

You can also register a new account from the login page.

> The 12 schemes are **sample data** based on real Indian schemes. Amounts and rules are
> simplified, so always check the official website. Deadlines are set relative to the day the
> database was created, so some are always upcoming.

## 3. Folder structure

```
WEBTECH PROJECT/
├── package.json            Project info, dependencies and the "npm start" script
├── .env.example            Example settings; copy to .env
├── README.md               This file
├── FLOW.md                 How the app works from browser to database and back
├── TESTING.md              Test checklist with results
│
├── server/
│   ├── index.js            Starts Express, serves /public, mounts all /api routes, handles errors
│   ├── db.js               Connects to PostgreSQL (DATABASE_URL), creates the 5 tables, inserts seed data
│   ├── middleware/
│   │   └── auth.js         requireAuth (checks the JWT) and requireAdmin (checks role = admin)
│   ├── routes/
│   │   ├── auth.js         Register, login and "who am I"
│   │   ├── profile.js      Read and save the user's eligibility profile
│   │   ├── schemes.js      Scheme list with search + filters, scheme details, deadlines, explanation
│   │   ├── applications.js Application status per scheme and the document checklist
│   │   └── admin.js        Admin-only: counts, and add / edit / delete schemes
│   └── utils/
│       └── eligibility.js  Compares a profile with a scheme: status, gap sentences, criteria list
│
└── public/                 Everything the browser loads (served by Express)
    ├── index.html          Login / register page
    ├── dashboard.html      Profile completion %, eligible count, next 3 deadlines
    ├── profile.html        Profile form
    ├── schemes.html        Search, filters and scheme cards with eligibility badges
    ├── scheme.html         One scheme: details, criteria check, explain, status, checklist
    ├── deadlines.html      Upcoming deadlines, closest first, "closing soon" highlight
    ├── applications.html   My Applications: status and document progress per scheme
    ├── admin.html          Admin dashboard: counts, scheme table, add/edit form
    ├── css/
    │   └── style.css       The only stylesheet (design variables at the top)
    └── js/
        ├── api.js          Shared helpers: fetch wrapper with token, login state, toast, labels
        ├── login.js        Login + register forms
        ├── dashboard.js    Loads the dashboard numbers
        ├── profile.js      Loads and saves the profile form
        ├── schemes.js      Reads the filters, calls the API, draws the cards
        ├── scheme.js       Scheme detail page: checklist, status, explain button
        ├── deadlines.js    Draws the deadline list
        ├── applications.js Draws My Applications, changes status, removes
        └── admin.js        Admin counts, table, add / edit / delete form
```

## 4. API endpoints

All endpoints start with `/api` and send and receive JSON.
"Auth" means the request must include the header `Authorization: Bearer <token>`.

### Auth: `server/routes/auth.js`
| Method | URL | Auth | What it does |
|---|---|---|---|
| POST | `/api/auth/register` | No | Body `{ name, email, password }`. Creates a user and returns `{ token, user }`. |
| POST | `/api/auth/login` | No | Body `{ email, password }`. Checks the password and returns `{ token, user }`. |
| GET | `/api/auth/me` | User | Returns the logged-in user's id, name, email and role. |

### Profile: `server/routes/profile.js`
| Method | URL | Auth | What it does |
|---|---|---|---|
| GET | `/api/profile` | User | Returns the user's profile (all fields `null` if not saved yet). |
| PUT | `/api/profile` | User | Saves the profile (insert or update). Every field is optional and is validated. |

### Schemes: `server/routes/schemes.js`
| Method | URL | Auth | What it does |
|---|---|---|---|
| GET | `/api/schemes?search=&type=&provider=&state=&education=&match=` | User | All schemes matching the filters, each with an `eligibility` object `{ status, summary, criteria }`. |
| GET | `/api/schemes/deadlines` | User | Upcoming deadlines (today or later) for schemes the user is eligible for or tracking, closest first. |
| GET | `/api/schemes/:id` | User | One scheme with eligibility, document checklist and application status. |
| GET | `/api/schemes/:id/explain` | User | "Explain in simple words" text. Uses rules, or Claude if `ANTHROPIC_API_KEY` is set. |

### Applications + checklist: `server/routes/applications.js`
| Method | URL | Auth | What it does |
|---|---|---|---|
| GET | `/api/applications` | User | The user's tracked schemes with status and documents done / total. |
| PUT | `/api/applications/:schemeId` | User | Body `{ status }` (saved / applied / under_review / approved / rejected). Sets the status. |
| DELETE | `/api/applications/:schemeId` | User | Stops tracking the scheme. |
| PUT | `/api/applications/:schemeId/documents` | User | Body `{ document_name, is_done }`. Ticks or unticks one document. |

### Admin: `server/routes/admin.js`
| Method | URL | Auth | What it does |
|---|---|---|---|
| GET | `/api/admin/stats` | Admin | Counts of users, schemes and applications. |
| GET | `/api/admin/schemes` | Admin | Every scheme with all its columns. |
| POST | `/api/admin/schemes` | Admin | Adds a scheme (validated). |
| PUT | `/api/admin/schemes/:id` | Admin | Updates a scheme (validated). |
| DELETE | `/api/admin/schemes/:id` | Admin | Deletes a scheme, along with its applications and checklists. |

Error responses always look like `{ "error": "message" }`, with status 400 (bad input),
401 (not logged in / bad token), 403 (not an admin), 404 (not found) or 409 (email already used).

## 5. Tech stack

| Part | What we used |
|---|---|
| Server | Node.js + Express 5 |
| Database | PostgreSQL through the `pg` package (on Render: a Render PostgreSQL database) |
| Passwords | `bcryptjs` (hashing) |
| Login sessions | `jsonwebtoken` (JWT in the `Authorization` header) |
| Settings | `dotenv` (reads `.env`) |
| Optional AI | `@anthropic-ai/sdk` (only used when `ANTHROPIC_API_KEY` is set) |
| Frontend | Plain HTML, one CSS file, vanilla JavaScript with `fetch()`, Inter font from Google Fonts |
