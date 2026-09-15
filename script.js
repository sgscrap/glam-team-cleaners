/**
 * Runtime behaviour: sticky header, mobile navigation, service pre-selection, and
 * booking submission.
 *
 * No user-visible string is defined in this file. Labels and confirmations come from the
 * `#runtime-config` island, which the build serialises out of src/data.js, so the runtime
 * cannot drift from the copy rendered into the page.
 */
const config = JSON.parse(document.getElementById('runtime-config')?.textContent ?? 'null') ?? {};
const mail = config.mail ?? {};
const mailLabels = mail.labels ?? {};
const mailFallback = mail.fallback ?? {};

const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#primary-nav');
const bookingForm = document.querySelector('#booking-form');
const serviceSelect = document.querySelector('#booking-service');
const dateInput = document.querySelector('#booking-date');
const successMessage = document.querySelector('.form-success');
const submitButton = document.querySelector('.booking-submit');
const resetButton = document.querySelector('.booking-reset');
const callBar = document.querySelector('#mobile-cta');
const bookingSection = document.querySelector('#book');

const FORM_STATES = ['is-sending', 'is-sent', 'is-error'];

/** The success copy the page rendered, restored for the direct-send channel. */
const renderedSuccess = successMessage?.textContent ?? '';

/* --- header shadow --- */
header?.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 8);
}, { passive: true });

/* --- mobile navigation --- */
function setMenu(open) {
  const label = open ? config.menu?.close : config.menu?.open;
  menuToggle?.setAttribute('aria-expanded', String(open));
  if (label) menuToggle?.setAttribute('aria-label', label);
  nav?.classList.toggle('is-open', open);
}

menuToggle?.addEventListener('click', () => {
  setMenu(menuToggle.getAttribute('aria-expanded') !== 'true');
});

nav?.addEventListener('click', event => {
  if (event.target.closest('a')) setMenu(false);
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (menuToggle?.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menuToggle.focus();
  }
});

/* --- service pre-selection --- */
document.querySelectorAll('[data-service]').forEach(link => {
  link.addEventListener('click', () => {
    if (bookingForm?.classList.contains('is-sent')) setFormState(null);
    if (serviceSelect) serviceSelect.value = link.dataset.service;
  });
});

/* --- no past dates --- */
if (dateInput) {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  dateInput.min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* --- booking --- */
function setFormState(state) {
  bookingForm.classList.remove(...FORM_STATES);
  if (state) bookingForm.classList.add(state);
}

/** The request as the recipient will read it. Labels and fallbacks come from data. */
function requestSummary() {
  const data = Object.fromEntries(new FormData(bookingForm).entries());
  const lines = [
    `${mailLabels.name}: ${data.firstName} ${data.lastName || ''}`.trim(),
    `${mailLabels.email}: ${data.email}`,
    `${mailLabels.phone}: ${data.phone || mailFallback.phone}`,
    `${mailLabels.service}: ${data.service}`,
    `${mailLabels.date}: ${data.date}`,
    `${mailLabels.time}: ${data.time || mailFallback.time}`,
    '',
    data.notes || mailFallback.notes,
  ];
  return { data, lines };
}

async function deliver() {
  const { data, lines } = requestSummary();
  const endpoint = (bookingForm.dataset.endpoint || '').trim();
  if (!endpoint) {
    const subject = encodeURIComponent(mail.subject ?? '');
    const body = encodeURIComponent(lines.join('\n'));
    window.location.href = `mailto:${bookingForm.dataset.email}?subject=${subject}&body=${body}`;
    return 'email';
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return 'direct';
}

bookingForm?.addEventListener('submit', async event => {
  event.preventDefault();
  setFormState('is-sending');
  if (submitButton) submitButton.disabled = true;
  try {
    const channel = await deliver();
    bookingForm.reset();
    if (successMessage) {
      successMessage.textContent = channel === 'email' ? config.success?.email ?? renderedSuccess : renderedSuccess;
    }
    setFormState('is-sent');
    successMessage?.focus();
  } catch (error) {
    setFormState('is-error');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

resetButton?.addEventListener('click', () => {
  bookingForm.reset();
  setFormState(null);
  bookingForm.elements.namedItem('firstName')?.focus();
});

/* --- hide the call bar while booking is on screen --- */
if (callBar && bookingSection && 'IntersectionObserver' in window) {
  new IntersectionObserver(entries => {
    callBar.classList.toggle('is-hidden', entries[0].isIntersecting);
  }, { threshold: 0.15 }).observe(bookingSection);
}
