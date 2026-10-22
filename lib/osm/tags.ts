/**
 * Maps a free-text business type to concrete OpenStreetMap tag filters.
 *
 * OpenStreetMap keys every place with a `key=value` primary tag (for example
 * `shop=bakery`). We translate everyday language — including regional terms
 * such as "chop bar", "buka" and "vulcanizer" — into those tags. Unknown
 * phrases are fuzzy-matched before we fall back to a name search.
 */

export interface OsmFilter {
  key: string;
  value: string;
}

interface Rule {
  keywords: string[];
  filters: OsmFilter[];
  /** Broader tags to try when the primary pool is exhausted. */
  related?: OsmFilter[];
}

const A = (value: string): OsmFilter => ({ key: "amenity", value });
const S = (value: string): OsmFilter => ({ key: "shop", value });
const C = (value: string): OsmFilter => ({ key: "craft", value });
const O = (value: string): OsmFilter => ({ key: "office", value });
const H = (value: string): OsmFilter => ({ key: "healthcare", value });
const L = (value: string): OsmFilter => ({ key: "leisure", value });
const T = (value: string): OsmFilter => ({ key: "tourism", value });

const FOOD: OsmFilter[] = [A("restaurant"), A("fast_food"), A("cafe")];

const RULES: Rule[] = [
  {
    keywords: [
      "restaurant",
      "eatery",
      "diner",
      "bistro",
      "chop bar",
      "buka",
      "bukka",
      "food",
      "food joint",
      "canteen",
      "food court",
      "barbecue",
      "grill",
    ],
    filters: FOOD,
    related: [...FOOD, A("bar"), A("pub")],
  },
  {
    keywords: ["cafe", "coffee", "coffee shop", "espresso", "tea house", "ice cream"],
    filters: [A("cafe"), A("ice_cream")],
    related: [A("cafe"), A("fast_food")],
  },
  {
    keywords: ["bar", "pub", "brewery", "lounge", "nightclub", "wine bar"],
    filters: [A("bar"), A("pub"), A("nightclub")],
    related: [A("bar"), A("pub"), A("restaurant")],
  },
  {
    keywords: ["fast food", "takeaway", "takeout", "street food", "suya", "shawarma"],
    filters: [A("fast_food"), A("restaurant")],
    related: [A("fast_food"), A("cafe")],
  },
  {
    keywords: ["bakery", "baker", "patisserie", "pastry", "bread", "cake", "confectionery"],
    filters: [S("bakery"), S("confectionery"), S("pastry")],
    related: [S("bakery"), S("convenience"), S("supermarket")],
  },
  {
    keywords: ["butcher", "meat", "abattoir"],
    filters: [S("butcher"), S("meat")],
    related: [S("butcher")],
  },
  {
    keywords: ["greengrocer", "produce", "fruit", "vegetable", "farm"],
    filters: [S("greengrocer"), S("farm")],
    related: [S("greengrocer"), S("convenience")],
  },
  {
    keywords: ["supermarket", "grocery", "groceries", "provision", "provisions"],
    filters: [S("supermarket"), S("convenience"), S("greengrocer")],
    related: [S("supermarket"), S("convenience"), S("department_store")],
  },
  {
    keywords: ["convenience", "corner shop", "kiosk", "mini mart", "minimart"],
    filters: [S("convenience"), S("kiosk")],
    related: [S("convenience"), S("supermarket")],
  },
  { keywords: ["deli", "delicatessen"], filters: [S("deli")] },
  {
    keywords: ["dentist", "dental", "orthodont"],
    filters: [A("dentist")],
    related: [A("dentist"), A("clinic")],
  },
  {
    keywords: ["doctor", "gp", "physician", "medical centre", "medical center"],
    filters: [A("doctors"), A("clinic")],
    related: [A("doctors"), A("clinic"), A("hospital")],
  },
  {
    keywords: ["clinic", "medical", "diagnostic", "laboratory", "lab"],
    filters: [A("clinic"), H("laboratory"), A("doctors")],
    related: [A("clinic"), A("hospital")],
  },
  {
    keywords: ["veterinar", "vet", "animal hospital"],
    filters: [A("veterinary")],
    related: [A("veterinary"), S("pet")],
  },
  {
    keywords: ["pharmacy", "chemist", "drugstore", "drug store"],
    filters: [A("pharmacy")],
    related: [A("pharmacy"), S("chemist")],
  },
  {
    keywords: ["optician", "optometrist", "eyewear", "eye clinic"],
    filters: [S("optician"), A("optician")],
    related: [S("optician")],
  },
  {
    keywords: ["physiotherap", "physical therapy"],
    filters: [H("physiotherapist")],
  },
  {
    keywords: ["psycholog", "therapist", "counsel"],
    filters: [H("psychotherapist")],
  },
  {
    keywords: ["hospital", "maternity"],
    filters: [A("hospital")],
    related: [A("hospital"), A("clinic")],
  },
  {
    keywords: ["gym", "fitness", "crossfit"],
    filters: [L("fitness_centre")],
    related: [L("fitness_centre"), L("sports_centre")],
  },
  {
    keywords: ["yoga", "pilates"],
    filters: [L("fitness_centre"), A("yoga")],
    related: [L("fitness_centre")],
  },
  {
    keywords: ["hair", "hairdresser", "barber", "barbing", "barbing salon"],
    filters: [S("hairdresser")],
    related: [S("hairdresser"), S("beauty")],
  },
  {
    keywords: ["beauty", "salon", "nail", "spa", "makeup", "make up", "cosmetic"],
    filters: [S("beauty")],
    related: [S("beauty"), S("hairdresser"), S("cosmetics")],
  },
  { keywords: ["tattoo", "piercing"], filters: [S("tattoo")] },
  {
    keywords: ["lawyer", "law firm", "solicitor", "attorney", "legal", "notary"],
    filters: [O("lawyer"), O("notary")],
    related: [O("lawyer"), O("notary"), O("company")],
  },
  {
    keywords: ["accountant", "accounting", "bookkeep", "tax", "audit"],
    filters: [O("accountant"), O("tax_advisor")],
    related: [O("accountant"), O("financial")],
  },
  {
    keywords: ["insurance", "broker"],
    filters: [O("insurance"), O("financial")],
    related: [O("insurance"), O("financial")],
  },
  {
    keywords: ["estate agent", "real estate", "realtor", "property", "letting"],
    filters: [O("estate_agent")],
    related: [O("estate_agent"), O("property_management")],
  },
  {
    keywords: ["architect", "architecture"],
    filters: [O("architect")],
    related: [O("architect"), O("engineer")],
  },
  {
    keywords: ["interior", "interior design"],
    filters: [S("interior_decoration"), O("interior_design")],
    related: [S("interior_decoration"), S("furniture")],
  },
  {
    keywords: ["engineer", "engineering", "surveyor", "surveying"],
    filters: [O("engineer"), O("surveyor")],
    related: [O("engineer"), O("surveyor")],
  },
  {
    keywords: ["it", "software", "web", "tech", "computer", "cyber cafe", "phone repair"],
    filters: [O("it"), S("computer"), S("mobile_phone"), S("electronics")],
    related: [O("it"), S("computer"), S("electronics")],
  },
  {
    keywords: ["marketing", "advertising", "seo", "branding", "digital agency"],
    filters: [O("advertising_agency"), O("marketing")],
    related: [O("advertising_agency"), O("company")],
  },
  {
    keywords: ["travel", "tour", "tours", "travel agent"],
    filters: [S("travel_agency"), O("travel_agent")],
    related: [S("travel_agency"), T("hotel")],
  },
  {
    keywords: ["logistic", "freight", "courier", "shipping", "delivery"],
    filters: [O("logistics"), O("courier")],
    related: [O("logistics"), O("courier")],
  },
  {
    keywords: ["hotel", "lodge", "motel", "resort"],
    filters: [T("hotel"), T("motel"), T("resort")],
    related: [T("hotel"), T("guest_house"), T("apartment")],
  },
  {
    keywords: ["guesthouse", "guest house", "bed and breakfast", "bnb"],
    filters: [T("guest_house"), T("bed_and_breakfast")],
    related: [T("guest_house"), T("hotel")],
  },
  {
    keywords: ["hostel", "shortlet", "short let", "serviced apartment"],
    filters: [T("hostel"), T("apartment")],
    related: [T("hostel"), T("apartment"), T("guest_house")],
  },
  {
    keywords: ["plumber", "plumbing"],
    filters: [C("plumber")],
    related: [C("plumber"), S("doityourself")],
  },
  {
    keywords: ["electrician", "electrical", "solar", "generator", "inverter"],
    filters: [C("electrician"), S("electrical"), S("solar")],
    related: [C("electrician"), S("electrical")],
  },
  {
    keywords: ["carpenter", "joinery", "woodwork", "furniture maker"],
    filters: [C("carpenter"), C("joiner")],
    related: [C("carpenter"), S("furniture")],
  },
  {
    keywords: ["painter", "decorator", "painting"],
    filters: [C("painter")],
    related: [C("painter"), S("paint")],
  },
  {
    keywords: ["roofer", "roofing"],
    filters: [C("roofer")],
    related: [C("roofer"), S("building_materials")],
  },
  {
    keywords: ["welder", "welding", "metal work", "metalwork", "fabricator"],
    filters: [C("welder"), C("metal_construction")],
    related: [C("welder"), C("metal_construction")],
  },
  {
    keywords: ["tailor", "seamstress", "alteration", "fashion designer", "fashion"],
    filters: [S("tailor"), C("tailor"), S("clothes")],
    related: [S("tailor"), S("clothes")],
  },
  {
    keywords: ["auto repair", "car repair", "mechanic", "garage", "automotive", "vulcanizer", "panel beater"],
    filters: [S("car_repair"), S("tyres")],
    related: [S("car_repair"), S("car_parts"), S("tyres")],
  },
  {
    keywords: ["car wash", "carwash", "detailing"],
    filters: [A("car_wash")],
    related: [A("car_wash"), S("car_repair")],
  },
  {
    keywords: ["car dealer", "car sales", "automobile", "car hire", "car rental"],
    filters: [S("car"), S("car_rental")],
    related: [S("car"), S("car_repair")],
  },
  { keywords: ["tyre", "tire"], filters: [S("tyres")] },
  {
    keywords: ["florist", "flower", "flowers"],
    filters: [S("florist")],
    related: [S("florist"), S("gift")],
  },
  {
    keywords: ["bookshop", "bookstore", "books", "stationery"],
    filters: [S("books"), S("stationery")],
    related: [S("books"), S("stationery")],
  },
  {
    keywords: ["clothing", "clothes", "boutique", "fashion store", "apparel"],
    filters: [S("clothes")],
    related: [S("clothes"), S("shoes"), S("jewelry")],
  },
  { keywords: ["shoe", "shoes", "footwear"], filters: [S("shoes")] },
  { keywords: ["jewel", "jeweller", "jewelry"], filters: [S("jewelry")] },
  {
    keywords: ["furniture", "upholstery", "upholsterer"],
    filters: [S("furniture"), C("upholsterer")],
    related: [S("furniture"), S("interior_decoration")],
  },
  {
    keywords: ["hardware", "diy", "building materials", "building material", "tiles", "cement"],
    filters: [S("hardware"), S("doityourself"), S("building_materials")],
    related: [S("hardware"), S("building_materials"), S("paint")],
  },
  {
    keywords: ["laundry", "dry clean", "dry cleaning", "washing"],
    filters: [S("laundry"), S("dry_cleaning")],
    related: [S("laundry"), S("dry_cleaning")],
  },
  {
    keywords: ["pet", "pet shop", "aquarium"],
    filters: [S("pet")],
    related: [S("pet"), A("veterinary")],
  },
  {
    keywords: ["photo", "photograph", "photography", "videography", "video"],
    filters: [S("photo"), C("photographer")],
    related: [S("photo"), C("photographer")],
  },
  {
    keywords: ["driving school", "driving lesson"],
    filters: [A("driving_school")],
  },
  {
    keywords: ["language school", "language lesson"],
    filters: [A("language_school")],
  },
  {
    keywords: ["school", "tutor", "tutorial", "lesson", "coaching"],
    filters: [A("school"), A("language_school")],
    related: [A("school"), A("language_school"), A("kindergarten")],
  },
  {
    keywords: ["kindergarten", "nursery", "daycare", "creche", "creche"],
    filters: [A("kindergarten")],
    related: [A("kindergarten"), A("school")],
  },
  {
    keywords: ["catering", "caterer", "event planner", "event planning", "party"],
    filters: [A("restaurant"), O("event_management")],
    related: [A("restaurant"), A("fast_food")],
  },
  {
    keywords: ["printing", "printer", "print shop", "signage", "sign maker", "copyshop"],
    filters: [S("copyshop"), S("printing"), C("sign_maker")],
    related: [S("copyshop"), S("stationery")],
  },
  {
    keywords: ["electronics", "phone", "mobile phone", "gadget"],
    filters: [S("electronics"), S("mobile_phone")],
    related: [S("electronics"), S("computer")],
  },
  {
    keywords: ["air conditioning", "air conditioner", "hvac", "refrigeration"],
    filters: [C("hvac"), S("electronics")],
    related: [C("hvac"), S("electronics")],
  },
  {
    keywords: ["betting", "bookmaker", "bet shop"],
    filters: [S("bookmaker"), A("gambling")],
    related: [S("bookmaker")],
  },
  {
    keywords: ["market", "marketplace", "shopping mall", "mall"],
    filters: [A("marketplace"), S("mall"), S("department_store")],
    related: [A("marketplace"), S("mall"), S("department_store")],
  },
  {
    keywords: ["bank", "financial", "bureau de change", "forex"],
    filters: [A("bank"), A("bureau_de_change"), O("financial")],
    related: [A("bank"), O("financial")],
  },
  {
    keywords: ["fuel", "petrol", "gas station", "filling station"],
    filters: [A("fuel")],
    related: [A("fuel"), S("car_repair")],
  },
];

/** Keys we consider "business-like" for the generic name-match fallback. */
export const BUSINESS_KEYS = [
  "shop",
  "amenity",
  "craft",
  "office",
  "healthcare",
  "leisure",
  "tourism",
] as const;

/** Generic words that add nothing to a name match ("bike shops" → "bike"). */
export const FILLER_WORDS = new Set([
  "shop",
  "store",
  "outlet",
  "service",
  "company",
  "agency",
  "firm",
  "business",
  "centre",
  "center",
  "studio",
  "parlour",
  "parlor",
  "salon",
  "clinic",
  "practice",
]);

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude English singulariser — enough for trade names (bakeries → bakery). */
export function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function singularizePhrase(phrase: string): string {
  return phrase.split(" ").map(singularize).join(" ");
}

/** Reduce a phrase to its meaningful words, singularised. */
export function keyPhrase(input: string): string {
  const words = input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0 && !FILLER_WORDS.has(word))
    .map(singularize)
    .filter((word) => word.length > 0 && !FILLER_WORDS.has(word));

  return words.length > 0 ? words.join(" ") : singularize(input.toLowerCase().trim());
}

export type MatchMethod = "exact" | "fuzzy" | "fallback";

export interface AudienceMatch {
  filters: OsmFilter[];
  related: OsmFilter[];
  matched: boolean;
  method: MatchMethod;
  label: string | null;
}

interface KeywordEntry {
  rule: Rule;
  keyword: string;
}

const KEYWORD_INDEX: KeywordEntry[] = RULES.flatMap((rule) =>
  rule.keywords.map((keyword) => ({ rule, keyword: normalize(keyword) })).filter((entry) => entry.keyword),
);

function tokenMatches(tokens: string[], key: string): boolean {
  const stem = singularize(key);
  if (tokens.includes(key) || tokens.includes(stem)) return true;
  if (stem.length >= 5) {
    return tokens.some((token) => token.startsWith(stem) || stem.startsWith(token));
  }
  return false;
}

function exactMatch(phrase: string, tokens: string[]): KeywordEntry | null {
  let best: KeywordEntry | null = null;
  let bestLength = 0;

  for (const entry of KEYWORD_INDEX) {
    const isMatch = entry.keyword.includes(" ")
      ? phrase.includes(entry.keyword)
      : tokenMatches(tokens, entry.keyword);

    if (isMatch && entry.keyword.length > bestLength) {
      best = entry;
      bestLength = entry.keyword.length;
    }
  }

  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = new Array<number>(cols);
  let current = new Array<number>(cols);
  for (let col = 0; col < cols; col += 1) previous[col] = col;

  for (let row = 1; row < rows; row += 1) {
    current[0] = row;
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      current[col] = Math.min(
        previous[col] + 1,
        current[col - 1] + 1,
        previous[col - 1] + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[cols - 1];
}

function fuzzyMatch(phrase: string): KeywordEntry | null {
  let best: KeywordEntry | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const entry of KEYWORD_INDEX) {
    if (entry.keyword.length < 4) continue;
    const distance = levenshtein(phrase, entry.keyword);
    const allowed = entry.keyword.length >= 8 ? 2 : 1;
    if (distance > allowed) continue;
    const score = distance / entry.keyword.length;
    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return best;
}

export function matchAudience(audience: string): AudienceMatch {
  const phrase = normalize(audience);
  if (!phrase) {
    return { filters: [], related: [], matched: false, method: "fallback", label: null };
  }

  const tokens = phrase.split(" ").map(singularize);
  const exact = exactMatch(phrase, tokens);
  if (exact) {
    return {
      filters: exact.rule.filters,
      related: exact.rule.related ?? [],
      matched: true,
      method: "exact",
      label: exact.keyword,
    };
  }

  const fuzzy = fuzzyMatch(phrase) ?? fuzzyMatch(singularizePhrase(phrase));
  if (fuzzy) {
    return {
      filters: fuzzy.rule.filters,
      related: fuzzy.rule.related ?? [],
      matched: true,
      method: "fuzzy",
      label: fuzzy.keyword,
    };
  }

  return { filters: [], related: [], matched: false, method: "fallback", label: null };
}

/** Stable key for snapshot lookups. */
export function audienceKey(audience: string): string {
  const normalized = normalize(audience).replace(/\s+/g, "-");
  return normalized || "unknown";
}

/**
 * Accent- and case-insensitive form used for city/region/country matching.
 * Stored in the database next to the display value so lookups never depend on
 * SQLite's ASCII-only `lower()`.
 */
export function normalizePlacePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical trade key stored on every business, e.g. "restaurant",
 * "car-repair", "lawyer". The crawler and the search endpoint both derive it
 * through this function, so "law firms" and "lawyers" land on the same key.
 */
export function normalizeTradeKey(value: string): string {
  const phrase = keyPhrase(value.replace(/[_:]+/g, " "));
  return normalize(phrase).replace(/\s+/g, "-") || "business";
}

export function tradeKeyForFilters(filters: OsmFilter[]): string {
  const primary = filters[0];
  if (!primary) return "business";
  return normalizeTradeKey(primary.value);
}

/** Map a free-text audience to the same key the crawler writes. */
export function tradeKeyForAudience(audience: string): string {
  const match = matchAudience(audience);
  if (match.filters.length > 0) return tradeKeyForFilters(match.filters);
  return normalizeTradeKey(audience);
}

/** Adjacent trades that can fill a result list when the exact trade is thin. */
export function relatedTradeKeys(match: AudienceMatch): string[] {
  const keys = match.related.map((filter) => tradeKeyForFilters([filter]));
  return [...new Set(keys)].filter(
    (key) => key !== "business" && key !== tradeKeyForFilters(match.filters),
  );
}

const FILTER_TRADE_KEY = new Map<string, string>();
for (const rule of RULES) {
  for (const filter of rule.filters) {
    const id = `${filter.key}=${filter.value}`;
    if (!FILTER_TRADE_KEY.has(id)) FILTER_TRADE_KEY.set(id, normalizeTradeKey(filter.value));
  }
}

/** Best trade key for an OpenStreetMap tag bag (used by the seed importer). */
export function tradeKeyFromTags(tags: Record<string, string>): string | null {
  for (const key of BUSINESS_KEYS) {
    const value = tags[key];
    if (!value || value === "yes" || value === "no") continue;
    const known = FILTER_TRADE_KEY.get(`${key}=${value}`);
    if (known) return known;
  }

  // Business-like but unmapped values still get a stable trade key. Generic
  // amenities (benches, waste baskets, parking) are deliberately excluded.
  const NON_BUSINESS = new Set([
    "bench",
    "waste_basket",
    "waste_disposal",
    "parking",
    "parking_space",
    "bicycle_parking",
    "motorcycle_parking",
    "toilets",
    "drinking_water",
    "fountain",
    "shelter",
    "atm",
    "post_box",
    "telephone",
    "recycling",
    "vending_machine",
    "park",
    "playground",
    "pitch",
    "garden",
    "common",
    "nature_reserve",
    "attraction",
    "artwork",
    "viewpoint",
    "information",
    "picnic_site",
  ]);

  for (const key of BUSINESS_KEYS) {
    if (key === "amenity") continue;
    const value = tags[key];
    if (!value || value === "yes" || value === "no" || NON_BUSINESS.has(value)) continue;
    return normalizeTradeKey(value);
  }

  return null;
}

/** Stable key for a filter list (used for cache keys). */
export function filtersKey(filters: OsmFilter[]): string {
  return filters
    .map((filter) => `${filter.key}=${filter.value}`)
    .sort()
    .join("+");
}

const CATEGORY_KEYS = [
  "amenity",
  "shop",
  "craft",
  "office",
  "tourism",
  "leisure",
  "healthcare",
  "healthcare:speciality",
] as const;

function titleCase(value: string): string {
  return value
    .replace(/[_:]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const TRADE_LABELS = new Map<string, string>();
for (const rule of RULES) {
  for (const filter of rule.filters) {
    const key = normalizeTradeKey(filter.value);
    if (!TRADE_LABELS.has(key)) TRADE_LABELS.set(key, titleCase(filter.value));
  }
}

/** Human label for a stored trade key, e.g. "car-repair" → "Car Repair". */
export function labelForTradeKey(key: string): string {
  return TRADE_LABELS.get(key) ?? titleCase(key.replace(/-/g, " "));
}

/** Best-effort human label from an element's primary OpenStreetMap tag. */
export function humanizeCategory(tags: Record<string, string>, fallback: string): string {
  for (const key of CATEGORY_KEYS) {
    const value = tags[key];
    if (value && value !== "yes") return titleCase(value);
  }
  return titleCase(fallback);
}
