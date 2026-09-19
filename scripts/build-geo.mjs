// Builds the country + city lists used by the Lead Finder from GeoNames data (CC BY 4.0, https://www.geonames.org).
//
// 1. Download these into one folder:
//      https://download.geonames.org/export/dump/cities15000.zip   (unzip → cities15000.txt)
//      https://download.geonames.org/export/dump/countryInfo.txt
//      https://download.geonames.org/export/dump/admin1CodesASCII.txt
// 2. Run:  node scripts/build-geo.mjs <that-folder>
//
// Output:
//   src/data/countries.json        [{ code, name }]  — every country that has cities
//   public/geo/cities/<CODE>.json  [[name, region, lat, lng], …] — largest city first, loaded on demand

import fs from 'node:fs'
import path from 'node:path'

const source = process.argv[2]
if (!source) {
  console.error('Usage: node scripts/build-geo.mjs <folder with GeoNames files>')
  process.exit(1)
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const read = (file) => fs.readFileSync(path.join(source, file), 'utf8').split('\n')

// Region (state / province) names, keyed "PK.04"
const regions = new Map()
for (const line of read('admin1CodesASCII.txt')) {
  const [code, name] = line.split('\t')
  if (code && name) regions.set(code, name)
}

const countryNames = new Map()
for (const line of read('countryInfo.txt')) {
  if (!line || line.startsWith('#')) continue
  const cols = line.split('\t')
  countryNames.set(cols[0], cols[4])
}

// cities15000.txt columns: 1 name, 4 lat, 5 lng, 7 feature code, 8 country, 10 admin1, 14 population
const byCountry = new Map()
for (const line of read('cities15000.txt')) {
  const c = line.split('\t')
  if (c.length < 15) continue
  const [name, lat, lng, feature, country, admin1, population] = [c[1], c[4], c[5], c[7], c[8], c[10], Number(c[14]) || 0]
  if (feature === 'PPLX' || feature === 'PPLH') continue // city sections and historical places
  const list = byCountry.get(country) ?? []
  list.push({ name, region: regions.get(`${country}.${admin1}`) ?? '', lat: Number(Number(lat).toFixed(4)), lng: Number(Number(lng).toFixed(4)), population })
  byCountry.set(country, list)
}

const outDir = path.join(root, 'public', 'geo', 'cities')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const countries = []
for (const [code, cities] of byCountry) {
  if (!countryNames.has(code)) continue
  cities.sort((a, b) => b.population - a.population)
  // Drop exact duplicates (same name + region) — keep the larger one
  const seen = new Set()
  const rows = []
  for (const city of cities) {
    const key = `${city.name}|${city.region}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push([city.name, city.region, city.lat, city.lng])
  }
  fs.writeFileSync(path.join(outDir, `${code}.json`), JSON.stringify(rows))
  countries.push({ code, name: countryNames.get(code) })
}

countries.sort((a, b) => a.name.localeCompare(b.name))
fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true })
fs.writeFileSync(path.join(root, 'src', 'data', 'countries.json'), JSON.stringify(countries, null, 0))
console.log(`${countries.length} countries, ${[...byCountry.values()].reduce((n, l) => n + l.length, 0)} cities written`)
