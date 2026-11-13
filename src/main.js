const form = document.querySelector("#search-form");
const input = document.querySelector("#search-input");
const status = document.querySelector("#search-status");

const messages = {
  SEARCH_BACKEND_UNAVAILABLE: "The search service is not available yet. The search index has not been connected.",
  INVALID_QUERY: "Enter a search query to continue.",
  QUERY_TOO_LONG: "Your query is too long. Keep it under 256 characters.",
};

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

function queryFromLocation() {
  return new URL(window.location.href).searchParams.get("q") ?? "";
}

async function search(query) {
  setStatus("Searching…", "loading");

  const url = new URL("/api/search", window.location.origin);
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      const message = messages[payload.error?.code] ?? payload.error?.message ?? "Something went wrong while searching.";
      setStatus(message, "error");
      return;
    }

    // Results will be rendered here when the search index is integrated.
    setStatus("The search service responded, but result rendering is not implemented.", "error");
  } catch {
    setStatus("Could not reach the search service. Check your connection and try again.", "error");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim();

  if (!query) {
    setStatus(messages.INVALID_QUERY, "error");
    input.focus();
    return;
  }

  if (query.length > 256) {
    setStatus(messages.QUERY_TOO_LONG, "error");
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("q", query);
  window.history.pushState({}, "", url);
  void search(query);
});

window.addEventListener("popstate", () => {
  const query = queryFromLocation();
  input.value = query;
  if (query) void search(query);
  else setStatus("Search index is not connected yet.");
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping = target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

  if (event.key === "/" && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    input.focus();
  }

  if (event.key === "Escape" && target === input) {
    input.value = "";
    input.blur();
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
    setStatus("Search index is not connected yet.");
  }
});

const initialQuery = queryFromLocation();
if (initialQuery) {
  input.value = initialQuery;
  void search(initialQuery);
}
