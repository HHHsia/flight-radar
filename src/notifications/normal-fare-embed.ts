import { serpApiFlightResultSchema } from "../schemas/domain.js";
import type { DiscordEmbed, NormalizedFareObservation } from "../types/domain.js";

export interface NormalFarePriceComparison {
  thirdLowestPriceAmountMinor?: number;
  historicalLowestPriceAmountMinor?: number;
}

const DISCORD_EMBED_FIELD_VALUE_MAX = 1024;

export function buildNormalFareEmbed(
  fare: NormalizedFareObservation,
  comparison: NormalFarePriceComparison = {}
): DiscordEmbed {
  const itineraryValue = buildItineraryFieldValue(fare);

  return {
    title: `Cheap fare found: ${fare.originAirportCode} -> ${fare.destinationAirportCode}`,
    description: buildDescription(comparison),
    url: fare.deepLink,
    color: 0x2ecc71,
    fields: [
      { name: "Price", value: formatMoney(fare.currencyCode, fare.priceAmountMinor), inline: true },
      { name: "Trip", value: fare.tripType, inline: true },
      { name: "Cabin", value: fare.cabinClass, inline: true },
      { name: "Source", value: buildSourceLabel(fare), inline: true },
      { name: "Departure", value: fare.departDate ?? "unknown", inline: true },
      { name: "Return", value: fare.returnDate ?? "unknown", inline: true },
      { name: "航段（班機編號／時間）", value: itineraryValue, inline: false },
      { name: "Price vs history", value: buildPriceComparison(fare, comparison), inline: false }
    ],
    timestamp: fare.observedAt
  };
}

function buildDescription(comparison: NormalFarePriceComparison): string {
  if (typeof comparison.thirdLowestPriceAmountMinor === "number") {
    return "New fare entered the historical top 3 for this destination.";
  }

  return "New fare found while historical baseline is still being built.";
}

function buildSourceLabel(fare: NormalizedFareObservation): string {
  return fare.providerQueryKey;
}

function buildPriceComparison(
  fare: NormalizedFareObservation,
  comparison: NormalFarePriceComparison
): string {
  const lines: string[] = [];

  if (typeof comparison.historicalLowestPriceAmountMinor === "number") {
    const delta = fare.priceAmountMinor - comparison.historicalLowestPriceAmountMinor;
    const sign = delta <= 0 ? "below" : "above";
    lines.push(
      `Lowest seen: ${formatMoney(fare.currencyCode, comparison.historicalLowestPriceAmountMinor)} (${formatMoney(fare.currencyCode, Math.abs(delta))} ${sign})`
    );
  }

  if (typeof comparison.thirdLowestPriceAmountMinor === "number") {
    const delta = comparison.thirdLowestPriceAmountMinor - fare.priceAmountMinor;
    const percentage = comparison.thirdLowestPriceAmountMinor > 0
      ? ((delta / comparison.thirdLowestPriceAmountMinor) * 100).toFixed(1)
      : "0.0";

    lines.push(
      `Top-3 threshold: ${formatMoney(fare.currencyCode, comparison.thirdLowestPriceAmountMinor)} (${formatMoney(fare.currencyCode, Math.abs(delta))} cheaper, ${percentage}% below)`
    );
  }

  if (lines.length === 0) {
    return "Not enough historical fares yet.";
  }

  return lines.join("\n");
}

function formatMoney(currencyCode: string, amountMinor: number): string {
  return `${currencyCode} ${(amountMinor / 100).toFixed(2)}`;
}

function buildItineraryFieldValue(fare: NormalizedFareObservation): string {
  try {
    const payload: unknown = JSON.parse(fare.rawPayloadJson);
    const parsed = serpApiFlightResultSchema.safeParse(payload);

    if (!parsed.success) {
      return "（SerpApi 原始資料無法解析為航班列表）";
    }

    const { flights } = parsed.data;
    if (flights.length === 0) {
      return "（SerpApi 未回傳航段明細）";
    }

    const lines = flights.map((flight, index) => {
      const flightNo = flight.flight_number?.trim() || "—";
      const airline = flight.airline?.trim();
      const depId = flight.departure_airport?.id?.trim() || "?";
      const depTime = flight.departure_airport?.time?.trim() || "?";
      const arrId = flight.arrival_airport?.id?.trim() || "?";
      const arrTime = flight.arrival_airport?.time?.trim() || "?";
      const airlineSuffix = airline ? `（${airline}）` : "";

      return `第 ${index + 1} 段｜**${flightNo}**｜${depId} **${depTime}** → ${arrId} **${arrTime}**${airlineSuffix}`;
    });

    return clampDiscordFieldValue(lines.join("\n"));
  } catch {
    return "（無法讀取航段 JSON）";
  }
}

function clampDiscordFieldValue(text: string): string {
  if (text.length <= DISCORD_EMBED_FIELD_VALUE_MAX) {
    return text;
  }

  const suffix = "\n…（以下略，完整行程見連結）";
  const budget = DISCORD_EMBED_FIELD_VALUE_MAX - suffix.length;
  return text.slice(0, Math.max(1, budget)) + suffix;
}
