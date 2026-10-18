// dashboard.js — logic for dashboard.html
// The dashboard doesn't need its own API route: it reuses routes we already have.

requireLogin(); // no token -> back to login page

const PROFILE_FIELDS = [
  'date_of_birth', 'gender', 'state', 'category', 'annual_income',
  'education_level', 'marks_percent', 'has_disability'
];

async function loadDashboard() {
  try {
    // Promise.all sends the 4 requests at the same time and waits for all of them
    const [me, profileData, eligibleData, deadlineData] = await Promise.all([
      api('/auth/me'),                       // who am I?
      api('/profile'),                       // for profile completion %
      api('/schemes?match=eligible'),        // only the schemes I'm eligible for
      api('/schemes/deadlines')              // eligible or saved, closest first
    ]);

    // Welcome message
    document.getElementById('welcome').textContent = 'Welcome, ' + me.user.name + ' 👋';
    if (me.user.role === 'admin') {
      document.getElementById('roleNote').innerHTML =
        'You are logged in as an admin. <a href="admin.html">Open the admin dashboard →</a>';
    }

    // Profile completion: how many of the 8 fields are filled in
    const filled = PROFILE_FIELDS.filter((field) => profileData.profile[field] !== null).length;
    const percent = Math.round((filled / PROFILE_FIELDS.length) * 100);
    document.getElementById('profilePercent').textContent = percent + '%';
    document.getElementById('profileBar').style.width = percent + '%';
    if (percent < 100) {
      document.getElementById('profileLink').textContent = 'Complete your profile →';
    }

    // Eligible schemes
    document.getElementById('eligibleCount').textContent = eligibleData.schemes.length;

    // Next 3 deadlines (the list is already sorted by the server)
    renderNextDeadlines(deadlineData.deadlines.slice(0, 3));
  } catch (err) {
    // An invalid token already logs out inside api(); this covers other errors
    document.getElementById('welcome').textContent = 'Dashboard';
    document.getElementById('nextDeadlines').innerHTML = '<p class="muted">Could not load deadlines.</p>';
    const message = document.getElementById('message');
    message.textContent = err.message;
    message.className = 'alert alert-error';
  }
}

function renderNextDeadlines(deadlines) {
  const box = document.getElementById('nextDeadlines');

  if (deadlines.length === 0) {
    box.innerHTML = '<p class="muted">No upcoming deadlines. Complete your profile or save some schemes.</p>';
    return;
  }

  box.innerHTML = deadlines.map((d) => {
    const closingSoon = d.days_left <= CLOSING_SOON_DAYS;
    return `
      <div class="mini-row">
        <a href="scheme.html?id=${d.id}"><strong>${escapeHtml(d.name)}</strong></a>
        <span class="${closingSoon ? 'badge badge-soon' : 'muted small'}">
          ${formatDate(d.deadline)} · ${daysLeftText(d.days_left)}
        </span>
      </div>`;
  }).join('');
}

loadDashboard();
