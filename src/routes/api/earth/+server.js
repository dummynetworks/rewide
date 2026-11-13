const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...extraHeaders },
  });
}

export async function GET({ fetch }) {
  const endpoint = new URL(
    'https://api.worldbank.org/v2/country/all/indicator/IT.NET.USER.ZS',
  );
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('mrnev', '1');
  endpoint.searchParams.set('per_page', '1000');

  try {
    const upstream = await fetch(endpoint, {
      headers: { accept: 'application/json' },
    });

    if (!upstream.ok) {
      return json({
        error: {
          code: 'WORLD_BANK_UPSTREAM_ERROR',
          message: 'World Bank data service did not return a successful response.',
        },
      }, 502);
    }

    const payload = await upstream.json();
    const observations = Array.isArray(payload) ? payload[1] : null;

    if (!Array.isArray(observations)) {
      return json({
        error: {
          code: 'WORLD_BANK_INVALID_RESPONSE',
          message: 'World Bank returned an unexpected data format.',
        },
      }, 502);
    }

    const latestByCountry = new Map();

    for (const observation of observations) {
      const code = observation?.countryiso3code;
      const rawValue = observation?.value;
      const value = Number(rawValue);
      const year = Number(observation?.date);

      if (
        typeof code !== 'string'
        || !/^[A-Z]{3}$/.test(code)
        || rawValue === null
        || rawValue === undefined
        || !Number.isFinite(value)
        || !Number.isFinite(year)
      ) {
        continue;
      }

      const previous = latestByCountry.get(code);
      if (!previous || year > previous.year) {
        latestByCountry.set(code, {
          code,
          value: Math.max(0, Math.min(100, value)),
          year,
          country: observation.country?.value ?? code,
        });
      }
    }

    const countries = [...latestByCountry.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    );

    if (countries.length === 0) {
      return json({
        error: {
          code: 'WORLD_BANK_NO_OBSERVATIONS',
          message: 'World Bank has no usable country observations for this indicator.',
        },
      }, 502);
    }

    const years = countries.map((country) => country.year);

    return json({
      source: 'World Bank World Development Indicators',
      sourceOrganization: 'International Telecommunication Union (ITU)',
      attribution: 'Source: International Telecommunication Union (ITU), via World Bank WDI',
      license: 'CC BY 4.0',
      indicator: 'IT.NET.USER.ZS',
      indicatorName: 'Individuals using the Internet (% of population)',
      definition: 'Individuals who used the Internet from any location in the last three months',
      periodicity: 'Annual',
      unit: '% of population',
      earliestYear: Math.min(...years),
      latestYear: Math.max(...years),
      countries,
    }, 200, {
      'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    });
  } catch {
    return json({
      error: {
        code: 'WORLD_BANK_FETCH_FAILED',
        message: 'World Bank data could not be reached.',
      },
    }, 502);
  }
}
