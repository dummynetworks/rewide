export const SEARCH_RANKING = Object.freeze({
  documentWeight: 1.15,
  discoveryWeight: 1,
  reciprocalRankConstant: 60,
});

function isRow(value) {
  return value && typeof value.url === 'string' && value.url.length > 0;
}

function toPublicResult(row, position) {
  const isDocument = row.resultType === 'document';

  return {
    position,
    resultType: row.resultType,
    indexStatus: isDocument
      ? 'INDEXABLE'
      : row.indexStatus === 'indexable' ? 'INDEXABLE' : 'UNKNOWN',
    url: row.url,
    title: row.title || row.url,
    description: row.description || '',
    snippet: row.snippet || '',
    canonicalUrl: isDocument ? row.canonicalUrl || null : null,
    canonicalStatus: isDocument
      ? row.canonicalStatus || (row.canonicalUrl ? 'unverified' : 'missing')
      : null,
    language: isDocument ? row.language || null : null,
    fetchedAt: isDocument ? row.fetchedAt || null : null,
    sourceUrl: isDocument ? null : row.sourceUrl || null,
    discoveredAt: isDocument ? null : row.discoveredAt || null,
  };
}

/**
 * Merge independently retrieved sources into the stable public result shape.
 * The rank positions from each source are combined using reciprocal rank fusion.
 */
export function rankSearchResults(documentRows, discoveryRows, { limit = 10 } = {}) {
  const documents = (Array.isArray(documentRows) ? documentRows : []).filter(isRow);
  // A rel=canonical declaration is publisher metadata, not proof of a redirect
  // or duplicate. Only the fetched URL and observed redirect aliases deduplicate.
  const matchedDocumentUrls = new Set(documents.map((row) => row.url));

  const discoveries = (Array.isArray(discoveryRows) ? discoveryRows : [])
    .filter(isRow)
    .filter((row) => (
      !matchedDocumentUrls.has(row.url)
      && !matchedDocumentUrls.has(row.resolvedUrl)
    ));

  const ranked = [
    ...documents.map((row, index) => ({
      ...row,
      resultType: 'document',
      rrfScore: SEARCH_RANKING.documentWeight
        / (SEARCH_RANKING.reciprocalRankConstant + index + 1),
    })),
    ...discoveries.map((row, index) => ({
      ...row,
      resultType: 'discovered',
      rrfScore: SEARCH_RANKING.discoveryWeight
        / (SEARCH_RANKING.reciprocalRankConstant + index + 1),
    })),
  ];

  ranked.sort((left, right) => (
    right.rrfScore - left.rrfScore
    || Number(right.resultType === 'document') - Number(left.resultType === 'document')
    || String(left.url).localeCompare(String(right.url))
  ));

  return ranked
    .slice(0, limit)
    .map((row, index) => toPublicResult(row, index + 1));
}
