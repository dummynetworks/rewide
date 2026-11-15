import { handleSearchStatusV1, optionsSearchV1 } from '../../../../../lib/server/api/search-v1.js';

export function GET(event) {
  return handleSearchStatusV1(event);
}

export function OPTIONS() {
  return optionsSearchV1();
}
