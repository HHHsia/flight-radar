import test from "node:test";
import assert from "node:assert/strict";
import type { TrackedDestination } from "../types/domain.js";
import { buildFlexibleSerpApiDateSlices } from "./serpapi.js";

test("buildFlexibleSerpApiDateSlices — single-day round trip yields one slice", () => {
  const destination: TrackedDestination = {
    id: "t1",
    originAirportCode: "TPE",
    destinationAirportCode: "NRT",
    tripType: "round_trip",
    cabinClass: "economy",
    currencyCode: "TWD",
    locale: "zh-TW",
    isActive: true,
    departureDateFrom: "2026-07-01",
    departureDateTo: "2026-07-01",
    returnDateFrom: "2026-07-20",
    returnDateTo: "2026-07-20"
  };

  const slices = buildFlexibleSerpApiDateSlices(destination);
  assert.equal(slices.length, 1);
  assert.deepEqual(slices[0], { outboundDate: "2026-07-01", returnDate: "2026-07-20" });
});

test("buildFlexibleSerpApiDateSlices — round trip grid is capped", () => {
  const destination: TrackedDestination = {
    id: "t2",
    originAirportCode: "TPE",
    destinationAirportCode: "NRT,HND",
    tripType: "round_trip",
    cabinClass: "economy",
    currencyCode: "TWD",
    locale: "zh-TW",
    isActive: true,
    departureDateFrom: "2026-07-01",
    departureDateTo: "2026-07-10",
    returnDateFrom: "2026-07-20",
    returnDateTo: "2026-07-30"
  };

  const slices = buildFlexibleSerpApiDateSlices(destination);
  assert.ok(slices.length > 1);
  assert.ok(slices.length <= 36);
  for (const slice of slices) {
    assert.ok(slice.returnDate !== undefined);
    assert.ok(slice.outboundDate <= slice.returnDate!);
  }
});

test("buildFlexibleSerpApiDateSlices — one-way date range is subsampled", () => {
  const destination: TrackedDestination = {
    id: "t3",
    originAirportCode: "TPE",
    destinationAirportCode: "NRT",
    tripType: "one_way",
    cabinClass: "economy",
    currencyCode: "TWD",
    locale: "zh-TW",
    isActive: true,
    departureDateFrom: "2026-07-01",
    departureDateTo: "2026-07-31"
  };

  const slices = buildFlexibleSerpApiDateSlices(destination);
  assert.ok(slices.length > 1);
  assert.ok(slices.length <= 14);
});
