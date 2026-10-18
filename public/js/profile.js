// profile.js — logic for profile.html

requireLogin();

const form = document.getElementById('profileForm');
const message = document.getElementById('message');

// The ids of the inputs are the same as the database column names,
// so we can loop over this list for both loading and saving.
const FIELDS = [
  'date_of_birth', 'gender', 'state', 'category', 'annual_income',
  'education_level', 'marks_percent', 'has_disability'
];

fillStateOptions(document.getElementById('state'));

function showError(text) {
  message.textContent = text;
  message.className = 'alert alert-error';
}

function hideError() {
  message.className = 'alert hidden';
}

// Load the saved profile and put each value into its input
async function loadProfile() {
  try {
    const data = await api('/profile');
    for (const field of FIELDS) {
      const value = data.profile[field];
      document.getElementById(field).value = value === null ? '' : value;
    }
    document.getElementById('loadingText').classList.add('hidden');
  } catch (err) {
    document.getElementById('loadingText').textContent = 'Could not load your saved profile.';
    showError(err.message);
  }
}

// Read the form, check it, and send it to the server
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError();

  const profile = {};
  for (const field of FIELDS) {
    profile[field] = document.getElementById(field).value.trim(); // '' = not filled
  }

  // Frontend validation (the server checks the same things again).
  // Note: if you type letters in a number box, the browser gives us '' for it,
  // so we also check the box's own "badInput" flag.
  if (document.getElementById('annual_income').validity.badInput) {
    return showError('Annual income must be a number.');
  }
  if (document.getElementById('marks_percent').validity.badInput) {
    return showError('Marks must be a number.');
  }
  if (profile.date_of_birth && new Date(profile.date_of_birth) > new Date()) {
    return showError('Date of birth cannot be in the future.');
  }
  if (profile.annual_income && (Number(profile.annual_income) < 0 || !Number.isInteger(Number(profile.annual_income)))) {
    return showError('Annual income must be a whole number of rupees (0 or more).');
  }
  if (profile.marks_percent && (Number(profile.marks_percent) < 0 || Number(profile.marks_percent) > 100)) {
    return showError('Marks must be a percentage between 0 and 100.');
  }

  const button = document.getElementById('saveBtn');
  setLoading(button, true, 'Saving...');
  try {
    await api('/profile', 'PUT', profile);
    showToast('Profile saved ✓');
  } catch (err) {
    showError(err.message);
  }
  setLoading(button, false);
});

loadProfile();
