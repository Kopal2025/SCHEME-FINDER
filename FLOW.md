# How the application works

This document follows one student, **Priya**, through the whole app, and then the **admin**.
At every step it shows the full path a request takes:

> **Page + JS file → `fetch()` request → Express route + middleware → SQL on a table → JSON reply → how the page updates**

---

## 1. The big picture

```
 ┌─────────────────────────── BROWSER ───────────────────────────┐
 │  HTML page (e.g. schemes.html)                                 │
 │     + page script (schemes.js)                                 │
 │     + api.js  ── api('/schemes?type=welfare')                  │
 │                    adds header  Authorization: Bearer <token>  │
 │  localStorage: token, user                                     │
 └───────────────┬───────────────────────────────▲────────────────┘
                 │  HTTP request (JSON)           │  HTTP response (JSON)
                 ▼                                │
 ┌──────────────────────── EXPRESS SERVER (server/) ──────────────┐
 │  index.js                                                      │
 │    express.static('public')  → sends the HTML/CSS/JS files     │
 │    express.json()            → turns the JSON body into req.body│
 │    /api/auth          → routes/auth.js                         │
 │    /api/profile       → routes/profile.js                      │
 │    /api/schemes       → routes/schemes.js  ── utils/eligibility│
 │    /api/applications  → routes/applications.js                 │
 │    /api/admin         → routes/admin.js                        │
 │  middleware/auth.js:  requireAuth (JWT)   requireAdmin (role)  │
 └───────────────┬───────────────────────────────▲────────────────┘
                 │  SQL through better-sqlite3    │  rows (JS objects)
                 ▼                                │
 ┌──────────────────────── SQLITE (data.sqlite) ──────────────────┐
 │  users   profiles   schemes   applications   document_checklist │
 └────────────────────────────────────────────────────────────────┘
```

- **One server does everything.** Express sends the HTML/CSS/JS files from `public/` *and* answers the
  `/api/...` requests. That's why everything runs on `http://localhost:3000` with `npm start`.
- **Pages never touch the database.** They only call the API with `fetch()`. The server is the
  only part that runs SQL.
- **Every API reply is JSON**: either data, or `{ "error": "message" }` with a status code.
- **`public/js/api.js` is loaded first on every page.** Its `api()` function is the only place that
  calls `fetch()`. It adds the token, turns the reply into JSON, and throws an `Error` with the server's
  message if something went wrong. So each page just does:

```js
try {
  const data = await api('/profile', 'PUT', profile);  // send
  showToast('Profile saved ✓');                        // success
} catch (err) {
  showError(err.message);                              // e.g. "Marks must be between 0 and 100."
}
```

### The database tables

| Table | One row means | Key columns |
|---|---|---|
| `users` | an account | `id`, `name`, `email` (unique), `password_hash`, `role` (`user`/`admin`) |
| `profiles` | one user's eligibility details | `user_id` (primary key), `date_of_birth`, `gender`, `state`, `category`, `annual_income`, `education_level`, `marks_percent`, `has_disability` |
| `schemes` | a scholarship or welfare scheme | details + rules: `allowed_states`, `allowed_categories`, `allowed_education` (comma-separated text, empty = no limit), `gender`, `max_income`, `min_marks`, `min_age`, `max_age`, `disability_required`, `required_documents` |
| `applications` | "this user is tracking this scheme" | `user_id`, `scheme_id` (unique pair), `status`, `updated_at` |
| `document_checklist` | one ticked/unticked document | `user_id`, `scheme_id`, `document_name`, `is_done` |

`applications` and `document_checklist` use `ON DELETE CASCADE`. When a scheme or user is deleted,
SQLite deletes their rows automatically. `db.js` turns this on with `PRAGMA foreign_keys = ON`.

---

## 2. How login works (the JWT token)

A **JWT** (JSON Web Token) is a signed piece of text that says "this is user 7, Priya, role user".
The server signs it with `JWT_SECRET`. Nobody can change it without breaking the signature.

| Stage | Where | What happens |
|---|---|---|
| **Created** | `routes/auth.js` → `createToken()` | After a correct register or login: `jwt.sign({ id, name, role }, JWT_SECRET, { expiresIn: '1d' })`. |
| **Stored** | `api.js` → `saveLogin()` | The browser saves it: `localStorage.setItem('token', ...)` and the user object as `user`. |
| **Sent** | `api.js` → `api()` | Every request adds the header `Authorization: Bearer <token>`. |
| **Verified** | `middleware/auth.js` → `requireAuth` | Reads the header and runs `jwt.verify(token, JWT_SECRET)`. If the signature or expiry is wrong it sends **401**. If it's OK it sets `req.user = { id, name, role }` and calls `next()`. |
| **Admin check** | `middleware/auth.js` → `requireAdmin` | Runs after `requireAuth`. If `req.user.role !== 'admin'` it sends **403**. |
| **Removed** | `api.js` → `logout()` | Deletes `token` and `user` from localStorage and goes to `index.html` with `location.replace()`. |

Things to know:
- **The server stores no sessions.** Logging out only means the browser forgets the token.
- **Pages check login too.** `requireLogin()` runs at the top of every protected page. With no
  token, it sends you to the login page. It also listens for `pageshow`, so pressing **Back** after
  logout doesn't show the old page from the browser cache.
- **Bad or expired tokens.** If the server answers 401 to a request that *had* a token, `api()`
  calls `logout()`.
- **Passwords are never stored.** `bcrypt.hashSync(password, 10)` makes a one-way hash. Login uses
  `bcrypt.compareSync(typed, stored_hash)`.

---

## 3. How eligibility matching works

File: `server/utils/eligibility.js`, function `checkEligibility(profile, scheme)`.

It goes through up to **8 rules**. A rule is only checked if the scheme has it (an empty
`allowed_states` means "all states", so it isn't checked). Each rule ends in one of three results:

| Result | Meaning | Example |
|---|---|---|
| `met` → **pass** | profile satisfies the rule | income 2,00,000 ≤ limit 2,50,000 |
| `failed` → **fail** | profile breaks the rule | category OBC, scheme is for SC only |
| `missing` → **unknown** | the profile field is empty | marks not filled in |

The 8 rules: state, category, education level, gender, family income (≤ max), marks (≥ min),
age (worked out from date of birth, between min and max) and disability.

**Status of the scheme:**
1. any rule **failed** → `not` (Not Eligible, red)
2. else any rule **missing** → `possible` (Possibly Eligible, amber)
3. else → `eligible` (Eligible, green)

A failed rule wins over a missing one. If your income is already too high, filling in your
category won't change the answer.

**Gap sentence (`summary`).** The function joins the passed rules and the problems into one
sentence:

```
met     = ['category', 'education level']
failed  = ['the family income limit is ₹2,50,000 per year (yours is ₹3,00,000)']

summary = "Your category and education level meet the requirements, but the family income
           limit is ₹2,50,000 per year (yours is ₹3,00,000)."
```

For Possibly Eligible: *"Your education level and family income meet the requirements so far. Add your
marks to your profile to confirm."* For Eligible: *"You meet every requirement (category, education level and family income)."*

It also returns **`criteria`**: one row per rule, for the scheme page:
`{ criterion: 'Family income', requirement: 'Family income up to ₹2,50,000 per year', result: 'fail', text: '...' }`.

---

## 4. Priya's journey (normal user)

### Step 1: Register
| | |
|---|---|
| **Page** | `index.html` + `js/login.js` (Register tab) |
| **Frontend check** | All fields filled, email looks like `a@b.c`, password ≥ 6 characters. Otherwise a red message appears and no request is sent. |
| **Request** | `POST /api/auth/register`<br>Body `{ "name": "Priya Sharma", "email": "priya@test.com", "password": "secret1" }`<br>No token yet. |
| **Server** | `routes/auth.js` → `router.post('/register')`. No middleware. It checks the same rules again. |
| **SQL** | `SELECT id FROM users WHERE email = ?` (is the email taken? → 409)<br>`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'user')` |
| **Reply** | `201 { "token": "eyJ...", "user": { "id": 7, "name": "Priya Sharma", "email": "...", "role": "user" } }` |
| **Page update** | `saveLogin()` stores the token and user, then `location.href = 'dashboard.html'`. While waiting, the button says "Creating account..." and is disabled. |

### Step 2: Log in (next time)
| | |
|---|---|
| **Page** | `index.html` + `js/login.js` |
| **Request** | `POST /api/auth/login`, body `{ "email": "...", "password": "..." }` |
| **Server** | `routes/auth.js` → `router.post('/login')` |
| **SQL** | `SELECT * FROM users WHERE email = ?`, then `bcrypt.compareSync()` with `password_hash` |
| **Reply** | `200 { token, user }`, or `401 { "error": "Incorrect email or password." }` (same message for an unknown email, so nobody can find out which emails exist) |
| **Page update** | Token saved, then the dashboard opens. On error the message shows above the form. |

### Step 3: Dashboard
| | |
|---|---|
| **Page** | `dashboard.html` + `js/dashboard.js` |
| **Request** | Four requests at once with `Promise.all`, all with the token:<br>`GET /api/auth/me` · `GET /api/profile` · `GET /api/schemes?match=eligible` · `GET /api/schemes/deadlines` |
| **Server** | `requireAuth` runs first on each one. They are the same routes described in the steps below, reused. |
| **Page update** | "Welcome, Priya Sharma 👋". **Profile complete %** = filled fields ÷ 8. **Eligible** = number of schemes returned. **Next deadlines** = first 3 of the deadline list. |

### Step 4: Fill in the profile
| | |
|---|---|
| **Page** | `profile.html` + `js/profile.js` |
| **On load** | `GET /api/profile` → `routes/profile.js`, `requireAuth`<br>SQL: `SELECT * FROM profiles WHERE user_id = ?`<br>Reply: `{ profile: { date_of_birth: null, gender: null, ... } }` (all `null` for a new user). Each value goes into the input with the same id. |
| **Frontend check** | Income is a whole number ≥ 0, marks 0–100, date of birth not in the future. |
| **Request** | `PUT /api/profile`<br>Body `{ "date_of_birth": "2005-06-15", "gender": "female", "state": "Karnataka", "category": "SC", "annual_income": "200000", "education_level": "ug", "marks_percent": "82", "has_disability": "0" }` (empty fields are sent as `""` and saved as `NULL`) |
| **Server** | `routes/profile.js` → `router.put('/')`, `requireAuth`. Validates every filled field (allowed lists, number ranges). |
| **SQL** | An "upsert", which inserts the first time and updates after that:<br>`INSERT INTO profiles (...) VALUES (...) ON CONFLICT (user_id) DO UPDATE SET date_of_birth = excluded.date_of_birth, ...` |
| **Reply** | `200 { "message": "Profile saved.", "profile": {...} }` or `400 { "error": "Marks must be a percentage between 0 and 100." }` |
| **Page update** | Button shows "Saving...", then a green toast **"Profile saved ✓"** in the corner. |

### Step 5: Browse, search and filter schemes
| | |
|---|---|
| **Page** | `schemes.html` + `js/schemes.js` |
| **How a filter travels** | 1. Priya picks **Type = Welfare**. 2. The form's `change` event calls `loadSchemes()`. 3. It reads every filter and builds `URLSearchParams` → `/api/schemes?type=welfare`. The search box waits 300 ms after the last key press. |
| **Request** | `GET /api/schemes?search=&type=welfare&provider=&state=&education=&match=` (only non-empty ones are sent) |
| **Server** | `routes/schemes.js` → `router.get('/')`, `requireAuth`. Express puts the query in `req.query`. Unknown values give 400. |
| **SQL** | Built step by step with `?` placeholders (safe from SQL injection):<br>`SELECT * FROM schemes WHERE 1 = 1 AND name LIKE ? ESCAPE '\' AND type = ? AND provider = ? ORDER BY name`<br>Then `SELECT * FROM profiles WHERE user_id = ?` |
| **In JavaScript** | **State** and **education** are comma-separated lists, so they are filtered with `.filter()`. Then `checkEligibility(profile, scheme)` runs for every scheme, and finally the **match** filter runs, because the status is calculated and not stored. |
| **Reply** | `{ "schemes": [ { ...scheme, "eligibility": { "status": "eligible", "summary": "...", "criteria": [...] } } ], "profileComplete": true }` |
| **Page update** | `renderSchemes()` builds one card per scheme: name, coloured badge, tags, benefit, deadline and the one-line reason. No results → *"No schemes match your filters."* An incomplete profile shows the amber banner. **Clear filters** resets the form and reloads. |

### Step 6: Open a scheme, see eligibility and gap reasons
| | |
|---|---|
| **Page** | `scheme.html?id=1` + `js/scheme.js` (it reads `id` from the URL) |
| **Request** | `GET /api/schemes/1` |
| **Server** | `routes/schemes.js` → `router.get('/:id')`, `requireAuth`. A bad or unknown id gives 404 "Scheme not found." |
| **SQL** | `SELECT * FROM schemes WHERE id = ?`<br>`SELECT * FROM profiles WHERE user_id = ?`<br>`SELECT document_name FROM document_checklist WHERE user_id = ? AND scheme_id = ? AND is_done = 1`<br>`SELECT status, updated_at FROM applications WHERE user_id = ? AND scheme_id = ?` |
| **Reply** | `{ scheme, eligibility: { status, summary, criteria }, documents: [ { name, is_done } ], application: { status, updated_at } \| null }` |
| **Page update** | Details card, badge, the summary sentence and the **criteria list** with ✔ / ✘ / ? for each rule (e.g. *"✘ Family income · Family income up to ₹2,50,000 per year: The family income limit is ₹2,50,000 per year (yours is ₹3,00,000)."*). |

### Step 7: "Explain in simple words"
| | |
|---|---|
| **Page** | `scheme.html` + `js/scheme.js` (the 💡 button) |
| **Request** | `GET /api/schemes/1/explain` |
| **Server** | `routes/schemes.js` → `router.get('/:id/explain')`, `requireAuth` |
| **SQL** | `SELECT * FROM schemes WHERE id = ?` and `SELECT * FROM profiles WHERE user_id = ?` |
| **Logic** | **No API key (default):** `ruleBasedExplanation()` fills sentences from the scheme row: what it is, what you get, who can apply (the `requirement` of each rule), what it means for you (the summary), the last date and the documents to keep ready.<br>**With `ANTHROPIC_API_KEY`:** sends the same facts to Claude and asks for 5–7 simple sentences. If that fails for any reason, it falls back to the rule-based text. |
| **Reply** | `{ "explanation": "line 1\nline 2\n...", "source": "rules" }` |
| **Page update** | Button shows "Explaining...", then each line becomes a paragraph in a light blue box, with a note saying where the text came from. |

### Step 8: Tick the document checklist
| | |
|---|---|
| **Page** | `scheme.html` + `js/scheme.js` |
| **Request** | Ticking "Aadhaar Card" sends `PUT /api/applications/1/documents` with body `{ "document_name": "Aadhaar Card", "is_done": true }` |
| **Server** | `routes/applications.js` → `router.put('/:schemeId/documents')`, `requireAuth`. The name must be in the scheme's `required_documents`, otherwise 400. |
| **SQL** | `INSERT INTO document_checklist (user_id, scheme_id, document_name, is_done) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, scheme_id, document_name) DO UPDATE SET is_done = excluded.is_done` |
| **Reply** | `{ "message": "Checklist updated.", ... }` |
| **Page update** | The progress text and bar update ("1 of 6 documents ready") and the item is crossed out. If saving fails, the tick is undone and an error toast appears. |

### Step 9: Set the application status
| | |
|---|---|
| **Page** | `scheme.html` + `js/scheme.js` (the status dropdown) |
| **Request** | Choosing **Applied** sends `PUT /api/applications/1` with body `{ "status": "applied" }`. Choosing **Not tracking** sends `DELETE /api/applications/1`. |
| **Server** | `routes/applications.js` → `router.put('/:schemeId')` or `router.delete('/:schemeId')`, `requireAuth` |
| **SQL** | `INSERT INTO applications (user_id, scheme_id, status, updated_at) VALUES (?, ?, ?, datetime('now','localtime')) ON CONFLICT (user_id, scheme_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`<br>or `DELETE FROM applications WHERE user_id = ? AND scheme_id = ?` |
| **Reply** | `{ "message": "Application status updated.", "status": "applied" }` |
| **Page update** | Toast **"Status saved: Applied"**. |

### Step 10: Check deadlines
| | |
|---|---|
| **Page** | `deadlines.html` + `js/deadlines.js` |
| **Request** | `GET /api/schemes/deadlines` |
| **Server** | `routes/schemes.js` → `router.get('/deadlines')`, `requireAuth`. It's written **before** `/:id`, otherwise Express would treat "deadlines" as an id. |
| **SQL** | `SELECT * FROM schemes WHERE deadline IS NOT NULL AND deadline >= ? ORDER BY deadline` (today as `'YYYY-MM-DD'`. Dates in this format sort correctly as text.)<br>`SELECT * FROM profiles WHERE user_id = ?`<br>`SELECT scheme_id, status FROM applications WHERE user_id = ?` |
| **Logic** | A scheme is kept if Priya is **Eligible** for it **or** is tracking it. The server works out `days_left`. Closed and open-all-year schemes don't appear. |
| **Reply** | `{ "deadlines": [ { id, name, deadline, days_left, eligibility_status, application_status } ] }` |
| **Page update** | One row per scheme with a date box. Rows with `days_left ≤ 7` get a red left border and a **"Closing soon"** badge. Tracked ones show a coloured status label. |

### Step 11: My Applications
| | |
|---|---|
| **Page** | `applications.html` + `js/applications.js` |
| **Request** | `GET /api/applications` |
| **Server** | `routes/applications.js` → `router.get('/')`, `requireAuth` |
| **SQL** | `SELECT a.scheme_id, a.status, a.updated_at, s.name, s.deadline, s.required_documents ... FROM applications a JOIN schemes s ON s.id = a.scheme_id WHERE a.user_id = ? ORDER BY a.updated_at DESC`<br>plus, for each row, the ticked documents from `document_checklist` |
| **Reply** | `{ "applications": [ { scheme_id, name, status, deadline, updated_at, docs_done: 1, docs_total: 6 } ] }` |
| **Page update** | One row each: name, status label, deadline, "1 of 6 ready", a status dropdown (`PUT /api/applications/:id`) and **Remove** (asks for confirmation, then `DELETE /api/applications/:id`). An empty list shows a friendly message. |

### Step 12: Log out
| | |
|---|---|
| **Page** | Any page, using the **Logout** button in the navbar (the handler is in `api.js`) |
| **Request** | None. The server keeps no session, so there is nothing to tell it. |
| **Page update** | `logout()` removes `token` and `user` from localStorage and calls `location.replace('index.html')`. Pressing Back runs `requireLogin()`'s `pageshow` check, which sends you to the login page again. |

---

## 5. The admin's journey

### Step A1: Admin logs in
Same as Step 2 with `admin@test.com`. The token now contains `role: "admin"`.
`api.js` sees `getUser().role === 'admin'` and shows the hidden **Admin** link in the navbar.

### Step A2: Admin dashboard counts and table
| | |
|---|---|
| **Page** | `admin.html` + `js/admin.js`. A normal user who opens this page is sent to the dashboard, but that check is only for convenience. |
| **Request** | `GET /api/admin/stats` and `GET /api/admin/schemes` |
| **Server** | `routes/admin.js`. `router.use(requireAuth, requireAdmin)` at the top protects **every** route in the file. A normal user's token gets **403 "Only admins can do this."**, even if they call the URL with curl. |
| **SQL** | `SELECT COUNT(*) AS count FROM users WHERE role = 'user'` (and the same for `schemes` and `applications`)<br>`SELECT * FROM schemes ORDER BY id DESC` |
| **Reply** | `{ "users": 3, "schemes": 12, "applications": 4 }` and `{ "schemes": [...] }` |
| **Page update** | Three count cards and a table with Edit / Delete buttons. |

### Step A3: Add a scheme
| | |
|---|---|
| **Page** | Click **+ Add scheme** and an empty form opens (`editingId = null`). |
| **Frontend check** | Name ≥ 3 characters, link starts with http(s), min age ≤ max age, marks 0–100. |
| **Request** | `POST /api/admin/schemes`<br>Body `{ "name": "...", "provider": "private", "type": "scholarship", "deadline": "2026-12-31", "allowed_states": ["Karnataka"], "allowed_categories": [], "allowed_education": ["ug"], "gender": "female", "max_income": "500000", "required_documents": "Aadhaar Card, Marksheet", ... }` |
| **Server** | `validateScheme()` checks every field and joins the arrays into comma-separated text (`"Karnataka"`, `"ug"`, `"Aadhaar Card,Marksheet"`). |
| **SQL** | `INSERT INTO schemes (name, provider, type, ..., required_documents) VALUES (@name, @provider, @type, ..., @required_documents)` |
| **Reply** | `201 { "message": "Scheme added.", "id": 13 }` or `400 { "error": "..." }`, which is shown inside the form |
| **Page update** | Toast **"Scheme added"**, the form closes, and the table and counts reload. |

### Step A4: Edit a scheme
| | |
|---|---|
| **Page** | **Edit** fills the form from the scheme already loaded (`editingId = 13`), including the ticked boxes and selected states. |
| **Request** | `PUT /api/admin/schemes/13` with the same body shape as Add |
| **SQL** | `UPDATE schemes SET name = @name, ..., required_documents = @required_documents WHERE id = @id` (`result.changes === 0` → 404) |
| **Page update** | Toast **"Scheme updated"**, and the table reloads. |

### Step A5: Delete a scheme
| | |
|---|---|
| **Page** | **Delete** → `confirm()` popup → button shows "Deleting..." |
| **Request** | `DELETE /api/admin/schemes/13` |
| **SQL** | `DELETE FROM schemes WHERE id = ?`. **ON DELETE CASCADE** also removes that scheme's rows in `applications` and `document_checklist`. |
| **Page update** | Toast **"Scheme deleted"**, and the table and counts reload. |

### Step A6: The change is visible to normal users
Nothing extra is needed. Normal users' pages always read the `schemes` table fresh. The next time
Priya opens **Schemes**, `GET /api/schemes` runs `SELECT * FROM schemes ...` again. The new or edited
scheme appears, `checkEligibility()` runs on it with her profile, and she sees the right badge and
reason. A deleted scheme disappears from her list, her deadlines and her applications.

---

## 6. Errors and edge cases, end to end

| Situation | What happens |
|---|---|
| Wrong input (empty field, marks 150...) | Frontend check shows a message with no request. If a request is sent anyway, the server's validation replies 400 `{ error }`, which `api()` throws and the page shows. |
| Not logged in | Page: `requireLogin()` redirects. API: `requireAuth` replies 401. |
| Token expired or edited | `jwt.verify` fails → 401 → `api()` calls `logout()` → login page. |
| Normal user calls an admin URL | `requireAdmin` → 403. |
| Scheme id doesn't exist | 404 "Scheme not found.", shown on the page with a link back. |
| Server is stopped | `fetch()` itself fails. `api()` turns that into *"Cannot reach the server. Please check that it is running and try again."* |
| Broken JSON body (e.g. from curl) | The error handler in `index.js` replies 400 "The request body is not valid JSON." |
| HTML typed into a scheme name | Pages use `escapeHtml()` / `textContent`, so it shows as text and never runs. |
| `%` or `_` typed in search | Escaped, so they are searched as normal characters. |
