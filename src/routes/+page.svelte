<script>
  import { onMount } from 'svelte';

  let query = $state('');
  let status = $state('Search index is not connected yet.');
  let statusState = $state('idle');
  let inputElement;

  const messages = {
    SEARCH_BACKEND_UNAVAILABLE: 'The search service is not available yet. The search index has not been connected.',
    INVALID_QUERY: 'Enter a search query to continue.',
    QUERY_TOO_LONG: 'Your query is too long. Keep it under 256 characters.',
  };

  function setStatus(message, state = 'idle') {
    status = message;
    statusState = state;
  }

  async function search(value) {
    setStatus('Searching…', 'loading');

    const url = new URL('/api/search', window.location.origin);
    url.searchParams.set('q', value);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = messages[payload.error?.code]
          ?? payload.error?.message
          ?? 'Something went wrong while searching.';
        setStatus(message, 'error');
        return;
      }

      setStatus('The search service responded, but result rendering is not implemented.', 'error');
    } catch {
      setStatus('Could not reach the search service. Check your connection and try again.', 'error');
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const value = query.trim();

    if (!value) {
      setStatus(messages.INVALID_QUERY, 'error');
      inputElement?.focus();
      return;
    }

    if (value.length > 256) {
      setStatus(messages.QUERY_TOO_LONG, 'error');
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('q', value);
    window.history.pushState({}, '', url);
    void search(value);
  }

  function handleKeydown(event) {
    const target = event.target;
    const isTyping = target instanceof HTMLElement && (
      target.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );

    if (event.key === '/' && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      inputElement?.focus();
    }

    if (event.key === 'Escape' && target === inputElement) {
      query = '';
      inputElement?.blur();
      const url = new URL(window.location.href);
      url.searchParams.delete('q');
      window.history.replaceState({}, '', url);
      setStatus('Search index is not connected yet.');
    }
  }

  function handlePopstate() {
    const value = new URL(window.location.href).searchParams.get('q') ?? '';
    query = value;
    if (value) void search(value);
    else setStatus('Search index is not connected yet.');
  }

  onMount(() => {
    const initialQuery = new URL(window.location.href).searchParams.get('q') ?? '';
    if (initialQuery) {
      query = initialQuery;
      void search(initialQuery);
    }

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  });
</script>

<svelte:head>
  <title>rewide — Open Web Search</title>
  <meta name="description" content="rewide — search the open web." />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main class="page">
  <header class="topbar">
    <a class="wordmark" href="/" aria-label="rewide home">rewide<span>.</span></a>
    <span class="topbar-label">OPEN WEB SEARCH</span>
  </header>

  <section class="search-panel" aria-labelledby="page-title">
    <p class="eyebrow">A SEARCH ENGINE BY dummyNet</p>
    <h1 id="page-title">Find your way<br />across the web.</h1>
    <p class="intro">Search broadly. Explore beyond the obvious.</p>

    <form class="search-form" role="search" onsubmit={handleSubmit}>
      <label class="sr-only" for="search-input">Search the open web</label>
      <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.8"></circle>
        <path d="m16 16 4.2 4.2"></path>
      </svg>
      <input
        bind:this={inputElement}
        id="search-input"
        name="q"
        type="search"
        placeholder="Search the open web"
        autocomplete="off"
        spellcheck="false"
        maxlength="256"
        enterkeyhint="search"
        bind:value={query}
      />
      <button class="search-button" type="submit">Search</button>
    </form>
    <p class="search-hint"><kbd>/</kbd> to focus search <span aria-hidden="true">·</span> <kbd>Esc</kbd> to clear</p>
    <p class="search-status" data-state={statusState} role="status" aria-live="polite">
      {status}
    </p>
  </section>

  <footer class="footer">
    <span>rewide</span>
    <span>Part of dummyNet</span>
  </footer>
</main>
