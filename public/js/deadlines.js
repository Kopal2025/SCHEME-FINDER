// deadlines.js — logic for deadlines.html

requireLogin();

const list = document.getElementById('deadlineList');

async function loadDeadlines() {
  try {
    // The server already filters (eligible or saved) and sorts (closest first)
    const data = await api('/schemes/deadlines');

    if (data.deadlines.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📅</span>
          No upcoming deadlines yet.<br>
          <span class="small">Complete your <a href="profile.html">profile</a>
          or save some <a href="schemes.html">schemes</a> to see them here.</span>
        </div>`;
      return;
    }

    list.innerHTML = data.deadlines.map((d) => {
      const closingSoon = d.days_left <= CLOSING_SOON_DAYS;

      // Why is this scheme on the list?
      const eligibleText = d.eligibility_status === 'eligible' ? '<span class="muted small">You are eligible</span>' : '';
      const status = d.application_status ? statusPill(d.application_status) : '';

      return `
        <div class="card list-row ${closingSoon ? 'closing-soon' : ''}">
          <div class="date-box">
            <strong>${formatDate(d.deadline)}</strong>
            <span>${daysLeftText(d.days_left)}</span>
          </div>
          <div class="list-row-main">
            <h3><a href="scheme.html?id=${d.id}">${escapeHtml(d.name)}</a></h3>
            <p>${eligibleText} ${status}</p>
          </div>
          ${closingSoon ? '<span class="badge badge-soon">Closing soon</span>' : ''}
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state">Deadlines could not be loaded.</div>';
    const message = document.getElementById('message');
    message.textContent = err.message;
    message.className = 'alert alert-error';
  }
}

loadDeadlines();
