<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    parseText as parseTextUtil,
    getWordDelay as getWordDelayUtil,
    formatTimeRemaining,
    shouldPauseAtWord,
    searchWords
  } from './lib/rsvp-utils.js';
  import { parseDocument } from './lib/file-parsers.js';
  import { detectChapters, findChapterIndex } from './lib/chapters.js';
  import {
    saveSession,
    loadSession,
    clearSession,
    hasSession,
    getSessionSummary,
    markImportOffered,
    wordIndexToPercentage
  } from './lib/progress-storage.js';
  import RSVPDisplay from './lib/components/RSVPDisplay.svelte';
  import Controls from './lib/components/Controls.svelte';
  import Settings from './lib/components/Settings.svelte';
  import TextInput from './lib/components/TextInput.svelte';
  import ProgressBar from './lib/components/ProgressBar.svelte';
  import AccountMenu from './lib/components/AccountMenu.svelte';
  import LibraryPanel from './lib/components/LibraryPanel.svelte';
  import SaveToLibraryModal from './lib/components/SaveToLibraryModal.svelte';
  import Modal from './lib/components/Modal.svelte';
  import { auth, initAuth, saveSettings, sendSettingsBeacon, onBeforeLogout } from './lib/auth.js';
  import { saveProgress, sendProgressBeacon, defaultTitle } from './lib/library.js';
  import { createProgressSync } from './lib/progress-sync.js';
  import { createSettingsSync, pickSettings, DEFAULT_SETTINGS } from './lib/settings-sync.js';
  import { extractWordFrame } from './lib/rsvp-utils.js';

  // State
  const DEFAULT_TEXT = `Rapid serial visual presentation (RSVP) is a scientific method for studying the timing of vision. In RSVP, a sequence of stimuli is shown to an observer at one location in their visual field. This technique has been adapted for speed reading applications, where words are displayed one at a time at a fixed point, eliminating the need for eye movements and potentially increasing reading speed significantly.`;
  let text = DEFAULT_TEXT;
  let words = [];
  let currentWordIndex = 0;
  let isPlaying = false;
  let isPaused = false;
  let isManualPause = false;
  let showSettings = false;
  let showTextInput = false;
  let progress = 0;
  let isLoadingFile = false;
  let loadingMessage = '';
  let showJumpTo = false;
  let jumpToValue = '';
  let savedSessionInfo = null;
  let showSavedSessionPrompt = false;
  let searchResults = [];
  let isSearchMode = false;
  let chapters = [];

  // Library: the open text when it comes from the user's library (null otherwise),
  // and where a not-yet-saved text came from (for the suggested title)
  /** @type {{id: string, title: string}|null} */
  let libraryText = null;
  /** @type {{fileName?: string, title?: string}} */
  let textSource = {};
  let showLibrary = false;
  let showSaveToLibrary = false;

  // Word index of the stored progress for the loaded text (library or browser session),
  // null when nothing is saved. Stop returns here, and Restart asks before leaving it.
  /** @type {number|null} */
  let savedPosition = null;
  let showRestartConfirm = false;

  // Positions of library texts are saved automatically (while playing, on pause, jumps,
  // and when leaving the text or the page); each save becomes the new saved position
  const progressSync = createProgressSync({
    save: saveProgress,
    beacon: sendProgressBeacon,
    onSynced: (id, position) => {
      if (libraryText?.id === id) savedPosition = position;
    }
  });

  // Settings (see DEFAULT_SETTINGS for the keys)
  let settings = { ...DEFAULT_SETTINGS };

  // Known settings override the current ones
  function applySettings(values) {
    settings = { ...settings, ...pickSettings(values) };
  }

  // Signed in, the settings belong to the account. The guest settings (the ones in use
  // before signing in, also stored with the browser session) come back after signing out.
  const settingsSync = createSettingsSync({ save: saveSettings, beacon: sendSettingsBeacon });
  /** @type {Object|null} */
  let guestSettings = null;
  /** @type {string|null} */
  let settingsUserId = null;

  function handleAuthState(state) {
    const userId = state.status === 'user' ? state.user.id : null;
    if (userId === settingsUserId) return;

    if (settingsUserId === null) guestSettings = { ...settings };
    settingsUserId = userId;

    if (userId === null) {
      settingsSync.reset(null);
      settings = guestSettings;
      guestSettings = null;
      return;
    }
    const stored = pickSettings(state.user.settings);
    if (Object.keys(stored).length > 0) {
      applySettings(stored);
      settingsSync.reset(settings);
    } else {
      settingsSync.reset(null);
      settingsSync.saveNow(settings);
    }
  }

  $: handleAuthState($auth);
  $: if ($auth.status === 'user') settingsSync.changed(settings);

  // Save unsynced changes while the session is still valid
  onBeforeLogout(() => Promise.all([progressSync.flush(), settingsSync.flush()]));

  // Animation
  let wordOpacity = 1;
  let intervalId = null;
  let fadeTimeoutId = null;

  // Derived state
  $: activeIndex = Math.max(0, currentWordIndex - 1);
  $: currentWord = words[activeIndex] || (words.length > 0 ? words[0] : '');
  $: wordFrame = extractWordFrame(words, activeIndex, settings.frameWordCount);
  // Surrounding text: shown on a manual pause and whenever not reading (after Exit/Esc,
  // Stop, opening a text or jumping), so you can see where you are
  $: showSurroundingText = settings.showContextEnabled && words.length > 0 && (isManualPause || !isFocusMode);
  $: contextBefore = showSurroundingText ? words.slice(Math.max(0, activeIndex - 60), activeIndex) : [];
  $: contextAfter = showSurroundingText ? words.slice(activeIndex + 1, Math.min(words.length, activeIndex + 61)) : [];
  $: timeRemaining = formatTimeRemaining(words.length - currentWordIndex, settings.wordsPerMinute);
  $: isFocusMode = isPlaying || isPaused;
  $: currentChapterIndex = findChapterIndex(chapters, currentWordIndex);

  // fileChapters: chapters from a PDF outline / EPUB TOC; otherwise
  // headings are detected in the (pasted) text
  function parseText(fileChapters = null) {
    words = parseTextUtil(text);
    chapters = fileChapters ?? detectChapters(text);
    currentWordIndex = 0;
    progress = 0;
    // A new text has no saved progress until it is loaded from or saved to storage
    savedPosition = null;
  }

  function getWordDelay(word) {
    return getWordDelayUtil(word, settings.wordsPerMinute, settings.pauseOnPunctuation, settings.punctuationPauseMultiplier, settings.wordLengthWPMMultiplier);
  }

  function showNextWord() {
    if (currentWordIndex >= words.length) {
      // Finished: save the end, before stop() resets the display to the start
      progressSync.flush();
      stop();
      return;
    }

    if (settings.fadeEnabled) {
      wordOpacity = 0;
      fadeTimeoutId = setTimeout(() => {
        wordOpacity = 1;
      }, 10);
    }

    progress = ((currentWordIndex + 1) / words.length) * 100;
    currentWordIndex++;
    progressSync.update(currentWordIndex);

    if (shouldPauseAtWord(currentWordIndex, settings.pauseAfterWords)) {
      isPaused = true;
      setTimeout(() => {
        if (isPlaying) {
          isPaused = false;
          scheduleNextWord();
        }
      }, settings.pauseDuration);
      return;
    }

    scheduleNextWord();
  }

  function scheduleNextWord() {
    if (!isPlaying || currentWordIndex >= words.length) return;
    const word = words[currentWordIndex - 1] || '';
    intervalId = setTimeout(showNextWord, getWordDelay(word));
  }

  function start() {
    if (words.length === 0) parseText();
    if (words.length === 0) return;
    isPlaying = true;
    isPaused = false;
    isManualPause = false;
    showSettings = false;
    showTextInput = false;
    showNextWord();
  }

  function pause() {
    isPlaying = false;
    isPaused = true;
    isManualPause = true;
    if (intervalId) {
      clearTimeout(intervalId);
      intervalId = null;
    }
    progressSync.flush();
  }

  function resume() {
    if (currentWordIndex < words.length) {
      isPlaying = true;
      isPaused = false;
      isManualPause = false;
      scheduleNextWord();
    }
  }

  function stop() {
    isPlaying = false;
    isPaused = false;
    isManualPause = false;
    currentWordIndex = 0;
    progress = 0;
    wordOpacity = 1;
    if (intervalId) {
      clearTimeout(intervalId);
      intervalId = null;
    }
  }

  function restart() {
    stop();
    start();
  }

  // Stop button: end playback and go back to the saved position (start of text if none),
  // so stopping by accident never loses progress
  function stopToSavedPosition() {
    stop();
    // Not a jump: the saved position is what the server already has
    progressSync.discard();
    if (savedPosition !== null) {
      currentWordIndex = Math.min(savedPosition, words.length);
      progress = words.length > 0 ? (currentWordIndex / words.length) * 100 : 0;
    }
  }

  // Restart button: confirm first when it would leave saved progress behind
  function requestRestart() {
    if (savedPosition > 0) showRestartConfirm = true;
    else restart();
  }

  function confirmRestart() {
    showRestartConfirm = false;
    restart();
  }

  function handleTextApply(event) {
    text = event.detail.text;
    leaveLibraryText();
    textSource = {};
    stop();
    parseText();
    showTextInput = false;
  }

  async function handleFileSelect(event) {
    const file = event.detail.file;
    if (!file) return;

    isLoadingFile = true;
    loadingMessage = `Loading ${file.name}...`;

    try {
      const doc = await parseDocument(file);
      text = doc.text;
      leaveLibraryText();
      textSource = { fileName: file.name, title: doc.title };
      stop();
      parseText(doc.chapters);
      showTextInput = false;
      loadingMessage = '';
    } catch (error) {
      console.error('Error parsing file:', error);
      loadingMessage = `Error: ${error.message}`;
      setTimeout(() => { loadingMessage = ''; }, 3000);
    } finally {
      isLoadingFile = false;
    }
  }

  // Short confirmation after the save button / Ctrl+S
  let saveNotice = '';
  let saveNoticeTimeoutId = null;

  function showSaveNotice(message) {
    saveNotice = message;
    clearTimeout(saveNoticeTimeoutId);
    saveNoticeTimeoutId = setTimeout(() => { saveNotice = ''; }, 3000);
  }

  /** @returns {Promise<boolean>} Whether the progress was stored */
  async function saveCurrentSession() {
    if (words.length === 0) return false;
    // Library texts keep their position on the server, everything else in the browser
    const position = currentWordIndex;
    if (libraryText) {
      progressSync.update(position);
      const synced = await progressSync.flush({ force: true });
      if (!synced) console.error('Failed to save progress');
      showSaveNotice(synced ? 'Progress saved' : 'Could not save progress, will retry automatically');
      return synced;
    }
    const saved = saveSession({
      text,
      currentWordIndex,
      totalWords: words.length,
      chapters,
      // The browser session keeps the guest settings, not the account's
      settings: guestSettings ?? settings
    });
    if (saved) savedPosition = position;
    showSaveNotice(saved ? 'Progress saved' : 'Could not save progress');
    return saved;
  }

  function loadSavedSession() {
    const session = loadSession();
    if (!session) return false;

    text = session.text;
    leaveLibraryText();
    textSource = {};
    // Older sessions have no chapters stored: fall back to detection
    parseText(session.chapters ?? null);
    currentWordIndex = session.currentWordIndex;
    savedPosition = session.currentWordIndex;
    progress = (currentWordIndex / words.length) * 100;

    if (session.settings) {
      // Signed in, the account's settings stay; the session's apply again after signing out
      if (guestSettings) guestSettings = { ...guestSettings, ...pickSettings(session.settings) };
      else applySettings(session.settings);
    }

    isManualPause = false;
    showSavedSessionPrompt = false;
    return true;
  }

  /** @param {import('./lib/library.js').LibraryText} saved */
  function openLibraryText(saved) {
    stop();
    // Save where the previous text was left; the server position of the new one wins
    progressSync.flush();
    text = saved.content;
    parseText(saved.chapters);
    currentWordIndex = Math.min(saved.currentWordIndex, words.length);
    progress = words.length > 0 ? (currentWordIndex / words.length) * 100 : 0;
    libraryText = { id: saved.id, title: saved.title };
    savedPosition = currentWordIndex;
    progressSync.link(saved.id, currentWordIndex);
    textSource = {};
    isManualPause = false;
    showSavedSessionPrompt = false;
    showLibrary = false;
  }

  // Another text is loaded: save the library text's position and unlink it
  function leaveLibraryText() {
    progressSync.flush();
    progressSync.unlink();
    libraryText = null;
  }

  // Library texts belong to the account: close them when nobody is signed in anymore
  // (nothing to save, the session is gone)
  function closeLibraryText() {
    stop();
    progressSync.unlink();
    libraryText = null;
    text = DEFAULT_TEXT;
    parseText();
  }

  $: if ($auth.status !== 'user' && $auth.status !== 'loading' && libraryText) {
    closeLibraryText();
  }

  function handleTextSaved(event) {
    libraryText = { id: event.detail.id, title: event.detail.title };
    savedPosition = event.detail.currentWordIndex;
    progressSync.link(event.detail.id, event.detail.currentWordIndex);
    showSaveToLibrary = false;
  }

  // After signing in (not on a reload while signed in), offer once to move the browser
  // session into the library
  /** @type {{text: string, chapters: Array, currentWordIndex: number, totalWords: number, title: string}|null} */
  let sessionImport = null;
  let previousAuthStatus = $auth.status;

  function handleSignIn(status) {
    const signedIn = previousAuthStatus === 'guest' && status === 'user';
    previousAuthStatus = status;
    if (signedIn) offerSessionImport();
  }

  $: handleSignIn($auth.status);

  function offerSessionImport() {
    const session = loadSession();
    if (!session?.text || session.importOffered) return;
    markImportOffered();
    const reading = session.text === text && words.length > 0;
    const sessionChapters = session.chapters ?? detectChapters(session.text);
    sessionImport = {
      text: session.text,
      chapters: sessionChapters,
      // The reader is further along than the last save when it shows the session's text
      currentWordIndex: reading ? currentWordIndex : session.currentWordIndex,
      totalWords: reading ? words.length : session.totalWords,
      title: defaultTitle({ text: session.text })
    };
  }

  function handleSessionImported(event) {
    const imported = sessionImport;
    sessionImport = null;
    // Moved to the library: the browser copy is no longer needed
    clearSavedSession();
    if (text !== imported.text) {
      stop();
      text = imported.text;
      textSource = {};
      parseText(imported.chapters);
      currentWordIndex = Math.min(imported.currentWordIndex, words.length);
      progress = words.length > 0 ? (currentWordIndex / words.length) * 100 : 0;
    }
    handleTextSaved(event);
  }

  function handleLibraryRenamed(event) {
    if (libraryText?.id === event.detail.id) libraryText = { ...libraryText, title: event.detail.title };
  }

  function handleLibraryReset(event) {
    if (libraryText?.id !== event.detail) return;
    savedPosition = 0;
    progressSync.link(event.detail, 0);
    stop();
  }

  function handleLibraryDeleted(event) {
    // The text stays in the reader, it just isn't linked to the library anymore
    if (libraryText?.id === event.detail) {
      progressSync.unlink();
      libraryText = null;
      savedPosition = null;
    }
  }

  function clearSavedSession() {
    clearSession();
    showSavedSessionPrompt = false;
    savedSessionInfo = null;
  }

  // Move to a word picked by the user. Jumps (search, chapter, progress bar) are saved
  // right away, small steps with the next save.
  function goTo(index, { save = false } = {}) {
    currentWordIndex = Math.max(0, Math.min(words.length, index));
    progress = words.length > 0 ? (currentWordIndex / words.length) * 100 : 0;
    progressSync.update(currentWordIndex);
    if (save) progressSync.flush();
  }

  function jumpToWord(value) {
    if (!value || words.length === 0) return;

    let targetIndex;
    const trimmed = value.trim();

    if (trimmed.endsWith('%')) {
      const percent = parseFloat(trimmed.slice(0, -1));
      if (!isNaN(percent)) {
        targetIndex = Math.floor((Math.max(0, Math.min(100, percent)) / 100) * words.length);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num)) {
        targetIndex = Math.max(0, Math.min(words.length, num));
      }
    }

    if (targetIndex !== undefined) goTo(targetIndex, { save: true });

    showJumpTo = false;
    jumpToValue = '';
  }

  function jumpToChapter(index) {
    const chapter = chapters[index];
    if (!chapter || words.length === 0) return;
    goTo(chapter.wordIndex, { save: true });
  }

  function searchText(query) {
    return searchWords(words, query);
  }

  function handleProgressClick(event) {
    goTo(Math.floor((event.detail.percentage / 100) * words.length), { save: true });
  }

  // Leave reading mode but keep the position (Esc or the exit button); saved like a pause
  function exitFocusMode() {
    isPlaying = false;
    isPaused = false;
    if (intervalId) {
      clearTimeout(intervalId);
      intervalId = null;
    }
    progressSync.flush();
  }

  function handleKeydown(e) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (isPlaying) pause();
        else if (isPaused) resume();
        else start();
        break;
      case 'Escape':
        if (showJumpTo) {
          showJumpTo = false;
          jumpToValue = '';
          searchResults = [];
          isSearchMode = false;
        } else if (showSettings || showTextInput) {
          showSettings = false;
          showTextInput = false;
        } else if (showSavedSessionPrompt) {
          showSavedSessionPrompt = false;
        } else if (isPlaying || isPaused) {
          exitFocusMode();
        }
        break;
      case 'KeyG':
        if (!isPlaying && !showSettings && !showTextInput) {
          e.preventDefault();
          showJumpTo = !showJumpTo;
        }
        break;
      case 'KeyS':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          saveCurrentSession();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        settings.wordsPerMinute = Math.min(1000, settings.wordsPerMinute + 25);
        break;
      case 'ArrowDown':
        e.preventDefault();
        settings.wordsPerMinute = Math.max(50, settings.wordsPerMinute - 25);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (currentWordIndex > 1) goTo(currentWordIndex - 2);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (currentWordIndex < words.length) goTo(currentWordIndex + 1);
        break;
    }
  }

  // The page may be closed after this, so a normal request could be cancelled
  function saveBeforeLeaving() {
    progressSync.flushWithBeacon();
    settingsSync.flushWithBeacon();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') saveBeforeLeaving();
  }

  $: progressSync.setPlaying(isPlaying);

  onMount(() => {
    parseText();
    window.addEventListener('keydown', handleKeydown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', saveBeforeLeaving);
    initAuth();

    // Check for saved session
    if (hasSession()) {
      savedSessionInfo = getSessionSummary();
      if (savedSessionInfo) {
        showSavedSessionPrompt = true;
      }
    }
  });

  onDestroy(() => {
    if (intervalId) clearTimeout(intervalId);
    if (fadeTimeoutId) clearTimeout(fadeTimeoutId);
    window.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', saveBeforeLeaving);
    clearTimeout(saveNoticeTimeoutId);
    progressSync.setPlaying(false);
    progressSync.flush();
    settingsSync.flush();
  });
</script>

<main class:focus-mode={isFocusMode}>
  {#if isFocusMode}
    <button class="exit-focus" on:click={exitFocusMode} title="Exit reading mode (Esc)" aria-label="Exit reading mode">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      <span class="exit-label">Exit</span>
    </button>
  {/if}

  <!-- Header - hidden during focus mode -->
  {#if !isFocusMode}
    <header>
      <div class="title-group">
        <h1>RSVP Reader</h1>
        {#if libraryText}
          <span class="library-title" title="Open from your library">{libraryText.title}</span>
        {/if}
      </div>
      <div class="header-actions">
        {#if chapters.length > 1}
          <select
            class="chapter-select"
            value={currentChapterIndex}
            on:change={(e) => jumpToChapter(Number(e.currentTarget.value))}
            title="Jump to chapter"
            aria-label="Jump to chapter"
          >
            {#if currentChapterIndex === -1}
              <option value={-1} disabled>Chapters</option>
            {/if}
            {#each chapters as chapter, index}
              <option value={index}>{'  '.repeat(chapter.level)}{chapter.title}</option>
            {/each}
          </select>
        {/if}
        <button
          class="icon-btn"
          on:click={() => { showJumpTo = !showJumpTo; showSettings = false; showTextInput = false; }}
          title="Jump to word (G)"
          class:active={showJumpTo}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
          </svg>
        </button>
        <button
          class="icon-btn"
          on:click={saveCurrentSession}
          title="Save progress (Ctrl+S)"
          disabled={words.length === 0}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
          </svg>
        </button>
        <button
          class="icon-btn"
          on:click={() => { showTextInput = !showTextInput; showSettings = false; showJumpTo = false; }}
          title="Load Content"
          class:active={showTextInput}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
          </svg>
        </button>
        <button
          class="icon-btn"
          on:click={() => { showSettings = !showSettings; showTextInput = false; showJumpTo = false; }}
          title="Settings"
          class:active={showSettings}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
        {#if $auth.status === 'user'}
          {#if !libraryText && words.length > 0}
            <button
              class="icon-btn"
              on:click={() => (showSaveToLibrary = true)}
              title="Save to library"
              aria-label="Save to library"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3H8V9h3V6h2v3h3v2z"/>
              </svg>
            </button>
          {/if}
          <button
            class="icon-btn"
            on:click={() => (showLibrary = true)}
            title="Library"
            aria-label="Library"
            class:active={showLibrary}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
            </svg>
          </button>
        {/if}
        <AccountMenu on:library={() => (showLibrary = true)} />
      </div>
    </header>
  {/if}

  <!-- Panels -->
  {#if showTextInput && !isFocusMode}
    <div class="panel-overlay">
      <TextInput
        {text}
        isLoading={isLoadingFile}
        {loadingMessage}
        on:apply={handleTextApply}
        on:fileselect={handleFileSelect}
        on:close={() => showTextInput = false}
      />
    </div>
  {/if}


  {#if showSettings && !isFocusMode}
    <div class="panel-overlay">
      <Settings
        bind:wordsPerMinute={settings.wordsPerMinute}
        bind:fadeEnabled={settings.fadeEnabled}
        bind:fadeDuration={settings.fadeDuration}
        bind:pauseOnPunctuation={settings.pauseOnPunctuation}
        bind:punctuationPauseMultiplier={settings.punctuationPauseMultiplier}
        bind:wordLengthWPMMultiplier={settings.wordLengthWPMMultiplier}
        bind:pauseAfterWords={settings.pauseAfterWords}
        bind:pauseDuration={settings.pauseDuration}
        bind:frameWordCount={settings.frameWordCount}
        bind:showContextEnabled={settings.showContextEnabled}
        on:close={() => showSettings = false}
      />
    </div>
  {/if}

  {#if showJumpTo && !isFocusMode}
    <div class="panel-overlay" on:click|self={() => { showJumpTo = false; searchResults = []; isSearchMode = false; }} role="presentation">
      <div class="jump-to-panel">
        <h3>Jump to position</h3>

        <!-- Tabs to switch between modes -->
        <div class="search-tabs">
          <button
            class:active={!isSearchMode}
            on:click={() => { isSearchMode = false; searchResults = []; jumpToValue = ''; }}
          >
            By Position
          </button>
          <button
            class:active={isSearchMode}
            on:click={() => { isSearchMode = true; jumpToValue = ''; }}
          >
            Search Text
          </button>
        </div>

        {#if isSearchMode}
          <!-- Search mode -->
          <p class="jump-hint">Search for a word or phrase in the text</p>
          <form on:submit|preventDefault={() => { searchResults = searchText(jumpToValue); }}>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text"
              bind:value={jumpToValue}
              placeholder="Type to search..."
              on:input={() => {
                if (jumpToValue.length >= 2) {
                  searchResults = searchText(jumpToValue);
                } else {
                  searchResults = [];
                }
              }}
              autofocus
            />
          </form>

          {#if searchResults.length > 0}
            <div class="search-results">
              {#each searchResults as result}
                <button
                  class="search-result"
                  on:click={() => {
                    goTo(result.index, { save: true });
                    showJumpTo = false;
                    jumpToValue = '';
                    searchResults = [];
                    isSearchMode = false;
                  }}
                >
                  <span class="result-position">Word {result.index} ({result.percentage}%)</span>
                  <span class="result-context">...{result.context}...</span>
                </button>
              {/each}
            </div>
          {:else if jumpToValue.length >= 2}
            <p class="no-results">No results found</p>
          {/if}

        {:else}
          <!-- Original mode by position -->
          <p class="jump-hint">Enter word number (e.g., 150) or percentage (e.g., 50%)</p>
          <form on:submit|preventDefault={() => jumpToWord(jumpToValue)}>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text"
              bind:value={jumpToValue}
              placeholder="Word # or %"
              autofocus
            />
            <div class="jump-actions">
              <button type="button" class="secondary" on:click={() => showJumpTo = false}>Cancel</button>
              <button type="submit" class="primary">Go</button>
            </div>
          </form>
          <div class="quick-jumps">
            <button on:click={() => jumpToWord('0')}>Start</button>
            <button on:click={() => jumpToWord('25%')}>25%</button>
            <button on:click={() => jumpToWord('50%')}>50%</button>
            <button on:click={() => jumpToWord('75%')}>75%</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showLibrary}
    <LibraryPanel
      currentTextId={libraryText?.id ?? null}
      beforeFetch={() => progressSync.flush()}
      on:close={() => (showLibrary = false)}
      on:open={(e) => openLibraryText(e.detail)}
      on:renamed={handleLibraryRenamed}
      on:reset={handleLibraryReset}
      on:deleted={handleLibraryDeleted}
    />
  {/if}

  {#if showSaveToLibrary}
    <SaveToLibraryModal
      title={defaultTitle({ ...textSource, text })}
      content={text}
      {chapters}
      {currentWordIndex}
      totalWords={words.length}
      on:close={() => (showSaveToLibrary = false)}
      on:saved={handleTextSaved}
    />
  {/if}

  {#if sessionImport}
    <SaveToLibraryModal
      heading="Save to library?"
      cancelLabel="No"
      title={sessionImport.title}
      content={sessionImport.text}
      chapters={sessionImport.chapters}
      currentWordIndex={sessionImport.currentWordIndex}
      totalWords={sessionImport.totalWords}
      on:close={() => (sessionImport = null)}
      on:saved={handleSessionImported}
    >
      <p class="notice">
        Save your current text ('{sessionImport.title}', {wordIndexToPercentage(sessionImport.currentWordIndex, sessionImport.totalWords)}%)
        to your library?
      </p>
    </SaveToLibraryModal>
  {/if}

  {#if showRestartConfirm}
    <Modal title="Start from the beginning?" on:close={() => (showRestartConfirm = false)}>
      <p class="notice">
        Your saved position (word {savedPosition.toLocaleString('en')} of {words.length.toLocaleString('en')})
        will be replaced the next time your progress is saved.
      </p>
      <div class="actions">
        <button type="button" class="secondary" on:click={() => (showRestartConfirm = false)}>Cancel</button>
        <button type="button" class="primary" on:click={confirmRestart}>Start over</button>
      </div>
    </Modal>
  {/if}

  {#if showSavedSessionPrompt && savedSessionInfo}
    <div class="panel-overlay">
      <div class="saved-session-panel">
        <h3>Resume reading?</h3>
        <p>You have a saved session at word {savedSessionInfo.currentWordIndex} of {savedSessionInfo.totalWords}</p>
        <p class="saved-time">Saved {new Date(savedSessionInfo.savedAt).toLocaleString()}</p>
        <div class="session-actions">
          <button class="secondary" on:click={clearSavedSession}>Start Fresh</button>
          <button class="primary" on:click={loadSavedSession}>Resume</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Main Display -->
  <div class="display-area">
    <RSVPDisplay
      word={currentWord}
      wordGroup={wordFrame.subset}
      highlightIndex={wordFrame.centerOffset}
      opacity={wordOpacity}
      fadeDuration={settings.fadeDuration}
      fadeEnabled={settings.fadeEnabled}
      multiWordEnabled={settings.frameWordCount > 1}
      showContext={showSurroundingText}
      {contextBefore}
      {contextAfter}
    />
  </div>

  <!-- Bottom Bar -->
  <div class="bottom-bar" class:minimal={isFocusMode}>
    <ProgressBar
      {progress}
      currentWord={currentWordIndex}
      totalWords={words.length}
      wpm={settings.wordsPerMinute}
      {timeRemaining}
      minimal={isFocusMode}
      clickable={!isPlaying}
      on:seek={handleProgressClick}
    />

    {#if saveNotice}
      <div class="save-notice" role="status">{saveNotice}</div>
    {/if}

    <!-- Word position while paused (stats are hidden in focus mode) -->
    {#if isManualPause}
      <div class="word-counter">
        Paused at word {currentWordIndex} / {words.length}{#if currentChapterIndex >= 0}&nbsp;· {chapters[currentChapterIndex].title}{/if}
      </div>
    {/if}

    <div class="controls-area">
      <Controls
        {isPlaying}
        {isPaused}
        canPlay={words.length > 0}
        minimal={isFocusMode}
        on:play={start}
        on:pause={pause}
        on:resume={resume}
        on:stop={stopToSavedPosition}
        on:restart={requestRestart}
      />
    </div>

    {#if !isFocusMode}
      <div class="shortcuts desktop-only">
        <kbd>Space</kbd> Play
        <kbd>Esc</kbd> Exit
        <kbd>↑↓</kbd> Speed
        <kbd>←→</kbd> Skip
        <kbd>G</kbd> Jump
        <kbd>Ctrl+S</kbd> Save
      </div>
      <div class="touch-controls mobile-only">
        <button class="touch-btn" on:click={() => goTo(currentWordIndex - 5)} title="Back 5 words">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <button class="touch-btn" on:click={() => settings.wordsPerMinute = Math.max(50, settings.wordsPerMinute - 50)} title="Slower">
          <span>−WPM</span>
        </button>
        <span class="wpm-display">{settings.wordsPerMinute}</span>
        <button class="touch-btn" on:click={() => settings.wordsPerMinute = Math.min(1000, settings.wordsPerMinute + 50)} title="Faster">
          <span>+WPM</span>
        </button>
        <button class="touch-btn" on:click={() => goTo(currentWordIndex + 5)} title="Forward 5 words">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
        </button>
      </div>
    {/if}
  </div>
</main>

<style>
  :global(body) {
    background-color: #000 !important;
    margin: 0;
    padding: 0;
    overflow: hidden;
    position: fixed;
    width: 100%;
    height: 100%;
  }

  main {
    height: 100vh;
    height: 100dvh; /* Dynamic viewport height for mobile */
    display: flex;
    flex-direction: column;
    background-color: #000;
    color: #fff;
    font-family: 'Segoe UI', system-ui, sans-serif;
    padding: 2rem;
    box-sizing: border-box;
    transition: padding 0.3s ease;
    overflow: hidden;
  }

  main.focus-mode {
    padding: 1rem;
  }

  /* Way out of reading mode besides Esc; subtle so it doesn't distract while reading */
  .exit-focus {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: 1px solid #222;
    border-radius: 8px;
    color: #444;
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .exit-focus:hover,
  .exit-focus:focus-visible {
    border-color: #555;
    color: #fff;
  }

  .exit-focus svg {
    width: 16px;
    height: 16px;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-shrink: 0;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 400;
    color: #555;
    margin: 0;
  }

  .title-group {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    min-width: 0;
  }

  .library-title {
    color: #888;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 30vw;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .chapter-select {
    background: transparent;
    border: 1px solid #333;
    color: #888;
    padding: 0 0.6rem;
    border-radius: 8px;
    font-size: 0.85rem;
    cursor: pointer;
    max-width: 220px;
    text-overflow: ellipsis;
  }

  .chapter-select:hover,
  .chapter-select:focus {
    border-color: #555;
    color: #fff;
    outline: none;
  }

  .chapter-select option {
    background: #111;
    color: #fff;
  }

  .icon-btn {
    background: transparent;
    border: 1px solid #333;
    color: #555;
    padding: 0.5rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    border-color: #555;
    color: #fff;
  }

  .icon-btn.active {
    border-color: #ff4444;
    color: #ff4444;
  }

  .icon-btn svg {
    width: 20px;
    height: 20px;
  }

  .panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 2rem;
  }

  .display-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    overflow: hidden;
  }

  .bottom-bar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-top: 1rem;
    transition: all 0.3s ease;
  }

  .bottom-bar.minimal {
    gap: 0.5rem;
    padding-top: 0.5rem;
  }

  .controls-area {
    display: flex;
    justify-content: center;
  }

  .shortcuts {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    color: #444;
    font-size: 0.8rem;
  }

  kbd {
    background: #1a1a1a;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-family: monospace;
    color: #666;
    margin-right: 0.25rem;
  }

  /* Touch controls for mobile */
  .touch-controls {
    display: none;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
  }

  .touch-btn {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #888;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .touch-btn:active {
    background: #333;
    color: #fff;
  }

  .touch-btn svg {
    width: 20px;
    height: 20px;
  }

  .wpm-display {
    color: #ff4444;
    font-family: monospace;
    font-size: 0.85rem;
    min-width: 3rem;
    text-align: center;
  }

  .mobile-only {
    display: none;
  }

  .desktop-only {
    display: flex;
  }

  /* Mobile styles */
  @media (max-width: 600px) {
    main {
      padding: 1rem;
    }

    main.focus-mode {
      padding: 0.5rem;
    }

    .exit-focus {
      top: 0.5rem;
      right: 0.5rem;
    }

    .panel-overlay {
      padding: 1rem;
    }

    .chapter-select {
      max-width: 40vw;
    }

    .desktop-only {
      display: none;
    }

    .mobile-only {
      display: flex;
    }
  }

  /* Jump to panel */
  .jump-to-panel,
  .saved-session-panel {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 320px;
    width: 100%;
  }

  .jump-to-panel h3,
  .saved-session-panel h3 {
    margin: 0 0 0.5rem 0;
    color: #fff;
    font-size: 1.1rem;
  }

  .jump-hint {
    color: #666;
    font-size: 0.85rem;
    margin: 0 0 1rem 0;
  }

  .jump-to-panel input {
    width: 100%;
    padding: 0.75rem;
    background: #111;
    border: 1px solid #333;
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
    margin-bottom: 1rem;
    box-sizing: border-box;
  }

  .jump-to-panel input:focus {
    outline: none;
    border-color: #ff4444;
  }

  .jump-actions,
  .session-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .jump-actions button,
  .session-actions button {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .jump-actions button.primary,
  .session-actions button.primary {
    background: #ff4444;
    color: #fff;
  }

  .jump-actions button.primary:hover,
  .session-actions button.primary:hover {
    background: #ff6666;
  }

  .jump-actions button.secondary,
  .session-actions button.secondary {
    background: #333;
    color: #fff;
  }

  .jump-actions button.secondary:hover,
  .session-actions button.secondary:hover {
    background: #444;
  }

  .quick-jumps {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #333;
  }

  .quick-jumps button {
    flex: 1;
    padding: 0.5rem;
    background: #222;
    border: 1px solid #333;
    border-radius: 4px;
    color: #888;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.2s;
  }

  .quick-jumps button:hover {
    background: #333;
    color: #fff;
  }

  .saved-session-panel p {
    margin: 0.5rem 0;
    color: #ccc;
  }

  .saved-session-panel .saved-time {
    color: #666;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Search tabs */
  .search-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .search-tabs button {
    flex: 1;
    padding: 0.5rem;
    background: #222;
    border: 1px solid #333;
    border-radius: 6px;
    color: #888;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;
  }

  .search-tabs button:hover {
    background: #333;
    color: #fff;
  }

  .search-tabs button.active {
    background: #ff4444;
    border-color: #ff4444;
    color: #fff;
  }

  /* Search results */
  .search-results {
    max-height: 250px;
    overflow-y: auto;
    margin-top: 1rem;
    border: 1px solid #333;
    border-radius: 6px;
  }

  .search-result {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 0.75rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid #333;
    color: #fff;
    cursor: pointer;
    text-align: left;
    transition: background 0.2s;
  }

  .search-result:last-child {
    border-bottom: none;
  }

  .search-result:hover {
    background: #222;
  }

  .result-position {
    font-size: 0.75rem;
    color: #ff4444;
    margin-bottom: 0.25rem;
  }

  .result-context {
    font-size: 0.85rem;
    color: #aaa;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .no-results {
    color: #666;
    text-align: center;
    padding: 1rem;
    font-size: 0.9rem;
  }

  .save-notice {
    text-align: center;
    color: #888;
    font-size: 0.85rem;
    margin-bottom: 0.25rem;
  }

  .word-counter {
    text-align: center;
    color: #888;
    font-size: 0.9rem;
    font-family: monospace;
    font-variant-numeric: tabular-nums;
    margin-bottom: 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
