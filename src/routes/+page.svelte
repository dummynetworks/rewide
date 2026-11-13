<script>
  import { onMount } from 'svelte';

  let query = $state('');
  let status = $state('search index is not connected; no results are available');
  let statusState = $state('idle');
  let inputElement;

  const messages = {
    SEARCH_BACKEND_UNAVAILABLE: 'search backend unavailable; the search index has not been connected',
    INVALID_QUERY: 'invalid query; enter a search term',
    QUERY_TOO_LONG: 'query too long; maximum length is 256 characters',
  };

  function setStatus(message, state = 'idle') {
    status = message;
    statusState = state;
  }

  async function search(value) {
    setStatus('sending request to /api/search…', 'loading');

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
          messages[payload.error?.code] ?? payload.error?.message ?? 'request failed',
          'error',
        );
        return;
      }

      setStatus('request completed; result rendering is not available yet', 'error');
    } catch {
      setStatus('connection error; could not reach the search API', 'error');
    }
  }

  function clearQuery() {
    query = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
    setStatus('search index is not connected; no results are available');
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
      clearQuery();
      inputElement?.blur();
    }
  }

  function handlePopstate() {
    const value = new URL(window.location.href).searchParams.get('q') ?? '';
    query = value;

    if (value) void search(value);
    else setStatus('search index is not connected; no results are available');
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

<div class="screen">
  <header class="topbar">
    <a class="wordmark" href="/" aria-label="rewide home">rewide<span>_</span></a>
    <div class="location">
      <span class="muted">search</span>
      <span class="separator">/</span>
      <span>open-web</span>
    </div>
    <div class="top-meta">
      <span class="client-mark"></span>
      <span>web client</span>
      <span class="separator">·</span>
      <span>v0.2.0</span>
    </div>
  </header>

  <div class="workspace">
    <aside class="sidebar" aria-label="Engine information">
      <section class="panel">
        <span class="panel-label">engine</span>
        <div class="panel-content">
          <div class="info-row">
            <span class="key">scope</span>
            <span class="value">open web</span>
          </div>
          <div class="info-row">
            <span class="key">retrieval</span>
            <span class="value">hybrid</span>
          </div>
          <div class="info-note">keyword + semantic</div>
        </div>
      </section>

      <section class="panel">
        <span class="panel-label">ranking pipeline</span>
        <div class="pipeline">
          <div class="pipeline-row">
            <span class="pipeline-key">R</span>
            <span class="pipeline-name">relevance</span>
            <span class="pipeline-question">is it relevant?</span>
          </div>
          <div class="pipeline-row">
            <span class="pipeline-key">Q</span>
            <span class="pipeline-name">quality</span>
            <span class="pipeline-question">is it good?</span>
          </div>
          <div class="pipeline-row">
            <span class="pipeline-key">B</span>
            <span class="pipeline-name">balance</span>
            <span class="pipeline-question">is the set balanced?</span>
          </div>
        </div>
      </section>

      <section class="panel index-panel">
        <span class="panel-label">index</span>
        <div class="index-state">
          <span class="state-dot"></span>
          <span>not connected</span>
        </div>
        <div class="index-note">retrieval is currently unavailable</div>
      </section>
    </aside>

    <main class="main-column">
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
            placeholder="enter search query"
            autocomplete="off"
            spellcheck="false"
            maxlength="256"
            enterkeyhint="search"
            bind:value={query}
          />
          <button class="execute" type="submit" aria-label="Run search">[ search ]</button>
        </form>
        <div class="query-foot">
          <span><kbd>/</kbd> focus</span>
          <span><kbd>esc</kbd> clear</span>
          <span class="limit">256 chars max</span>
        </div>
      </section>

      <section class="panel output-panel" aria-live="polite" aria-busy={statusState === 'loading'}>
        <span class="panel-label">response</span>
        <div class="output-meta">
          <span>GET /api/search</span>
          <span class="response-state" data-state={statusState}>
            {statusState === 'loading' ? 'running' : statusState === 'error' ? 'error' : 'idle'}
          </span>
        </div>
        <div class="output-line" data-state={statusState}>
          <span class="output-prefix">{statusState === 'error' ? '!' : statusState === 'loading' ? '*' : '>'}</span>
          <p>{status}</p>
        </div>
        <div class="output-placeholder">waiting for an available search index…</div>
      </section>

      <section class="panel request-panel">
        <span class="panel-label">request</span>
        <div class="request-row">
          <span class="request-method">GET</span>
          <code>/api/search?q={query.trim() ? encodeURIComponent(query.trim()) : '…'}</code>
        </div>
        <div class="request-note">queries are limited to 256 characters · response is not cached</div>
      </section>
    </main>
  </div>

  <footer class="statusbar">
    <span>dummyNet <span class="separator">/</span> rewide</span>
    <span><span class="footer-dot"></span> interface ready</span>
  </footer>
</div>
