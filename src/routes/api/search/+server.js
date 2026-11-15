// Backwards-compatible route. The website can keep calling /api/search while
// external clients use the explicitly versioned /api/v1/search endpoint.
export {
  GET,
  OPTIONS,
} from '../v1/search/+server.js';
