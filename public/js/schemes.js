// schemes.js — logic for schemes.html
//
// HOW A FILTER TRAVELS (browser side; the server side is in server/routes/schemes.js)
//   1. The user picks e.g. "Karnataka" in the State dropdown.
//   2. The 'change' event calls loadSchemes().
//   3. loadSchemes() reads every filter's .value and puts the non-empty ones in
//      the URL:  /api/schemes?state=Karnataka
//   4. The server filters the schemes (SQL + JavaScript) and replies with JSON.
//   5. renderSchemes() turns each scheme in that JSON into a card and puts the
//      cards into #schemeList. If the list is empty it shows a message instead.

requireLogin();

const filtersForm = document.getElementById('filters');
const schemeList = document.getElementById('schemeList');
const resultCount = document.getElementById('resultCount');
const message = document.getElementById('message');

// The ids of the filter inputs, which are also the query parameter names
const FILTER_IDS = ['search', 'type', 'provider', 'state', 'education', 'match'];

fillStateOptions(document.getElementById('state'));

// Steps 3 and 4: read the filters, call the API
async function loadSchemes() {
  // URLSearchParams builds "search=abc&type=welfare" and encodes spaces etc.
  const params = new URLSearchParams();
  for (const id of FILTER_IDS) {
    const value = document.getElementById(id).value.trim();
    if (value) params.append(id, value);
  }

  try {
    const data = await api('/schemes?' + params.toString());
    message.className = 'alert hidden';
    document.getElementById('profileReminder').classList.toggle('hidden', data.profileComplete);
    renderSchemes(data.schemes);
  } catch (err) {
    resultCount.textContent = '';
    schemeList.innerHTML = '<div class="empty-state">Schemes could not be loaded.</div>';
    message.textContent = err.message;
    message.className = 'alert alert-error';
  }
}

// Step 5: draw one card per scheme
function renderSchemes(schemes) {
  resultCount.textContent = `${schemes.length} scheme${schemes.length === 1 ? '' : 's'} found`;

  if (schemes.length === 0) {
    schemeList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        No schemes match your filters.<br>
        <span class="small">Try removing a filter or click "Clear filters".</span>
      </div>`;
    return;
  }

  schemeList.innerHTML = schemes.map((s) => {
    const badge = BADGES[s.eligibility.status];
    return `
      <article class="card scheme-card">
        <div class="scheme-card-top">
          <h3><a href="scheme.html?id=${s.id}">${escapeHtml(s.name)}</a></h3>
          <span class="badge ${badge.css}">${badge.text}</span>
        </div>
        <p>
          <span class="tag">${escapeHtml(s.provider)}</span>
          <span class="tag">${escapeHtml(s.type)}</span>
        </p>
        <p><strong>Benefit:</strong> ${escapeHtml(s.benefit)}</p>
        <p><strong>Deadline:</strong> ${describeDeadline(s.deadline)}</p>
        <p class="reason reason-${s.eligibility.status}">${escapeHtml(s.eligibility.summary)}</p>
        <a href="scheme.html?id=${s.id}" class="btn btn-small">View details →</a>
      </article>`;
  }).join('');
}

// Step 2: re-load whenever a filter changes.
// Dropdowns fire 'change'. For the search box we wait until the user stops
// typing for 300 ms, so we don't call the server on every single key press.
filtersForm.addEventListener('change', loadSchemes);

let typingTimer;
document.getElementById('search').addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(loadSchemes, 300);
});

// "Clear filters" resets the form; reload after the browser has cleared the values
filtersForm.addEventListener('reset', () => setTimeout(loadSchemes, 0));

// Pressing Enter in the search box shouldn't reload the page
filtersForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadSchemes();
});

loadSchemes();
