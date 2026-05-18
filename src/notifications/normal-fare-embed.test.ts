import test from "node:test";
import assert from "node:assert/strict";
import { discordEmbedSchema } from "../schemas/domain.js";
import type { NormalizedFareObservation } from "../types/domain.js";
import { buildNormalFareEmbed } from "./normal-fare-embed.js";

test("buildNormalFareEmbed includes per-segment flight numbers and times from rawPayloadJson", () => {
  const rawPayload = {
    price: 25000,
    currency: "TWD",
    flights: [
      {
        departure_airport: { id: "TPE", time: "2026-07-05 09:10" },
        arrival_airport: { id: "NRT", time: "2026-07-05 13:40" },
        airline: "BR",
        flight_number: "BR198"
      },
      {
        departure_airport: { id: "NRT", time: "2026-07-20 18:05" },
        arrival_airport: { id: "TPE", time: "2026-07-20 21:15" },
        airline: "BR",
        flight_number: "BR199"
      }
    ],
    departure_date: "2026-07-05",
    return_date: "2026-07-20",
    deep_link: "https://example.com/booking"
  };

  const fare: NormalizedFareObservation = {
    trackedDestinationId: "tpe-tokyo",
    observedAt: "2026-05-18T12:00:00.000Z",
    provider: "serpapi",
    providerQueryKey: "serpapi:tpe-tokyo:TPE",
    originAirportCode: "TPE",
    destinationAirportCode: "NRT,HND",
    departDate: "2026-07-05",
    returnDate: "2026-07-20",
    tripType: "round_trip",
    cabinClass: "economy",
    priceAmountMinor: 2500000,
    currencyCode: "TWD",
    deepLink: "https://example.com/booking",
    flightFingerprint: "fp-test",
    rawPayloadJson: JSON.stringify(rawPayload)
  };

  const embed = buildNormalFareEmbed(fare);
  discordEmbedSchema.parse(embed);

  const itineraryField = embed.fields.find((field) => field.name.includes("航段"));
  assert.ok(itineraryField);
  assert.match(itineraryField!.value, /BR198/);
  assert.match(itineraryField!.value, /2026-07-05 09:10/);
  assert.match(itineraryField!.value, /BR199/);
  assert.match(itineraryField!.value, /2026-07-20 18:05/);
});
