# Image Translation Feature Plan

## What We're Building

A keyboard shortcut that captures the current video frame, extracts visible text via a vision-capable LLM, then translates it through the existing pipeline. Result is stored as a proper image cue (with video timestamps) and rendered in a separate top-center overlay using the same display loop pattern as subtitle cues.

---

## User Flow

1. User presses `I` during playback
2. Video pauses + subtitle overlay hidden (so neither appears in the captured frame)
3. `getDisplayMedia({ preferCurrentTab: true })` fires — browser shows a small dialog with the current tab pre-selected
4. User clicks "Share" (one click)
5. One frame captured from the stream → stream stopped immediately → subtitle overlay restored
6. Toast: "Extracting image text..." (working) + vision LLM request sent
7. OCR response received → shaped into `{ begin: captureMs, end: captureMs + displayDurationMs, text: ocrText }` → saved to `state.imageOriginalCues` and as placeholder to `state.imageTranslatedCues` → OCR text appears in image overlay immediately
8. Toast: "Translating image text..." (working) + translation request sent
9. Translation received → `state.imageTranslatedCues[index].text` updated in place → overlay updates
10. Toast: "Image text translated" (success)
11. User reads, then unpauses manually
12. After `displayDurationMs` of video playback time has passed, the cue naturally disappears

**Key press while request is in-flight:** ignored (guard flag). A second press after the result is shown creates a new cue at the new `captureMs`, which replaces the previous one in the overlay since only the most recent cue matching `currentTime` is shown.

**No abort.** Flow always runs to completion once started. Entire `triggerImageTranslation` body is wrapped in `try/finally` — the `finally` block clears `_imageTranslationInProgress` so the feature never locks permanently on error. Errors show a toast via `showStatus('Image translation failed', 'error', true)`.

**OCR text shown immediately, replaced by translation** — same pattern as subtitle cues. As soon as OCR completes, the raw OCR text is pushed to both `state.imageOriginalCues` and `state.imageTranslatedCues` (as a placeholder), so it appears in the overlay right away. When translation completes, `state.imageTranslatedCues[index]` is updated in place with the real translation.

---

## Cue Architecture (Reusing Existing Pattern)

Image cues are stored as the same `{ begin, end, text }` structure used for subtitle cues. Two parallel arrays in `state`:

```js
state.imageOriginalCues    // OCR text, video-timestamped
state.imageTranslatedCues  // translated text, same indices
```

The `end` timestamp encodes the display duration:
```
begin = video.currentTime * 1000  (ms at moment of capture)
end   = begin + CONFIG.imageDisplayDuration  (e.g. 3000ms)
```

The image overlay hooks into the existing `tick()` in `overlay.js` — no separate render loop. `tick()` checks `currentTime` against image cues exactly as it checks subtitle cues. This means:
- While **paused**: cue is visible immediately (currentTime is within `[begin, end]`)
- On **unpause**: cue stays visible until that much playback time has elapsed
- On **seek back**: cue reappears naturally if user lands within the window
- Multiple image cues accumulate across the session (one per keypress), each tied to its video position

Image cues are cached as one entry per episode under `image:url:${pathname}`, containing both `imageOriginalCues` and `imageTranslatedCues` arrays. Restored into state on page load — same motivation as subtitle cache. Pressing `I` always runs fresh (no cache check on trigger); the result is appended and the cache entry is overwritten with the full updated arrays.

---

## Config Changes

New fields in `src/config.js`:

```js
// Vision model: '' = disabled (default). Setting a model enables the feature.
imageVisionModel: GM_getValue('imageVisionModel', ''),
// Vision provider: defaults to '' = use same as main provider (reuses apiKey + url)
imageVisionProvider: GM_getValue('imageVisionProvider', ''),
imageVisionApiKey: GM_getValue('imageVisionApiKey', ''),
imageDisplayDuration: parseInt(GM_getValue('imageDisplayDuration', '3000')) || 3000,
```

Derived: `imageTranslationEnabled` = `imageVisionModel !== ''`. No separate boolean — selecting a model is the toggle.

Persisted in `saveConfig()`.

Defaulting vision provider to "same as main" means zero extra config for most users — pick a vision model from the dropdown and it works.

---

## Provider Vision Support

Add `supportsVision: true` and `buildVisionRequest(imageBase64, textPrompt, model, apiKey)` to each vision-capable provider in `src/core/providers/definitions.js`. Returns `{ headers, data }` (same shape as `buildRequest`), with the image embedded in the provider-specific format. The URL is the same as for text requests — vision is just a different message shape, not a different endpoint. The existing `extractText` function is reused unchanged — response shape is identical to text-only requests.

**Gemini** (`supportsVision: true`) — `inlineData` in `parts`:
```json
{
  "contents": [{
    "role": "user",
    "parts": [
      { "inlineData": { "mimeType": "image/jpeg", "data": "<base64>" } },
      { "text": "..." }
    ]
  }]
}
```

**Ollama** (`supportsVision: true`) — `images` array on the message (vision models detected dynamically via `/api/show`):
```json
{
  "model": "llava",
  "messages": [{ "role": "user", "content": "...", "images": ["<base64>"] }],
  "stream": false
}
```

**OpenAI-compatible** (openrouter, groq — `supportsVision: true`) — `image_url` content block:
```json
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } },
      { "type": "text", "text": "..." }
    ]
  }]
}
```

**Anthropic** (`supportsVision: true`) — `image` source block:
```json
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "..." } },
      { "type": "text", "text": "..." }
    ]
  }]
}
```

Providers without vision: `libretranslate`, `lingva`, `google_free`, `mistral` — `supportsVision` absent/false, settings UI hides vision config for these.

### Vision Model Detection

**Ollama — dynamic detection via API:**
Ollama's `/api/show` endpoint returns a `capabilities` array per model. Vision models include `"vision"`:
```json
{ "capabilities": ["completion", "vision", "tools", "thinking"] }
```
At startup (or when the user selects Ollama as vision provider), call `POST /api/show` for the configured model and check `capabilities.includes('vision')`. The settings UI can also call `/api/tags` to list installed models, then `/api/show` for each to filter vision-capable ones for the dropdown. No hardcoded list needed — the user's actual installed models are shown, with vision ones flagged.

**Cloud providers — curated `visionModels` array:**
Cloud provider APIs don't expose vision capability as cleanly, so each vision-capable provider gets a `visionModels` array (same `{ id, name }` shape as `models`):

| Provider | Vision Models |
|----------|--------------|
| **Gemini** | `gemini-2.0-flash` (recommended), `gemini-2.5-flash-preview-05-20`, `gemini-2.5-pro-preview-05-06` |
| **OpenRouter** | `google/gemini-2.0-flash-001:free`, `google/gemma-3-4b-it:free` |
| **Groq** | `llama-4-scout-17b-16e-instruct`, `meta-llama/llama-4-maverick-17b-128e-instruct` |
| **Anthropic** | `claude-sonnet-4-5-20250514`, `claude-haiku-4-5-20251001` |

Default vision model per provider (`defaultVisionModel`) is the first entry. When vision provider is "same as main", the vision model dropdown shows the *vision* models for that provider, not the translation models.

---

## New Files

### `src/browser/image-translate.js`

```
captureDisplayFrame()
  → calls getDisplayMedia({ video: { displaySurface: 'browser' }, preferCurrentTab: true })
  → on stream received: draws one frame onto in-memory <canvas> via a hidden <video> element
  → stops all stream tracks immediately after capture
  → returns base64 JPEG string (quality 0.85)
  → caller is responsible for hiding/restoring the subtitle overlay around this call

buildOcrPrompt(sourceLang)
  → instructs LLM to extract text only, preserve line breaks, return "NO_TEXT" if none
  → includes source language hint if CONFIG.sourceLang is set

callVisionLLM(imageBase64)
  → resolves vision provider (imageVisionProvider || CONFIG.provider)
  → validates provider.supportsVision — throws if not
  → calls provider.buildVisionRequest(imageBase64, ocrPrompt, model, apiKey)
  → posts via postJsonViaGM (existing), returns extracted text string

triggerImageTranslation()
  → guard: if _imageTranslationInProgress, return
  → set _imageTranslationInProgress = true
  → pause video
  → hide subtitle overlay (state.overlayEl, state.origOverlayEl)
  → call captureDisplayFrame()  ← getDisplayMedia dialog appears here on a clean paused frame
  → restore subtitle overlay
  → showStatus('Extracting image text...', 'working', true)
  → call callVisionLLM
  → if result === 'NO_TEXT' or empty:
       showStatus('No text detected', 'info', true)
       _imageTranslationInProgress = false; return
  → build cue: { begin: captureMs, end: captureMs + CONFIG.imageDisplayDuration, text: ocrText }
  → append to state.imageOriginalCues
  → append same cue (OCR text) to state.imageTranslatedCues  ← shows OCR text immediately in overlay
  → const insertedIndex = state.imageTranslatedCues.length - 1
  → showStatus('Translating image text...', 'working', true)
  → const [translatedText] = await translateChunkLLM([cue], [], 0, createBrowserContext())  ← returns translated text, does NOT call commitTranslation (that's caller-driven)
  → state.imageTranslatedCues[insertedIndex].text = translatedText  ← we write to image arrays directly, never touches state.translatedCues
  → write both arrays to cache: cacheSet('image:url:' + location.pathname, { imageOriginalCues: state.imageOriginalCues, imageTranslatedCues: state.imageTranslatedCues })
  → showStatus('Image text translated', 'success', true)
  → _imageTranslationInProgress = false
  → tick() in overlay.js picks it up automatically on next frame
```

### `src/ui/image-overlay.js`

Single exported function `updateImageOverlay(currentMs)` and a `createImageOverlay()` initializer. No render loop — called directly from the existing `tick()` in `overlay.js` which already has `currentMs` and the cached video element.

```
createImageOverlay()
  → creates overlay element, top-center positioning, pointer-events: none
  → registered in reparentOverlay() so it moves into fullscreen automatically

updateImageOverlay(currentMs)
  → called inside the if (video) block of tick() in overlay.js, after subtitle logic
  → if !state.imageOverlayEnabled or no image cues: clear and return
  → find active cue: last entry in state.imageTranslatedCues where currentMs ∈ [begin, end]
  → if state.imageShowOriginal: use state.imageOriginalCues at same index instead
  → set overlay content, or clear if no active cue
```

Overlay styling is visually distinct from subtitle overlays: blue-tinted background (`rgba(30, 60, 120, 0.7)`) with sharp corners (`border-radius: 0`) vs subtitles' neutral black (`rgba(0,0,0,0.4-0.6)`) with rounded corners (`border-radius: 4px`). Same font family and text color as subtitles. Positioned `top: 60px, left: 50%, transform: translateX(-50%)`. `pointer-events: none`. A small dimmed "Image" label above the text.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `I` | Trigger image capture + translate (only if `imageVisionModel` is set) |
| `Shift+I` | Toggle image overlay on/off |
| `K` | Toggle show original OCR text vs translation in image overlay (diagnostic) |

All gated on `location.pathname.startsWith('/watch/')`. `I`, `Shift+I`, and `K` are all no-ops when `imageVisionModel` is empty (feature disabled). Wired in `handleKeydown` in `src/browser/shortcuts.js`.

---

## Translation Step (Pipeline Reuse via DI Context)

Calls `translateChunkLLM([cue], [], 0, context)` — the same pipeline function used for subtitle chunks, imported directly into `src/browser/image-translate.js`. This follows the existing pattern where `main.js` and `intercept.js` already import pipeline functions (`handleSubtitlePayload`, `runFullPass`) and pass them a browser context. The DI boundary is the `context` object, not the import.

**Key: uses the return value, not `commitTranslation`.** `translateChunkLLM` returns the translated text array — `commitTranslation` is caller-driven (called by `translateWithLLM`, not by `translateChunkLLM` itself). So `triggerImageTranslation` simply destructures `const [translatedText] = await translateChunkLLM(...)` and writes to `state.imageTranslatedCues` directly. This avoids any collision with the subtitle pipeline's `state.translatedCues`. The only side effect is flagged-lines bookkeeping on `context.sharedTranslationState`, which is harmless for a single cue at index 0.

This gives us:
- Same provider, model, API key as main translation
- Glossary terms applied if `glossaryPerChunk` is on
- Same prompt structure, validation, and response parsing
- Show metadata context (show name, characters) if available — helps with proper nouns on title cards

Single cue means the prompt has one numbered line. The response parser returns one translated string. Clean and consistent.

### Concurrency with Subtitle Translation

Image translation calls `translateChunkLLM` concurrently — it does not wait for the subtitle pipeline to finish. Both the vision OCR request and the translation request fire independently via `postJsonViaGM`.

- **Ollama**: serves one request at a time, so the image request naturally queues behind the current in-flight subtitle chunk. Wait time is one chunk (~2-5 seconds), not the entire episode.
- **Cloud providers**: handle concurrent requests natively — image translation runs immediately.

No pipeline changes needed for this. `translateChunkLLM` touches `context.sharedTranslationState` (flagged lines at `globalOffset`), but image translation uses `globalOffset = 0` on a single cue — no collision with subtitle indices (which start at real line numbers). The `_onFirstPass` static callback is unused for image cues (single cue, no partial display needed).

---

## State Changes (`src/state.js`)

```js
imageOriginalCues: [],       // { begin, end, text } — OCR results
imageTranslatedCues: [],     // { begin, end, text } — translated results
imageOverlayEnabled: true,   // toggled by Shift+I
imageShowOriginal: false,    // toggled by K — show OCR text instead of translation
```

Image cues are persisted to GM storage under `image:url:${pathname}` (same `cacheGet`/`cacheSet` from `cache.js`, no changes needed). Both arrays are written together as one cache entry and restored on page load.

---

## Existing Code Touched (Not New)

| Location | Change |
|----------|--------|
| `src/ui/overlay.js` `tick()` | Change early-return condition to `translatedCues.length === 0 && imageTranslatedCues.length === 0`; add `updateImageOverlay(currentMs)` call inside the `if (video)` block |
| `src/ui/overlay.js` `reparentOverlay()` | Include image overlay element in the reparent call |
| `src/browser/main.js` `tryRestoreFromCache()` | Also restore `image:url:${pathname}` into `state.imageOriginalCues` / `imageTranslatedCues` |
| `src/browser/main.js` `onUrlChange()` | Reset `state.imageOriginalCues = []` and `state.imageTranslatedCues = []` |

---

## Settings UI

Mirrors the existing subtitle provider/model pattern — basic config up front, advanced behind the toggle.

**Basic section** (always visible, alongside the subtitle provider/model):
```
  Image model:  [disabled ▼ / moondream / gemma3 / ...]
```

Dropdown is populated the same way as the subtitle model dropdown — dynamically for Ollama (filtered to vision-capable via `/api/show`), curated `visionModels` for cloud providers. First option is "disabled" (default). Selecting a model enables the feature; no separate checkbox needed.

When the selected vision provider is "same as main" (default), the dropdown shows vision models for whichever provider is currently selected for subtitles. If the main provider has no vision models, the dropdown shows only "disabled" with a hint.

**Advanced section** (behind the existing advanced toggle):
```
  Vision provider:        [same as main ▼ / gemini / ollama / ...]
  Vision API key:         [hidden input]  (shown only if different provider needs one)
  Image display duration: [___] ms        (default 3000)
```

Vision provider/key only needed when the user wants a different provider for vision than for subtitles (e.g., Ollama for subs, Gemini for vision). Most users never touch this.

**Privacy hint:** When a cloud vision provider is selected (anything other than Ollama), show a brief inline note below the dropdown: "Video frames are sent to [provider] for processing." Not shown for Ollama since it's local. This is more important than for subtitles — frames are actual screenshots, not just text.

**Instructions:** The feature needs a section in the instructions panel (`src/ui/instructions.js`) explaining the `I` / `Shift+I` / `K` shortcuts and the image model dropdown. Add this when wiring the UI.

**README:** Add an image translation section to `README.md` — what it does, how to enable (image model dropdown), shortcuts, and that it requires a vision-capable model.

---

## Frame Capture Approach

Direct canvas capture of the Netflix `<video>` element is blocked by DRM (hardware-decoded frames return all black pixels; `captureStream()` throws `NotSupportedError: Stream capture not supported with EME`).

`getDisplayMedia()` is used instead — it captures the rendered screen contents, bypassing the DRM restriction entirely. With `preferCurrentTab: true`, Chrome pre-selects the current tab and the dialog requires only one click ("Share"). The stream is stopped immediately after one frame is captured.

The subtitle overlay is hidden before the dialog appears and restored after capture, so the captured frame is a clean paused video frame with no UI overlays.

---

## Gemini Compatibility

Yes, works with `gemini-2.0-flash` and newer. Gemini 1.5+ supports `inlineData` image parts. The existing `extractText` function is unchanged. Rate limit note: 2 requests per keypress (OCR + translate), shared with the subtitle translation quota.

---

## Headless Image Translation

Standalone CLI for iterating on the OCR prompt and vision model without needing a browser or Netflix. Follows the same pattern as the subtitle headless.

### Folder structure

Images live inside existing episode folders (same as subtitles), in an `images/` subfolder. This means they share the same `metadata.json` — show name, characters, and cast are available for the translation prompt automatically.

```
episodes/                        (tracked)
  smoke-test/
    source.ttml                  Subtitle source
    metadata.json                Shared metadata (show name, characters, cast)
    images/                      Image files for this episode
      title-card.jpg
      sign-on-wall.png

episodes-local/                  (gitignored)
  smoke-jjk/
    source.ttml
    metadata.json
    images/
      preview-text.jpg
```

### Usage
```
make headless-images CONFIG=<preset> EPISODE=<name>        One episode's images
make headless-images CONFIG=<preset>                        All episodes' images
```

Runs via `node src/headless/image-translate.js`. Uses the same config preset system — reads `configs/<preset>.json`, uses `imageVisionModel` and `imageVisionProvider` (falling back to main provider/model if not set). Reads `metadata.json` from the episode folder — same metadata the subtitle pipeline uses (show name, characters, cast).

### Per image
1. Read file from `<episode>/images/` → base64
2. `buildVisionRequest` + `postJson` (headless context) → OCR text
3. `translateChunkLLM([cue], [], 0, headlessContext)` → translated text (with full metadata context)
4. Output both to console + write results

### Output
Written to `runs/<preset>/<episode>/images/<commit>/`:
```
output.image-translations.json   [{ file, ocrText, translatedText }]
output.image-viewer.html         Self-contained viewer (images embedded as base64)
```

### Scoring (evaluation step only — does not affect OCR or translation)
After OCR and translation are complete, the evaluation step splits both on line breaks, pairs them up, and scores each pair via cross-lingual semantic similarity (same embedding approach as subtitle evaluation). No reference files needed. Per-sentence scoring surfaces which lines the model struggled with — a single aggregate score would hide partial failures in text-heavy images.

### Viewer
`make headless-images-viewer CONFIG=<preset> EPISODE=<name>` generates and opens a self-contained HTML file (same pattern as `run-viewer.js` for subtitles). Layout per image:

```
┌──────────────────────────────────────────────┐
│  [original image — full width]               │
├──────────────────────┬───────────────────────┤
│  OCR                 │  Translation           │
│  "東京タワー 展望台"   │  "Tokyo Tower Obs."    │
│                      │  similarity: 94.2%     │
└──────────────────────┴───────────────────────┘
```

Images are embedded as base64 data URIs so the HTML is fully self-contained and portable. Full-width image on top (16:9 needs the space to remain legible), two columns below for OCR and translation. Cross-lingual similarity score on the translation side. One card per image, scrolling down.

### New file
`src/headless/image-translate.js` — discovers `images/` subfolder within episode directories, reads images, calls vision + translation, writes output. Reuses `createHeadlessContext` and `nodePostJson` from existing `src/headless/context.js`. Loads `metadata.json` from the episode folder for translation context.

### Config additions
The existing config preset JSON gains optional image fields:
```json
{
  "imageVisionModel": "moondream",
  "imageVisionProvider": ""
}
```
When empty/absent, falls back to main `provider` and `model` (must support vision).

---

## Multi-language OCR

Image OCR defaults to the same `sourceLang` as subtitle translation. Configurable separately in advanced settings via `imageSourceLang` — empty means "use main source language". Useful when characters are in a foreign country and on-screen text is in a different language than the dialogue.

Config addition:
```js
imageSourceLang: GM_getValue('imageSourceLang', ''),  // '' = follow main sourceLang
```

Advanced settings UI shows this as a text input alongside the other image advanced fields.

---

## Transcript Panel Integration

When image cues exist, the transcript panel gets a collapsible "Image Translations" section at the bottom, separated by a divider. Each entry shows:
- Timestamp (same format as subtitle lines)
- OCR text (dimmed) + translated text
- Blue-tinted left border (matching the image overlay's visual identity)

The section updates live as new image cues are added via a separate refresh pass in the existing `refreshTranscript()` function — image cues are not interleaved with subtitle lines, they have their own list below the divider. Clicking an entry seeks the video to that timestamp (same behavior as clicking subtitle lines). The section header shows count: "3 image translations".

Added to `src/ui/transcript.js` — no new file, extends the existing panel.

---

## Headless Image Run History

Same pattern as `make headless-history` for subtitles. `make headless-images-history CONFIG=<preset>` shows runs across commits with aggregate similarity scores, so you can compare OCR prompt or model changes over time.

Reuses the existing `src/headless/run-history.js` infrastructure — just reads from the `images/` subdirectory within each episode's run directory.

---

## What We're NOT Doing

- No automatic OCR (no frame analysis to detect text-heavy frames — always manual via `I`)
- No image cropping or region selection (full frame capture, LLM figures out what's text)
- No auto-resume (user decides when to unpause)
- No abort of in-flight request (runs to completion)

---

## Tests

### `buildVisionRequest` per provider (core)
- Each vision-capable provider produces the correct request shape (Gemini `inlineData`, Ollama `images`, OpenAI-compatible `image_url`, Anthropic `image` source block)
- Returns `{ headers, data }` matching the same shape as `buildRequest`
- Base64 image data is placed in the correct field
- Text prompt is placed in the correct field
- Model and API key are wired through

### `buildOcrPrompt` (core)
- Includes source language hint when `sourceLang` is set
- Omits hint when `sourceLang` is empty
- Instructs to return `NO_TEXT` when no text is visible

### Vision model detection (core)
- Parses Ollama `/api/show` response — detects `"vision"` in capabilities array
- Returns false when capabilities array has no `"vision"`
- Handles missing capabilities field gracefully

### `updateImageOverlay` (ui)
- Shows translated cue when `currentMs` is within `[begin, end]`
- Clears overlay when `currentMs` is outside all cue windows
- Shows last matching cue when multiple overlap
- Shows original OCR text when `state.imageShowOriginal` is true
- Clears when `state.imageOverlayEnabled` is false

### `triggerImageTranslation` flow (browser, integration)
- Guard flag prevents concurrent triggers
- Guard flag is cleared on error (try/finally)
- Cue is built with correct `begin`/`end` timestamps
- OCR text appears in both `imageOriginalCues` and `imageTranslatedCues` immediately
- Translation result replaces placeholder in `imageTranslatedCues`
- `NO_TEXT` / empty response short-circuits without creating a cue
- Cache is written with both arrays after translation completes

### Test file
New test file: `tests/image-translate.test.js` — covers all of the above. Browser-specific parts (`getDisplayMedia`, DOM manipulation) are mocked; core logic and cue building are tested directly.

---

## Files Changed / Created

| File | Change |
|------|--------|
| `src/core/providers/definitions.js` | Add `supportsVision`, `buildVisionRequest`, `visionModels` (cloud) to vision-capable providers; Ollama uses `/api/show` capability check instead |
| `src/config.js` | Add image translation config fields |
| `src/state.js` | Add `imageOriginalCues`, `imageTranslatedCues` arrays |
| `src/browser/image-translate.js` | **New** — frame capture, vision request, cue building, translation call, cache write/restore |
| `src/ui/image-overlay.js` | **New** — singleton overlay, render function |
| `src/browser/shortcuts.js` | Wire `I`, `Shift+I`, `K` keys |
| `src/ui/settings/index.js` | Add image translation section |
| `src/ui/overlay.js` | Call `updateImageOverlay` from `tick()`; include image overlay in `reparentOverlay` |
| `src/ui/transcript.js` | Add collapsible "Image Translations" section at bottom |
| `src/browser/main.js` | Extend `tryRestoreFromCache` and `onUrlChange` with image cue handling |
| `src/ui/instructions.js` | Add image translation section explaining `I` / `Shift+I` / `K` shortcuts and the image model dropdown |

| `src/headless/image-translate.js` | **New** — headless CLI for image OCR + translation iteration |
| `src/headless/image-viewer.js` | **New** — generates self-contained HTML viewer for image translation results |
| `tests/image-translate.test.js` | **New** — unit + integration tests |
| `Makefile` | Add `headless-images`, `headless-images-viewer`, `headless-images-history` targets |
| `README.md` | Add image translation section |

Total: 5 new files, 10 modified. No new npm dependencies. No new render loop.
