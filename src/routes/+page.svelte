<script>
  import { onMount } from 'svelte';

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
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="screen">
  <header class="topbar">
    <a class="wordmark" href="/" aria-label="rewide home">rewide<span>_</span></a>
  </header>

  <main class="workspace">
    <section class="panel query-panel">
      <span class="panel-label">query</span>
      <form role="search" onsubmit={handleSubmit}>
        <label class="sr-only" for="search-input">Search the open web</label>
        <span class="prompt" aria-hidden="true">&gt;</span>
        <input
          bind:this={inputElement}
          id="search-input"
          name="q"
          type="search"
          placeholder="search the open web"
          autocomplete="off"
          spellcheck="false"
          maxlength="256"
          enterkeyhint="search"
          bind:value={query}
        />
        <kbd class="enter-hint">↵</kbd>
      </form>
    </section>

    {#if hasSearched}
      <section
        class="panel results-panel"
        aria-label="Search results"
        aria-live="polite"
        aria-busy={statusState === 'loading'}
      >
        <span class="panel-label">results</span>
        <div class="result-line" data-state={statusState}>
          <span class="result-prefix" aria-hidden="true">
            {statusState === 'loading' ? '*' : statusState === 'error' ? '!' : '>'}
          </span>
          <p>{status}</p>
        </div>
      </section>
    {/if}
  </main>
</div>
