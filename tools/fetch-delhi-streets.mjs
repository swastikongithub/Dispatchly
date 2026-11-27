// Fetches the named main roads of central Delhi from OpenStreetMap (Overpass API) and writes the
// compact street file the API reads to name the street a rider is on ("…riding down Mathura Road").
//
//   node tools/fetch-delhi-streets.mjs
//
// Writes src/Dispatchly.Infrastructure/Streets/delhi-streets.json. The data is © OpenStreetMap
// contributors under the ODbL; the file says so, and the maps already credit OpenStreetMap.

import { writeFile } from 'node:fs/promises';

const OUT = new URL('../src/Dispatchly.Infrastructure/Streets/delhi-streets.json', import.meta.url);
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** South, west, north, east: every seeded area, with room for drops and idle riders (§12). */
const BBOX = [28.5, 77.13, 28.7, 77.34];
/** Roads a rider is said to be "riding down"; lanes and service roads are left out. */
const KINDS = 'motorway|trunk|primary|secondary|tertiary';
/** Points closer than this to the simplified line are dropped. */
const TOLERANCE_METERS = 4;

const query = `[out:json][timeout:180];
way["highway"~"^(${KINDS})$"]["name"](${BBOX.join(',')});
out tags geom;`;

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'dispatchly-street-fetch' },
  body: new URLSearchParams({ data: query }),
});
if (!response.ok) throw new Error(`Overpass answered ${response.status}: ${await response.text()}`);
const { elements } = await response.json();

// Metres on a local flat projection: plenty for a city this size.
const LAT0 = (BBOX[0] + BBOX[2]) / 2;
const M_PER_LAT = 110_574;
const M_PER_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const xy = ({ lat, lon }) => [lon * M_PER_LNG, lat * M_PER_LAT];

/** Douglas–Peucker on the projected points. */
function simplify(points) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = xy(points[first]);
    const [bx, by] = xy(points[last]);
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    let farthest = -1;
    let max = TOLERANCE_METERS;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = xy(points[i]);
      const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > max) {
        max = d;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The English name: `name:en` when tagged, else `name` when it's in Latin script. */
function englishName(tags) {
  const name = (tags['name:en'] ?? tags.name ?? '').replace(/\s+/g, ' ').trim();
  return /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(name) ? name : null;
}

const round = (value) => Math.round(value * 1e5) / 1e5;
const streets = {};
let ways = 0;
for (const way of elements) {
  const name = englishName(way.tags ?? {});
  if (!name || !way.geometry || way.geometry.length < 2) continue;
  const line = simplify(way.geometry).flatMap(({ lat, lon }) => [round(lat), round(lon)]);
  (streets[name] ??= []).push(line);
  ways++;
}

const sorted = Object.fromEntries(Object.entries(streets).sort(([a], [b]) => a.localeCompare(b)));
const file = {
  source: 'OpenStreetMap via the Overpass API (tools/fetch-delhi-streets.mjs)',
  license: '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
  fetched: new Date().toISOString().slice(0, 10),
  bbox: BBOX,
  highways: KINDS.split('|'),
  // Each street: its ways, each a flat [lat, lng, lat, lng, …] line.
  streets: sorted,
};
await writeFile(OUT, JSON.stringify(file) + '\n');
console.log(`${Object.keys(sorted).length} streets from ${ways} ways → ${OUT.pathname}`);
