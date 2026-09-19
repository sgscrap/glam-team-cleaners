/**
 * Single source of truth for all page content.
 * Nothing here is markup — the renderers in sections.js turn it into HTML.
 *
 * Every photograph on this page is one the business owns. That is a rule, not a preference: a
 * rented stock interior under a heading like "Our work" claims a job nobody here did, and no
 * alt text can make that honest. Where a real photograph does not exist yet the slot holds copy
 * rather than borrowing one — see `gallery.items[].photo` — and the build refuses to emit a
 * page whose images load from anywhere but this site.
 */

/** Founding year feeds the hero stamp and the structured-data foundingDate alike. */
const founded = 2018;

export const site = {
  name: 'Glam Team Cleaners',
  brand: { lead: 'Glam Team', tail: 'Cleaners' },
  title: 'Glam Team Cleaners | Thoughtful cleaning, beautifully done.',
  description:
    'Glam Team Cleaners — thoughtful residential and commercial cleaning with a polished touch. Book your clean in minutes.',
  tagline: 'Thoughtful cleaning with a polished touch. Residential and commercial, across the greater city.',
  /**
   * Absolute, no trailing slash — the base for the canonical link, the Open Graph URL,
   * the sitemap's <loc>, and the structured-data @id. This is the address the site is
   * actually served from, so crawlers are never pointed at a domain that is not serving
   * the page. Change this one value when the site moves to its own domain.
   */
  url: 'https://sgscrap.github.io/glam-team-cleaners',
  /**
   * The image a share of this site shows: a card set in the brand's own type and palette
   * beside Emely's portrait, rather than a stock photograph, so a link to the site looks
   * like the business. `file` is site-root relative — the URL a crawler fetches is built
   * from it and `url` above, so the two can never point at different places. `alt`
   * describes the card itself, not the photograph inside it.
   */
  socialImage: {
    file: 'assets/social-preview.png',
    alt: 'Glam Team Cleaners brand card with the business name, tagline, and a portrait of Emely.',
  },
  announcement: 'Thoughtful cleaning for the spaces you call home',
  founded,
  est: `GTC / EST. ${founded}`,
  phone: { label: '(555) 014-7826', href: 'tel:+15550147826' },
  email: 'hello@glamteamcleaners.com',
  instagram: 'https://www.instagram.com/immaculatenesss/',
  year: 2024,
  city: 'your city',
};

/** Icon path data. Only referenced icons are emitted into the sprite. */
export const icons = {
  shield: '<path d="M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-13 0 9-5 14-13 14"/><path d="M5 19c3-5 7-8 12-9"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6c0 5-7 9.4-7 9.4z"/>',
  phone: '<path d="M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
};

/**
 * Business facts that only the machine-readable record needs.
 *
 * `type` is deliberately the plain LocalBusiness: schema.org's own subtype list for
 * LocalBusiness stops at types like HomeAndConstructionBusiness and contains no
 * cleaning type, so the widely-recommended "CleaningService" is not a real type and
 * would be reported as unrecognized. The parent type is the valid, supported choice.
 */
export const business = {
  type: 'LocalBusiness',
  catalogName: 'Cleaning services',
};

export const nav = [
  { href: '#services', label: 'Services' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#approach', label: 'Our approach' },
  { href: '#work', label: 'Our work' },
  { href: '#team', label: 'The team' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * Labels for page chrome. Most are announced rather than drawn, which makes them easy
 * to forget and easy to leave stale — so they live with the rest of the copy.
 */
export const ui = {
  skipLink: 'Skip to content',
  brandHome: 'home',
  primaryNav: 'Primary navigation',
  trustList: 'What we stand for',
  menuOpen: 'Open menu',
  menuClose: 'Close menu',
};

/** Call-to-action labels, shared by every section that leads to the booking form. */
export const cta = {
  book: 'Book a clean',
  quote: 'Get a quote',
  bookService: 'Book this clean',
  requestQuote: 'Request a quote',
  call: 'Call',
  instagram: 'Instagram ↗',
};

export const hero = {
  eyebrow: 'A better kind of clean',
  lead: 'Beautifully clean.',
  accent: 'Effortlessly yours.',
  lede:
    'Glam Team Cleaners brings thoughtful detail, dependable care, and a little everyday luxury to your home or business.',
  primary: { label: 'Book your clean', href: '#book' },
  secondary: { label: 'View our work', href: '#work' },
  rating: { stars: '★★★★★', value: '4.9 / 5', note: 'average client rating' },
  /**
   * Emely, not a room. `master` is the original in photos/; the page loads a generated ladder of
   * WebP widths from it, and `sizes` mirrors the CSS box it fills (.hero-art) so the browser can
   * choose a candidate. The alt describes the photograph that is actually there.
   */
  image: {
    master: 'photos/emely/emely-02.png',
    alt: 'Emely, a Glam Team Cleaner, standing beside an ornate window',
    width: 383,
    height: 590,
    /** Measured in a browser against .hero-art, not derived from it: 84vw on a phone (83.6vw
        measured), a box capped at 580px from 621px to 1000px, and the 0.88fr hero column above
        that (36.5vw). The previous 92vw was an upper bound rather than a measurement, which is
        harmless while this 383px master is the widest candidate and would over-fetch by more
        than half as soon as a larger one exists. */
    sizes: '(max-width: 620px) 84vw, (max-width: 1000px) 580px, 37vw',
  },
  card: { index: '01', lead: 'Spaces that', accent: 'feel like you.', note: 'Residential · Commercial' },
};

export const trust = [
  { icon: 'shield', title: 'Careful, vetted team', text: 'The same trusted cleaners, every visit.' },
  { icon: 'leaf', title: 'Kid & pet friendly', text: 'Gentle products chosen with your home in mind.' },
  { icon: 'clock', title: 'Flexible scheduling', text: 'Mornings, afternoons, and weekend slots.' },
  { icon: 'heart', title: 'Trusted locally', text: 'Neighbours, families, and small businesses.' },
];

/**
 * Services own the booking option label. Pricing tiers and service cards both
 * reference a service by id, so a card CTA and its <select> option can never drift.
 */
export const services = {
  eyebrow: 'Our services',
  lead: 'Consider it',
  accent: 'taken care of.',
  aside: 'From a weekly reset to a full transformation, we make the details feel easy.',
  priceLead: 'Starting at',
  priceQuote: { lead: 'Custom', accent: 'quote' },
  items: [
    {
      id: 'regular',
      option: 'Regular cleaning',
      title: 'Regular cleaning',
      blurb: 'Reliable upkeep for a home that always feels ready for guests.',
      price: { from: '$120', unit: 'per visit' },
    },
    {
      id: 'deep',
      option: 'Deep cleaning',
      title: 'Deep cleaning',
      blurb: 'A considered top-to-bottom refresh for every overlooked corner.',
      price: { from: '$220', unit: 'per visit' },
    },
    {
      id: 'move',
      option: 'Move in / move out',
      title: 'Move in / move out',
      blurb: 'Start fresh, leave beautifully, and hand over a space with confidence.',
      price: { from: '$280', unit: 'per visit' },
    },
    {
      id: 'commercial',
      option: 'Office & commercial',
      title: 'Office & commercial',
      blurb: 'Polished, welcoming workspaces that help your team do its best work.',
      price: { quote: true },
    },
  ],
};

export const pricing = {
  eyebrow: 'Simple pricing',
  lead: 'Clear rates.',
  accent: 'No surprises.',
  aside: 'Starting rates for planning. We confirm your exact price once we know about your space.',
  note: 'Starting rates shown are placeholders for planning and are confirmed by quote before booking.',
  tiers: [
    {
      id: 'refresh',
      name: 'Refresh',
      amount: '$120',
      unit: 'from / per visit',
      summary: 'Best for weekly or biweekly upkeep.',
      features: ['Kitchen & bathroom surfaces', 'Floors, dusting & tidy', 'Up to 2 bedrooms'],
      cta: { label: 'Choose Refresh', serviceId: 'regular' },
    },
    {
      id: 'deep',
      name: 'Deep Reset',
      amount: '$220',
      unit: 'from / per visit',
      summary: 'Our thorough top-to-bottom clean.',
      features: ['Everything in Refresh', 'Inside appliances & cabinets', 'Baseboards, vents & fixtures'],
      featured: true,
      badge: 'Most popular',
      cta: { label: 'Choose Deep Reset', serviceId: 'deep' },
    },
    {
      id: 'move',
      name: 'Move In / Out',
      amount: '$280',
      unit: 'from / per visit',
      summary: 'Empty-home detail for moving day.',
      features: ['Everything in Deep Reset', 'Inside all closets & drawers', 'Final walkthrough together'],
      cta: { label: 'Choose Move In / Out', serviceId: 'move' },
    },
  ],
};

export const why = {
  eyebrow: 'Why Glam Team',
  lead: 'Details you can',
  accent: 'actually feel.',
  body:
    'A clean space should feel personal, not clinical. We take the time to learn how you like things, then bring that same care every single visit.',
  points: [
    { title: 'Consistent faces', text: 'The same cleaners who learn your home.' },
    { title: 'Clear communication', text: 'Straight answers, no chasing, no surprises.' },
    { title: 'Finish strong', text: 'A final walkthrough before we call it done.' },
  ],
  cta: { label: 'Book your first clean', href: '#book' },
};

export const process = {
  eyebrow: 'Our approach',
  lead: 'Four easy steps.',
  accent: 'Zero effort.',
  aside: 'From first message to final sparkle, we keep the process short and calm.',
  steps: [
    { title: 'Share your space', text: 'Tell us the rooms, the quirks, and how you like things done.' },
    { title: 'Get your quote', text: 'A clear rate and a suggested plan, usually within one business day.' },
    { title: 'Pick your time', text: 'Choose the morning, afternoon, or weekend slot that suits you.' },
    { title: 'Enjoy the reset', text: 'We clean, we walk it through with you, and you get your time back.' },
  ],
};

export const gallery = {
  eyebrow: 'A few favorites',
  lead: 'Our work,',
  accent: 'in the wild.',
  aside: 'Little moments of order, calm, and light — made for real life.',
  /**
   * A portfolio entry is a photograph of a job this business did, or nothing at all.
   *
   * `photo` is the slot, taking the same shape as every other photograph on the page: a `master`
   * original in photos/, that file's real width and height, alt text describing the job, and a
   * `sizes` hint for the cell it fills. The same pipeline generates what the page loads, so an
   * entry that is filled in gains a WebP ladder like any other photograph. While it is null the
   * entry renders as a typographic panel — the section stands on its own structure instead of on
   * a photograph of somebody else's house. Nothing here may name an image the business does not
   * own.
   */
  items: [
    { tag: 'Residential', caption: 'Soft, serene, spotless.', size: 'large', photo: null },
    { tag: 'Kitchen reset', caption: 'Counters you can breathe on.', photo: null },
    { tag: 'Bedroom detail', caption: 'That fresh-sheet feeling.', photo: null },
    { tag: 'Commercial', caption: 'Make an entrance.', photo: null },
  ],
};

export const team = {
  eyebrow: 'The people behind the polish',
  lead: 'Good energy',
  accent: 'makes a difference.',
  body:
    'Meet Emely — a warm presence on the Glam Team who brings an exacting eye, a thoughtful touch, and a little personality to every clean.',
  role: 'Glam Team Cleaner',
  roleNote: 'Detail enthusiast',
  link: { label: 'Follow Emely', href: site.instagram },
  portrait: {
    master: 'photos/emely/emely-01.png',
    alt: 'Emely wearing a black top and pink statement accessories',
    /** 587x837 is the file's real size. The attributes used to claim 640x960, which is not a
        shape this photograph has ever had, so the page reserved the wrong box for it. */
    width: 587,
    height: 837,
    /** The width the browser must plan for, measured rather than assumed: below 1000px the box
        stretches to 560px and on a phone to the 89vw column, but on a wide screen .team-portrait's
        `margin-left: auto` stops the grid stretching it, so it is sized by its 480px height and
        this photograph's aspect ratio — 337px. Guessing 460px here made the browser fetch the
        480px derivative for a 337px box. */
    sizes: '(max-width: 620px) 89vw, (max-width: 1000px) 560px, 337px',
    label: 'EMELY',
    note: 'GLAM TEAM',
  },
};

export const testimonials = {
  eyebrow: 'Kind words',
  lead: 'What clients',
  accent: 'tell us.',
  aside: 'A few notes from the homes and businesses we look after.',
  note: 'Testimonials shown are placeholder content for review.',
  items: [
    {
      quote: 'The whole experience feels thoughtful — from the first message to the final sparkle.',
      name: 'Jules M.',
      meta: 'Regular client · 2 years',
    },
    {
      quote: 'I came home and actually exhaled. Everything smelled fresh without being overpowering.',
      name: 'Andrea P.',
      meta: 'Deep clean · 1 year',
    },
    {
      quote: 'Our office looks presentable for clients on Monday morning. That alone is worth it.',
      name: 'Marcus T.',
      meta: 'Commercial · 8 months',
    },
  ],
};

export const faqs = {
  eyebrow: 'Good to know',
  lead: 'Questions,',
  accent: 'answered.',
  aside: 'Anything else you want to ask? Send it along with your booking.',
  items: [
    {
      q: 'Do I need to be home during my clean?',
      a: 'Not at all. Many clients share access details and come home to a finished space. If you prefer to be there, that works too.',
    },
    {
      q: 'What do you need before the first visit?',
      a: 'Just a quick description of your space and anything you want us to focus on. We will confirm access and any preferences beforehand.',
    },
    {
      q: 'Do you bring your own supplies?',
      a: 'Yes. We arrive with everything needed. If you would rather we use your products, let us know in the notes.',
    },
    {
      q: 'How far ahead should I book?',
      a: 'Most bookings are placed a few days ahead. Weekend slots often fill first, so earlier is better.',
    },
    {
      q: 'What if something is not right?',
      a: 'Tell us within 24 hours and we will make it right. A final walkthrough helps us catch anything before we leave.',
    },
  ],
};

export const booking = {
  eyebrow: 'Let’s make it happen',
  lead: 'Book your',
  accent: 'clean.',
  body: 'Tell us a little about your space and we’ll confirm your quote within one business day.',
  points: ['Free, no-obligation quote', 'Flexible morning & afternoon slots', 'Reply within one business day'],
  selectPlaceholder: 'Select a service',
  timePlaceholder: 'Select a time',
  times: ['Morning (8am – 12pm)', 'Afternoon (12pm – 4pm)', 'Evening (4pm – 7pm)', 'Flexible'],
  serviceLabel: 'Which clean do you need?',
  dateLabel: 'Preferred date',
  timeLabel: 'Preferred time',
  fields: [
    { row: [{ name: 'firstName', label: 'First name', required: true, autocomplete: 'given-name', placeholder: 'Jane' },
            { name: 'lastName', label: 'Last name', autocomplete: 'family-name', placeholder: 'Doe' }] },
    { row: [{ name: 'email', label: 'Email address', type: 'email', required: true, autocomplete: 'email', placeholder: 'jane@email.com' },
            { name: 'phone', label: 'Phone number', type: 'tel', autocomplete: 'tel', placeholder: '(555) 123-4567' }] },
  ],
  notes: { name: 'notes', label: 'Anything we should know?', placeholder: '2-bedroom apartment, one cat, focus on the kitchen...' },
  submit: 'Send my request',
  note: 'Placeholder contact details. No spam, ever.',
  success: 'Thank you — your request is in. We’ll reply within one business day.',
  error: 'We couldn’t send your request just now. Please email hello@glamteamcleaners.com and we’ll take it from there.',
  reset: 'Book another clean',
};

/**
 * Opening hours — one source, two consumers. `hoursText` is printed in the footer and
 * `openingHours` becomes schema.org openingHours, so the visible page and the
 * structured data cannot drift apart. Day tokens are schema.org's own (Mo, Tu, …).
 */
const DAY_NAMES = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };

/** '08:00' → '8am', '16:30' → '4:30pm' */
const clock = time => {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'am' : 'pm'}`;
};

const hours = [
  { days: 'Mo-Fr', open: '08:00', close: '18:00' },
  { days: 'Sa', open: '09:00', close: '16:00' },
  { days: 'Su' },
];

const dayLabel = days => days.split('-').map(code => DAY_NAMES[code]).join(' – ');

/** e.g. 'Mon – Fri · 8am – 6pm' */
export const hoursText = hours.map(({ days, open, close }) =>
  `${dayLabel(days)} · ${open ? `${clock(open)} – ${clock(close)}` : 'Closed'}`);

/** Schema.org openingHours, e.g. 'Mo-Fr 08:00-18:00'. Closed days are simply omitted. */
export const openingHours = hours
  .filter(entry => entry.open)
  .map(({ days, open, close }) => `${days} ${open}-${close}`);

export const footer = {
  brandLine: site.tagline,
  area: ['Serving the greater city', 'and surrounding suburbs.'],
  contactTitle: 'Contact',
  hoursTitle: 'Hours & area',
  exploreTitle: 'Explore',
  creditLead: 'Made with care in',
  backToTop: 'Back to top ↑',
};

/**
 * Strings the browser needs at runtime: menu labels, the email-channel confirmation, and
 * the labels used to compose the mailto request. script.js is a plain script with no
 * bundler, so it cannot import this module — the build serialises this block into the page
 * as a JSON island instead, which keeps the runtime from holding its own copy of the copy.
 */
export const runtime = {
  menu: { open: ui.menuOpen, close: ui.menuClose },
  success: {
    email: 'Your request is ready in your email app — press send and we’ll reply within one business day.',
  },
  mail: {
    subject: 'Cleaning quote request',
    labels: {
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      service: 'Service',
      date: 'Preferred date',
      time: 'Preferred time',
    },
    fallback: { phone: 'not provided', time: 'flexible', notes: 'No additional notes.' },
  },
};
