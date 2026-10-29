"""Charge les villes GeoNames (population >= 500) et la liste des pays dans Supabase.

    DATABASE_URL=postgresql://... python scripts/load_geonames.py [--min-population 500]

Sources (licence CC BY 4.0, https://www.geonames.org) :
  - cities500.zip : toutes les villes de plus de 500 habitants (~200 000 lignes)
  - countryInfo.txt : codes, noms et langues des pays
FR et US sont marqués « vérifiés » (corpus du prototype), les autres « standard ».
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import zipfile
from pathlib import Path

import httpx
import psycopg

BASE = "https://download.geonames.org/export/dump/"
VERIFIED = {"FR", "US"}
CACHE = Path(__file__).resolve().parent / ".cache"


def fetch(name: str) -> bytes:
    CACHE.mkdir(exist_ok=True)
    target = CACHE / name
    if target.exists():
        return target.read_bytes()
    print(f"téléchargement {name}…", file=sys.stderr)
    with httpx.stream("GET", BASE + name, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        data = b"".join(r.iter_bytes())
    target.write_bytes(data)
    return data


def load_countries(conn: psycopg.Connection) -> int:
    text = fetch("countryInfo.txt").decode("utf-8")
    rows = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        f = line.split("\t")
        code, name, languages = f[0], f[4], [l.split("-")[0] for l in f[15].split(",") if l]
        rows.append((code, name, languages[:5], "verified" if code in VERIFIED else "standard"))
    with conn.cursor() as cur:
        cur.executemany(
            """insert into public.lm_country_coverage (country_code, name, languages, tier)
               values (%s, %s, %s, %s::public.lm_coverage_tier)
               on conflict (country_code) do update set name = excluded.name, languages = excluded.languages""",
            rows,
        )
    return len(rows)


def load_cities(conn: psycopg.Connection, min_population: int) -> int:
    data = fetch("cities500.zip")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        raw = z.read("cities500.txt").decode("utf-8")
    reader = csv.reader(io.StringIO(raw), delimiter="\t", quoting=csv.QUOTE_NONE)
    count = 0
    with conn.cursor() as cur:
        cur.execute("create temp table tmp_cities (like public.lm_geo_cities) on commit drop")
        with cur.copy("copy tmp_cities (geoname_id, name, ascii_name, country_code, admin1_code, population, latitude, longitude, timezone) from stdin") as copy:
            for f in reader:
                # colonnes GeoNames : 0 id, 1 name, 2 asciiname, 4 lat, 5 lng, 8 country, 10 admin1, 14 population, 17 timezone
                population = int(f[14] or 0)
                if population < min_population:
                    continue
                copy.write_row((int(f[0]), f[1], f[2] or f[1], f[8], f[10] or None, population, float(f[4]), float(f[5]), f[17] or None))
                count += 1
        cur.execute(
            """insert into public.lm_geo_cities
               select * from tmp_cities
               on conflict (geoname_id) do update set
                 name = excluded.name, ascii_name = excluded.ascii_name, country_code = excluded.country_code,
                 admin1_code = excluded.admin1_code, population = excluded.population,
                 latitude = excluded.latitude, longitude = excluded.longitude, timezone = excluded.timezone"""
        )
    return count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-population", type=int, default=500)
    args = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL manquant")
    with psycopg.connect(url) as conn:
        n_countries = load_countries(conn)
        n_cities = load_cities(conn, args.min_population)
        conn.commit()
    print(f"{n_countries} pays, {n_cities} villes chargés")


if __name__ == "__main__":
    main()
