import { serpApiFlightResultSchema } from "../schemas/domain.js";
import type { SerpApiFlightResult, TrackedDestination } from "../types/domain.js";

export interface SerpApiClient {
  searchFlights(destination: TrackedDestination): Promise<SerpApiFlightResult[]>;
}

export interface SerpApiClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** One SerpApi `google_flights` request: single outbound_date and optional return_date. */
export interface SerpApiDateSlice {
  outboundDate: string;
  returnDate?: string;
}

interface SerpApiSearchResponse {
  best_flights?: unknown;
  other_flights?: unknown;
}

const DEFAULT_SERPAPI_BASE_URL = "https://serpapi.com/search.json";

/** Caps SerpApi calls per tracked destination when date ranges are wide (each slice = one billable search). */
const MAX_ROUND_TRIP_DATE_SLICES = 36;
const MAX_ONE_WAY_DATE_SLICES = 14;

export function parseSerpApiFlightResults(payload: unknown): SerpApiFlightResult[] {
  if (!Array.isArray(payload)) {
    throw new Error("Expected SerpApi flights array");
  }

  return payload.flatMap((item, index) => {
    const normalized = normalizeSerpApiFlightResult(item);
    const parsed = serpApiFlightResultSchema.safeParse(normalized);

    if (!parsed.success) {
      console.warn(`[serpapi] skipped invalid flight result at index ${index}`, parsed.error.issues);
      return [];
    }

    return [parsed.data];
  });
}

export function createSerpApiClient(config: SerpApiClientConfig): SerpApiClient {
  const fetchImpl = config.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is not available for SerpApi client");
  }

  return {
    async searchFlights(destination: TrackedDestination): Promise<SerpApiFlightResult[]> {
      const slices = buildFlexibleSerpApiDateSlices(destination);
      const effectiveSlices = slices.length > 0 ? slices : [undefined];

      if (effectiveSlices.length > 1) {
        console.info(
          `[serpapi] flexible date search: ${effectiveSlices.length} slice(s) for destination ${destination.id}`
        );
      }

      const merged: SerpApiFlightResult[] = [];

      for (const slice of effectiveSlices) {
        const requestUrl = buildSerpApiUrl(destination, config, slice);
        const response = await fetchImpl(requestUrl, {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `SerpApi request failed with status ${response.status} url=${redactSerpApiUrlForLogs(requestUrl)} body=${errorText}`
          );
        }

        const payload = (await response.json()) as SerpApiSearchResponse;
        merged.push(...parseSerpApiSearchResponse(payload));
      }

      return dedupeSerpApiFlightResults(merged);
    }
  };
}

export function parseSerpApiSearchResponse(payload: unknown): SerpApiFlightResult[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Expected SerpApi response object");
  }

  const response = payload as SerpApiSearchResponse;
  const bestFlights = Array.isArray(response.best_flights) ? response.best_flights : [];
  const otherFlights = Array.isArray(response.other_flights) ? response.other_flights : [];

  return parseSerpApiFlightResults([...bestFlights, ...otherFlights]);
}

export function buildSerpApiUrl(
  destination: TrackedDestination,
  config: SerpApiClientConfig,
  dateSlice?: SerpApiDateSlice
): string {
  const baseUrl = config.baseUrl ?? DEFAULT_SERPAPI_BASE_URL;
  const url = new URL(baseUrl);
  const params = url.searchParams;

  params.set("engine", "google_flights");
  params.set("api_key", config.apiKey);
  params.set("departure_id", destination.originAirportCode);
  params.set("arrival_id", destination.destinationAirportCode);
  params.set("gl", extractGoogleMarket(destination.locale));
  params.set("hl", extractGoogleLanguage(destination.locale));
  params.set("currency", destination.currencyCode);
  params.set("type", destination.tripType === "one_way" ? "2" : "1");
  params.set("travel_class", mapCabinClass(destination.cabinClass));

  const outboundDate = dateSlice?.outboundDate ?? destination.departureDateFrom;
  const returnDate = dateSlice?.returnDate ?? destination.returnDateFrom;

  if (outboundDate) {
    params.set("outbound_date", outboundDate);
  }

  if (destination.tripType === "round_trip" && returnDate) {
    params.set("return_date", returnDate);
  }

  const stopsParam = mapMaxStopsToSerpApiStops(destination.maxStops);
  if (stopsParam !== undefined) {
    params.set("stops", stopsParam);
  }

  return url.toString();
}

/**
 * SerpApi `google_flights` only accepts one outbound_date / return_date per request (see
 * https://serpapi.com/google-flights-api ). When tracked_destinations store date *ranges*,
 * we expand into multiple slices (capped) so each slice maps to one API call.
 */
export function buildFlexibleSerpApiDateSlices(destination: TrackedDestination): SerpApiDateSlice[] {
  if (destination.tripType === "one_way") {
    return buildOneWayDateSlices(destination);
  }

  return buildRoundTripDateSlices(destination);
}

function buildOneWayDateSlices(destination: TrackedDestination): SerpApiDateSlice[] {
  const from = destination.departureDateFrom;
  if (!from) {
    return [];
  }

  const to = destination.departureDateTo ?? from;
  if (to < from) {
    return [{ outboundDate: from }];
  }

  const days = enumerateIsoDatesInclusive(from, to);
  const sampled = subsampleEvenlyByIndex(days, MAX_ONE_WAY_DATE_SLICES);
  return sampled.map((outboundDate) => ({ outboundDate }));
}

function buildRoundTripDateSlices(destination: TrackedDestination): SerpApiDateSlice[] {
  const depFrom = destination.departureDateFrom;
  const retFrom = destination.returnDateFrom;
  if (!depFrom || !retFrom) {
    return [];
  }

  const depTo = destination.departureDateTo ?? depFrom;
  const retTo = destination.returnDateTo ?? retFrom;

  if (depTo < depFrom || retTo < retFrom) {
    return [{ outboundDate: depFrom, returnDate: retFrom }];
  }

  const outboundDays = enumerateIsoDatesInclusive(depFrom, depTo);
  const returnDays = enumerateIsoDatesInclusive(retFrom, retTo);
  const pairs: SerpApiDateSlice[] = [];

  for (const outboundDate of outboundDays) {
    for (const returnDate of returnDays) {
      if (compareIsoDateStrings(returnDate, outboundDate) >= 0) {
        pairs.push({ outboundDate, returnDate });
      }
    }
  }

  if (pairs.length === 0) {
    return [{ outboundDate: depFrom, returnDate: retFrom }];
  }

  pairs.sort((left, right) => {
    const byOut = left.outboundDate.localeCompare(right.outboundDate);
    if (byOut !== 0) {
      return byOut;
    }

    return (left.returnDate ?? "").localeCompare(right.returnDate ?? "");
  });

  return subsampleEvenlyByIndex(pairs, MAX_ROUND_TRIP_DATE_SLICES);
}

function enumerateIsoDatesInclusive(from: string, to: string): string[] {
  const startMs = parseIsoDateUtcMs(from);
  const endMs = parseIsoDateUtcMs(to);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return [from];
  }

  const dayMs = 86400000;
  const dates: string[] = [];
  for (let t = startMs; t <= endMs; t += dayMs) {
    dates.push(formatIsoDateUtc(new Date(t)));
  }

  return dates.length > 0 ? dates : [from];
}

function parseIsoDateUtcMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) {
    return NaN;
  }

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatIsoDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compareIsoDateStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function subsampleEvenlyByIndex<T>(items: T[], max: number): T[] {
  if (items.length <= max) {
    return items;
  }

  const indices = new Set<number>();
  const last = max - 1;
  for (let i = 0; i < max; i++) {
    const position = last === 0 ? 0 : i / last;
    indices.add(Math.round(position * (items.length - 1)));
  }

  return [...indices]
    .sort((left, right) => left - right)
    .map((index) => items[index]!);
}

/**
 * SerpApi `stops` filter (https://serpapi.com/google-flights-api#api-parameters-advanced-filters-stops):
 * `1` nonstop, `2` one stop or fewer, `3` two stops or fewer, `0` any.
 * Our `max_stops` is "maximum number of stops", so map accordingly.
 */
function mapMaxStopsToSerpApiStops(maxStops: TrackedDestination["maxStops"]): string | undefined {
  if (typeof maxStops !== "number" || !Number.isFinite(maxStops)) {
    return undefined;
  }

  if (maxStops <= 0) {
    return "1";
  }

  if (maxStops === 1) {
    return "2";
  }

  if (maxStops === 2) {
    return "3";
  }

  return "0";
}

function dedupeSerpApiFlightResults(results: SerpApiFlightResult[]): SerpApiFlightResult[] {
  const seen = new Set<string>();
  const out: SerpApiFlightResult[] = [];

  for (const result of results) {
    const key = buildSerpApiResultDedupeKey(result);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(result);
  }

  return out;
}

function buildSerpApiResultDedupeKey(result: SerpApiFlightResult): string {
  const legs = result.flights
    .map((flight) =>
      [
        flight.departure_airport?.id,
        flight.departure_airport?.time,
        flight.arrival_airport?.id,
        flight.arrival_airport?.time,
        flight.airline,
        flight.flight_number
      ].join(":")
    )
    .join("|");

  return [result.departure_date, result.return_date, String(result.price), legs].join("#");
}

function redactSerpApiUrlForLogs(url: string): string {
  return url.replace(/api_key=[^&]+/u, "api_key=REDACTED");
}

function normalizeSerpApiFlightResult(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const result = { ...(payload as Record<string, unknown>) };

  if (typeof result.price !== "number") {
    const extractedPrice = extractNumericPrice(result.price);

    if (typeof extractedPrice === "number") {
      result.price = extractedPrice;
    }
  }

  return result;
}

function extractNumericPrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (normalized) {
      return Number(normalized[0]);
    }
  }

  return undefined;
}

function mapCabinClass(cabinClass: TrackedDestination["cabinClass"]): string {
  switch (cabinClass) {
    case "economy":
      return "1";
    case "premium_economy":
      return "2";
    case "business":
      return "3";
    case "first":
      return "4";
    default:
      return "1";
  }
}

function extractGoogleLanguage(locale: string): string {
  const normalized = locale.trim().replace("_", "-");
  const parts = normalized.split("-");
  const language = (parts[0] ?? "en").toLowerCase();
  const region = parts[1]?.toUpperCase();

  // SerpApi Google Flights rejects bare `hl=zh`; use a regional tag.
  if (language === "zh") {
    if (region === "TW" || region === "HK" || region === "MO") {
      return `${language}-${region}`;
    }

    return "zh-TW";
  }

  return region ? `${language}-${region.toLowerCase()}` : language;
}

function extractGoogleMarket(locale: string): string {
  const [, region] = locale.split(/[-_]/);
  return (region || "us").toLowerCase();
}
