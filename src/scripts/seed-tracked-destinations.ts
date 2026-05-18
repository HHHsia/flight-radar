import "dotenv/config";
import { createTursoClient, createTursoRepository } from "../db/repositories.js";
import { loadEnvironment, getTursoConnectionConfig } from "../config/env.js";

interface SeedTrackedDestinationRow {
  id: string;
  originAirportCode: string;
  destinationAirportCode: string;
  destinationCity?: string;
  destinationCountry?: string;
  tripType: "round_trip" | "one_way";
  cabinClass: "economy" | "premium_economy" | "business" | "first";
  departureDateFrom?: string;
  departureDateTo?: string;
  returnDateFrom?: string;
  returnDateTo?: string;
  maxStops?: number | null;
  currencyCode: string;
  locale: string;
}

const seedRows: SeedTrackedDestinationRow[] = [
  {
    id: "tpe-tas-skd-bhk-rt-econ-202702",
    originAirportCode: "TPE",
    destinationAirportCode: "TAS,SKD,BHK",
    destinationCity: "Tashkent / Samarkand / Bukhara",
    destinationCountry: "Uzbekistan",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2027-02-04",
    departureDateTo: "2027-02-13",
    returnDateFrom: "2027-02-18",
    returnDateTo: "2027-03-05",
    maxStops: 1,
    currencyCode: "TWD",
    locale: "zh-TW"
  },
  {
    id: "tpe-oka-rt-econ-202612",
    originAirportCode: "TPE",
    destinationAirportCode: "OKA",
    destinationCity: "Okinawa (Naha)",
    destinationCountry: "Japan",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-12-25",
    departureDateTo: "2026-12-28",
    returnDateFrom: "2026-12-29",
    returnDateTo: "2027-01-05",
    maxStops: 1,
    currencyCode: "TWD",
    locale: "zh-TW"
  }
];

async function main(): Promise<void> {
  const env = loadEnvironment();
  const client = createTursoClient(getTursoConnectionConfig(env));
  const repository = createTursoRepository(client);

  for (const row of seedRows) {
    await client.execute({
      sql: `
        INSERT OR REPLACE INTO tracked_destinations (
          id,
          origin_airport_code,
          destination_airport_code,
          destination_city,
          destination_country,
          trip_type,
          cabin_class,
          departure_date_from,
          departure_date_to,
          return_date_from,
          return_date_to,
          max_stops,
          currency_code,
          locale,
          is_active,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `,
      args: [
        row.id,
        row.originAirportCode,
        row.destinationAirportCode,
        row.destinationCity ?? null,
        row.destinationCountry ?? null,
        row.tripType,
        row.cabinClass,
        row.departureDateFrom ?? null,
        row.departureDateTo ?? null,
        row.returnDateFrom ?? null,
        row.returnDateTo ?? null,
        typeof row.maxStops === "number" ? row.maxStops : null,
        row.currencyCode,
        row.locale
      ]
    });
  }

  const activeDestinations = await repository.listActiveTrackedDestinations();

  console.log(`[seed-tracked-destinations] inserted or updated ${seedRows.length} rows`);
  console.log(`[seed-tracked-destinations] active tracked destinations: ${activeDestinations.length}`);

  for (const destination of activeDestinations) {
    console.log(
      `- ${destination.id}: ${destination.originAirportCode} -> ${destination.destinationAirportCode} (${destination.cabinClass})`
    );
  }

  await client.close();
}

void main().catch((error) => {
  console.error("[seed-tracked-destinations] failed", error);
  process.exitCode = 1;
});