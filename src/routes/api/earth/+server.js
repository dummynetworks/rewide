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

export async function GET({ platform, fetch }) {
  const token = platform?.env?.CLOUDFLARE_RADAR_API_TOKEN;

  if (!token) {
    return json({
      error: {
        code: 'RADAR_TOKEN_NOT_CONFIGURED',
        message: 'Cloudflare Radar data is not configured.',
      },
    }, 503);
  }

  const endpoint = new URL(
    'https://api.cloudflare.com/client/v4/radar/http/summary/LOCATION',
  );
  endpoint.searchParams.set('dateRange', '1d');
  endpoint.searchParams.set('format', 'JSON');

  try {
    const upstream = await fetch(endpoint, {
      headers: {
        accept: 'application/json',
        authorization: 'Bearer ' + token,
      },
    });

    if (!upstream.ok) {
      return json({
        error: {
          code: 'RADAR_UPSTREAM_ERROR',
          message: 'Cloudflare Radar did not return a successful response.',
        },
      }, 502);
    }

    const payload = await upstream.json();

    if (!payload.success || !payload.result?.summary_0) {
      return json({
        error: {
          code: 'RADAR_INVALID_RESPONSE',
          message: 'Cloudflare Radar returned an unexpected response.',
        },
      }, 502);
    }

    const countries = Object.entries(payload.result.summary_0)
      .filter(([code, value]) =>
        /^[A-Z]{2}$/.test(code) && Number.isFinite(Number(value))
      )
      .map(([code, value]) => ({
        code,
        value: Number(value),
      }));

    return json({
      source: 'Cloudflare Radar',
      license: 'CC BY-NC 4.0',
      metric: 'share of HTTP requests observed on the Cloudflare network',
      dateRange: payload.result.meta?.dateRange ?? null,
      lastUpdated: payload.result.meta?.lastUpdated ?? null,
      normalization: payload.result.meta?.normalization ?? null,
      countries,
    }, 200, {
      'cache-control': 'public, s-maxage=900, stale-while-revalidate=3600',
    });
  } catch {
    return json({
      error: {
        code: 'RADAR_FETCH_FAILED',
        message: 'Cloudflare Radar could not be reached.',
      },
    }, 502);
  }
}
