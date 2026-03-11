// ============================
// METADATA PROMPT
// ============================

/** Format metadata into a prompt string for the LLM */
export function formatMetadataPrompt(metadata, { showSynopsis = true, episodeSynopsis = true } = {}) {
  if (!metadata) return '';

  const sections = [];

  // Title line (year and genre appended inline)
  let titleLine = `Show: "${metadata.title}"`;
  if (metadata.year) titleLine += ` (${metadata.year})`;
  if (metadata.genre?.length > 0) {
    const genres = Array.isArray(metadata.genre) ? metadata.genre.join(', ') : metadata.genre;
    titleLine += ` — ${genres}`;
  }
  sections.push(titleLine);

  if (metadata.country) {
    sections.push(`Country of origin: ${metadata.country} (use this for cultural context — honorifics, humor, formality — NOT as the output language)`);
  }
  if (showSynopsis && metadata.synopsis) {
    sections.push(`Synopsis: ${metadata.synopsis}`);
  }
  if (metadata.episode) {
    let episodeLine = `Episode: S${metadata.episode.season}E${metadata.episode.episode}`;
    if (metadata.episode.title) episodeLine += ` "${metadata.episode.title}"`;
    if (episodeSynopsis && metadata.episode.synopsis) episodeLine += ` — ${metadata.episode.synopsis}`;
    sections.push(episodeLine);
  }
  if (metadata.hasCharacterNames && metadata.cast.length > 0) {
    const castNames = [...new Set(metadata.cast
      .filter(c => c.character)
      .map(c => c.character)
    )];
    if (castNames.length > 0) {
      sections.push(`Character names (use these exact spellings): ${castNames.join(', ')}`);
      sections.push(`Always use only the spellings listed above for these character names.`);
    }
  }
  if (metadata.characterNameMap?.size > 0) {
    const mappings = [...metadata.characterNameMap.entries()]
      .map(([source, english]) => `${source} → ${english}`)
      .join(', ');
    sections.push(`Speaker name mapping: ${mappings}`);
    sections.push(`When translating speaker labels like （name）, use the exact English names above.`);
  }

  return '\n\n' + sections.join('\n');
}

/** Build metadata prompt from config settings and metadata object */
export function buildMetadataPrompt(config, metadata) {
  return formatMetadataPrompt(metadata, {
    showSynopsis: config.showSynopsis,
    episodeSynopsis: config.episodeSynopsis,
  });
}

// ============================
// SYSTEM PROMPT
// ============================

/** Build the main translation system prompt */
export function buildSystemPrompt(config, metadata) {
  const lang = config.targetLang;
  const source = config.sourceLang;
  const sourceNote = source ? ` Output only ${lang}.` : '';

  // Use first character name from metadata as the example, falling back to a generic name
  const nameExample = (metadata?.hasCharacterNames && metadata.cast?.length > 0
    ? metadata.cast.find(c => c.character)?.character
    : null) || 'Tanaka';

  let systemPrompt = `You are a subtitle translator. Translate into ${lang} ONLY.${sourceNote}

Rules:
1. Output ${lang} ONLY. Write proper names in their common ${lang} form.
2. Each [N] in output must be the translation of the SAME [N] from input. One line in, one line out, same order.
3. Lines starting with （name） are speaker labels. Translate as (Name) dialogue — always keep parentheses around the name.
4. Lines that are ONLY （description） with no dialogue are sound effects/actions. Keep parentheses: (description).
5. [brackets] are closed captions — translate the text inside, keep square brackets. [name] at the start = speaker label: [name] dialogue → [Name] dialogue.
6. ♪ marks song lyrics — keep ♪ and translate the words.
7. Use the SAME spelling for each character name throughout. If previous context shows a name (e.g. "${nameExample}"), always reuse that exact spelling.
8. Write every word in ${lang} script (plus punctuation/numbers). Every output word must use ${lang} script.
9. Always translate into natural ${lang} words. Convert meaning, not sounds.`;

  const japaneseLike = /japanese|^ja$|^jpn$/i.test(source);
  if (japaneseLike) {
    systemPrompt += `\n10. Names with kanji followed by smaller kana (e.g. 漆原しのはら) are ONE name — the kana is just the pronunciation. Translate as a single unhyphenated name (e.g. "Shinohara").`;
  }

  if (source) systemPrompt += `\nSource language: ${source}.`;
  systemPrompt += buildMetadataPrompt(config, metadata);
  return systemPrompt;
}

// ============================
// USER MESSAGE
// ============================

/** Build per-chunk glossary instructions block */
export function buildGlossaryPerChunkBlock(glossaryContextBlock) {
  return `
After ALL [N] lines, add one final line:
[TERMS] source1 = translation1, source2 = translation2
List proper names (people, places, organizations) and important recurring terms from this chunk with their translations. Only include names/terms, not common words. If none, omit the [TERMS] line entirely.
${glossaryContextBlock}`;
}

/** Build the user message for a translation chunk */
export function buildUserMessage(lineCount, scriptLines, { retryNote = '', prevTranslations = '', glossaryBlock = '', targetLang } = {}) {
  return `${retryNote}${prevTranslations}${scriptLines.join('\n')}

Translate each line above into ${targetLang}.
EXACTLY ${lineCount} lines: output [0] to [${lineCount - 1}], one per [N]. Each [N] maps to exactly one output [N], in order.
${glossaryBlock}
Reminders:
- Every [N] from [0] to [${lineCount - 1}] must appear in output
- Output only translated [N] lines
- Keep ? and ! where the source has them
- （名前）dialogue → (Name) dialogue — ALWAYS wrap speaker names in parentheses like (Name)
- [name] dialogue → [Name] dialogue — keep square brackets around speaker labels
- Reuse name spellings from previous context exactly`;
}

/** Format previous translation context lines */
export function buildPrevContext(prevContext) {
  if (!prevContext || prevContext.length === 0) return '';
  const contextLines = prevContext.slice(-5).map(c => c.text).join('\n');
  return `Previous translated lines (reference only — start your output fresh from [0]):\n${contextLines}\n\n`;
}

// ============================
// RETRY / DIAGNOSTIC PROMPTS
// ============================

/** Map of validation reason codes to diagnostic message builders */
export const DIAG_MSGS = {
  'missing': (i, _trans) => `[${i}] output was EMPTY — must provide a translation`,
  'untranslated': (i, _trans) => `[${i}] was NOT translated — still in source language`,
  'malformed —': (i, _trans) => `[${i}] malformed — starts or ends with "—": "${_trans}"`,
  'em dash dropped': (i, trans) => `[${i}] original has "—" line break but translation dropped it — translate BOTH sides and keep "—" between them: "${trans}"`,
  'annotation mismatch': (i, trans, orig) => {
    const origTrimmed = orig.trim().replace(/^-\s*/, '');
    if (/^\[/.test(origTrimmed) && !/^\[/.test(trans.trim().replace(/^-\s*/, ''))) {
      return `[${i}] original has [speaker] label — you MUST keep it as [Name] before the dialogue: "${trans}"`;
    }
    if (/^[（(]/.test(origTrimmed) && !/^[（(]/.test(trans.trim().replace(/^-\s*/, ''))) {
      return `[${i}] original has (speaker) label — keep as (Name) before the dialogue: "${trans}"`;
    }
    return `[${i}] annotation mismatch — ${/^[[(（【♪]/.test(origTrimmed) ? 'original has brackets/♪ but translation does not' : 'translation has brackets but original does not'}: "${trans}"`;
  },
  '? mismatch': (i, trans, orig) => `[${i}] punctuation: original ${/[?？]/.test(orig) ? 'has ?' : 'has no ?'}, translation ${/[?？]/.test(trans) ? 'has ?' : 'missing ?'}: "${trans}"`,
  '! mismatch': (i, trans, orig) => `[${i}] punctuation: original ${/[!！]/.test(orig) ? 'has !' : 'has no !'}, translation ${/[!！]/.test(trans) ? 'has !' : 'missing !'}: "${trans}"`,
  'source leak': (i, trans) => `[${i}] contains source language text: "${trans}"`,
  'source prepend/append': (i, trans) => `[${i}] has source text prepended/appended: "${trans}"`,
  'shifted': (i, trans) => `[${i}] contains text from a DIFFERENT line — translate only what [${i}] says in the input, not a neighbor: "${trans}"`,
  'truncated': (i, trans, orig) => `[${i}] truncated (${trans.length} chars vs ${orig.length}): "${trans}"`,
  'speaker label lost': (i, trans, orig) => `[${i}] original has speaker label ${orig.match(/^（[^）]+）/)?.[0] || '（…）'} but translation dropped the parentheses — keep as (Name): "${trans}"`,
  'ruby artifact': (i, trans) => `[${i}] contains hyphenated romanization from leaked furigana — write the name normally without hyphens: "${trans}"`,
};

/**
 * Normalize fullwidth punctuation in translations before using them in retry prompts.
 *
 * When a first-pass translation leaks fullwidth characters like （） from the source,
 * and those translations are used as "correct" ✓ lines in the retry prompt, small models
 * see the Japanese-style punctuation among the ✓ lines and enter "copy mode" — echoing
 * everything verbatim, including the untranslated source lines that need retranslation.
 * Normalizing to ASCII punctuation makes the ✓ lines look unambiguously like target-language
 * text, so the model stays in "translate mode" for the lines that need fixing.
 */
function normalizeForRetry(text) {
  return text
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/【/g, '[').replace(/】/g, ']')
    .replace(/「/g, '"').replace(/」/g, '"')
    .replace(/\u3000/g, ' ');
}

/** Build script lines and diagnostic messages from validation results */
export function buildDiagnosticPrompt(chunkCues, results, gaps, reasons, targetLang) {
  const gapSet = new Set(gaps);
  const scriptLines = [];
  const diagnosticLines = [];
  for (let i = 0; i < chunkCues.length; i++) {
    const orig = chunkCues[i].text;
    const trans = results[i];
    if (gapSet.has(i)) {
      scriptLines.push(`[${i}] ${orig}`);
      const reason = reasons[i] || 'bad output';
      const msgFn = DIAG_MSGS[reason];
      if (msgFn) {
        diagnosticLines.push(msgFn(i, trans || '', orig));
      } else if (reason.startsWith('mixed script')) {
        diagnosticLines.push(`[${i}] mixed script — contains source language characters that should be fully translated to ${targetLang}: "${trans}"`);
      } else if (reason.startsWith('wrong lang')) {
        diagnosticLines.push(`[${i}] ${reason}: "${trans}"`);
      } else {
        diagnosticLines.push(`[${i}] ${reason}: "${trans}"`);
      }
    } else {
      scriptLines.push(`[${i}] ${normalizeForRetry(trans)}`);
    }
  }
  return { scriptLines, diagnosticLines };
}

/** Build retry note for chunk retranslation */
export function buildRetryNote(diagnosticLines, targetLang) {
  return `Some lines had problems. Lines already in ${targetLang} are correct.

Problems:
${diagnosticLines.join('\n')}

Translate completely into ${targetLang}. Write full ${targetLang} text for each line.

`;
}

/** Build retry note for final sweep of missed lines */
export function buildSweepRetryNote(diagnosticLines, targetLang) {
  return `Some lines were missed in translation. Lines already in ${targetLang} are correct.

Problems found:
${diagnosticLines.join('\n')}

Translate completely into ${targetLang}. Write only ${targetLang} text.

`;
}

/** Build retry note for cleanup pass (second model) */
export function buildCleanupRetryNote(targetLang) {
  return `These lines failed translation with a different model. Translate every line completely into ${targetLang}. Write full ${targetLang} text for each line.\n\n`;
}

// ============================
// UPFRONT GLOSSARY PROMPTS
// ============================

/** System prompt for upfront glossary analysis */
export function buildGlossarySystemPrompt() {
  return `You are a subtitle analysis assistant. You extract proper names and key terms from subtitle scripts to create a translation glossary. Output ONLY term pairs in the format: source_term = translated_term`;
}

/** User message for upfront glossary analysis */
export function buildGlossaryUserMessage(allText, showCtx, config) {
  return `Here is the full subtitle script of a show:
${showCtx}
---
${allText}
---

From the script above, extract ALL proper names and important terms that should be translated consistently into ${config.targetLang}.
${config.sourceLang ? `The source language is ${config.sourceLang}.` : ''}

Output a list in this exact format, one per line:
source_term = translated_term

Include only: character names, nicknames, place names, organization names, titles/honorifics, fictional terms, recurring phrases.

Output only term pairs, one per line.`;
}
