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

// 與 sync-tracked-destinations.ts 的 trackedRows 保持一致，避免本機 seed 與 CI sync 結果不一致。
const seedRows: SeedTrackedDestinationRow[] = [
  {
    id: "tpe-tas-skd-bhk-rt-econ-202702",
    originAirportCode: "TPE",
    destinationAirportCode: "TAS,SKD,BHK",
    destinationCity: "Tashkent / Samarkand / Bukhara",
    destinationCountry: "Uzbekistan",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2027-02-03",
    departureDateTo: "2027-02-04",
    returnDateFrom: "2027-02-13",
    returnDateTo: "2027-02-14",
    maxStops: 1,
    currencyCode: "TWD",
    locale: "zh-TW"
  },
  {
    id: "icn-tas-skd-bhk-rt-econ-202702",
    originAirportCode: "ICN",
    destinationAirportCode: "TAS,SKD,BHK",
    destinationCity: "Tashkent / Samarkand / Bukhara",
    destinationCountry: "Uzbekistan",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2027-02-03",
    departureDateTo: "2027-02-04",
    returnDateFrom: "2027-02-13",
    returnDateTo: "2027-02-14",
    maxStops: 1,
    currencyCode: "TWD",
    locale: "zh-TW"
  },
  {
    id: "tpe-svo-dme-vko-rt-econ-202702",
    originAirportCode: "TPE",
    destinationAirportCode: "SVO,DME,VKO",
    destinationCity: "Moscow",
    destinationCountry: "Russia",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2027-02-03",
    departureDateTo: "2027-02-04",
    returnDateFrom: "2027-02-13",
    returnDateTo: "2027-02-14",
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
    departureDateFrom: "2026-12-24",
    departureDateTo: "2026-12-25",
    returnDateFrom: "2026-12-27",
    returnDateTo: "2026-12-28",
    maxStops: 1,
    currencyCode: "TWD",
    locale: "zh-TW"
  }
];

function formatDateWindow(row: SeedTrackedDestinationRow): string {
  const dep = `${row.departureDateFrom ?? "?"}..${row.departureDateTo ?? "?"}`;
  if (row.tripType === "one_way") {
    return `dep ${dep}`;
  }

  return `dep ${dep} ret ${row.returnDateFrom ?? "?"}..${row.returnDateTo ?? "?"}`;
}

async function main(): Promise<void> {
  const jobStartedAt = Date.now();
  console.info(
    `[seed-tracked-destinations] start rows=${seedRows.length} at=${new Date().toISOString()}`
  );

  const env = loadEnvironment();
  const client = createTursoClient(getTursoConnectionConfig(env));
  const repository = createTursoRepository(client);

  for (let index = 0; index < seedRows.length; index++) {
    const row = seedRows[index]!;
    const rowStartedAt = Date.now();
    console.info(
      `[seed-tracked-destinations] upsert ${index + 1}/${seedRows.length} id=${row.id} ` +
        `${row.originAirportCode}->${row.destinationAirportCode} ${formatDateWindow(row)}`
    );

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

    console.info(
      `[seed-tracked-destinations] upsert ok id=${row.id} ${Date.now() - rowStartedAt}ms`
    );
  }

  const listStartedAt = Date.now();
  const activeDestinations = await repository.listActiveTrackedDestinations();
  console.info(`[seed-tracked-destinations] listActiveTrackedDestinations ${Date.now() - listStartedAt}ms`);

  console.log(`[seed-tracked-destinations] inserted or updated ${seedRows.length} rows`);
  console.log(`[seed-tracked-destinations] active tracked destinations: ${activeDestinations.length}`);

  for (const destination of activeDestinations) {
    console.log(
      `- ${destination.id}: ${destination.originAirportCode} -> ${destination.destinationAirportCode} (${destination.cabinClass})`
    );
  }

  await client.close();
  console.info(
    `[seed-tracked-destinations] done total_elapsed=${Date.now() - jobStartedAt}ms at=${new Date().toISOString()}`
  );
}

void main().catch((error) => {
  console.error("[seed-tracked-destinations] failed", error);
  process.exitCode = 1;
});