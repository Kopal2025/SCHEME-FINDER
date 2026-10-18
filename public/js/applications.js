// applications.js — logic for applications.html

requireLogin();

const list = document.getElementById('applicationList');

// Builds the <option>s for the status dropdown, with the current one selected
function statusOptions(current) {
  return Object.keys(STATUS_LABELS).map((value) =>
    `<option value="${value}" ${value === current ? 'selected' : ''}>${STATUS_LABELS[value]}</option>`
  ).join('');
}

async function loadApplications() {
  try {
    const data = await api('/applications');

    if (data.applications.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📂</span>
          You are not tracking any schemes yet.<br>
          <span class="small">Open a scheme from the <a href="schemes.html">Schemes</a> page and set a status.</span>
        </div>`;
      return;
    }

    // data-id on the dropdown and button tells us which scheme they belong to
    list.innerHTML = data.applications.map((a) => `
      <div class="card list-row">
        <div class="list-row-main">
          <h3><a href="scheme.html?id=${a.scheme_id}">${escapeHtml(a.name)}</a> ${statusPill(a.status)}</h3>
          <p class="muted small">
            Deadline: ${describeDeadline(a.deadline)} ·
            Documents: ${a.docs_done} of ${a.docs_total} ready ·
            Updated ${formatDate(a.updated_at)}
          </p>
        </div>
        <select class="status-select" data-id="${a.scheme_id}" aria-label="Application status">${statusOptions(a.status)}</select>
        <button type="button" class="btn btn-small btn-danger remove-btn" data-id="${a.scheme_id}">Remove</button>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state">Your applications could not be loaded.</div>';
    const message = document.getElementById('message');
    message.textContent = err.message;
    message.className = 'alert alert-error';
  }
}

// Status changed in one of the dropdowns -> save it, then redraw the list
list.addEventListener('change', async (event) => {
  const select = event.target;
  if (!select.classList.contains('status-select')) return;

  select.disabled = true;
  try {
    await api(`/applications/${select.dataset.id}`, 'PUT', { status: select.value });
    showToast(`Status saved: ${STATUS_LABELS[select.value]}`);
    loadApplications();
  } catch (err) {
    showToast(err.message, 'error');
    select.disabled = false;
  }
});

// "Remove" clicked -> stop tracking that scheme, then reload the list
list.addEventListener('click', async (event) => {
  const button = event.target;
  if (!button.classList.contains('remove-btn')) return;
  if (!confirm('Remove this scheme from your applications?')) return;

  setLoading(button, true, 'Removing...');
  try {
    await api(`/applications/${button.dataset.id}`, 'DELETE');
    showToast('Removed from My Applications');
    loadApplications();
  } catch (err) {
    showToast(err.message, 'error');
    setLoading(button, false);
  }
});

loadApplications();
