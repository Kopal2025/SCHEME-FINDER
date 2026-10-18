// api.js
// Small helpers used by every page. It is loaded first on every page.
//
//  Talking to the server
//   - api()            : calls the server with fetch() and attaches the JWT token
//
//  Login state
//   - saveLogin()      : stores the token + user after login/register
//   - getToken(), getUser()
//   - requireLogin()   : sends the visitor to the login page if not logged in
//   - logout()         : removes the token and goes back to the login page
//
//  Page helpers
//   - showToast()      : small success/error message in the corner
//   - setLoading()     : disables a button and shows "Saving..." while waiting
//   - escapeHtml()     : makes text safe to put inside innerHTML
//   - formatDate(), describeDeadline(), statusPill(), fillStateOptions()
//   - INDIAN_STATES, BADGES, STATUS_LABELS, CLOSING_SOON_DAYS

// ---------------------------------------------------------------------------
// Shared lists and labels
// ---------------------------------------------------------------------------

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh',
  'Lakshadweep', 'Puducherry'
];

// Labels and CSS classes for the three eligibility results
const BADGES = {
  eligible: { text: 'Eligible', css: 'badge-eligible' },
  possible: { text: 'Possibly Eligible', css: 'badge-possible' },
  not: { text: 'Not Eligible', css: 'badge-not' }
};

// Application status values (as stored in the database) and how we show them
const STATUS_LABELS = {
  saved: 'Saved',
  applied: 'Applied',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected'
};

// Deadlines this close (in days) are highlighted as "closing soon"
const CLOSING_SOON_DAYS = 7;

// ---------------------------------------------------------------------------
// Talking to the server
// ---------------------------------------------------------------------------

// Example: const data = await api('/auth/login', 'POST', { email, password });
// Returns the JSON from the server, or throws an Error with a friendly message.
async function api(path, method = 'GET', body) {
  const options = { method, headers: {} };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const token = getToken();
  if (token) {
    options.headers['Authorization'] = 'Bearer ' + token;
  }

  let response;
  try {
    response = await fetch('/api' + path, options);
  } catch (networkError) {
    // fetch() itself only fails when the server can't be reached at all
    throw new Error('Cannot reach the server. Please check that it is running and try again.');
  }

  const data = await response.json().catch(() => ({})); // empty or non-JSON body -> {}

  // We sent a token but the server rejected it (expired/invalid): log out
  if (response.status === 401 && token) {
    logout();
  }

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

// ---------------------------------------------------------------------------
// Login state (the token lives in localStorage)
// ---------------------------------------------------------------------------

function getToken() {
  return localStorage.getItem('token');
}

function saveLogin(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function getUser() {
  const saved = localStorage.getItem('user');
  return saved ? JSON.parse(saved) : null;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  // replace() instead of href: the protected page is not kept in the Back history
  window.location.replace('index.html');
}

// Call this at the top of every protected page
function requireLogin() {
  // If the user presses Back after logging out, the browser can show the old
  // page from its cache. 'pageshow' runs even then, so we check again.
  window.addEventListener('pageshow', () => {
    if (!getToken()) window.location.replace('index.html');
  });

  if (!getToken()) {
    window.location.replace('index.html');
    // Stop the rest of this page's script from running (no API calls, no errors shown)
    throw new Error('Not logged in - redirecting to the login page.');
  }
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

// Shows a small message in the bottom corner for 3 seconds.
// type: 'success' or 'error'
function showToast(text, type = 'success') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status'); // screen readers read it out
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.className = 'toast toast-' + type + ' show';

  clearTimeout(toast.hideTimer);
  toast.hideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// While a request is running: disable the button and change its text.
// setLoading(button, true, 'Saving...')  ...then...  setLoading(button, false)
function setLoading(button, isLoading, loadingText = 'Saving...') {
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

// Scheme names etc. come from the database; escaping them stops any HTML
// inside them from running when we build cards with innerHTML.
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text === null || text === undefined ? '' : String(text);
  return div.innerHTML;
}

// Coloured label for an application status, e.g. <span class="status status-applied">Applied</span>
function statusPill(status) {
  return `<span class="status status-${status}">${STATUS_LABELS[status] || status}</span>`;
}

// Adds one <option> per state to a <select> element
function fillStateOptions(select) {
  for (const state of INDIAN_STATES) {
    const option = document.createElement('option');
    option.value = state;
    option.textContent = state;
    select.appendChild(option);
  }
}

// '2026-10-22' -> '22 Oct 2026'
function formatDate(dateText) {
  const [year, month, day] = dateText.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day)
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// How many days from today until '2026-10-22' (negative = already passed)
function daysUntil(dateText) {
  const [year, month, day] = dateText.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(year, month - 1, day) - today) / 86400000);
}

// A short description of a deadline for showing on cards
function describeDeadline(deadline) {
  if (!deadline) return 'Open all year';
  const days = daysUntil(deadline);
  if (days < 0) return `Closed (${formatDate(deadline)})`;
  if (days === 0) return `${formatDate(deadline)} (today!)`;
  return `${formatDate(deadline)} (${days} day${days === 1 ? '' : 's'} left)`;
}

// "3 days left" / "1 day left" / "Closes today"
function daysLeftText(days) {
  if (days === 0) return 'Closes today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

// ---------------------------------------------------------------------------
// Runs on every page that has a navbar
// ---------------------------------------------------------------------------

// Logout button
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);

// Show the "Admin" link only to admins. This is just for looks:
// the server checks the role on every /api/admin request.
const adminLink = document.getElementById('adminLink');
if (adminLink && getUser() && getUser().role === 'admin') {
  adminLink.classList.remove('hidden');
}
