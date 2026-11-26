# Romaji Lyrics

A small web app for iPhone that shows **time-synced, romanized lyrics** for what you're playing on Spotify. It works with Spotify Free.

- **Japanese → romaji** (kuromoji + wanakana, readings are machine-guessed)
- **Korean → Revised Romanization**, adjusted to how words are sung (좋아 → *joa*, 같이 → *gachi*)
- **Chinese → pinyin**, with or without tone marks (traditional characters are supported)

## How it works

1. Spotify reports each song you play to **Last.fm** (free).
2. This app asks Last.fm what you're playing every 5 seconds.
3. It fetches synced lyrics from **[LRCLIB](https://lrclib.net)** (free, open database).
4. It romanizes them on your phone and highlights the current line.

Everything runs in your browser. There's no server and no account other than Last.fm.

## One-time setup

### 1. Turn on GitHub Pages
In this repo on github.com: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
After a minute or two the app is live at `https://<your-username>.github.io/romaji-lyrics/`.

### 2. Connect Spotify to Last.fm
1. Make a free account at [last.fm/join](https://www.last.fm/join).
2. Go to [Settings → Applications](https://www.last.fm/settings/applications) and connect **Spotify**.
3. Make sure your listening history is public: in [Settings → Privacy](https://www.last.fm/settings/privacy), **Hide recent listening** must be off.
4. Create an API account at [last.fm/api/account/create](https://www.last.fm/api/account/create). Any name and description work; leave the callback URL empty. Copy the **API key** (not the shared secret).

### 3. Install on your iPhone
1. Open the app's address in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the home screen and enter your Last.fm username and API key. They're saved only on your phone.

## Using it

- Play a song in Spotify, then switch to the app. Lyrics appear a few seconds after a song starts.
- **Tap any line** to sync the lyrics to that moment. Do this if you opened the app partway through a song.
- **−0.5s / +0.5s** nudge the timing. The play button pauses the lyric timer (the app can't tell when Spotify is paused).
- **Wrong?** shows other versions of the lyrics. Your pick is remembered for that song.
- **🔍 Search** works without Last.fm too ("Skip, search manually" on the setup screen).
- **Settings**: romanized/original/both, pinyin tones, text size, the song-start delay (raise it if lyrics run ahead, lower it if they lag), and keeping the screen on.

## Limits

- Lyrics show only while the app is open. iOS doesn't let web apps draw over Spotify or show lyrics on the lock screen.
- Timing is estimated from when Last.fm sees the song change, so it can be off by a second or two. Tap a line to fix it.
- Japanese readings of kanji are guessed from a dictionary and are occasionally wrong (especially names and stylized readings).
- Cantonese songs get Mandarin pinyin, not Jyutping.
- If LRCLIB doesn't have a song, try searching with the original-language title or artist name. You can also add missing lyrics at [lrclib.net](https://lrclib.net).

## Updating

Files in `vendor/` are built from npm packages; see [THIRD_PARTY.md](THIRD_PARTY.md). After changing app files, bump `VERSION` in `sw.js` so phones pick up the new version.
