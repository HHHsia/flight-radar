import "dotenv/config";
import { createTursoClient } from "../db/repositories.js";
import { loadEnvironment, getTursoConnectionConfig } from "../config/env.js";

interface SyncTrackedDestinationRow {
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
  isActive: number;
}

const trackedRows: SyncTrackedDestinationRow[] = [
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
    locale: "zh-TW",
    isActive: 1
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
    locale: "zh-TW",
    isActive: 1
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
    locale: "zh-TW",
    isActive: 1
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
    locale: "zh-TW",
    isActive: 1
  }
];

function formatSyncDateWindow(row: SyncTrackedDestinationRow): string {
  const dep = `${row.departureDateFrom ?? "?"}..${row.departureDateTo ?? "?"}`;
  if (row.tripType === "one_way") {
    return `dep ${dep}`;
  }

  return `dep ${dep} ret ${row.returnDateFrom ?? "?"}..${row.returnDateTo ?? "?"}`;
}

async function main(): Promise<void> {
  const jobStartedAt = Date.now();
  console.info(
    `[tracked-destinations-sync] start trackedRows=${trackedRows.length} at=${new Date().toISOString()}`
  );

  const env = loadEnvironment();
  const client = createTursoClient(getTursoConnectionConfig(env));

  const deactivateStartedAt = Date.now();
  await client.execute(`
    UPDATE tracked_destinations
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
  `);
  console.log(
    `[tracked-destinations-sync] deactivated all existing rows (${Date.now() - deactivateStartedAt}ms)`
  );

  const beforeResult = await client.execute(`
    SELECT
      id,
      origin_airport_code,
      destination_airport_code,
      cabin_class,
      trip_type,
      currency_code,
      locale,
      is_active
    FROM tracked_destinations
    ORDER BY origin_airport_code, destination_airport_code, id
  `);

  console.log(`[tracked-destinations-sync] before count: ${beforeResult.rows.length}`);
  for (const row of beforeResult.rows) {
    console.log(
      `- ${String(row.id)}: ${String(row.origin_airport_code)} -> ${String(row.destination_airport_code)} (${String(row.cabin_class)})`
    );
  }

  for (let index = 0; index < trackedRows.length; index++) {
    const row = trackedRows[index]!;
    const rowStartedAt = Date.now();
    console.info(
      `[tracked-destinations-sync] upsert ${index + 1}/${trackedRows.length} id=${row.id} ` +
        `${row.originAirportCode}->${row.destinationAirportCode} ${formatSyncDateWindow(row)}`
    );

    await client.execute({
      sql: `
        INSERT INTO tracked_destinations (
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
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          origin_airport_code = excluded.origin_airport_code,
          destination_airport_code = excluded.destination_airport_code,
          destination_city = excluded.destination_city,
          destination_country = excluded.destination_country,
          trip_type = excluded.trip_type,
          cabin_class = excluded.cabin_class,
          departure_date_from = excluded.departure_date_from,
          departure_date_to = excluded.departure_date_to,
          return_date_from = excluded.return_date_from,
          return_date_to = excluded.return_date_to,
          max_stops = excluded.max_stops,
          currency_code = excluded.currency_code,
          locale = excluded.locale,
          is_active = excluded.is_active,
          updated_at = CURRENT_TIMESTAMP
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
        row.locale,
        row.isActive
      ]
    });

    console.info(
      `[tracked-destinations-sync] upsert ok id=${row.id} ${Date.now() - rowStartedAt}ms`
    );
  }

  const afterResult = await client.execute(`
    SELECT
      id,
      origin_airport_code,
      destination_airport_code,
      cabin_class,
      trip_type,
      currency_code,
      locale,
      is_active
    FROM tracked_destinations
    ORDER BY origin_airport_code, destination_airport_code, id
  `);

  console.log(`[tracked-destinations-sync] synced rows: ${trackedRows.length}`);
  console.log(`[tracked-destinations-sync] after count: ${afterResult.rows.length}`);

  for (const row of afterResult.rows) {
    console.log(
      `- ${String(row.id)}: ${String(row.origin_airport_code)} -> ${String(row.destination_airport_code)} (${String(row.cabin_class)})`
    );
  }

  await client.close();
  console.info(
    `[tracked-destinations-sync] done total_elapsed=${Date.now() - jobStartedAt}ms at=${new Date().toISOString()}`
  );
}

void main().catch((error) => {
  console.error("[tracked-destinations-sync] failed", error);
  process.exitCode = 1;
});