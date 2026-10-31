// Afstanden en adres opzoeken (PDOK Locatieserver, openbare dienst van de Nederlandse overheid).

/** Hemelsbreed in km, maal 1,25 als schatting van de echte route */
export function distanceKm(a: { lat: number; lon: number }, b: { lat?: number; lon?: number }): number {
  if (b.lat === undefined || b.lon === undefined) return Infinity;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.25;
}

export interface Place { label: string; place: string; lat: number; lon: number }

export async function searchAddress(q: string): Promise<Place[]> {
  const url = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?' + new URLSearchParams({ q, rows: '5', fq: 'type:adres', fl: 'weergavenaam,woonplaatsnaam,centroide_ll' });
  const res = await fetch(url);
  if (!res.ok) throw new Error('Adres zoeken lukt nu niet');
  const body = await res.json() as { response: { docs: { weergavenaam: string; woonplaatsnaam: string; centroide_ll: string }[] } };
  return body.response.docs.map((d) => {
    const [lon, lat] = d.centroide_ll.replace(/POINT\(|\)/g, '').split(' ').map(Number);
    return { label: d.weergavenaam, place: d.woonplaatsnaam, lat, lon };
  });
}
