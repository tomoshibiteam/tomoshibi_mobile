/**
 * Web 用ジオコーディング（Google Geocoding API）
 * 場所名・住所から緯度経度を取得
 */
export const geocodeAddress = async (
  address: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> => {
  if (!address.trim() || !apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&language=ja`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
  };
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
};
