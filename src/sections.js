import {
  site, nav, ui, cta, hero, trust, services, pricing, why, process,
  gallery, team, faqs, booking, footer, hoursText,
} from './data.js';
import { esc } from './html.js';
import { largestPath, srcset } from './photos.js';

/* --- tiny helpers ------------------------------------------------------- */

/**
 * Every value that reaches markup goes through esc(), attributes included. The only
 * literals left in this file are structure: class names, ids, and punctuation.
 */
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;
const UP = '<b aria-hidden="true">↗</b>';
const DOWN = '<b aria-hidden="true">↓</b>';
const pad2 = value => String(value).padStart(2, '0');

/** Resolve a booking option label from a service id — the only place ids become labels. */
const optionFor = id => services.items.find(service => service.id === id)?.option ?? '';

/**
 * A section title: an eyebrow above a heading whose second line is set in the italic accent
 * face. This is the one owner of the eyebrow + heading pattern, so a change to it lands in
 * one place. Both text values come from the section's data object; no copy is hardcoded.
 *
 * `level` exists because the hero is an h1. `separator` exists because the intro keeps its
 * wrapper on one line while the full-width sections put the heading on its own line.
 */
const title = ({ eyebrow, lead, accent }, { level = 'h2', separator = '\n' } = {}) =>
  `<p class="eyebrow"><i aria-hidden="true"></i> ${esc(eyebrow)}</p>${separator}<${level}>${esc(lead)}<br><em>${esc(accent)}</em></${level}>`;

const intro = section => `<div class="section-intro">
<div>${title(section, { separator: '' })}</div>
<p>${esc(section.aside)}</p>
</div>`;

/**
 * A photograph, at every width the pipeline generated for it. `src` is the widest candidate, so a
 * browser that ignores srcset still gets the full one; `sizes` comes from the data because
 * without it the browser assumes the image spans the viewport and fetches the widest file always,
 * which is the download this pipeline exists to stop.
 */
const img = (photo, { lazy = true, high = false, className = '' } = {}) =>
  `<img${className ? ` class="${esc(className)}"` : ''} src="${esc(largestPath(photo))}" srcset="${esc(srcset(photo))}" sizes="${esc(photo.sizes)}" alt="${esc(photo.alt)}"${lazy ? ' loading="lazy"' : ''} width="${esc(photo.width)}" height="${esc(photo.height)}"${high ? ' fetchpriority="high"' : ''}>`;

/**
 * What kind of entry this is, in the words drawn on the caption. A photograph of a room this
 * business cleaned and a drawing of a room it could clean are the same size in the layout and
 * completely different claims, so every entry says which one it is.
 */
const workKind = item =>
  `${esc(item.photos ? gallery.labels.job : gallery.labels.illustration)} · ${esc(item.tag)}`;

/**
 * The photographs of one finished visit, whole, in one row that fills the width.
 *
 * They are deliberately not cells in the comparison grid. Those cells are one fixed shape, because
 * a comparison only reads as one room while both sides are cropped the same way — and a portrait
 * photograph put through that crop would lose half of what it shows. A photograph taken to fit a
 * grid stops being evidence of what was actually there, which is the one thing it is on this page
 * for.
 *
 * The row's height comes from the frames themselves: each frame grows in proportion to its own
 * aspect ratio, and the set carries the sum of those ratios as its `aspect-ratio`. So a row of a
 * portrait, a square and a portrait fills the width with no crop and no letterbox, and one height
 * across the row keeps a tall frame from becoming a thumbnail. A single photograph is capped at its
 * master's width — it is shown as large as its own pixels allow and no larger — and its caption sits
 * beside it, where there is room.
 */
const workPhoto = item => {
  const ratios = item.photos.map(photo => photo.width / photo.height);
  const setRatio = ratios.reduce((sum, value) => sum + value, 0).toFixed(3);
  const single = item.photos.length === 1;
  const cap = single ? `; --set-max: ${item.photos[0].width}px` : '';
  return `<figure class="work-photo" data-count="${item.photos.length}" style="--set-ratio: ${setRatio}${cap}">
<div class="work-photo-set">
${item.photos
  .map((photo, index) => `<div class="work-photo-frame" style="--photo-ratio: ${ratios[index].toFixed(3)}">${img(photo, { className: 'work-photo-image' })}</div>`)
  .join('\n')}
</div>
<figcaption>
<span class="work-kind">${workKind(item)}</span>
<strong class="work-caption">${esc(item.caption)}</strong>
${item.detail ? `<p class="work-detail">${esc(item.detail)}</p>` : ''}
</figcaption>
</figure>`;
};

/**
 * A drawn pair on a sliding handle, or — while an entry has no image of its own — a panel set in
 * type, so the section keeps its shape instead of showing a gap.
 *
 * The control is a real `<input type="range">` laid over the frame rather than a div with pointer
 * handlers: it is focusable, it takes the arrow keys, and a screen reader announces it as a value,
 * which is the whole of the interaction here. The handle the eye sees is a sibling that follows
 * the input's value through one custom property — `--reveal` — so the drawing and the control
 * cannot disagree about where the edge is. The "before" image is the layer underneath and the
 * "after" one is clipped from that edge rightward, which is why the labels read in the order the
 * slider runs.
 */
const workCell = (item, index) => {
  const caption = `<figcaption>
<span class="work-kind">${workKind(item)}</span>
<strong class="work-caption">${esc(item.caption)}</strong>
</figcaption>`;
  if (!(item.before && item.after)) {
    return `<figure class="work-cell work-cell-empty">
<div class="cell-frame"><span class="cell-index" aria-hidden="true">${pad2(index + 1)}</span></div>
${caption}</figure>`;
  }
  return `<figure class="work-cell compare" style="--reveal: 52%">
<div class="cell-frame">
${img(item.before, { className: 'cell-image compare-before' })}
${img(item.after, { className: 'cell-image compare-after' })}
<span class="compare-edge" aria-hidden="true"></span>
<span class="compare-grip" aria-hidden="true"><i></i><i></i></span>
<span class="compare-label compare-label-before" aria-hidden="true">${esc(gallery.labels.before)}</span>
<span class="compare-label compare-label-after" aria-hidden="true">${esc(gallery.labels.after)}</span>
<input class="compare-range" type="range" min="0" max="100" value="52" step="1" aria-label="${esc(gallery.labels.compare)}: ${esc(item.tag)}">
</div>
${caption}</figure>`;
};

const brandBlock = () =>
  `<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(site.brand.lead)}<br><em>${esc(site.brand.tail)}</em></span>`;

/* --- sections ----------------------------------------------------------- */

export const announcement = () =>
  `<div class="announcement"><p>${esc(site.announcement)}</p><a href="#book">${esc(cta.book)} ${UP}</a></div>`;

export const header = () => `<header class="site-header" id="top">
<a class="brand" href="#top" aria-label="${esc(site.name)} ${esc(ui.brandHome)}">${brandBlock()}</a>
<nav class="main-nav" id="primary-nav" aria-label="${esc(ui.primaryNav)}">
${nav.map(item => `<a href="${esc(item.href)}">${esc(item.label)}</a>`).join('\n')}
</nav>
<div class="header-actions">
<a class="phone-link" href="${esc(site.phone.href)}">${icon('phone')}${esc(site.phone.label)}</a>
<a class="button button-dark" href="#book">${esc(cta.quote)} ${UP}</a>
<button class="menu-toggle" type="button" aria-label="${esc(ui.menuOpen)}" aria-expanded="false" aria-controls="primary-nav"><i></i><i></i></button>
</div>
</header>`;

export const heroSection = () => `<section class="hero section-pad">
<div class="hero-copy">
${title(hero, { level: 'h1' })}
<p class="hero-lede">${esc(hero.lede)}</p>
<div class="hero-actions">
<a class="button button-rose" href="${esc(hero.primary.href)}">${esc(hero.primary.label)} ${UP}</a>
<a class="under-link" href="${esc(hero.secondary.href)}">${esc(hero.secondary.label)} ${DOWN}</a>
</div>
<div class="hero-proof">
<span class="stars" aria-hidden="true">${esc(hero.rating.stars)}</span>
<span><strong>${esc(hero.rating.value)}</strong><small>${esc(hero.rating.note)}</small></span>
</div>
<p class="hero-area">Serving ${esc(site.serviceArea)}</p>
</div>
<div class="hero-art">
<div class="hero-photo">${img(hero.image, { lazy: false, high: true })}</div>
<div class="hero-card"><span aria-hidden="true">${esc(hero.card.index)}</span><strong>${esc(hero.card.lead)}<br><em>${esc(hero.card.accent)}</em></strong><small>${esc(hero.card.note)}</small></div>
<p class="hero-caption" aria-hidden="true">${esc(site.est)}</p>
</div>
</section>`;

export const trustStrip = () => `<section class="trust-strip section-pad" aria-label="${esc(ui.trustList)}">
<ul>
${trust.map(item => `<li>${icon(item.icon)}<strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></li>`).join('\n')}
</ul>
</section>`;

/** The "from" price or the custom-quote fallback, with its emphasis left in markup. */
const servicePrice = service => service.price.quote
  ? `${esc(services.priceQuote.lead)} <strong>${esc(services.priceQuote.accent)}</strong>`
  : `${esc(services.priceLead)} <strong>${esc(service.price.from)}</strong> ${esc(service.price.unit)}`;

export const servicesSection = () => `<section class="services section-pad" id="services">
${intro(services)}
<div class="service-grid">
${services.items.map((service, index) => `<article class="service-card">
<div class="card-body"><span class="card-index" aria-hidden="true">${pad2(index + 1)}</span><h3>${esc(service.title)}</h3><p>${esc(service.blurb)}</p><p class="card-price">${servicePrice(service)}</p><a class="card-link" href="#book" data-service="${esc(service.option)}">${esc(cta.bookService)} ${UP}</a></div>
</article>`).join('\n')}
</div>
</section>`;

export const pricingSection = () => `<section class="pricing section-pad" id="pricing">
${intro(pricing)}
<p class="pricing-rate"><span class="pricing-rate-main"><strong>${esc(pricing.rate.amount)}</strong><small>${esc(pricing.rate.unit)}</small></span> <span class="pricing-rate-floor">${esc(pricing.rate.floor.lead)} <strong>${esc(pricing.rate.floor.amount)}</strong> ${esc(pricing.rate.floor.tail)}</span></p>
<div class="pricing-grid">
${pricing.tiers.map(tier => `<article class="price-card${tier.featured ? ' price-featured' : ''}">
${tier.badge ? `<span class="price-badge">${esc(tier.badge)}</span>\n` : ''}<span class="price-tier">${esc(tier.name)}</span>
<p class="price-amount"><strong>${esc(tier.amount)}</strong><small>${esc(tier.unit)}</small></p>
<p class="price-for">${esc(tier.summary)}</p>
<ul class="price-list">
${tier.features.map(feature => `<li>${icon('check')}${esc(feature)}</li>`).join('\n')}
</ul>
<a class="button ${tier.featured ? 'button-rose' : 'button-outline'}" href="#book" data-service="${esc(optionFor(tier.cta.serviceId))}">${esc(tier.cta.label)}</a>
</article>`).join('\n')}
</div>
<p class="pricing-note">${esc(pricing.note)}</p>
</section>`;

export const whySection = () => `<section class="section-pad" id="why">
<div class="why-copy">
${title(why)}
<p>${esc(why.body)}</p>
<ul class="checklist">
${why.points.map(point => `<li>${icon('check')}<div><strong>${esc(point.title)}</strong><span>${esc(point.text)}</span></div></li>`).join('\n')}
</ul>
<a class="under-link" href="${esc(why.cta.href)}">${esc(why.cta.label)} ${UP}</a>
</div>
</section>`;

export const processSection = () => `<section class="process section-pad" id="approach">
${intro(process)}
<ol class="process-steps">
${process.steps.map((step, index) => `<li><span aria-hidden="true">${pad2(index + 1)}</span><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></li>`).join('\n')}
</ol>
</section>`;

export const gallerySection = () => {
  // Photographs first, then the drawn pairs: the section leads with what the business has actually
  // done and finishes with the standard it works to, and the visitor reads the distinction from
  // the label on each entry rather than from the order.
  const photographs = gallery.items.filter(item => item.photos);
  const cells = gallery.items.filter(item => !item.photos);
  return `<section class="work section-pad" id="work">
${intro(gallery)}
${photographs.length ? `<div class="work-photos">
${photographs.map(workPhoto).join('\n')}
</div>` : ''}
${cells.length ? `<div class="work-grid">
${cells.map(workCell).join('\n')}
</div>` : ''}
<p class="work-note">${esc(gallery.labels.note)}</p>
</section>`;
};

export const teamSection = () => `<section class="team section-pad" id="team">
<div class="team-copy">
${title(team)}
<p>${esc(team.body)}</p>
<p class="role">${esc(team.role)} <b aria-hidden="true">✦</b> ${esc(team.roleNote)}</p>
<a class="under-link" href="${esc(team.link.href)}" target="_blank" rel="noreferrer noopener">${esc(team.link.label)} ${UP}</a>
</div>
<div class="team-portrait">
${img(team.portrait)}
<p class="portrait-note" aria-hidden="true">${esc(team.portrait.label)}<br><span>${esc(team.portrait.note)}</span></p>
</div>
</section>`;

export const faqSection = () => `<section class="faq section-pad" id="faq">
${intro(faqs)}
<div class="faq-list">
${faqs.items.map(item => `<details><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`).join('\n')}
</div>
</section>`;

const field = ({ label, name, required, type, autocomplete, placeholder }) =>
  `<label>${esc(label)}<input${required ? ' required' : ''}${type ? ` type="${esc(type)}"` : ''} name="${esc(name)}"${autocomplete ? ` autocomplete="${esc(autocomplete)}"` : ''} placeholder="${esc(placeholder)}"></label>`;

export const bookingSection = () => `<section class="booking section-pad" id="book">
<div class="booking-copy">
${title(booking)}
<p>${esc(booking.body)}</p>
<ul class="booking-points">
${booking.points.map(point => `<li>${icon('check')}${esc(point)}</li>`).join('\n')}
</ul>
<div class="booking-contact">
<p class="contact-person">${esc(site.contact.name)} <span>${esc(site.contact.role)}</span></p>
<a href="${esc(site.phone.href)}">${icon('phone')}${esc(site.phone.label)}</a>
<a href="${esc(site.email.href)}">${icon('mail')}${esc(site.email.label)}</a>
</div>
</div>
<form class="booking-form" id="booking-form" data-endpoint="">
<div class="form-fields">
${booking.fields.map(group => `<div class="field-row">
${group.row.map(field).join('\n')}
</div>`).join('\n')}
<label>${esc(booking.serviceLabel)}<select required name="service" id="booking-service"><option value="" disabled selected>${esc(booking.selectPlaceholder)}</option>${services.items.map(service => `<option>${esc(service.option)}</option>`).join('')}</select></label>
<div class="field-row">
<label>${esc(booking.dateLabel)}<input required type="date" name="date" id="booking-date"></label>
<label>${esc(booking.timeLabel)}<select name="time"><option value="" disabled selected>${esc(booking.timePlaceholder)}</option>${booking.times.map(time => `<option>${esc(time)}</option>`).join('')}</select></label>
</div>
<label>${esc(booking.notes.label)}<textarea name="${esc(booking.notes.name)}" rows="4" placeholder="${esc(booking.notes.placeholder)}"></textarea></label>
<button class="button button-rose booking-submit" type="submit">${esc(booking.submit)} ${UP}</button>
<p class="form-note">${esc(booking.note)}</p>
</div>
<p class="form-success" tabindex="-1" role="status" aria-live="polite">${esc(booking.success)}</p>
<p class="form-error" role="alert">${esc(booking.error)}</p>
<button class="under-link booking-reset" type="button">${esc(booking.reset)}</button>
</form>
</section>`;

export const footerSection = () => `<footer class="site-footer">
<div class="footer-main">
<div class="footer-brand">
<a class="brand" href="#top">${brandBlock()}</a>
<p>${esc(footer.brandLine)}</p>
</div>
<nav class="footer-col" aria-label="${esc(footer.exploreTitle)}">
<h2>${esc(footer.exploreTitle)}</h2>
${nav.map(item => `<a href="${esc(item.href)}">${esc(item.label)}</a>`).join('\n')}
</nav>
<div class="footer-col">
<h2>${esc(footer.contactTitle)}</h2>
<p class="footer-person">${esc(site.contact.name)}<br><span>${esc(site.contact.role)}</span></p>
<a href="${esc(site.phone.href)}">${esc(site.phone.label)}</a>
<a href="${esc(site.email.href)}">${esc(site.email.label)}</a>
<a href="${esc(site.instagram)}" target="_blank" rel="noreferrer noopener">${esc(cta.instagram)}</a>
<a href="#book">${esc(cta.requestQuote)}</a>
<a href="links/">${esc(cta.links)}</a>
</div>
<div class="footer-col">
<h2>${esc(footer.hoursTitle)}</h2>
<p>${hoursText.map(esc).join('<br>')}</p>
<p>${footer.area.map(esc).join('<br>')}</p>
</div>
</div>
<div class="footer-bottom">
<span>© ${esc(site.year)} ${esc(site.name)}</span>
<span>${esc(footer.creditLead)} ${esc(site.city)}</span>
<a href="#top">${esc(footer.backToTop)}</a>
</div>
</footer>`;

export const mobileCta = () => `<div class="mobile-cta" id="mobile-cta">
<a class="button button-outline" href="${esc(site.phone.href)}">${icon('phone')}${esc(cta.call)}</a>
<a class="button button-rose" href="#book">${esc(cta.book)}</a>
</div>`;

/** Page sections in document order. Adding or reordering a section happens here. */
export const mainSections = [
  heroSection, trustStrip, servicesSection, pricingSection, whySection,
  processSection, gallerySection, teamSection,
  faqSection, bookingSection,
];
