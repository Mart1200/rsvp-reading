# RSVP Reader

A Svelte-based Rapid Serial Visual Presentation (RSVP) reader for speed reading with PDF and EPUB support.

## Online version / DEMO

Link: https://rsvp.n0name.eu/

<video src="rsvp-clip.mp4" controls width="600"></video>

## What is RSVP?

Rapid Serial Visual Presentation (RSVP) is a technique where text is displayed one word at a time at a fixed focal point. This eliminates the need for eye movements (saccades) during reading, potentially allowing for significantly faster reading speeds.

The app uses **Optimal Recognition Point (ORP)** highlighting - the red letter in each word indicates the point where your eye naturally focuses for fastest word recognition. This is calculated based on word length:

- 1-3 letter words: 1st letter
- 4-5 letter words: 2nd letter
- 6-9 letter words: 3rd letter
- 10+ letter words: 4th letter

## Features

- **PDF & EPUB Support**: Upload PDF documents or EPUB e-books directly
- **Adjustable reading speed**: 50-1000 words per minute (WPM)
- **ORP highlighting**: Red-highlighted focal letter for faster recognition
- **Monospace display**: Fixed-width font keeps the focal point stable
- **Focus mode**: Minimal UI during reading for distraction-free experience
- **Fade effect**: Optional smooth transitions between words
- **Punctuation pauses**: Configurable extra pause on sentence-ending punctuation
- **Periodic pauses**: Optional pause every N words for comprehension
- **Progress tracking**: Visual progress bar and time remaining
- **Save progress**: Save your reading session and resume later
- **Jump to position**: Skip to any word number or percentage in the text
- **Clickable progress bar**: Click anywhere on the progress bar to jump to that position
- **Keyboard shortcuts**: Full keyboard control for hands-free reading
- **Dark theme**: Easy on the eyes with black background

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/rsvp.git
cd rsvp

# Install dependencies
npm install

# Start development server
npm run dev
```

### Backend (API + Postgres)

The frontend works on its own. The API in `server/` (Node, [Hono](https://hono.dev), Postgres) is needed for account features. The Vite dev server proxies `/api` to it (`http://localhost:3000`, override with `API_URL`).

```bash
# Start Postgres for development and tests (creates databases rsvp and rsvp_test)
docker compose -f docker/docker-compose.dev.yml up -d

cd server
npm install
cp .env.example .env

# Start the API with auto-reload (applies pending migrations on start)
npm run dev
```

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | – | Postgres connection string. Alternatively set `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (no URL encoding needed); one of both is required |
| `PORT` | `3000` | API port |
| `ORIGIN` | `http://localhost:5173` | Origin allowed to send mutating requests. Required when `NODE_ENV=production` (set in the Docker image) |
| `COOKIE_SECURE` | `true` | Set to `false` only when served over plain http on a host other than `localhost` |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so rate limits use the client IP from `X-Forwarded-For` (the proxy must append it) |
| `STATIC_DIR` | – | Frontend build to serve (set in the Docker image; unset in development, where Vite serves the frontend) |

Migrations are plain SQL files in `server/migrations/`, applied in filename order on startup (or with `npm run migrate`). Add a new file such as `002_add_something.sql` and never edit an applied one.

## Docker

Run the app (one image with frontend + API) and Postgres using Docker Compose:

```bash
cd docker
cp .env.example .env   # set POSTGRES_PASSWORD and ORIGIN for a real deployment
docker compose up -d --build --wait
```

The app will be available at http://localhost:8080. The image is built by `docker/Dockerfile`: it builds the frontend with Vite and the Node server serves it next to the API (SPA fallback, gzip, immutable caching for `/assets/*`). Postgres data is stored in the `pgdata` volume. For HTTPS, put a reverse proxy (e.g. Caddy or Traefik) in front, set `ORIGIN` to the public URL and `TRUST_PROXY=true`.

> **Behind a reverse proxy, set `TRUST_PROXY=true`.** Otherwise every request appears to come from the proxy's IP, so the login and registration rate limits apply to all users at once (anyone could lock out a username, and 10 sign-ups per hour would block registration site-wide). The API logs a warning when it receives `X-Forwarded-For` without `TRUST_PROXY`. Only enable it if the app is reachable exclusively through the proxy, since clients could otherwise fake their IP.

Check that the running stack works end to end:

```bash
bash docker/smoke-test.sh
```

The smoke test also runs a full account flow (register, log in/out, delete) with a throwaway user.

### Accounts

Accounts are optional: without signing in the app works exactly as before, with progress stored in the browser. Users register with a username (3–32 characters: letters, digits, `_`, `-`; case-insensitive) and a password (8–128 characters, stored as an argon2id hash). Sessions last 30 days and are extended while in use.

Rate limits (in memory, per server process; `429` with `Retry-After`):

| What | Limit |
|---|---|
| Failed logins per IP + username | 5 / minute |
| Failed logins per IP, any username (password spraying) | 30 / 15 minutes |
| Failed logins per username, any IP (distributed guessing) | 50 / 15 minutes |
| Registrations per IP (invalid input and taken names don't count) | 10 / hour |
| Wrong current password per user (change password, delete account) | 5 / minute |

The per-username limit applies to everyone trying that account, including its owner. Locking someone out therefore requires a sustained stream of wrong guesses; this is the trade-off for stopping guessing from many IPs.

There is no email-based password recovery. An admin can reset a password, which also signs the user out everywhere:

```bash
# Generates and prints a new password
docker compose exec app node scripts/reset-password.js <username>

# Or set a specific one via stdin (keeps it out of shell history)
echo 'new password' | docker compose exec -T app node scripts/reset-password.js <username> --password-stdin
```

Locally: `cd server && npm run reset-password -- <username>`.

## Usage

### Running the App

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Loading Content

**From Files:**
1. Click the document icon in the header
2. Click "Upload PDF or EPUB"
3. Select your PDF or EPUB file
4. The text will be extracted and loaded automatically

**From Text:**
1. Click the document icon in the header
2. Paste or type your text in the textarea
3. Click "Load Text"

### Controls

**Buttons:**
- **Play**: Start reading from the beginning or current position
- **Pause**: Pause reading (UI enters focus mode with minimal controls)
- **Exit** (top right, only in focus mode): Leave focus mode and keep the position, same as `Esc`

When paused or not reading, the text around the current word is shown so you can see where you are (Settings → *Show context when paused or not reading*).
- **Resume**: Continue from where you paused
- **Stop**: Stop and go back to your last saved position (library or browser), or to the beginning if nothing is saved
- **Restart**: Start from the beginning. If progress is saved, you are asked first; the saved position is only replaced the next time you save

**Keyboard Shortcuts:**
| Key | Action |
|-----|--------|
| `Space` | Play/Pause/Resume |
| `Escape` | Exit focus mode (or close dialogs) |
| `Arrow Up` | Increase speed (+25 WPM) |
| `Arrow Down` | Decrease speed (-25 WPM) |
| `Arrow Left` | Go back one word |
| `Arrow Right` | Skip forward one word |
| `G` | Open jump to position dialog |
| `Ctrl+S` / `Cmd+S` | Save current progress |

### Account

Click **Sign in** in the header to register or log in. The account menu (your username) offers *Change password* (signs out your other devices), *Log out* and *Delete account* (removes the account with all saved texts and progress after a confirmation).

### Library

When signed in, two extra buttons appear in the header:

- **Save to library** (bookmark icon): stores the loaded text with its chapters and your current position in your account. The title is suggested from the EPUB book title, the file name or the first words of pasted text, and can be edited. The button is hidden for texts that are already in the library.
- **Library** (books icon, also in the account menu): lists your texts with words read / total (e.g. `600 / 1,200 words`), progress in percent and when you last read them. Click a title to continue reading at the saved position. Each entry can be renamed, reset to the beginning or deleted (both with confirmation).

The title of an open library text is shown next to the app name. For library texts, the save button and `Ctrl+S` store the position in your account instead of the browser. Texts that are not in the library keep working exactly like before. Signing out closes an open library text.

### Saving and Resuming Progress

**Save Progress:**
- Click the save icon in the header (floppy disk icon)
- Or press `Ctrl+S` (Windows/Linux) or `Cmd+S` (Mac)
- Your current position, text, and all settings are saved to browser storage

**Resume Reading:**
- When you return to the app, you'll be prompted to resume your saved session
- Click "Resume" to continue from where you left off
- Click "Start Fresh" to begin with the default text

### Jump to Position

**Using the Jump Dialog:**
1. Click the code bracket icon in the header, or press `G`
2. Enter a word number (e.g., `150`) or percentage (e.g., `50%`)
3. Click "Go" or press Enter

**Quick Jump Buttons:**
- Use the preset buttons (Start, 25%, 50%, 75%) for quick navigation

**Clickable Progress Bar:**
- When not playing, click anywhere on the progress bar to jump directly to that position
- The progress bar expands on hover to make clicking easier

### Settings

Click the gear icon to access settings:

- **Words Per Minute**: Reading speed (50-1000 WPM)
- **Enable Fade Effect**: Smooth fade transition between words
- **Fade Duration**: Duration of fade effect (50-300ms)
- **Pause on Punctuation**: Extra pause at sentence endings
- **Punctuation Pause Multiplier**: How much longer to pause (1-4x)
- **Pause Every N Words**: Take a break every N words (0 = disabled)
- **Pause Duration**: Length of periodic pauses (100-2000ms)

## Project Structure

```
rsvp/
├── src/
│   ├── App.svelte              # Main application component
│   ├── app.css                 # Global styles
│   ├── main.js                 # Application entry point
│   ├── lib/
│   │   ├── rsvp-utils.js       # Core RSVP utility functions
│   │   ├── file-parsers.js     # PDF and EPUB parsing utilities
│   │   ├── progress-storage.js # Session save/load utilities
│   │   ├── api.js              # Fetch wrapper for the backend (ApiError)
│   │   ├── auth.js             # Auth store and actions (login, register, ...)
│   │   ├── library.js          # Library API calls, suggested titles, formatting
│   │   └── components/
│   │       ├── RSVPDisplay.svelte   # Word display component
│   │       ├── Controls.svelte      # Playback controls
│   │       ├── Settings.svelte      # Settings panel
│   │       ├── TextInput.svelte     # Text/file input panel
│   │       ├── ProgressBar.svelte   # Progress indicator (clickable)
│   │       ├── AccountMenu.svelte   # Sign-in button / account menu
│   │       ├── Modal.svelte         # Dialog base (focus, Escape, form styles)
│   │       ├── LibraryPanel.svelte  # Library list: open, rename, reset, delete
│   │       └── *Modal.svelte        # Auth, account, save to library
│   └── tests/
│       ├── setup.js                 # Test setup
│       ├── helpers/fetch-mock.js    # mockFetch() route table for API calls
│       ├── components/              # Component tests (@testing-library/svelte)
│       ├── rsvp-utils.test.js       # RSVP utility tests
│       ├── file-parsers.test.js     # File parser tests
│       └── progress-storage.test.js # Progress storage tests
├── server/                     # Backend API (separate npm package)
│   ├── src/
│   │   ├── index.js            # Entry point: migrate, then serve
│   │   ├── app.js              # Hono app: routes, body limit, error handling
│   │   ├── static.js           # Serves the built frontend (SPA fallback, caching)
│   │   ├── config.js           # Environment configuration
│   │   ├── errors.js           # HttpError + uniform error body
│   │   ├── csrf.js             # Origin + JSON content-type check
│   │   ├── request.js          # JSON body parsing, client IP
│   │   ├── db.js               # Postgres pool
│   │   ├── migrate.js          # SQL migration runner
│   │   ├── auth/               # Passwords, sessions, validation, rate limits, admin
│   │   ├── texts/              # Word counting (same as the reader), text validation
│   │   └── routes/             # Route modules: auth.js (/api/auth/*), texts.js (/api/texts/*)
│   ├── migrations/             # Numbered .sql migrations
│   ├── scripts/                # CLI scripts (migrate, reset-password)
│   └── tests/
│       ├── unit/               # No database needed
│       ├── integration/        # Run against Postgres
│       ├── helpers/            # setupTestApp, request, fixtures, db utils
│       └── fixtures/           # Test data (e.g. sample migrations)
├── docker/
│   ├── Dockerfile              # Single image: frontend build + API
│   ├── docker-compose.yml      # app + db
│   ├── docker-compose.dev.yml  # Postgres for development/tests
│   └── smoke-test.sh           # End-to-end check of the running stack
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## Testing

```bash
# Run tests in watch mode
npm test

# Run tests once
npm run test:run

# Run tests with coverage
npm run test:coverage
```

### Server tests

Integration tests need the dev Postgres (`docker compose -f docker/docker-compose.dev.yml up -d`). They use the `rsvp_test` database (override with `TEST_DATABASE_URL`, also read from `server/.env`) and recreate its schema on every run. As a safeguard, the tests refuse to run unless the database name ends in `_test`.

```bash
cd server
npm run test:run          # all tests
npm run test:unit         # no database needed
npm run test:integration  # against Postgres
```

Writing new API tests:

```js
import { setupTestApp } from '../helpers/app.js';
import { createText } from '../helpers/fixtures.js';

const ctx = setupTestApp(); // app + pool on the test DB, tables truncated after each test

it('returns the text', async () => {
  const { user, cookie } = await ctx.loggedInUser(); // user with password + session
  const text = await createText(ctx.pool, user.id, { title: 'Book' });

  // Mutating requests get a matching Origin and JSON content type automatically
  const res = await ctx.request('GET', `/api/texts/${text.id}`, { cookie });
  expect(res.status).toBe(200);
});
```

## API Reference

### Utility Functions (`src/lib/rsvp-utils.js`)

#### `parseText(text)`
Parses input text into an array of words.

```javascript
parseText('Hello world') // ['Hello', 'world']
```

#### `getORPIndex(word)`
Calculates the Optimal Recognition Point index for a word.

```javascript
getORPIndex('hello') // 1 (second letter 'e')
```

#### `getActualORPIndex(word)`
Gets the actual character index for ORP, accounting for leading punctuation.

```javascript
getActualORPIndex('"hello') // 2 (skips the quote)
```

#### `getWordDelay(word, wpm, pauseOnPunctuation, multiplier)`
Calculates the display delay for a word based on WPM and punctuation.

```javascript
getWordDelay('hello', 300) // 200 (ms)
getWordDelay('end.', 300, true, 2) // 400 (ms)
```

#### `formatTimeRemaining(remainingWords, wpm)`
Formats remaining time as MM:SS.

```javascript
formatTimeRemaining(300, 300) // '1:00'
```

#### `splitWordForDisplay(word)`
Splits a word into parts for ORP display.

```javascript
splitWordForDisplay('hello')
// { before: 'h', orp: 'e', after: 'llo' }
```

#### `shouldPauseAtWord(wordIndex, pauseAfterWords)`
Checks if reading should pause at the current word.

```javascript
shouldPauseAtWord(10, 10) // true
shouldPauseAtWord(5, 10)  // false
```

### File Parsers (`src/lib/file-parsers.js`)

#### `parsePDF(file)`
Extracts text content from a PDF file.

#### `parseEPUB(file)`
Extracts text content from an EPUB e-book.

#### `parseFile(file)`
Auto-detects file type and parses accordingly.

#### `getSupportedExtensions()`
Returns supported file extensions (`.pdf,.epub`).

### Progress Storage (`src/lib/progress-storage.js`)

#### `saveSession(session)`
Saves the current reading session to localStorage.

```javascript
saveSession({
  text: 'Your text content...',
  currentWordIndex: 150,
  totalWords: 500,
  settings: { wordsPerMinute: 300 }
}) // true
```

#### `loadSession()`
Loads a saved reading session from localStorage.

```javascript
const session = loadSession()
// { text: '...', currentWordIndex: 150, totalWords: 500, settings: {...}, savedAt: 1234567890 }
```

#### `hasSession()`
Checks if a saved session exists.

```javascript
hasSession() // true or false
```

#### `clearSession()`
Removes the saved session from localStorage.

```javascript
clearSession() // true
```

#### `getSessionSummary()`
Gets session info without loading the full text.

```javascript
getSessionSummary()
// { currentWordIndex: 150, totalWords: 500, savedAt: 1234567890, hasText: true }
```

#### `percentageToWordIndex(percentage, totalWords)`
Converts a percentage to a word index.

```javascript
percentageToWordIndex(50, 100) // 50
percentageToWordIndex(25, 200) // 50
```

#### `wordIndexToPercentage(wordIndex, totalWords)`
Converts a word index to a percentage.

```javascript
wordIndexToPercentage(50, 100) // 50
wordIndexToPercentage(25, 50) // 50
```

## Browser Support

Works in all modern browsers:
- Chrome (recommended)
- Firefox
- Safari
- Edge

## Dependencies

- **pdfjs-dist**: PDF parsing
- **epubjs**: EPUB e-book parsing
- **Svelte 5**: UI framework
- **Vite**: Build tool

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgments

- Based on RSVP research in cognitive psychology
- Inspired by various speed reading applications
- Built with [Svelte](https://svelte.dev/) and [Vite](https://vitejs.dev/)
- PDF parsing powered by [PDF.js](https://mozilla.github.io/pdf.js/)
- EPUB parsing powered by [Epub.js](https://github.com/futurepress/epub.js/)

