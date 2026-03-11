// ============================
// SUBTITLE URL DETECTION
// ============================
export function isSubtitleUrl(url) {
  if (!url) return false;
  const isNflx = url.includes('nflxvideo.net') || url.includes('nflximg.net') || url.includes('oca.nflxvideo');
  if (!isNflx) return false;
  // Subtitle URLs typically contain these patterns; video/audio segments don't
  const isLikelySub = url.includes('?o=') || url.includes('textstream') || url.includes('ttml') || url.includes('dfxp');
  // Exclude obvious video/audio segments
  const isMedia = url.includes('range/') && !url.includes('?o=');
  return isLikelySub && !isMedia;
}

/**
 * Quick extraction of xml:lang from TTML content without full DOM parsing.
 * Used by headless file selection and anywhere a lightweight language check is needed.
 * @param {string} xml - Raw TTML/XML content
 * @returns {string} ISO language code (lowercase) or empty string
 */
export function extractLanguageCode(xml) {
  const match = xml.match(/xml:lang=["']([^"']+)["']/);
  return match ? match[1].toLowerCase() : '';
}

// ============================
// TTML / DFXP PARSER
// ============================
export function parseTTML(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return { cues: [], meta: null };

  // Read tick rate and frame rate from root <tt> element
  const tt = doc.querySelector('tt') || doc.documentElement;
  const tickRate = parseInt(tt.getAttribute('ttp:tickRate')) || 10000000;
  const frameRate = parseInt(tt.getAttribute('ttp:frameRate')) || 30;
  const ticksToMs = 1000 / tickRate;

  // Extract Netflix metadata from TTML header if present
  let ttmlMeta = null;
  try {
    const lang = tt.getAttribute('xml:lang') || '';
    const metaEl = doc.querySelector('metadata');
    let movieId = null;
    let ttmTitle = null;
    if (metaEl) {
      for (const attr of metaEl.attributes) {
        if (attr.localName === 'movieId' || attr.name.endsWith(':movieId')) {
          movieId = attr.value;
        }
      }
      const titleEl = metaEl.querySelector('title');
      if (titleEl?.textContent?.trim()) ttmTitle = titleEl.textContent.trim();
    }
    if (lang || movieId || ttmTitle) {
      ttmlMeta = { lang, movieId, title: ttmTitle };
    }
  } catch { /* ignore metadata parse errors */ }

  const ps = doc.querySelectorAll('p') || [];
  const rawCues = [];

  for (const p of ps) {
    const begin = p.getAttribute('begin');
    if (!begin) continue;

    let text = '';
    for (const node of p.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
      else if (node.nodeName === 'br') text += '—';
      else if (node.nodeType === Node.ELEMENT_NODE) text += node.textContent;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const beginMs = timeToMs(begin, ticksToMs, frameRate);
    let endMs;
    if (p.getAttribute('end')) endMs = timeToMs(p.getAttribute('end'), ticksToMs, frameRate);
    else if (p.getAttribute('dur')) endMs = beginMs + timeToMs(p.getAttribute('dur'), ticksToMs, frameRate);
    else endMs = beginMs + 5000;

    rawCues.push({ begin: beginMs, end: endMs, text });
  }

  rawCues.sort((a, b) => a.begin - b.begin);

  // Only remove exact duplicates (same text AND same timing)
  const cues = [];
  for (const cue of rawCues) {
    const prev = cues[cues.length - 1];
    if (prev && Math.abs(prev.begin - cue.begin) < 50 && Math.abs(prev.end - cue.end) < 50) {
      const prevNorm = prev.text.replace(/\s+/g, ' ').trim();
      const cueNorm = cue.text.replace(/\s+/g, ' ').trim();
      if (prevNorm === cueNorm) continue;
    }
    cues.push(cue);
  }

  return { cues, meta: ttmlMeta };
}

export function timeToMs(t, ticksToMs = 0.0001, frameRate = 30) {
  if (!t) return 0;
  // Tick format: "12345678t"
  if (t.endsWith('t')) return parseInt(t) * ticksToMs;

  // Frame-based format: "00:01:23:15" (HH:MM:SS:frames)
  const frameMatch = t.match(/^(\d+):(\d+):(\d+):(\d+)$/);
  if (frameMatch) {
    const [, h, m, s, f] = frameMatch;
    return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + Math.round((parseInt(f) / frameRate) * 1000);
  }

  // Decimal format: "00:01:23.456"
  const match = t.match(/^(\d+):(\d+):(\d+)[.](\d+)$/);
  if (match) {
    const [, h, m, s, frac] = match;
    const ms = Math.round(parseInt(frac) * Math.pow(10, 3 - frac.length));
    return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + ms;
  }

  // Plain HH:MM:SS
  const simple = t.match(/^(\d+):(\d+):(\d+)$/);
  if (simple) {
    return parseInt(simple[1]) * 3600000 + parseInt(simple[2]) * 60000 + parseInt(simple[3]) * 1000;
  }
  return 0;
}

// ============================
// HASHING
// ============================
export function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}
