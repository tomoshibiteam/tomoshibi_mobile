export interface SpotCandidate {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  kinds?: string;
  address?: string;
  description?: string;
  tourism_summary?: string;
  tourism_keywords?: string[];
  rate?: number;
  wikidata?: string;
  distance_km?: number;
  source?: string;
}
