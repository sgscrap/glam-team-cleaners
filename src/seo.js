import { site, business, hero, services, footer, openingHours, faqs } from './data.js';
import { ICON_LINKS } from './favicon.js';
import { esc, jsonBlock, GENERATED_NOTE } from './html.js';
import { largestPath } from './photos.js';

const pageUrl = `${site.url}/`;

/**
 * The image a share of this site shows, served from this site's own domain. Derived from
 * `site.url` rather than hand-written, so it moves with the canonical address instead of
 * pointing at whatever host the site used to live on.
 */
const socialCard = `${site.url}/${site.socialImage.file}`;

/**
 * The icon declarations, rendered from the one list that also tells the build guard what to expect
 * to find here — so the page cannot declare one path while the build checks another.
 */
const iconLinks = ICON_LINKS.map(({ rel, href, ...attributes }) => `<link rel="${rel}" href="${esc(href)}"${
  Object.entries(attributes).map(([name, value]) => ` ${name}="${value}"`).join('')}>`).join('\n');

/** The crawler files, named here so robots.txt and the build agree on one spelling. */
export const SITEMAP_FILE = 'sitemap.xml';
export const ROBOTS_FILE = 'robots.txt';

/** Exported so the build guard compares the published files against this one value. */
export const sitemapUrl = `${site.url}/${SITEMAP_FILE}`;

/**
 * The LocalBusiness record, built from the same content data the page renders —
 * contact details, opening hours, service area, and the service catalog all come
 * from their one existing home, so the page and the machine-readable record cannot
 * describe the business differently.
 *
 * Deliberately absent: `address` and `geo`. No street address or coordinates exist
 * anywhere in the data, and inventing them would put a false location into search
 * results. Add both here once the real values are known.
 */
export const structuredData = () => ({
  '@context': 'https://schema.org',
  '@type': business.type,
  '@id': `${pageUrl}#business`,
  name: site.name,
  description: site.description,
  url: pageUrl,
  telephone: site.phone.href.replace(/^tel:/, ''),
  email: site.email,
  image: `${site.url}/${largestPath(hero.image)}`,
  slogan: site.tagline,
  foundingDate: String(site.founded),
  areaServed: footer.area.join(' '),
  openingHours,
  sameAs: [site.instagram],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: business.catalogName,
    /**
     * Service names and descriptions only. Tier prices are omitted on purpose: the
     * page states they are starting rates confirmed by quote, so publishing them as
     * firm Offer prices would contradict the site.
     */
    itemListElement: services.items.map(service => ({
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: service.option,
        description: service.blurb,
        url: `${pageUrl}#services`,
      },
    })),
  },
});

/** schema.org @type for the FAQ block, shared with the build guard that keeps it in sync. */
export const FAQ_TYPE = 'FAQPage';

/**
 * The questions the page renders, as a FAQPage. One answer, two audiences: what a visitor
 * reads and what a search or answer engine reads are the same content, never a paraphrase.
 *
 * FAQ rich results have been limited to a small set of sites since 2023, so this is not
 * here to win a snippet. It is the machine-readable copy of the FAQ, and it is valid
 * markup either way.
 */
export const faqPage = () => ({
  '@context': 'https://schema.org',
  '@type': FAQ_TYPE,
  '@id': `${pageUrl}#faq`,
  mainEntity: faqs.items.map(item => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
});

/**
 * Everything inside <head>. Derived from `site` rather than hand-copied, so the tab
 * title, the search snippet, the social preview, and the structured data all
 * describe the same business from one set of facts. The record is embedded through
 * the shared jsonBlock helper, which handles safe serialisation inside a tag.
 */
export const head = () => `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(site.title)}</title>
<meta name="description" content="${esc(site.description)}">
<link rel="canonical" href="${esc(pageUrl)}">
${iconLinks}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(site.title)}">
<meta property="og:description" content="${esc(site.description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(socialCard)}">
<meta property="og:image:alt" content="${esc(site.socialImage.alt)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(site.title)}">
<meta name="twitter:description" content="${esc(site.description)}">
<meta name="twitter:image" content="${esc(socialCard)}">
${jsonBlock('application/ld+json', structuredData())}
${jsonBlock('application/ld+json', faqPage())}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,600;1,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">`;

/**
 * The sitemap. One page, so one <loc> — anchors are not separate URLs and listing them
 * would be noise. `lastmod` is deliberately absent: there is no honest date to publish,
 * inventing one would make the file differ on every build (the drift check compares
 * bytes), and Google ignores a lastmod it cannot verify.
 */
export const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${GENERATED_NOTE} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url>
<loc>${esc(pageUrl)}</loc>
</url>
</urlset>
`;

/**
 * robots.txt. On a site with nothing to hide the Sitemap line is the whole point of the
 * file: it is how crawlers are told where the sitemap lives.
 */
export const robots = () => `# ${GENERATED_NOTE}
User-agent: *
Allow: /

Sitemap: ${sitemapUrl}
`;
