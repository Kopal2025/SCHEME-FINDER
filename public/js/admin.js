// admin.js — logic for admin.html
//
// Note: the check below only sends normal users away for convenience.
// The real protection is on the server (routes/admin.js returns 403 for non-admins).

requireLogin();
if (!getUser() || getUser().role !== 'admin') {
  window.location.replace('dashboard.html');
  throw new Error('Not an admin - redirecting to the dashboard.');
}

const form = document.getElementById('schemeForm');
const message = document.getElementById('message');
const formMessage = document.getElementById('formMessage');

let schemes = [];       // all schemes, filled by loadSchemes()
let editingId = null;   // null = adding a new scheme, a number = editing that scheme

// Simple text/number fields: input id = database column name
const TEXT_FIELDS = ['name', 'provider', 'type', 'description', 'benefit', 'deadline',
  'official_link', 'gender', 'max_income', 'min_marks', 'min_age', 'max_age', 'required_documents'];

fillStateOptions(document.getElementById('allowed_states'));

// Errors about loading the page go at the top; errors about the form go inside the form
function showPageError(text) {
  message.textContent = text;
  message.className = 'alert alert-error';
}

function showFormError(text) {
  formMessage.textContent = text;
  formMessage.className = 'alert alert-error';
  formMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---- Counts at the top ----
async function loadStats() {
  try {
    const stats = await api('/admin/stats');
    document.getElementById('userCount').textContent = stats.users;
    document.getElementById('schemeCount').textContent = stats.schemes;
    document.getElementById('applicationCount').textContent = stats.applications;
  } catch (err) {
    showPageError(err.message);
  }
}

// ---- Table of all schemes ----
async function loadSchemes() {
  const table = document.getElementById('schemeTable');
  try {
    const data = await api('/admin/schemes');
    schemes = data.schemes;

    if (schemes.length === 0) {
      table.innerHTML = '<tr><td colspan="5" class="muted">No schemes yet. Click "+ Add scheme".</td></tr>';
      return;
    }

    table.innerHTML = schemes.map((s) => `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td><span class="tag">${escapeHtml(s.provider)}</span></td>
        <td><span class="tag">${escapeHtml(s.type)}</span></td>
        <td>${s.deadline ? formatDate(s.deadline) : '<span class="muted">Open all year</span>'}</td>
        <td class="actions">
          <button type="button" class="btn btn-small" data-action="edit" data-id="${s.id}">Edit</button>
          <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${s.id}">Delete</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    table.innerHTML = '<tr><td colspan="5" class="muted">Schemes could not be loaded.</td></tr>';
    showPageError(err.message);
  }
}

// ---- Helpers for the checkbox groups and the multi-select ----
function getCheckedValues(groupId) {
  return [...document.querySelectorAll(`#${groupId} input:checked`)].map((box) => box.value);
}

function setCheckedValues(groupId, values) {
  document.querySelectorAll(`#${groupId} input`).forEach((box) => {
    box.checked = values.includes(box.value);
  });
}

function toList(text) {
  return (text || '').split(',').map((item) => item.trim()).filter(Boolean);
}

// ---- Open the form, empty (add) or filled with a scheme (edit) ----
function openForm(scheme) {
  form.reset();
  formMessage.className = 'alert hidden';
  editingId = scheme ? scheme.id : null;
  document.getElementById('formTitle').textContent = scheme ? `Edit scheme: ${scheme.name}` : 'Add scheme';

  if (scheme) {
    for (const field of TEXT_FIELDS) {
      const value = scheme[field];
      document.getElementById(field).value = value === null ? '' : value;
    }
    // Documents are stored as "A,B" -> show as "A, B"
    document.getElementById('required_documents').value = toList(scheme.required_documents).join(', ');
    document.getElementById('disability_required').checked = scheme.disability_required === 1;
    setCheckedValues('categoryChecks', toList(scheme.allowed_categories));
    setCheckedValues('educationChecks', toList(scheme.allowed_education));

    const states = toList(scheme.allowed_states);
    for (const option of document.getElementById('allowed_states').options) {
      option.selected = states.includes(option.value);
    }
  }

  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('name').focus({ preventScroll: true });
}

function closeForm() {
  form.classList.add('hidden');
  editingId = null;
}

document.getElementById('addBtn').addEventListener('click', () => openForm(null));
document.getElementById('cancelBtn').addEventListener('click', closeForm);

// ---- Edit / Delete buttons in the table ----
document.getElementById('schemeTable').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const scheme = schemes.find((s) => s.id === Number(button.dataset.id));

  if (button.dataset.action === 'edit') {
    openForm(scheme);
  }

  if (button.dataset.action === 'delete') {
    const sure = confirm(`Delete "${scheme.name}"?\nUsers' saved applications and checklists for it will also be deleted.`);
    if (!sure) return;

    setLoading(button, true, 'Deleting...');
    try {
      await api(`/admin/schemes/${scheme.id}`, 'DELETE');
      showToast('Scheme deleted');
      if (editingId === scheme.id) closeForm();
      loadSchemes();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
      setLoading(button, false);
    }
  }
});

// ---- Save (add or edit) ----
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.className = 'alert hidden';

  const scheme = {};
  for (const field of TEXT_FIELDS) {
    scheme[field] = document.getElementById(field).value.trim();
  }
  scheme.allowed_categories = getCheckedValues('categoryChecks');
  scheme.allowed_education = getCheckedValues('educationChecks');
  scheme.allowed_states = [...document.getElementById('allowed_states').selectedOptions].map((o) => o.value);
  scheme.disability_required = document.getElementById('disability_required').checked;

  // Frontend validation (the server checks everything again)
  if (scheme.name.length < 3) {
    return showFormError('Please enter a scheme name (at least 3 characters).');
  }
  if (scheme.official_link && !/^https?:\/\//.test(scheme.official_link)) {
    return showFormError('Official link must start with http:// or https://');
  }
  if (scheme.min_marks && (Number(scheme.min_marks) < 0 || Number(scheme.min_marks) > 100)) {
    return showFormError('Min marks must be between 0 and 100.');
  }
  if (scheme.min_age && scheme.max_age && Number(scheme.min_age) > Number(scheme.max_age)) {
    return showFormError('Min age cannot be more than max age.');
  }

  const button = document.getElementById('saveBtn');
  setLoading(button, true, 'Saving...');
  try {
    if (editingId) {
      await api(`/admin/schemes/${editingId}`, 'PUT', scheme);
      showToast('Scheme updated');
    } else {
      await api('/admin/schemes', 'POST', scheme);
      showToast('Scheme added');
    }
    closeForm();
    loadSchemes();
    loadStats();
  } catch (err) {
    showFormError(err.message);
  }
  setLoading(button, false);
});

loadStats();
loadSchemes();
