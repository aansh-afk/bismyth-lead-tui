import type {Config, Site} from './model.js';

export interface PortalCatalogEntry {
  home: string;
  searchUrl(city: string, intent: Config['intent']): string;
  projectPattern: string;
  /** Open an enquiry or contact surface; opening it is not proof of delivery. */
  openLabels: string[];
  /** Candidate final controls. Require form readiness and independent confirmation. */
  submitLabels: string[];
  contactMode: 'enquiry' | 'chat';
  contactHistoryPaths?: string[];
  /** Some entry pages require the browser to confirm city and transaction type. */
  searchNeedsSelection?: (city: string) => boolean;
  evidenceUrls: readonly string[];
}

function citySlug(city: string): string {
  const slug = city.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error('Choose an Indian city before finding properties.');
  return slug;
}

/**
 * Public navigation and visible label catalogue. It is deliberately not an
 * authentication, delivery, or seller-phone assertion. Evidence was checked
 * against official public pages on 2026-10-16; authenticated forms can differ.
 */
export const portalCatalog: Record<Site, PortalCatalogEntry> = {
  '99acres': {
    home: 'https://www.99acres.com/',
    searchUrl: (city, intent) => `https://www.99acres.com/${intent === 'buy' ? '' : 'rental-'}property-in-${citySlug(city)}-ffid`,
    projectPattern: '(?:-npxid-|-spid-)',
    openLabels: ['Contact', 'Contact Builder', 'Contact Owner', 'View Number', 'Get Callback'],
    submitLabels: ['Send Enquiry', 'Get Details', 'Submit', 'Contact'],
    contactMode: 'enquiry',
    evidenceUrls: ['https://www.99acres.com/'],
  },
  nobroker: {
    home: 'https://www.nobroker.in/',
    searchUrl: (city, intent) => `https://www.nobroker.in/flats-for-${intent === 'buy' ? 'sale' : 'rent'}-in-${citySlug(city)}_${citySlug(city)}`,
    projectPattern: '^/property/(?:buy|rent)/.+/detail/?$|^/new-projects/[^/?]+/[^/?]+/?$',
    openLabels: ['Get Owner Details', 'Contact Owner', 'Contact', 'Enquire Now'],
    submitLabels: ['Send Enquiry', 'Submit', 'Get Owner Details'],
    contactMode: 'enquiry', contactHistoryPaths: ['/profile/myContacts'],
    evidenceUrls: ['https://www.nobroker.in/flats-for-sale-in-mumbai_mumbai', 'https://www.nobroker.in/profile/myContacts'],
  },
  housing: {
    home: 'https://housing.com/',
    searchUrl: (city, intent) => `https://housing.com/in/${intent}/${citySlug(city)}/${citySlug(city)}`,
    projectPattern: '^/in/buy/(?:projects|resale)/page/[^/?]+/?$|^/rent/\\d[^/?]*/?$',
    openLabels: ['Contact Sellers', 'Contact Seller', 'Contact', 'Contact Developer', 'Contact Owner'],
    submitLabels: ['Submit', 'Send Enquiry', 'Get Contact Details', 'Contact Seller'],
    contactMode: 'enquiry',
    evidenceUrls: ['https://housing.com/in/buy/mumbai/mumbai'],
  },
  squareyards: {
    home: 'https://www.squareyards.com/',
    searchUrl: (city, intent) => `https://www.squareyards.com/${intent === 'buy' ? 'sale/property-for-sale' : 'rent/property-for-rent'}-in-${citySlug(city)}`,
    projectPattern: '^/(?:resale|rental)-[^/?]+/\\d+/?$|^/[^/?]+-residential-property/[^/?]+/\\d+/project/?$',
    openLabels: ['Request for Call', 'Contact Agent', 'Contact Owner', 'Get a Call Back', 'View Number'],
    submitLabels: ['Request for Call', 'Get a Call Back', 'Submit', 'Send Enquiry'],
    contactMode: 'enquiry',
    evidenceUrls: ['https://www.squareyards.com/sale/property-for-sale-in-mumbai', 'https://www.squareyards.com/resale-1-5-bhk-500-sq-ft-apartment-in-chandiwala-pearl-heaven/10738754'],
  },
  magicbricks: {
    home: 'https://www.magicbricks.com/',
    searchUrl: (city, intent) => `https://www.magicbricks.com/property-for-${intent === 'buy' ? 'sale' : 'rent'}-in-${citySlug(city)}-${intent === 'buy' ? 'pppfs' : 'pppfr'}`,
    projectPattern: '^/propertyDetails/[^/?]+-FOR-(?:Sale|Rent)-[^/?]+/?$|^/[^/?]+-pdpid-[a-f0-9]+/?$',
    openLabels: ['Contact Owner', 'Contact Agent', 'Contact Builder', 'Get Phone No.', 'Get Contact Details'],
    submitLabels: ['Get Contact Details', 'Contact Owner', 'Contact Agent', 'Submit', 'Send Enquiry'],
    contactMode: 'enquiry', contactHistoryPaths: ['/primedashboard/buyer-dashboard'],
    evidenceUrls: ['https://www.magicbricks.com/property-for-sale-in-mumbai-pppfs', 'https://www.magicbricks.com/property-for-rent-in-mumbai-pppfr'],
  },
  olx: {
    home: 'https://www.olx.in/',
    searchUrl: (city, intent) => `https://www.olx.in/for-${intent === 'buy' ? 'sale' : 'rent'}-houses-apartments_c${intent === 'buy' ? '1725' : '1723'}/q-${citySlug(city)}`,
    projectPattern: '^/item/(?:for-(?:sale|rent)-[^/?]+|[^/?]*property[^/?]*)-iid-\\d+/?$',
    openLabels: ['Chat with seller', 'Show number'],
    // Showing a number or opening a chat never counts as sending our details.
    submitLabels: ['Send'], contactMode: 'chat', searchNeedsSelection: () => true,
    evidenceUrls: ['https://www.olx.in/mumbai_g4058997/properties_c3', 'https://www.olx.in/item/for-sale-houses-apartments-c1725-2-bhk-flats-apartments-880-sq-ft-in-kalyan-east-mumbai-iid-1850164767'],
  },
  quikr: {
    home: 'https://www.quikr.com/',
    searchUrl: (city, intent) => citySlug(city) === 'mumbai'
      ? `https://www.quikr.com/homes/property/residential-for-${intent === 'buy' ? 'sale' : 'rent'}-in-Mumbai-cid_31`
      : `https://www.quikr.com/homes/city/${citySlug(city)}`,
    projectPattern: '^/homes/[^/?]+/p/\\d+/?$|^/homes/project/[^/?]+(?:%2[Bb]|\\+)\\d+/?$',
    openLabels: ['Contact Owner', 'Contact Broker', 'Contact Seller', 'Contact Builder'],
    submitLabels: ['Send Enquiry', 'Send Message', 'Contact Owner', 'Contact Broker', 'Submit'],
    contactMode: 'enquiry', searchNeedsSelection: city => citySlug(city) !== 'mumbai',
    evidenceUrls: ['https://www.quikr.com/homes/property/residential-for-sale-in-Mumbai-cid_31', 'https://www.quikr.com/homes/1-bhk-apartment-of-650sqft-for-sale-in-mumbai/p/375389152?source=qh'],
  },
};
