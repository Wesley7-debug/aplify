/**
 * Crawl targets. Keep this module free of Node-only imports: the admin UI
 * imports it to populate the "specific city / trade" pickers.
 */

export interface CrawlPlace {
  /** Stable key used in the cursor and stored as the business city. */
  name: string;
  city: string;
  region: string;
  country: string;
  /** [south, west, north, east] */
  bbox: [number, number, number, number];
}

export const CRAWL_PLACES: CrawlPlace[] = [
  {
    name: "Lagos",
    city: "Lagos",
    region: "Lagos",
    country: "Nigeria",
    bbox: [6.4, 3.2, 6.7, 3.65],
  },
  {
    name: "Abuja",
    city: "Abuja",
    region: "Federal Capital Territory",
    country: "Nigeria",
    bbox: [8.95, 7.35, 9.15, 7.55],
  },
  {
    name: "Port Harcourt",
    city: "Port Harcourt",
    region: "Rivers",
    country: "Nigeria",
    bbox: [4.74, 6.92, 4.88, 7.08],
  },
  {
    name: "Ibadan",
    city: "Ibadan",
    region: "Oyo",
    country: "Nigeria",
    bbox: [7.3, 3.82, 7.48, 4.0],
  },
  {
    name: "Kano",
    city: "Kano",
    region: "Kano",
    country: "Nigeria",
    bbox: [11.93, 8.44, 12.08, 8.6],
  },
  {
    name: "Benin City",
    city: "Benin City",
    region: "Edo",
    country: "Nigeria",
    bbox: [6.28, 5.55, 6.4, 5.7],
  },
  {
    name: "Enugu",
    city: "Enugu",
    region: "Enugu",
    country: "Nigeria",
    bbox: [6.4, 7.45, 6.5, 7.55],
  },
  {
    name: "Kaduna",
    city: "Kaduna",
    region: "Kaduna",
    country: "Nigeria",
    bbox: [10.47, 7.38, 10.58, 7.5],
  },
  {
    name: "Jos",
    city: "Jos",
    region: "Plateau",
    country: "Nigeria",
    bbox: [9.87, 8.83, 9.96, 8.93],
  },
  {
    name: "Ilorin",
    city: "Ilorin",
    region: "Kwara",
    country: "Nigeria",
    bbox: [8.45, 4.5, 8.55, 4.62],
  },
  {
    name: "Abeokuta",
    city: "Abeokuta",
    region: "Ogun",
    country: "Nigeria",
    bbox: [7.12, 3.3, 7.2, 3.4],
  },
  {
    name: "Onitsha",
    city: "Onitsha",
    region: "Anambra",
    country: "Nigeria",
    bbox: [6.1, 6.75, 6.18, 6.85],
  },
  {
    name: "Uyo",
    city: "Uyo",
    region: "Akwa Ibom",
    country: "Nigeria",
    bbox: [5.0, 7.88, 5.08, 7.98],
  },
  {
    name: "Calabar",
    city: "Calabar",
    region: "Cross River",
    country: "Nigeria",
    bbox: [4.92, 8.28, 5.0, 8.38],
  },
  {
    name: "Warri",
    city: "Warri",
    region: "Delta",
    country: "Nigeria",
    bbox: [5.5, 5.7, 5.58, 5.8],
  },
  {
    name: "Owerri",
    city: "Owerri",
    region: "Imo",
    country: "Nigeria",
    bbox: [5.46, 7.0, 5.52, 7.08],
  },
  {
    name: "Akure",
    city: "Akure",
    region: "Ondo",
    country: "Nigeria",
    bbox: [7.22, 5.16, 7.3, 5.25],
  },
  {
    name: "Zaria",
    city: "Zaria",
    region: "Kaduna",
    country: "Nigeria",
    bbox: [11.04, 7.65, 11.12, 7.75],
  },
  {
    name: "Osogbo",
    city: "Osogbo",
    region: "Osun",
    country: "Nigeria",
    bbox: [7.74, 4.52, 7.8, 4.6],
  },
  {
    name: "Makurdi",
    city: "Makurdi",
    region: "Benue",
    country: "Nigeria",
    bbox: [7.7, 8.5, 7.76, 8.58],
  },
];

/** Can free-text trade list. Every entry resolves through lib/osm/tags.ts. */
export const CRAWL_TRADES = [
  "Restaurants",
  "Cafés",
  "Bakeries",
  "Fast food",
  "Bars",
  "Hotels",
  "Guest houses",
  "Dentists",
  "Clinics",
  "Pharmacies",
  "Hospitals",
  "Law firms",
  "Accountants",
  "Estate agents",
  "Plumbers",
  "Electricians",
  "Carpenters",
  "Auto repair shops",
  "Car dealers",
  "Gyms",
  "Schools",
  "Kindergartens",
  "Beauty salons",
  "Hairdressers",
  "Tailors",
  "Supermarkets",
  "Travel agencies",
  "Printers",
  "Couriers",
  "Architects",
];

export function findPlace(name: string | null | undefined): CrawlPlace | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return (
    CRAWL_PLACES.find(
      (place) =>
        place.name.toLowerCase() === needle ||
        place.city.toLowerCase() === needle ||
        needle.includes(place.name.toLowerCase()),
    ) ?? null
  );
}

export function findTrade(name: string | null | undefined): string | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return (
    CRAWL_TRADES.find(
      (trade) => trade.toLowerCase() === needle || trade.toLowerCase().includes(needle),
    ) ?? null
  );
}
