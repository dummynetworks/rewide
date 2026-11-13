import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/search.js";

function makeRequest(url, method = "GET") {
  return new Request(url, { method });
}

test("rejects methods other than GET", async () => {
  const response = await onRequest({
    request: makeRequest("https://rewide.example/api/search?q=test", "POST"),
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), null);
  assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
});

test("rejects an empty query", async () => {
  const response = await onRequest({
    request: makeRequest("https://rewide.example/api/search?q=%20%20"),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_QUERY");
});

test("rejects queries longer than 256 characters", async () => {
  const query = "a".repeat(257);
  const response = await onRequest({
    request: makeRequest(`https://rewide.example/api/search?q=${query}`),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "QUERY_TOO_LONG");
});

test("returns an explicit unavailable response until the real backend is connected", async () => {
  const response = await onRequest({
    request: makeRequest("https://rewide.example/api/search?q=web"),
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).error.code, "SEARCH_BACKEND_UNAVAILABLE");
});
