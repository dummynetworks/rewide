<script>
  import { onMount } from 'svelte';

  let query = $state('');
  let status = $state('The search index is not connected.');
  let statusState = $state('idle');
  let inputElement;

  const messages = {
    SEARCH_BACKEND_UNAVAILABLE: 'The search backend is not connected. No results were returned.',
    INVALID_QUERY: 'Enter a search query to continue.',
    QUERY_TOO_LONG: 'The query is too long. Keep it under 256 characters.',
  };

  function setStatus(message, state = 'idle') {
    status = message;
    statusState = state;
  }

  async function search(value) {
    setStatus('Sending request to /api/search…', 'loading');

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
          ?? 'The search request failed.';
        setStatus(message, 'error');
        return;
      }

      setStatus('The API responded, but result rendering is not available yet.', 'error');
    } catch {
      setStatus('Could not reach the search API. Check the connection and try again.', 'error');
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

  function clearQuery() {
    query = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
    setStatus('The search index is not connected.');
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

    if (value) void search(value);
    else setStatus('The search index is not connected.');
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
  <meta name="description" content="Search the open web with rewide." />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="page-shell">
  <div class="application">
    <header class="topbar">
      <a class="wordmark" href="/" aria-label="rewide home">rewide<span>_</span></a>
      <div class="topbar-path" aria-label="Current location">
        <span class="path-muted">rewide</span>
        <span class="path-separator">/</span>
        <span>search</span>
      </div>
      <div class="topbar-meta">
        <span class="connection-mark" aria-hidden="true"></span>
        <span>WEB CLIENT</span>
        <span class="meta-divider">·</span>
        <span>v0.2.0</span>
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar" aria-label="Search configuration">
        <div class="sidebar-heading">
          <span class="panel-index">00</span>
          <span>ENGINE</span>
        </div>

        <section class="sidebar-group">
          <p class="field-label">SEARCH SCOPE</p>
          <div class="field-value">OPEN WEB</div>
          <p class="field-note">PUBLIC WEB DOCUMENTS</p>
        </section>

        <section class="sidebar-group">
          <p class="field-label">RETRIEVAL METHOD</p>
          <div class="field-value">HYBRID SEARCH</div>
          <p class="field-note">KEYWORD + SEMANTIC</p>
        </section>

        <section class="sidebar-group ranking-group">
          <p class="field-label">RANKING SPECIFICATION</p>
          <div class="ranking-row"><span>R</span><span>RELEVANCE</span></div>
          <div class="ranking-row"><span>Q</span><span>QUALITY</span></div>
          <div class="ranking-row"><span>B</span><span>BALANCE</span></div>
        </section>

        <div class="sidebar-status">
          <span class="field-label">INDEX STATUS</span>
          <span class="index-state"><span aria-hidden="true"></span> NOT CONNECTED</span>
        </div>
      </aside>

      <main class="main-content">
        <div class="section-heading">
          <div>
            <p class="field-label">QUERY INTERFACE / 01</p>
            <h1>Search</h1>
          </div>
          <span class="section-code">RW / 001</span>
        </div>

        <form class="search-form" role="search" onsubmit={handleSubmit}>
          <label class="sr-only" for="search-input">Search the open web</label>
          <span class="query-prefix" aria-hidden="true">&gt;</span>
          <input
            bind:this={inputElement}
            id="search-input"
            name="q"
            type="search"
            placeholder="Enter a search query"
            autocomplete="off"
            spellcheck="false"
            maxlength="256"
            enterkeyhint="search"
            bind:value={query}
            aria-describedby="search-help"
          />
          <button class="search-button" type="submit">
            <span>SEARCH</span>
            <kbd>ENTER</kbd>
          </button>
        </form>

        <p class="search-help" id="search-help">
          <span><kbd>/</kbd> FOCUS</span>
          <span><kbd>ESC</kbd> CLEAR</span>
          <span class="help-limit">MAX 256 CHARACTERS</span>
        </p>

        <section class="response-panel" aria-labelledby="response-heading" aria-live="polite" aria-busy={statusState === 'loading'}>
          <header class="panel-heading">
            <span id="response-heading">REQUEST STATUS</span>
            <span>GET /API/SEARCH</span>
          </header>
          <div class="response-body" data-state={statusState}>
            <span class="response-code" aria-hidden="true">
              {statusState === 'loading' ? 'RUN' : statusState === 'error' ? 'ERR' : 'SYS'}
            </span>
            <p>{status}</p>
          </div>
        </section>

        <div class="main-footnote">
          <span>OPEN WEB SEARCH</span>
          <span>NO INDEX / NO RESULTS FABRICATED</span>
        </div>
      </main>
    </div>

    <footer class="statusbar">
      <span>dummyNet <span class="status-separator">/</span> rewide</span>
      <span>CLIENT READY</span>
    </footer>
  </div>
</div>
