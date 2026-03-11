# Test Fixtures

Real API responses downloaded on 2026-03-04 for offline testing.

## Cinemeta (Stremio metadata)

| File | Source URL | Description |
|------|-----------|-------------|
| `cinemeta_search_series.json` | `https://v3-cinemeta.strem.io/catalog/series/top/search=Stranger%20Things.json` | Search results for "Stranger Things" (series) |
| `cinemeta_search_movie.json` | `https://v3-cinemeta.strem.io/catalog/movie/top/search=The%20Matrix.json` | Search results for "The Matrix" (movie) |
| `cinemeta_meta_series.json` | `https://cinemeta-live.strem.io/meta/series/tt4574334.json` | Full metadata for Stranger Things — includes `credits_cast` with character names |
| `cinemeta_meta_movie.json` | `https://cinemeta-live.strem.io/meta/movie/tt0133093.json` | Full metadata for The Matrix — includes `credits_cast` with character names |

## Google Translate (unofficial free endpoint)

| File | Source URL | Description |
|------|-----------|-------------|
| `google_translate_response.json` | `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=...` | English → Spanish, 3 subtitle-like lines |
| `google_translate_autodetect.json` | `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=...` | Auto-detect Spanish → English, 4 lines |

## Lingva Translate (Google Translate proxy)

| File | Source URL | Description |
|------|-----------|-------------|
| `lingva_translate_response.json` | `https://lingva.ml/api/v1/en/es/Hello%2C%20how%20are%20you%3F` | English → Spanish |
| `lingva_translate_autodetect.json` | `https://lingva.ml/api/v1/auto/en/Hola%2C%20%C2%BFc%C3%B3mo%20est%C3%A1s%3F` | Auto-detect → English |

Note: The primary instance (`lingva.thedaviddelta.com`) and fedilab instance were down at fetch time. `lingva.ml` was used instead.

## LibreTranslate

| File | Source URL | Description |
|------|-----------|-------------|
| `libretranslate_response.json` | `https://libretranslate.com/translate` | **Error response** — public instance now requires an API key |

## Netflix TTML/DFXP Subtitles

Real Netflix subtitle files from [isaacbernat/netflix-to-srt](https://github.com/isaacbernat/netflix-to-srt/tree/master/samples).

| File | Original | Format details |
|------|----------|----------------|
| `netflix_ttml_sample1.xml` | `sample.xml` | 8 cues, tick-based timing (`ttp:tickRate="10000000"`), Netflix DFXP-LS-SDH profile |
| `netflix_ttml_sample2_tickrate.xml` | `sample5.xml` | 1 cue, tick-based timing, same profile |
| `netflix_ttml_sample3_spanish.xml` | `sample9.xml` | 3 cues, Spanish text, older TTAF1 namespace, Netflix DFXP-SimpleSDH profile |
| `netflix_ttml_sample4_framerate.xml` | `sample6.xml` | 6 cues, tick-based timing, older TTAF1 namespace |
| `netflix_ttml_sample5.xml` | `sample8.xml` | 4 cues, tick-based timing, older TTAF1 namespace, Netflix DFXP-SimpleSDH profile |

## Ollama (local LLM)

Fetched from a real Ollama instance.

| File | Endpoint | Description |
|------|----------|-------------|
| `ollama_tags.json` | `GET /api/tags` | Model discovery — lists all installed models with sizes |
| `ollama_chat_response.json` | `POST /api/chat` | Real translation of 8 Stranger Things subtitle lines (EN→ES) using `qwen2.5:3b` with full system prompt including show metadata and character names |

## APIs NOT included (require credentials)

| API | Why | What you'd need |
|-----|-----|-----------------|
| **Netflix Metadata API** (`netflix.com/nq/website/memberapi/release/metadata`) | Requires active Netflix session cookies | Netflix account, logged-in browser cookies |
| **Google Gemini** (`generativelanguage.googleapis.com`) | Requires API key | Free key from https://aistudio.google.com |
| **Anthropic Claude** (`api.anthropic.com`) | Requires API key (paid) | Key from https://console.anthropic.com |
| **Groq** (`api.groq.com`) | Requires API key | Free key from https://console.groq.com |
| **Mistral** (`api.mistral.ai`) | Requires API key | Free key from https://console.mistral.ai |
| **OpenRouter** (`openrouter.ai`) | Requires API key | Free key from https://openrouter.ai |
