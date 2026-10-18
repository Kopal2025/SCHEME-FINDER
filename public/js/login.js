// login.js — logic for index.html (login + register forms)

// Already logged in? Skip the login page.
if (getToken()) {
  window.location.replace('dashboard.html');
}

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const message = document.getElementById('message');

function showMessage(text) {
  message.textContent = text;
  message.className = 'alert alert-error';
}

function hideMessage() {
  message.className = 'alert hidden';
}

// Switch between the Login and Register forms
function showForm(which) {
  const isLogin = which === 'login';
  loginForm.classList.toggle('hidden', !isLogin);
  registerForm.classList.toggle('hidden', isLogin);
  loginTab.classList.toggle('active', isLogin);
  registerTab.classList.toggle('active', !isLogin);
  document.getElementById('formHeading').textContent = isLogin ? 'Welcome back' : 'Create your account';
  document.getElementById('formSubheading').textContent = isLogin
    ? 'Log in to see your matching schemes.'
    : 'It takes less than a minute.';
  hideMessage();
}

loginTab.addEventListener('click', () => showForm('login'));
registerTab.addEventListener('click', () => showForm('register'));

// LOGIN: send email + password, save the token, go to the dashboard
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the browser from reloading the page

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  // Frontend validation
  if (!email || !password) {
    return showMessage('Please enter both email and password.');
  }

  const button = document.getElementById('loginBtn');
  setLoading(button, true, 'Logging in...');
  try {
    const data = await api('/auth/login', 'POST', { email, password });
    saveLogin(data.token, data.user);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showMessage(err.message); // e.g. "Incorrect email or password."
    setLoading(button, false);
  }
});

// REGISTER: create the account, save the token, go to the dashboard
registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  // Frontend validation (the server checks the same things again)
  if (!name || !email || !password) {
    return showMessage('Please fill in all the fields.');
  }
  if (name.length < 2) {
    return showMessage('Name must be at least 2 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return showMessage('Please enter a valid email address.');
  }
  if (password.length < 6) {
    return showMessage('Password must be at least 6 characters.');
  }

  const button = document.getElementById('registerBtn');
  setLoading(button, true, 'Creating account...');
  try {
    const data = await api('/auth/register', 'POST', { name, email, password });
    saveLogin(data.token, data.user);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showMessage(err.message); // e.g. "An account with this email already exists."
    setLoading(button, false);
  }
});
