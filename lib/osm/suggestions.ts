/**
 * Business-type suggestions shown as the user types.
 *
 * The list mirrors the trades we can translate into OpenStreetMap tags, so a
 * suggestion always maps to a query we know how to run. Users can still type
 * anything — free text falls back to a name match.
 */
export const BUSINESS_TYPES: string[] = [
  "Accountants",
  "Architects",
  "Auto repair shops",
  "Bakeries",
  "Barbers",
  "Bars",
  "Beauty salons",
  "Bookshops",
  "Buka / chop bars",
  "Butchers",
  "Cafés",
  "Car dealers",
  "Car hire",
  "Car wash",
  "Carpenters",
  "Catering",
  "Clothing boutiques",
  "Coffee shops",
  "Couriers",
  "Cyber cafés",
  "Dentists",
  "Doctors",
  "Driving schools",
  "Electricians",
  "Estate agents",
  "Event planners",
  "Fast food",
  "Florists",
  "Furniture shops",
  "Greengrocers",
  "Guest houses",
  "Gyms",
  "Hairdressers",
  "Hardware stores",
  "Hospitals",
  "Hotels",
  "Insurance brokers",
  "Interior designers",
  "Jewellers",
  "Kindergartens",
  "Laundry services",
  "Law firms",
  "Logistics companies",
  "Marketing agencies",
  "Markets",
  "Nail salons",
  "Opticians",
  "Pet shops",
  "Pharmacies",
  "Photographers",
  "Physiotherapists",
  "Plumbers",
  "Printers",
  "Psychologists",
  "Real estate agents",
  "Restaurants",
  "Roofers",
  "Schools",
  "Shoe shops",
  "Shortlets",
  "Software companies",
  "Solar installers",
  "Supermarkets",
  "Tailors",
  "Tattoo studios",
  "Travel agencies",
  "Veterinary clinics",
  "Vulcanizers",
  "Welding shops",
  "Yoga studios",
];

/** Case-insensitive prefix/substring filter, best matches first. */
export function filterBusinessTypes(input: string, limit = 6): string[] {
  const query = input.trim().toLowerCase();
  if (query.length === 0) return [];

  const startsWith: string[] = [];
  const contains: string[] = [];

  for (const type of BUSINESS_TYPES) {
    const lower = type.toLowerCase();
    if (lower.startsWith(query)) startsWith.push(type);
    else if (lower.includes(query)) contains.push(type);
  }

  return [...startsWith, ...contains].slice(0, limit);
}

/** Fallback cities for the location field before the geocoder responds. */
export const CITY_SUGGESTIONS: string[] = [
  "Lagos",
  "Abuja",
  "Port Harcourt",
  "Accra",
  "Nairobi",
  "London",
  "Manchester",
  "Birmingham",
  "New York",
  "Los Angeles",
  "Austin",
  "Toronto",
  "Berlin",
  "Amsterdam",
  "Paris",
  "Madrid",
  "Dubai",
  "Mumbai",
  "Singapore",
  "Sydney",
];

export function filterCities(input: string, limit = 6): string[] {
  const query = input.trim().toLowerCase();
  if (query.length === 0) return [];
  return CITY_SUGGESTIONS.filter((city) => city.toLowerCase().includes(query)).slice(
    0,
    limit,
  );
}
