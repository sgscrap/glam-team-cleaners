/**
 * What the registry has said, over time.
 *
 * `REGISTRAR_FACTS` is a single answer: the last one. A renewal overwrites the expiry, a hold
 * overwrites the status, and the fact that the domain was ever held — or that it expired and came
 * back — leaves no trace except a git log someone has to reconstruct from diffs. For a domain, the
 * sequence is the interesting part: `2027-09-17` replacing `2027-09-17` is nothing, but `2028-09-17`
 * replacing it is a renewal, and `clientHold` following `active` is a problem with a date attached.
 *
 * So the answers are kept, dated, in `registrar-history.json` — append-only, committed, and never
 * rewritten. One entry per *distinct answer*, not one per read: eighty identical nightly readings
 * are not a history, and a file that grows a line a day stops being read. The head of the file is
 * the current answer, which is what makes it checkable — `REGISTRAR_FACTS` and the last entry are
 * held to each other by the guards, so the timeline cannot end somewhere the runbook does not.
 *
 * Everything here is text in, text out; the commands that own the file do the writing.
 */
import { compareRegistrar } from './registrar.js';

/** The committed file. One JSON array, oldest first. */
export const HISTORY_FILE = 'registrar-history.json';

/** The fields an entry keeps — the facts, without the domain, which is the file's subject. */
export const HISTORY_FIELDS = ['observed', 'registrar', 'ianaId', 'statuses', 'registered', 'expires', 'nameservers', 'signed'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isDate = value => typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** One dated answer, in a fixed field order so the rendered file is stable byte for byte. */
export const historyEntry = (live, observed) => ({
  observed,
  registrar: live.registrar,
  ianaId: live.ianaId,
  statuses: [...(live.statuses ?? [])].map(String).sort(),
  registered: live.registered,
  expires: live.expires,
  nameservers: [...(live.nameservers ?? [])].map(String).sort(),
  signed: live.signed === true,
});

/** The fields that make two answers the same answer. `observed` is when, not what. */
const factsOf = entry => historyEntry(entry, entry.observed);

/**
 * Two answers, compared the way every other comparison here works — field by field, both values
 * kept — so a dedupe decision and a printed drift cannot disagree.
 */
export const sameAnswer = (left, right) => compareRegistrar(factsOf(left), factsOf(right)).ok;

/**
 * The timeline with this answer recorded, or the timeline unchanged.
 *
 * A reading that repeats the head is not recorded: the file is a history of what changed, and the
 * runbook says so rather than implying a line per night. A second change on a day already in the
 * file replaces that day's entry — a timeline is dated to the day, and two entries for one day
 * would make the order a guess.
 */
export const recordObservation = (entries, live, { today = new Date().toISOString().slice(0, 10) } = {}) => {
  const last = entries.at(-1) ?? null;
  if (last && sameAnswer(last, live)) return { entries, added: null, replaced: false };

  const entry = historyEntry(live, today);
  if (last && last.observed === today) {
    return { entries: [...entries.slice(0, -1), entry], added: entry, replaced: true };
  }
  return { entries: [...entries, entry], added: entry, replaced: false };
};

/**
 * The file's own schema, enforced rather than assumed: a closed set of fields, dates that move
 * forward, no two entries for one day. A hand edit that breaks any of that is an error here, where
 * it names the entry, instead of a timeline that quietly sorts itself wrong.
 */
export const parseHistory = text => {
  let entries;
  try {
    entries = JSON.parse(text);
  } catch (error) {
    throw new Error(`${HISTORY_FILE} is not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(entries)) throw new Error(`${HISTORY_FILE} must be a JSON array of dated answers`);
  if (!entries.length) throw new Error(`${HISTORY_FILE} holds no answers; it should start with the one the runbook records`);

  let previous = null;
  entries.forEach((entry, index) => {
    const where = `${HISTORY_FILE} entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${where} is not an object`);

    const missing = HISTORY_FIELDS.filter(field => !(field in entry));
    if (missing.length) throw new Error(`${where} is missing ${missing.join(', ')}`);

    const extra = Object.keys(entry).filter(field => !HISTORY_FIELDS.includes(field));
    if (extra.length) throw new Error(`${where} has fields nothing reads: ${extra.join(', ')}`);

    if (!isDate(entry.observed)) throw new Error(`${where} has no YYYY-MM-DD observed date`);
    if (!isDate(entry.registered)) throw new Error(`${where} has no registration date`);
    if (!isDate(entry.expires)) throw new Error(`${where} has no expiry date`);
    if (typeof entry.registrar !== 'string' || !entry.registrar) throw new Error(`${where} names no registrar`);
    if (typeof entry.ianaId !== 'number' || !Number.isInteger(entry.ianaId)) throw new Error(`${where} has no IANA ID`);
    if (typeof entry.signed !== 'boolean') throw new Error(`${where} has no DNSSEC state`);
    for (const field of ['statuses', 'nameservers']) {
      if (!Array.isArray(entry[field]) || entry[field].some(value => typeof value !== 'string' || !value)) {
        throw new Error(`${where} has a malformed ${field}`);
      }
    }

    if (previous && entry.observed <= previous) {
      throw new Error(
        `${where} is dated ${entry.observed}, which does not follow ${previous}; the file is a timeline and must stay in order`,
      );
    }
    previous = entry.observed;
  });

  return entries;
};

/** The file as committed: two-space JSON, one answer per block, a trailing newline for git. */
export const renderHistory = entries => `${JSON.stringify(entries, null, 2)}\n`;

/** The current answer, as the runbook records it. The head of the file has to be this. */
export const headOf = entries => entries.at(-1) ?? null;

/**
 * How the recorded facts differ from the head of the timeline — empty when the timeline ends where
 * the runbook does. `observed` is not compared: it is the date of the reading, not the reading.
 */
export const historyDrift = (entries, facts) => {
  const head = headOf(entries);
  if (!head) return null;
  return compareRegistrar(facts, factsOf(head)).checks.filter(check => !check.ok);
};
