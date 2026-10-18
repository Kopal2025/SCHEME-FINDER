// scheme.js — logic for scheme.html?id=3

requireLogin();

// Read the scheme id from the page URL: scheme.html?id=3 -> "3"
const schemeId = new URLSearchParams(window.location.search).get('id');

const message = document.getElementById('message');
let documents = []; // [{ name, is_done }] for this scheme, filled by loadScheme()

const RESULT_ICONS = {
  pass: { icon: '✔', text: 'Pass' },
  fail: { icon: '✘', text: 'Fail' },
  unknown: { icon: '?', text: 'Unknown' }
};

function showError(text) {
  message.textContent = text;
  message.className = 'alert alert-error';
}

// Load everything about this scheme and fill in the page
async function loadScheme() {
  if (!schemeId) {
    document.getElementById('loading').classList.add('hidden');
    return showError('No scheme selected. Go back and pick a scheme from the list.');
  }

  try {
    const data = await api('/schemes/' + encodeURIComponent(schemeId));
    const s = data.scheme;
    document.title = s.name + ' | Scheme Finder';

    // 1. Details (textContent is always safe, no escaping needed)
    document.getElementById('name').textContent = s.name;
    document.getElementById('description').textContent = s.description || 'No description added.';
    document.getElementById('benefit').textContent = s.benefit || '—';
    document.getElementById('deadline').textContent = describeDeadline(s.deadline);
    document.getElementById('tags').innerHTML =
      `<span class="tag">${escapeHtml(s.provider)}</span><span class="tag">${escapeHtml(s.type)}</span>`;

    const link = document.getElementById('officialLink');
    if (s.official_link) link.href = s.official_link;
    else link.classList.add('hidden');

    const badge = BADGES[data.eligibility.status];
    const badgeEl = document.getElementById('badge');
    badgeEl.textContent = badge.text;
    badgeEl.className = 'badge ' + badge.css;

    // 2. Eligibility
    renderEligibility(data.eligibility);

    // 3. Application status ('' means not tracking)
    document.getElementById('status').value = data.application ? data.application.status : '';
    if (data.application) {
      document.getElementById('statusMessage').textContent = 'Last updated ' + formatDate(data.application.updated_at);
    }

    // 4. Documents
    documents = data.documents;
    renderDocuments();

    document.getElementById('content').classList.remove('hidden');
  } catch (err) {
    showError(err.message + ' Go back to the schemes list and pick another one.');
  }
  document.getElementById('loading').classList.add('hidden');
}

function renderEligibility(eligibility) {
  const summary = document.getElementById('summary');
  summary.textContent = eligibility.summary;
  summary.className = 'reason reason-' + eligibility.status;

  const list = document.getElementById('criteria');
  if (eligibility.criteria.length === 0) {
    list.innerHTML = '<li class="muted small">This scheme has no special conditions.</li>';
    return;
  }

  // One row per rule: icon, criterion name + requirement, and the sentence
  list.innerHTML = eligibility.criteria.map((c) => `
    <li class="criterion criterion-${c.result}">
      <span class="criterion-icon" title="${RESULT_ICONS[c.result].text}">${RESULT_ICONS[c.result].icon}</span>
      <div>
        <strong>${escapeHtml(c.criterion)}</strong>
        <span class="muted"> · ${escapeHtml(c.requirement)}</span>
        <div>${escapeHtml(c.text)}</div>
      </div>
    </li>`).join('');
}

function renderDocuments() {
  const list = document.getElementById('documents');
  const progress = document.getElementById('docProgress');
  const bar = document.getElementById('docBar');

  if (documents.length === 0) {
    progress.textContent = 'No documents listed for this scheme.';
    bar.style.width = '0';
    list.innerHTML = '';
    return;
  }

  const done = documents.filter((d) => d.is_done).length;
  progress.textContent = `${done} of ${documents.length} documents ready`;
  bar.style.width = Math.round((done / documents.length) * 100) + '%';

  // data-index tells us which document a checkbox belongs to
  list.innerHTML = documents.map((d, index) => `
    <li>
      <label class="check-row ${d.is_done ? 'done' : ''}">
        <input type="checkbox" data-index="${index}" ${d.is_done ? 'checked' : ''}>
        <span>${escapeHtml(d.name)}</span>
      </label>
    </li>`).join('');
}

// Tick / untick a document -> save it straight away
document.getElementById('documents').addEventListener('change', async (event) => {
  const checkbox = event.target;
  const doc = documents[checkbox.dataset.index];

  checkbox.disabled = true; // stop double clicks while saving
  try {
    await api(`/applications/${schemeId}/documents`, 'PUT', {
      document_name: doc.name,
      is_done: checkbox.checked
    });
    doc.is_done = checkbox.checked;
    renderDocuments();
  } catch (err) {
    checkbox.checked = !checkbox.checked; // undo the tick if saving failed
    checkbox.disabled = false;
    showToast(err.message, 'error');
  }
});

// Change the application status -> save it (or remove it for "Not tracking")
document.getElementById('status').addEventListener('change', async (event) => {
  const select = event.target;
  const status = select.value;
  const statusMessage = document.getElementById('statusMessage');

  select.disabled = true;
  statusMessage.textContent = 'Saving...';
  try {
    if (status === '') {
      await api(`/applications/${schemeId}`, 'DELETE');
      statusMessage.textContent = 'You are not tracking this scheme.';
      showToast('Removed from My Applications');
    } else {
      await api(`/applications/${schemeId}`, 'PUT', { status });
      statusMessage.textContent = 'Last updated today';
      showToast(`Status saved: ${STATUS_LABELS[status]}`);
    }
  } catch (err) {
    statusMessage.textContent = '';
    showToast(err.message, 'error');
  }
  select.disabled = false;
});

// "Explain in simple words"
document.getElementById('explainBtn').addEventListener('click', async () => {
  const button = document.getElementById('explainBtn');
  const box = document.getElementById('explanation');

  setLoading(button, true, 'Explaining...');
  try {
    const data = await api(`/schemes/${schemeId}/explain`);
    // Each line of the explanation becomes one paragraph
    const paragraphs = data.explanation.split('\n').filter((line) => line.trim() !== '');
    const note = data.source === 'ai'
      ? 'Written by AI (Claude) from the scheme details. Please confirm on the official website.'
      : 'Generated from the scheme details.';

    box.innerHTML = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
      `<p class="hint">${note}</p>`;
    box.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
  setLoading(button, false);
});

loadScheme();
