/**
 * Runtime behaviour: sticky header, mobile navigation, service pre-selection, and
 * booking submission.
 *
 * No user-visible string is defined in this file. Labels and confirmations come from the
 * `#runtime-config` island, which the build serialises out of src/data.js, so the runtime
 * cannot drift from the copy rendered into the page.
 */
const config = JSON.parse(document.getElementById('runtime-config')?.textContent ?? 'null') ?? {};
const handoff = config.handoff ?? {};
const handoffLabels = handoff.labels ?? {};
const handoffFallback = handoff.fallback ?? {};
const compareLabels = config.compare ?? {};

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

const FORM_STATES = ['is-sending', 'is-sent', 'is-calling', 'is-error'];

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

/* --- before/after comparisons ---
 *
 * The range input already does the hard part: it is focusable, it takes the arrow keys, and it
 * reports a value. All this does is hand that value to the one custom property the edge and the
 * handle are drawn from, and give the value something to say — a slider that announces "52" has
 * told a screen reader nothing about what is being compared, so the number the browser speaks is
 * composed with the word the page draws on that side of the handle. No fallback is needed for a
 * browser without custom properties: the stylesheet draws the pair at its default reveal, which is
 * a comparison that simply cannot be moved.
 */
document.querySelectorAll('.compare').forEach(figure => {
  const range = figure.querySelector('.compare-range');
  if (!range) return;
  const reveal = () => {
    figure.style.setProperty('--reveal', `${range.value}%`);
    if (compareLabels.before) range.setAttribute('aria-valuetext', `${range.value}% ${compareLabels.before}`);
  };
  range.addEventListener('input', reveal);
  reveal();
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

/**
 * The request as the business will read it: the fields the form actually asks for, no email
 * among them, with every label and fallback coming from data.
 */
function requestSummary() {
  const data = Object.fromEntries(new FormData(bookingForm).entries());
  const lines = [
    `${handoffLabels.name}: ${data.firstName} ${data.lastName || ''}`.trim(),
    `${handoffLabels.phone}: ${data.phone || handoffFallback.phone}`,
    `${handoffLabels.service}: ${data.service}`,
    `${handoffLabels.date}: ${data.date}`,
    `${handoffLabels.time}: ${data.time || handoffFallback.time}`,
    '',
    data.notes || handoffFallback.notes,
  ];
  return { data, lines };
}

/**
 * Three channels, in order. A configured endpoint posts the request; with none — this site has
 * none, and publishes no mailbox either — the visitor's own phone is asked to carry it, as a
 * message when the line is known to take one and as a call otherwise. The call is the default
 * because a text to a line that cannot receive one vanishes without a word, which is the same
 * silence this form was rebuilt to avoid.
 *
 * Either way the visitor sends it; the page never claims to have sent anything.
 */
async function deliver() {
  const { data, lines } = requestSummary();
  const endpoint = (bookingForm.dataset.endpoint || '').trim();
  if (!endpoint) {
    if (!handoff.text) {
      window.location.href = `tel:${handoff.phone}`;
      return 'call';
    }
    const body = encodeURIComponent([handoff.subject ?? '', ...lines].join('\n'));
    window.location.href = `sms:${handoff.phone}?body=${body}`;
    return 'text';
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
    // The call channel sends nothing, so the details stay where the visitor can read them out.
    if (channel !== 'call') bookingForm.reset();
    if (successMessage) {
      const copy = { call: config.success?.call, text: config.success?.text }[channel];
      successMessage.textContent = copy ?? renderedSuccess;
    }
    setFormState(channel === 'call' ? 'is-calling' : 'is-sent');
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
