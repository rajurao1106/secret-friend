import { find as findTimezone } from 'geo-tz';
import { z } from 'zod';

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly timezone: string;
}

export interface GeocodingService {
  search(query: string): Promise<Place[]>;
}

const nominatimPlaceSchema = z.array(
  z.object({
    place_id: z.union([z.string(), z.number()]),
    display_name: z.string(),
    lat: z.string(),
    lon: z.string(),
  }),
);

export class NominatimGeocodingService implements GeocodingService {
  async search(query: string): Promise<Place[]> {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('addressdetails', '0');

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SecretFriend/1.0 (location search)',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OpenStreetMap geocoding failed with ${response.status}`);
    }

    const places = nominatimPlaceSchema.parse(await response.json());
    return places.map((place) => {
      const lat = Number(place.lat);
      const lng = Number(place.lon);
      const timezone = findTimezone(lat, lng)[0];
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || timezone === undefined) {
        throw new Error('OpenStreetMap returned a place without a timezone');
      }

      return {
        id: String(place.place_id),
        name: place.display_name,
        lat,
        lng,
        timezone,
      };
    });
  }
}
