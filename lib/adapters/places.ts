import { retry } from "../util/retry";
import { ExternalServiceError } from "../domain/errors";
import type { PlacesPort } from "../domain/ports";
import type { Candidate } from "../domain/types";
import type { KurumTur } from "../domain/enums";

export interface PlacesSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    websiteUri?: string;
    nationalPhoneNumber?: string;
  }>;
}

/** Kurum adından tür tahmini (sourcing'de Candidate.tur için). */
export function inferTur(name: string): KurumTur | null {
  // Türkçe ünsüz yumuşaması: "Polikliniği"/"Kliniği" → kök eşle ("poliklini"/"klini").
  const n = name.toLocaleLowerCase("tr");
  if (n.includes("hastane")) return "hastane";
  if (n.includes("poliklini")) return "poliklinik";
  if (n.includes("klini") || n.includes("muayene") || n.includes("veteriner")) return "muayenehane";
  return null;
}

type PlaceItem = NonNullable<PlacesSearchResponse["places"]>[number];

export function mapPlaceToCandidate(p: PlaceItem, city: string | null): Candidate {
  const name = p.displayName?.text ?? "";
  return {
    kurumAdi: name,
    sehir: city,
    tur: inferTur(name),
    website: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? null,
    placeId: p.id ?? null,
    kaynak: "places",
  };
}

export const placesAdapter: PlacesPort = {
  async searchClinics(query, opts = {}) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new ExternalServiceError("GOOGLE_PLACES_API_KEY tanımlı değil");
    try {
      const res = await retry(() =>
        fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber",
          },
          body: JSON.stringify({ textQuery: query, languageCode: "tr", regionCode: "TR" }),
        }),
      );
      if (!res.ok) throw new ExternalServiceError(`Places API ${res.status}`);
      const data = (await res.json()) as PlacesSearchResponse;
      const city = opts.city ?? null;
      return (data.places ?? []).map((p) => mapPlaceToCandidate(p, city));
    } catch (e) {
      if (e instanceof ExternalServiceError) throw e;
      throw new ExternalServiceError("Places arama hatası", e);
    }
  },
};
