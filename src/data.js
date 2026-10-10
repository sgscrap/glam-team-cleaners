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
   * the page.
   *
   * The business's own domain, not the GitHub Pages address the site was built on: that
   * gh.io URL now 301s here, so naming it would advertise a redirect instead of the site.
   * `assertRetiredHostsAbsent` in checks.js fails the build if it comes back.
   */
  url: 'https://glamcleaners.net',
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
  phone: {
    label: '(667) 487-0858',
    href: 'tel:+16674870858',
    /**
     * Whether this line receives texts, which is what decides how the booking form hands a
     * request over. It does not, as far as anyone here knows — a number nobody has confirmed can
     * take a message is a number where a message disappears, and the visitor would never find
     * out. So the form opens a call, and this is the switch that turns the text flow back on
     * once someone has actually checked the line.
     */
    receivesText: false,
  },
  /**
   * Deliberately absent: `email`. The business publishes no mailbox, and a request is answered by
   * phone or not at all — so an address here would be a channel that does not exist. The booking
   * form asks for no email either, and the structured data omits it, for the same reason.
   */
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
 * The rate every price on this page is computed from, and the floor under it.
 *
 * One number, plus the hours a typical job of each service takes, are the only inputs: change
 * `perHour` and every figure moves with it — both the service cards and the plans that quote
 * hours, the band above the plans, and the note beneath them. The alternative, which this page
 * had until now, is six dollar amounts typed into two lists, where a rate change edits some and
 * misses others and the page ends up quoting two different prices for the same job. No guard
 * would catch that: the figures are copy, and copy is only ever compared with other copy.
 */
export const baseRate = {
  perHour: 40,
  /** The floor under the rate: nothing on this page is booked for less than this. */
  minimum: 75,
};

/** A price in whole dollars — the site quotes dollars, never cents. */
const dollars = amount => `$${Math.round(amount)}`;

/**
 * What a job of `hours` comes to: the base rate by the hour, and never less than the minimum — a
 * job that would come to less than the floor costs the floor, which is what a floor is for.
 *
 * The minimum is applied here rather than only stated in the band, so the two cannot disagree:
 * a service whose typical job is under an hour is quoted at the floor, not below the price the
 * page promises is its lowest.
 */
const priceFor = hours => Math.max(hours * baseRate.perHour, baseRate.minimum);

/**
 * A service, with its card's figure computed from the base rate and the hours a typical job of it
 * takes. `quoted` is the commercial work, priced by survey rather than by the hour, so it has no
 * figure to compute.
 */
const withPrice = ({ hours, quoted, ...service }) => (quoted
  ? { ...service, price: { quote: true } }
  : { ...service, hours, price: { from: dollars(priceFor(hours)), unit: 'per visit' } });

/**
 * Services own the booking option label and the hours their typical job takes. Pricing tiers and
 * service cards both reference a service by id, so a card CTA and its <select> option can never
 * drift — and, because a plan takes its figure from the service it names, neither can quote a
 * price the other doesn't.
 */
export const services = {
  eyebrow: 'Our services',
  lead: 'Consider it',
  accent: 'taken care of.',
  aside: 'From a weekly reset to a full transformation, we make the details feel easy.',
  /**
   * "Typically", not "Starting at": the one starting price on this page is the base rate in
   * `pricing.rate`. A per-service figure presented as a floor beside a per-hour base would be a
   * second, lower floor — the card price is an example of what the service usually comes to.
   */
  priceLead: 'Typically',
  priceQuote: { lead: 'Custom', accent: 'quote' },
  items: [
    {
      id: 'regular',
      option: 'Regular cleaning',
      title: 'Regular cleaning',
      blurb: 'Reliable upkeep for a home that always feels ready for guests.',
      hours: 3,
    },
    {
      id: 'deep',
      option: 'Deep cleaning',
      title: 'Deep cleaning',
      blurb: 'A considered top-to-bottom refresh for every overlooked corner.',
      hours: 5.5,
    },
    {
      id: 'move',
      option: 'Move in / move out',
      title: 'Move in / move out',
      blurb: 'Start fresh, leave beautifully, and hand over a space with confidence.',
      hours: 7,
    },
    {
      id: 'commercial',
      option: 'Office & commercial',
      title: 'Office & commercial',
      blurb: 'Polished, welcoming workspaces that help your team do its best work.',
      quoted: true,
    },
  ].map(withPrice),
};

/**
 * The hours a service's typical job takes, by id — the one place a plan's figure comes from.
 *
 * A plan that names a service stating no hours is a build failure rather than a `$NaN` on a card:
 * this runs while the module loads, long before any markup is rendered.
 */
const hoursOf = serviceId => {
  const service = services.items.find(item => item.id === serviceId);
  if (!service || service.hours === undefined) {
    throw new Error(`The "${serviceId}" plan names a service with no hours to price: a plan costs the base rate times the hours its service states, so the two must name the same thing`);
  }
  return service.hours;
};

/**
 * Plans, each with the figure the service it names comes to at the base rate.
 *
 * The amount is computed rather than typed, so the plan and the service card beside it cannot
 * disagree — they are the same service, and the same sum. `serviceId` moves onto the CTA it
 * belongs to, which is the only thing the renderer and the booking form read it for.
 */
const priced = plans => plans.map(({ serviceId, ...plan }) => ({
  ...plan,
  amount: dollars(priceFor(hoursOf(serviceId))),
  unit: 'typical visit',
  cta: { ...plan.cta, serviceId },
}));

export const pricing = {
  eyebrow: 'Simple pricing',
  lead: 'Clear rates.',
  accent: 'No surprises.',
  aside: 'Our base rate, and what three typical visits come to. We confirm your exact price once we know about your space.',
  /**
   * The band above the plans, built from `baseRate` rather than restating it.
   *
   * A base figure by the hour and a floor under it for the smallest job: that is the whole basis,
   * and every other figure on this page is an example of what it comes to. Kept apart from the
   * tiers so the one rate a visitor can hold the business to is not one of three cards, and so a
   * plan can change without the rate moving.
   */
  rate: {
    amount: dollars(baseRate.perHour),
    unit: 'per hour',
    floor: { lead: 'and at least', amount: dollars(baseRate.minimum), tail: 'for the smallest job' },
  },
  note: `Plans above show typical visits at the ${dollars(baseRate.perHour)} hourly rate. Nothing is booked for less than the ${dollars(baseRate.minimum)} minimum.`,
  tiers: priced([
    {
      id: 'refresh',
      name: 'Refresh',
      serviceId: 'regular',
      summary: 'Best for weekly or biweekly upkeep.',
      features: ['Kitchen & bathroom surfaces', 'Floors, dusting & tidy', 'Up to 2 bedrooms'],
      cta: { label: 'Choose Refresh' },
    },
    {
      id: 'deep',
      name: 'Deep Reset',
      serviceId: 'deep',
      summary: 'Our thorough top-to-bottom clean.',
      features: ['Everything in Refresh', 'Inside appliances & cabinets', 'Baseboards, vents & fixtures'],
      featured: true,
      badge: 'Most popular',
      cta: { label: 'Choose Deep Reset' },
    },
    {
      id: 'move',
      name: 'Move In / Out',
      serviceId: 'move',
      summary: 'Empty-home detail for moving day.',
      features: ['Everything in Deep Reset', 'Inside all closets & drawers', 'Final walkthrough together'],
      cta: { label: 'Choose Move In / Out' },
    },
  ]),
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

/**
 * Deliberately absent: the testimonials section.
 *
 * The three quotes that stood here were written as placeholders, and a quote invented for a
 * customer is the one thing on a page like this that no guard can catch — it reads exactly like
 * a real one. Rather than dress them up, the section is off the page: `sections.js` renders no
 * testimonials and `mainSections` does not list it, so nothing stands in for a customer's words.
 * It comes back when there are real, attributable quotes to put in it, and not before.
 */
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
    /**
     * Phone only, and required: no mailbox is published, so this is the one channel a request can
     * come back on. An email field here would be a field nothing could answer.
     */
    { row: [{ name: 'phone', label: 'Phone number', type: 'tel', required: true, autocomplete: 'tel', placeholder: '(555) 123-4567' }] },
  ],
  notes: { name: 'notes', label: 'Anything we should know?', placeholder: '2-bedroom apartment, one cat, focus on the kitchen...' },
  /**
   * The button and the note describe what pressing it does, which is the channel `site.phone`
   * selects: a call, or a text once the line is known to take one. A button that says "send"
   * and opens a dialer is the same lie as a form that posts nowhere.
   */
  submit: site.phone.receivesText ? 'Send my request' : 'Call to book',
  note: site.phone.receivesText
    ? 'No spam — we use your details only to arrange your clean.'
    : 'Nothing is sent from this page — call and we’ll take these details down.',
  success: 'Thank you — your request is in. We’ll reply within one business day.',
  error: `We couldn’t send your request just now. Please call ${site.phone.label} and we’ll take it from there.`,
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
 * Strings the browser needs at runtime: menu labels, the confirmation shown when a request is
 * handed to the visitor's own messaging app, and the labels used to compose that message.
 * script.js is a plain script with no bundler, so it cannot import this module — the build
 * serialises this block into the page as a JSON island instead, which keeps the runtime from
 * holding its own copy of the copy.
 */
export const runtime = {
  menu: { open: ui.menuOpen, close: ui.menuClose },
  success: {
    /**
     * Shown when the request left through the phone rather than a form endpoint: the visitor's
     * messaging app holds the message, and the number is named in case their device cannot open
     * a text — a desktop browser, most often.
     */
    text: `Your request is ready in your messages app — press send, and call ${site.phone.label} if it didn’t open.`,
    /**
     * Shown when the handoff is a call. Nothing was sent, so the copy says so and leaves the
     * details the visitor filled in on screen to read out — which is why the form is not reset
     * on this channel.
     */
    call: `Our number is opening in your phone app — call ${site.phone.label} and we’ll take these details down.`,
  },
  /**
   * The phone channel. No mailbox is published and no form endpoint is configured, so the phone
   * is the only way a request leaves this page — as a call unless the line takes texts.
   */
  handoff: {
    /** Whether the number takes a message; see `site.phone.receivesText`. */
    text: site.phone.receivesText,
    subject: 'Cleaning quote request',
    /** Digits only, taken from the one place the number is written down. */
    phone: site.phone.href.replace(/^tel:/, ''),
    labels: {
      name: 'Name',
      phone: 'Phone',
      service: 'Service',
      date: 'Preferred date',
      time: 'Preferred time',
    },
    fallback: { phone: 'not provided', time: 'flexible', notes: 'No additional notes.' },
  },
};
