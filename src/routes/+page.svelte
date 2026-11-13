<script>
  import { onMount } from 'svelte';
  import EarthGlobe from '$lib/EarthGlobe.svelte';

  let query = $state('');
  let status = $state('');
  let statusState = $state('idle');
  let hasSearched = $state(false);
  let inputElement;

  const messages = {
    SEARCH_BACKEND_UNAVAILABLE: 'search service is not connected yet',
    INVALID_QUERY: 'enter a search query',
    QUERY_TOO_LONG: 'query is too long (maximum 256 characters)',
  };

  function setStatus(message, state = 'idle') {
    status = message;
    statusState = state;
    hasSearched = true;
  }

  function resetResults() {
    status = '';
    statusState = 'idle';
    hasSearched = false;
  }

  async function search(value) {
    setStatus('searching…', 'loading');

    const url = new URL('/api/search', window.location.origin);
    url.searchParams.set('q', value);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = await response.json();

      if (!response.ok) {
        setStatus(
          messages[payload.error?.code] ?? payload.error?.message ?? 'search request failed',
          'error',
        );
        return;
      }

      setStatus('search completed, but result rendering is not available yet', 'error');
    } catch {
      setStatus('could not connect to the search service', 'error');
    }
  }

  function clearQuery() {
    query = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
    resetResults();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const value = query.trim();

    if (!value) {
      resetResults();
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
      clearQuery();
      inputElement?.blur();
    }
  }

  function handlePopstate() {
    const value = new URL(window.location.href).searchParams.get('q') ?? '';
    query = value;

    if (value.trim()) void search(value.trim());
    else resetResults();
  }

  onMount(() => {
    const initialQuery = new URL(window.location.href).searchParams.get('q') ?? '';

    if (initialQuery.trim()) {
      query = initialQuery;
      void search(initialQuery.trim());
    }

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  });
</script>

<svelte:head>
  <title>rewide — Open Web Search</title>
  <meta name="description" content="Search the open web with rewide." />
  <meta name="theme-color" content="#e6e7e9" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="desktop">
  <header class="app-header">
    <a class="wordmark" href="/" aria-label="rewide home">rewide<span>_</span></a>
    <span class="header-context">OPEN WEB SEARCH</span>
    <span class="header-edition">EARTH WORKSPACE</span>
  </header>

  <main class="workspace">
    <section class="window earth-window" aria-label="Earth visualization">
      <div class="window-titlebar dark-titlebar">
        <div class="traffic-lights" aria-hidden="true">
          <span class="light close"></span>
          <span class="light minimize"></span>
          <span class="light zoom"></span>
        </div>
        <span class="window-title">Earth</span>
        <span class="window-toolbar-label">GLOBAL VIEW</span>
      </div>

      <div class="earth-panel">
        <div class="earth-topline">
          <span>EARTH / 01</span>
          <span>3D · ROTATING</span>
        </div>

        <div class="earth-stage">
          <EarthGlobe />
        </div>

        <div class="earth-footer">
          <div>
            <span class="footer-label">GEOGRAPHIC MODEL</span>
            <span class="footer-value">NATURAL EARTH · 1:110M</span>
          </div>
          <div class="telemetry-state">
            <span class="state-indicator"></span>
            <span>NETWORK TELEMETRY NOT CONNECTED</span>
          </div>
        </div>
      </div>
    </section>

    <section class="window search-window" aria-label="Web search">
      <div class="window-titlebar light-titlebar">
        <div class="traffic-lights" aria-hidden="true">
          <span class="light close"></span>
          <span class="light minimize"></span>
          <span class="light zoom"></span>
        </div>
        <span class="window-title">Search</span>
        <span class="window-toolbar-label">rewide</span>
      </div>

      <div class="search-content">
        <div class="search-intro">
          <p class="eyebrow">OPEN WEB SEARCH</p>
          <h1>Search the open web.</h1>
          <p class="intro-copy">Find documents, references, and ideas across the web.</p>
        </div>

        <form class="search-form" role="search" onsubmit={handleSubmit}>
          <label class="sr-only" for="search-input">Search the open web</label>
          <div class="search-field">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="8.8" cy="8.8" r="5.6"></circle>
              <path d="m13 13 4 4"></path>
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
            <kbd>↵</kbd>
          </div>
          <button type="submit">Search</button>
        </form>

        {#if hasSearched}
          <section
            class="search-response"
            aria-label="Search response"
            aria-live="polite"
            aria-busy={statusState === 'loading'}
          >
            <div class="response-heading">
              <span>RESPONSE</span>
              <span class:error-label={statusState === 'error'}>
                {statusState === 'loading' ? 'WORKING' : statusState === 'error' ? 'UNAVAILABLE' : 'READY'}
              </span>
            </div>
            <div class="response-line" data-state={statusState}>
              <span class="response-mark" aria-hidden="true">
                {statusState === 'loading' ? '·' : statusState === 'error' ? '!' : '>'}
              </span>
              <p>{status}</p>
            </div>
          </section>
        {/if}

        <div class="search-spacer"></div>

        <div class="search-method">
          <div class="method-row">
            <span class="method-label">SEARCH METHOD</span>
            <span class="method-value">HYBRID / KEYWORD + SEMANTIC</span>
          </div>
          <div class="method-row">
            <span class="method-label">SEARCH BACKEND</span>
            <span class="method-value unavailable">NOT CONNECTED</span>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="app-footer">
    <span>rewide · Open Web Search</span>
    <span>MADE FOR THE OPEN WEB</span>
  </footer>
</div>
