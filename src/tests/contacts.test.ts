import test from 'node:test';
import assert from 'node:assert/strict';
import {deduplicateContacts, extractPublicContacts, normalizeIndianPhone} from '../contacts.js';

const sourceUrl = 'https://www.nobroker.in/property/buy/fixture/owner/detail';
const observedAt = '2026-10-15T09:00:00.000Z';

test('Indian phone normalisation accepts complete mobile numbers and rejects masks or foreign/fake numbers', () => {
  for (const raw of ['9876543210', '+91 98765-43210', '919876543210', '09876543210', '0091 98765 43210', '(98765) 43210']) {
    assert.equal(normalizeIndianPhone(raw), '+919876543210', raw);
  }
  for (const raw of ['+44 9876543210', '+9198765432', '98765xxxxx', '98****3210', '1234567890', '9999999999', '9876543210123', '91+9876543210', '9876543210 ext 2', '']) {
    assert.equal(normalizeIndianPhone(raw), undefined, raw);
  }
});

test('extracts public mobile/email candidates with exact source evidence and no inferred identity', () => {
  const markdown = '# Flat for sale\nOwner: Priya Rao\nMobile: +91 98765 43210\nEmail: priya@example.org\n';
  const contacts = extractPublicContacts({url: sourceUrl, markdown, observedAt});
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].value, '+919876543210');
  assert.equal(contacts[1].value, 'priya@example.org');
  for (const contact of contacts) {
    assert.equal(contact.review, 'needs-review');
    assert.equal(contact.whatsapp, 'unchecked');
    assert.equal(contact.name, undefined);
    assert.equal(contact.sourceUrl, sourceUrl);
    assert.equal(contact.observedAt, observedAt);
    assert.ok(markdown.includes(contact.evidence));
    assert.ok(contact.evidence.includes(contact.raw));
    assert.equal(contact.attributions?.length, 1);
  }
});

test('rejects support, portal footer, masked and incomplete contacts', () => {
  const markdown = '# Flat for sale\nOwner mobile: 98xxxxxx10\nEmail: sales@nobroker.in\n\n## Customer care\nPhone: 9876543210\nEmail: assistance@example.org\n\n## Support\n[Call](tel:+919876543210)\n';
  assert.deepEqual(extractPublicContacts({url: sourceUrl, markdown, observedAt}), []);
  assert.deepEqual(extractPublicContacts({url: sourceUrl, markdown: '# Seller\nCustomer support: 9876543210\n', observedAt}), []);
});

test('WhatsApp links mark contact kind but never assert WhatsApp availability', () => {
  const link = 'https://wa.me/919876543210';
  const contacts = extractPublicContacts({url: sourceUrl, markdown: `# Seller\n[WhatsApp owner](${link})`, links: [link], observedAt});
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].kind, 'whatsapp');
  assert.equal(contacts[0].value, '+919876543210');
  assert.equal(contacts[0].whatsapp, 'unchecked');
  assert.deepEqual(extractPublicContacts({url: sourceUrl, markdown: '# Seller\nContact on request.', links: [link], observedAt}), []);
});

test('deduplicates phone and WhatsApp across sources retaining every attribution and approved evidence', () => {
  const first = extractPublicContacts({url: sourceUrl, markdown: 'Owner Priya: 9876543210', observedAt})[0];
  const second = extractPublicContacts({url: 'https://housing.com/in/buy/resale/page/1-fixture', markdown: 'Sales team Priya: https://wa.me/919876543210', observedAt})[0];
  second.review = 'approved'; second.name = 'Priya'; second.role = 'sales';
  const deduplicated = deduplicateContacts([first, second, first]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].kind, 'whatsapp');
  assert.equal(deduplicated[0].review, 'approved');
  assert.equal(deduplicated[0].name, 'Priya');
  assert.equal(deduplicated[0].sourceUrl, second.sourceUrl);
  assert.equal(deduplicated[0].attributions?.length, 2);
  assert.deepEqual(new Set(deduplicated[0].attributions?.map(item => item.sourceUrl)), new Set([first.sourceUrl, second.sourceUrl]));
});

test('email keys are stable across casing and source hashes, and source URL credentials are rejected', () => {
  const first = extractPublicContacts({url: `${sourceUrl}#details`, markdown: 'Owner: Owner@Example.org', observedAt});
  const second = extractPublicContacts({url: sourceUrl, markdown: 'Email: owner@example.org', observedAt});
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].sourceUrl, sourceUrl);
  assert.equal(deduplicateContacts([...first, ...second]).length, 1);
  assert.throws(() => extractPublicContacts({url: 'https://user:pass@example.com', markdown: '9876543210'}), /public http/);
});

test('contacts late in a long paragraph retain bounded evidence centered around each actual match', () => {
  const markdown = '# Flat for sale\n' + 'Apartment description. '.repeat(100) + 'Owner Priya Rao: +91 98765 43210. Email: priya@example.org. ' + 'More apartment details. '.repeat(80);
  const contacts = extractPublicContacts({url: sourceUrl, markdown, observedAt});
  assert.equal(contacts.length, 2);
  for (const contact of contacts) {
    assert.ok(contact.evidence.length <= 700);
    assert.ok(contact.evidence.includes(contact.raw));
    assert.ok(markdown.includes(contact.evidence));
    assert.match(contact.evidence, /Owner Priya Rao/);
  }
});

test('sentence-ending punctuation does not hide public email addresses or become part of their values', () => {
  for (const punctuation of ['.', ',', ';', ')']) {
    const contacts = extractPublicContacts({url: sourceUrl, markdown: `Owner: Priya Rao. Email: priya@example.org${punctuation}`, observedAt});
    assert.equal(contacts.length, 1, punctuation);
    assert.equal(contacts[0].value, 'priya@example.org', punctuation);
  }
});
