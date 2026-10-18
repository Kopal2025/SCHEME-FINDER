# Test checklist

**How to use this file:** start the app with `npm start`, then go through each table. Write ✅ or ❌
in the last column. Test accounts: `student@test.com` / `student123` and `admin@test.com` / `admin123`.

**Results column, as filled in on the last run (17 Oct 2026):**
- ✅ **API**: checked automatically by calling the endpoints directly
- ✅ **Browser**: checked automatically in headless Chrome (the real pages, real clicks through the DOM)
- ☐ **Manual**: needs a person looking at the screen (listed again at the end)

The sample deadlines are set relative to the day `data.sqlite` was created, so "3 days left" etc.
will differ on a newer database. The *order* and the *closing soon* rule stay the same.

---

## 1. Authentication

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| A01 | Register | Register tab → name "Test User", new email, password `secret1` → Create account | Goes to dashboard, shows "Welcome, Test User 👋" | ✅ API + Browser |
| A02 | Register, duplicate email | Register again with `student@test.com` (also try `STUDENT@test.com`) | "An account with this email already exists." Button goes back to "Create account" | ✅ API + Browser |
| A03 | Register, invalid email | Email `bad-email` | "Please enter a valid email address." | ✅ API + Browser |
| A04 | Register, short password | Password `123` | "Password must be at least 6 characters." | ✅ API + Browser |
| A05 | Register, empty fields | Click Create account with nothing filled | "Please fill in all the fields." | ✅ API + Browser |
| A06 | Login, empty fields | Click Login with nothing filled | "Please enter both email and password." | ✅ API + Browser |
| A07 | Login, wrong password | `student@test.com` / `wrong123` | "Incorrect email or password." | ✅ API + Browser |
| A08 | Login, unknown email | `nobody@test.com` / anything | Same message as A07 (doesn't reveal which emails exist) | ✅ API |
| A09 | Login success | `student@test.com` / `student123` | Dashboard opens, "Welcome, Priya Sharma 👋" | ✅ API + Browser |
| A10 | Login, email in capitals | `STUDENT@Test.com` / `student123` | Logs in | ✅ API |
| A11 | Protected page without login | Log out, then type `localhost:3000/dashboard.html` (also profile, schemes, scheme, deadlines, applications, admin) | Sent to the login page every time | ✅ Browser |
| A13 | Invalid token | Logged in → DevTools → Application → Local Storage → change `token` to `abc` → refresh | Logged out and sent to the login page | ✅ API + Browser |
| A14 | Expired token | Use a token whose 1-day expiry has passed | API replies 401 "Your session has expired. Please log in again." → login page | ✅ API |
| A15 | Logout | Click Logout on any page | Login page opens. `token` and `user` are gone from Local Storage | ✅ Browser |
| A16 | Back button after logout | After A15 press the browser Back button | Stays on / returns to the login page, not the old page | ✅ Browser |
| A17 | Login page while logged in | While logged in, open `localhost:3000` | Goes straight to the dashboard | ✅ Browser |
| A18 | API without token | `curl localhost:3000/api/profile` | 401 `{"error":"Please log in first."}` | ✅ API |
| A19 | Loading state | Click Login | Button shows "Logging in..." and is disabled until the reply arrives | ✅ Browser (slow network simulated) |
| A20 | Who am I | `GET /api/auth/me` with token | Returns name, email, role. Never the password hash | ✅ API |

## 2. Profile

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| P01 | New profile | New user opens Profile | All fields empty, "Loading your profile..." disappears | ✅ API + Browser |
| P02 | Save full profile | Fill all 8 fields (DOB 2005-06-15, Female, Karnataka, SC, 200000, UG, 82, No) → Save → refresh | Toast "Profile saved ✓". After refresh every value is still there | ✅ API + Browser |
| P03 | Save partial profile | Fill only gender, state, income, education → Save | Saves, toast shown. Other fields stay empty | ✅ API + Browser |
| P04 | Negative income | Income `-5` → Save | "Annual income must be a whole number of rupees (0 or more)." | ✅ API + Browser |
| P05 | Text income | Type letters in the income box → Save (API: send `"abc"`) | "Annual income must be a number." / API 400 | ✅ API · ☐ Manual (typing letters) |
| P06 | Marks above 100 | Marks `150` → Save | "Marks must be a percentage between 0 and 100." | ✅ API + Browser |
| P07 | Future date of birth | DOB in 2099 | "Date of birth cannot be in the future." | ✅ API |
| P08 | Decimal income | Income `1000.5` | Error, not saved | ✅ API |
| P09 | Invalid dropdown values | Send category `XYZ`, education `phd`, gender `robot` to the API | 400 for each | ✅ API |

## 3. Eligibility matching

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| M01 | Fully eligible | Full profile from P02 → Schemes | Post Matric SC = green **Eligible**, "You meet every requirement (category, education level and family income)." No profile banner | ✅ API + Browser |
| M02 | Possibly eligible | New user with an empty profile → Schemes | All 12 amber **Possibly Eligible**, e.g. "Add your category, education level and family income to your profile to confirm." | ✅ API |
| M03 | Not eligible + gap reason | Profile: Female, Karnataka, SC, income 300000, UG → Schemes | Post Matric SC = red **Not Eligible**: "Your category and education level meet the requirements, but the family income limit is ₹2,50,000 per year (yours is ₹3,00,000)." | ✅ API + Browser |
| M04 | Two reasons | Male, General, 900000, UG → AICTE Pragati | Reason mentions both "only for female applicants" and "₹8,00,000" | ✅ API |
| M05 | Updates after editing | Change category SC → ST, save, reopen Schemes | Post Matric SC becomes Not Eligible ("only for the SC category"), Post Matric ST becomes Eligible | ✅ API |
| M06 | Age rule | DOB that makes you 16 → PM-KISAN | Not Eligible "...aged 18 or above (you are 16)" | ✅ API |
| M07 | Disability rule | Disability No → AICTE Saksham, then Yes | No → Not Eligible, Yes → Eligible | ✅ API |
| M08 | Profile reminder | Incomplete profile → Schemes | Amber banner "Your profile is not complete..." with link. Hidden when complete | ✅ API + Browser |

## 4. Search and filters (logged in as the student)

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| S01 | No filters | Open Schemes | 12 cards, "12 schemes found" | ✅ API + Browser |
| S02 | Search | Type `aicte` (also `AICTE`) | 2 cards (Pragati, Saksham), updates while typing | ✅ API + Browser |
| S03 | Type filter | Type = Welfare | 2 cards (PM-KISAN, Ayushman Bharat) | ✅ API + Browser |
| S04 | Provider filter | Provider = Private | 3 cards (HDFC, Reliance, Kotak) | ✅ API |
| S05 | State filter | State = Kerala | 11 cards. Karnataka SSP is hidden | ✅ API + Browser |
| S06 | Education filter | Education = Class 10 | 3 cards (NMMS + the 2 welfare schemes, which have no education rule) | ✅ API |
| S07 | Match filter | Match = Eligible, then Not Eligible | 8 green cards, then 4 red cards | ✅ API |
| S08 | Combined filters | Scholarship + Private + Not Eligible | Only Kotak Kanya Scholarship | ✅ API + Browser |
| S09 | No results | Search `zzzz` | "No schemes match your filters." and "0 schemes found" | ✅ API + Browser |
| S10 | Clear filters | Click Clear filters | Back to 12 cards | ✅ Browser |
| S11 | Bad filter values | `GET /api/schemes?type=abc` (also provider, education, match) | 400 error | ✅ API |
| S12 | Wildcard characters | Search `%` or `_` | 0 results (treated as normal text) | ✅ API |
| S13 | SQL text in search | Search `' OR 1=1 --` | 0 results, no error | ✅ API |

## 5. Scheme detail page

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| D01 | Details | Click "View details" on Post Matric SC | Name, badge, tags, description, benefit, deadline, "Official website ↗" (opens in a new tab) | ✅ Browser |
| D02 | Criteria list | Profile without marks → Central Sector scheme | ✔ Education level, ✔ Family income, ? Marks ("Add your marks to your profile.") | ✅ API |
| D03 | Invalid id | Open `scheme.html?id=abc` | "Scheme not found. Go back to the schemes list..." | ✅ API + Browser |
| D04 | Unknown id | Open `scheme.html?id=9999` | "Scheme not found..." | ✅ API + Browser |
| D05 | No id | Open `scheme.html` | "No scheme selected..." | ✅ Browser |
| D06 | Tick a document | Tick "Aadhaar Card" → refresh | "1 of 6 documents ready", still ticked after refresh | ✅ API + Browser |
| D07 | Untick | Untick it → refresh | Stays unticked | ✅ API |
| D08 | Bad checklist request | API: document "Passport", or `is_done: "yes"`, or scheme 9999 | 400 / 400 / 404 | ✅ API |
| D09 | Status change | Status = Applied → refresh | Toast "Status saved: Applied", still Applied after refresh | ✅ API + Browser |
| D10 | Not tracking | Status = Not tracking | Toast "Removed from My Applications". Scheme gone from My Applications | ✅ API |
| D11 | Bad status | API: status `won` | 400 | ✅ API |
| D12 | Explain (no API key) | Click 💡 Explain in simple words | "Explaining..." then about 7 short lines + "Generated from the scheme details." | ✅ API + Browser |
| D13 | Explain, special deadlines | Explain NMMS, then PM-KISAN | NMMS: "...has already passed". PM-KISAN: "You can apply at any time of the year." | ✅ API |

## 6. Deadlines

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| DL01 | Sorted | Student → Deadlines | Closest date first (AICTE Pragati at the top) | ✅ API + Browser |
| DL02 | Which schemes | Track a scheme you're not eligible for | It appears with its status label. Schemes that are neither eligible nor tracked don't | ✅ API + Browser |
| DL03 | Closing soon | Look at rows with ≤ 7 days left | Red left border + "Closing soon" badge. Rows with more days have neither | ✅ Browser |
| DL04 | Expired hidden | Save NMMS (closed) | Doesn't appear on Deadlines | ✅ API |
| DL05 | Open all year hidden | Student is eligible for PM-KISAN | PM-KISAN doesn't appear (no deadline) | ✅ API |
| DL06 | Empty state | New user with an empty profile → Deadlines | "No upcoming deadlines yet..." with links | ✅ Browser (dashboard) |

## 7. My Applications

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| AP01 | List | Set Applied + tick 1 document on Post Matric SC → My Applications | Row with blue "Applied" label, deadline, "1 of 6 ready", updated date | ✅ API + Browser |
| AP02 | Change status here | Change dropdown to Under review | Toast, label turns amber, still there after refresh | ✅ Browser |
| AP03 | Remove | Click Remove → OK | Row disappears. Scheme page shows "Not tracking this scheme" | ✅ API + Browser |
| AP04 | Empty state | New user → My Applications | "You are not tracking any schemes yet..." | ✅ API + Browser |
| AP05 | Privacy | Log in as a second user | Doesn't see the first user's applications or ticks | ✅ API |

## 8. Admin

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| AD01 | No admin link for users | Log in as student | No "Admin" in the navbar | ✅ Browser |
| AD02 | Users can't open admin page | Student types `localhost:3000/admin.html` | Sent to the dashboard | ✅ Browser |
| AD03 | Users can't call admin API | With the student's token, call GET `/api/admin/stats`, GET/POST `/api/admin/schemes`, PUT/DELETE `/api/admin/schemes/1` | All 403 "Only admins can do this." Scheme 1 unchanged | ✅ API |
| AD04 | No token | `curl localhost:3000/api/admin/stats` | 401 | ✅ API |
| AD05 | Forged token | Token saying `role: admin` signed with a wrong secret | 401 | ✅ API |
| AD06 | Admin dashboard | Log in as admin → Admin | Admin link visible. Counts for users / schemes (12) / applications. Table with 12 rows | ✅ API + Browser |
| AD07 | Missing fields | + Add scheme → Save with an empty name | "Please enter a scheme name (at least 3 characters)." API without provider → "Provider must be..." | ✅ API + Browser |
| AD08 | Invalid values | Min age 30 > max age 20, link `javascript:...`, marks 150, income −1, bad date, bad category | Error message for each, nothing saved | ✅ API + Browser |
| AD09 | Add | Fill a valid scheme → Save | Toast "Scheme added". Table row + count 13. Student sees it with the correct badge | ✅ API + Browser |
| AD10 | Edit | Edit → form is pre-filled (ticks, states) → change name → Save | Toast "Scheme updated". Table and the student's Schemes page show the new name/rules | ✅ API + Browser |
| AD11 | Delete | Delete → OK | Toast "Scheme deleted", count back to 12. Gone for the student, including their applications and checklist for it | ✅ API + Browser |
| AD12 | Unknown id | API: PUT/DELETE `/api/admin/schemes/99999` | 404 | ✅ API |
| AD13 | HTML in names | Add a scheme named `<img src=x onerror=alert(1)>` | Shown as plain text, no popup | ✅ Browser |

## 9. General

| ID | Page / Feature | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| G01 | Server stopped | While logged in, stop the server (Ctrl+C), then use any page or try to log in | "Cannot reach the server. Please check that it is running and try again." | ✅ Browser (network cut simulated) · ☐ Manual (really stop it) |
| G02 | Refresh | Press F5 on every page | Stays logged in, data loads again, no errors | ✅ API + Browser |
| G03 | Unknown API URL | `curl localhost:3000/api/nothing` | 404 `{"error":"API route not found."}` | ✅ API |
| G04 | Phone layout | DevTools device mode, 390 px wide, every page | No sideways page scrolling. Logout visible. Nav links swipe sideways. Cards stack in one column. Login page stacks | ✅ Browser (measured) · ☐ Manual (look) |
| G04b | Phone admin table | Admin page at 390 px | The table scrolls sideways inside its card, the page doesn't | ✅ Browser |
| G05 | Laptop layout | 800, 1024 and 1366 px wide | Logout button always visible, no sideways scrolling | ✅ Browser |
| G06 | Keyboard focus | Press Tab through a page | Every link, button and input shows a clear blue outline | ✅ CSS present · ☐ Manual |
| G07 | Loading text | Open Schemes on a slow connection (DevTools → Network → Slow 3G) | "Loading schemes..." shows until cards arrive | ✅ Browser (slow network simulated) |
| G08 | Toasts | Save profile, change status, add/delete a scheme | Small coloured message bottom-right, disappears after ~3 s | ✅ Browser (text) · ☐ Manual (look) |
| G09 | Dashboard numbers | Student → Dashboard | 100% profile, 8 eligible, up to 3 deadlines (≤ 7 days in red). New user: 0%, 0, empty text | ✅ Browser |
| G10 | Broken JSON | `curl -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{bad"` | 400 "The request body is not valid JSON." Server keeps running | ✅ API |
| G11 | No JS errors | Open DevTools Console while using every page | No red errors | ✅ Browser |

---

## Results of the last run

| Run | Checks | Passed | Failed |
|---|---|---|---|
| API script | 75 | 75 | 0 |
| Browser script (headless Chrome) | 61 | 61 | 0 |

### Problems found while testing, and fixed
| Found by | Problem | Fix |
|---|---|---|
| G05 | On screens between about 760 and 1000 px wide, the six navbar links pushed the **Logout button off the right edge**. | `style.css`: the link row can now shrink and scroll sideways (`min-width: 0; overflow-x: auto`), and Logout never shrinks. |
| S12 | Searching for `%` or `_` matched **every** scheme, because they are wildcards in SQL `LIKE`. | `routes/schemes.js`: these characters are escaped (`LIKE ? ESCAPE '\'`). |
| G10 | Sending broken JSON gave a 500 "server error" instead of a clear 400. | `index.js`: the error handler now replies 400 "The request body is not valid JSON." |
| Visual check | Tags on the scheme detail header were invisible (same colour as the page). | `style.css`: white chip with a border when tags sit on the page background. |

## Checks you need to do yourself in the browser

1. **P05**: type letters into the income box and press Save (browsers handle this differently).
2. **G01**: really stop the server with Ctrl+C while a page is open, then click something.
3. **G04 / G05**: look at every page in DevTools device mode (iPhone size) and on your laptop:
   does it *look* right? (Spacing, nothing cut off, nav links swipe.)
4. **G06**: press Tab through the login page and a form page, and check the focus outline is visible.
5. **G08**: watch a toast appear and fade out.
6. **D01**: click "Official website ↗" and check it opens in a new tab.
7. **Optional**: add `ANTHROPIC_API_KEY` to `.env`, restart, click 💡 Explain. The note should say
   "Written by AI (Claude)". This wasn't tested because there is no key in `.env`.
8. Repeat a few of the main flows (A01, P02, M03, D06, D09, AD09) **by hand with a real mouse and
   keyboard**. The automated browser checks set values through the page's DOM rather than real key
   presses.
