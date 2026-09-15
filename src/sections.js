import {
  site, nav, ui, cta, hero, trust, services, pricing, why, process,
  gallery, team, testimonials, faqs, booking, footer, hoursText,
} from './data.js';
import { esc } from './html.js';

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
 * The eyebrow + heading pattern, with a single owner — every section title goes through
 * `title()` below, so a change to the pattern lands in one place.
 */
const eyebrowLine = text => `<p class="eyebrow"><i aria-hidden="true"></i> ${esc(text)}</p>`;

/**
 * A section title: an eyebrow above a heading whose second line is set in the italic accent
 * face. Both text values come from the section's data object, so no copy is hardcoded here.
 *
 * `level` exists because the hero is an h1. `separator` exists because the intro keeps its
 * wrapper on one line while the full-width sections put the heading on its own line.
 */
const title = ({ eyebrow, lead, accent }, { level = 'h2', separator = '\n' } = {}) =>
  `${eyebrowLine(eyebrow)}${separator}<${level}>${esc(lead)}<br><em>${esc(accent)}</em></${level}>`;

const intro = section => `<div class="section-intro">
<div>${title(section, { separator: '' })}</div>
<p>${esc(section.aside)}</p>
</div>`;

const img = ({ src, alt, width, height }, { lazy = true, high = false } = {}) =>
  `<img src="${esc(src)}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} width="${esc(width)}" height="${esc(height)}"${high ? ' fetchpriority="high"' : ''}>`;

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
<div class="card-media">${img(service.image)}</div>
<div class="card-body"><span class="card-index" aria-hidden="true">${pad2(index + 1)}</span><h3>${esc(service.title)}</h3><p>${esc(service.blurb)}</p><p class="card-price">${servicePrice(service)}</p><a class="card-link" href="#book" data-service="${esc(service.option)}">${esc(cta.bookService)} ${UP}</a></div>
</article>`).join('\n')}
</div>
</section>`;

export const pricingSection = () => `<section class="pricing section-pad" id="pricing">
${intro(pricing)}
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

export const whySection = () => `<section class="why section-pad" id="why">
<div class="why-media">${img(why.image)}</div>
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

export const gallerySection = () => `<section class="work section-pad" id="work">
${intro(gallery)}
<div class="work-grid">
${gallery.items.map(item => `<figure${item.size === 'large' ? ' class="work-large"' : ''}>${img(item)}<figcaption>${esc(item.tag)} <strong>${esc(item.caption)}</strong></figcaption></figure>`).join('\n')}
</div>
</section>`;

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

export const testimonialsSection = () => `<section class="testimonials section-pad" id="testimonials">
${intro(testimonials)}
<div class="testimonial-grid">
${testimonials.items.map(item => `<figure class="testimonial-card">
<blockquote>“${esc(item.quote)}”</blockquote>
<figcaption><strong>${esc(item.name)}</strong><span>${esc(item.meta)}</span></figcaption>
</figure>`).join('\n')}
</div>
<p class="placeholder-note">${esc(testimonials.note)}</p>
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
<a href="${esc(site.phone.href)}">${icon('phone')}${esc(site.phone.label)}</a>
<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>
</div>
</div>
<form class="booking-form" id="booking-form" data-endpoint="" data-email="${esc(site.email)}">
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
<a href="${esc(site.phone.href)}">${esc(site.phone.label)}</a>
<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>
<a href="${esc(site.instagram)}" target="_blank" rel="noreferrer noopener">${esc(cta.instagram)}</a>
<a href="#book">${esc(cta.requestQuote)}</a>
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
  processSection, gallerySection, teamSection, testimonialsSection,
  faqSection, bookingSection,
];
