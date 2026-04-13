// Language signatures: common function words / script patterns for wrong-language detection.
export const LANG_SIGNATURES = [
  { name: 'English',    aliases: ['english', 'en', 'eng'],
    markers: /\b(the|is|are|was|were|have|has|been|will|would|could|should|this|that|with|from|they|their|what|which|about|into|more|some|when|than|just|also|very|because|don't|didn't|can't|won't|it's|I'm|he's|she's|you|not|do|but|no|or|so|my|we|he|she)\b/i },
  { name: 'French',     aliases: ['french', 'fr', 'fra', 'français', 'francais'],
    markers: /\b(le|la|les|un|une|des|du|est|sont|c'est|qu[ie]|avec|pour|dans|sur|mais|très|aussi|cette|vous|nous|je suis|il est|elle est|n'est|l'|d'|j'ai|qui est|pas|ont|fait|être|avoir|tout|comme|bien|peut|même)\b/i },
  { name: 'Spanish',    aliases: ['spanish', 'es', 'spa', 'español', 'espanol'],
    markers: /\b(el|los|las|una|unos|está|están|es|son|que|con|para|por|pero|muy|también|esta|usted|nosotros|tiene|puede|más|como|todo|hay|desde|entre|sin|sobre|otro|cuando|donde|después|antes|mejor|ahora)\b/i },
  { name: 'Portuguese', aliases: ['portuguese', 'pt', 'por', 'português', 'portugues'],
    markers: /\b(o|os|as|um|uma|uns|umas|é|são|está|estão|tem|têm|com|para|por|mas|mais|muito|também|esta|você|nós|pode|como|todo|há|desde|entre|sem|sobre|outro|quando|onde|depois|antes|melhor|agora|não|sim|já|ainda|aqui|isso|isto|esse|essa)\b/i },
  { name: 'German',     aliases: ['german', 'de', 'deu', 'deutsch'],
    markers: /\b(der|die|das|ein|eine|ist|sind|und|aber|für|mit|nicht|auch|sehr|diese|haben|werden|ich bin|er ist|sie ist|kann|muss|wenn|dann|schon|noch|oder|nach|über|unter|durch|zwischen|gegen|ohne|weil|dass|hier|dort)\b/i },
  { name: 'Italian',    aliases: ['italian', 'it', 'ita', 'italiano'],
    markers: /\b(il|lo|la|i|gli|le|un|uno|una|è|sono|ha|hanno|con|per|che|ma|più|molto|anche|questa|questo|può|come|tutto|c'è|dal|nel|sul|tra|fra|dopo|prima|ancora|già|qui|così|dove|quando|perché|bene)\b/i },
  { name: 'Japanese',   aliases: ['japanese', 'ja', 'jpn', '日本語'],
    markers: /[ぁ-んァ-ヶ]/ },
  { name: 'Korean',     aliases: ['korean', 'ko', 'kor', '한국어'],
    markers: /[가-힣]/ },
  { name: 'Chinese',    aliases: ['chinese', 'zh', 'zho', 'mandarin', '中文', '普通话'],
    markers: /[\u4e00-\u9fff]/ },
  { name: 'Russian',    aliases: ['russian', 'ru', 'rus', 'русский'],
    markers: /[а-яА-ЯёЁ]/ },
  { name: 'Arabic',     aliases: ['arabic', 'ar', 'ara', 'العربية'],
    markers: /[\u0600-\u06FF]/ },
];

/**
 * Check for ruby text artifacts — hyphenated romanization from furigana leaking.
 * Matches patterns like "Na-tsu-me", "shi-no-ha-ra" (2+ hyphens between short segments).
 * Segments are capped at 3 chars: Japanese romaji mora are ≤3 chars (ka, shi, tsu…),
 * while common English compounds have longer segments (year, date, face…).
 */
export function hasRubyArtifact(text) {
  return /\b[A-Za-z]{1,3}(?:-[A-Za-z]{1,3}){2,}\b/.test(text);
}

// ── Validation Rules ──────────────────────────────────────────
// Each rule receives a context { orig, trans, cjkSource, chunkCues, index, targetLang }
// and returns { reason } if the translation should be flagged, or null if it passes.

function checkMissing({ trans }) {
  return !trans ? { reason: 'missing' } : null;
}

function checkUntranslated({ orig, trans }) {
  return trans === orig ? { reason: 'untranslated' } : null;
}

function checkMalformedEmDash({ trans }) {
  if (/^—/.test(trans.trim()) || /—$/.test(trans.trim())) return { reason: 'malformed —' };
  return null;
}

function checkEmDashDropped({ orig, trans }) {
  if (orig.includes('—') && !trans.includes('—')) return { reason: 'em dash dropped' };
  return null;
}

function checkSpeakerLabelLost({ orig, trans }) {
  if (/^（[^）]+）./.test(orig) && !/^[（(]/.test(trans)) return { reason: 'speaker label lost' };
  return null;
}

function checkAnnotationMismatch({ orig, trans }) {
  // Strip leading "-" (Korean/CC multi-speaker convention) before checking
  const origNorm = orig.trim().replace(/^-\s*/, '');
  const transNorm = trans.trim().replace(/^-\s*/, '');
  const origHasAnnotation = /^[[(（【]/.test(origNorm) || /^♪/.test(origNorm);
  const transHasAnnotation = /^[[(（【]/.test(transNorm) || /^♪/.test(transNorm);
  if (origHasAnnotation !== transHasAnnotation) return { reason: 'annotation mismatch' };
  if (origHasAnnotation && transHasAnnotation) {
    const bracketGroup = (c) => '[(（【'.includes(c) ? 'bracket' : c === '♪' ? 'music' : 'other';
    if (bracketGroup(origNorm[0]) !== bracketGroup(transNorm[0])) return { reason: 'annotation mismatch' };
  }
  if (!origHasAnnotation && /^[[(（【][^\])）】]*[\])）】]$/.test(transNorm)) return { reason: 'annotation mismatch' };
  return null;
}

function checkQuestionMarkMismatch({ orig, trans, cjkSource }) {
  if (trans.length <= 3 || orig.length <= 3) return null;
  const origHasQ = /[?？]/.test(orig);
  const transHasQ = /[?？]/.test(trans);
  if (origHasQ === transHasQ) return null;
  if (cjkSource && !origHasQ && transHasQ) return null; // adding ? is fine for CJK
  return { reason: '? mismatch' };
}

function checkExclamationMismatch({ orig, trans }) {
  if (trans.length <= 3 || orig.length <= 3) return null;
  if (/[!！]/.test(orig) !== /[!！]/.test(trans)) return { reason: '! mismatch' };
  return null;
}

function checkSourceLeak({ orig, trans }) {
  if (orig.length <= 10) return null;
  const origLower = orig.toLowerCase();
  const transLower = trans.toLowerCase();
  const checkLen = Math.min(orig.length, 30);
  for (let s = 0; s <= orig.length - checkLen; s++) {
    if (transLower.includes(origLower.substring(s, s + checkLen))) return { reason: 'source leak' };
  }
  return null;
}

function checkSourcePrependAppend({ orig, trans }) {
  if (orig.length <= 15) return null;
  const checkLen = Math.min(12, Math.floor(orig.length * 0.4));
  const origStart = orig.substring(0, checkLen);
  const origEnd = orig.substring(Math.max(0, orig.length - checkLen));
  if (trans.includes(origStart) || trans.includes(origEnd)) return { reason: 'source prepend/append' };
  return null;
}

function checkShifted({ trans, chunkCues, index }) {
  if (trans.length <= 5) return null;
  for (let j = Math.max(0, index - 3); j <= Math.min(chunkCues.length - 1, index + 3); j++) {
    if (j !== index && trans === chunkCues[j].text) return { reason: 'shifted' };
  }
  return null;
}

function checkTruncated({ orig, trans }) {
  if (orig.length > 20 && trans.length < orig.length * 0.15) return { reason: 'truncated' };
  return null;
}

function checkRubyArtifact({ trans }) {
  if (trans.length > 5 && hasRubyArtifact(trans)) return { reason: 'ruby artifact' };
  return null;
}

const SCRIPTS = [
  { name: 'CJK',       reGlobal: /[\u4e00-\u9fff\u3400-\u4dbf]/g },
  { name: 'Hiragana',  reGlobal: /[\u3040-\u309f]/g },
  { name: 'Katakana',  reGlobal: /[\u30a0-\u30ff]/g },
  { name: 'Hangul',    reGlobal: /[\uac00-\ud7af\u1100-\u11ff]/g },
  { name: 'Cyrillic',  reGlobal: /[\u0400-\u04ff]/g },
  { name: 'Arabic',    reGlobal: /[\u0600-\u06ff\u0750-\u077f]/g },
  { name: 'Devanagari', reGlobal: /[\u0900-\u097f]/g },
  { name: 'Thai',      reGlobal: /[\u0e00-\u0e7f]/g },
  { name: 'Latin',     reGlobal: /[a-zA-ZÀ-ÿ]/g },
];

function checkMixedScript({ orig, trans }) {
  if (trans.length <= 5 || orig.length <= 3) return null;

  const origScripts = new Set();
  for (const s of SCRIPTS) {
    const hits = (orig.match(s.reGlobal) || []).length;
    if (hits / orig.length > 0.15) origScripts.add(s.name);
  }

  const transScripts = {};
  for (const s of SCRIPTS) {
    const hits = (trans.match(s.reGlobal) || []).length;
    if (hits > 0) transScripts[s.name] = hits / trans.length;
  }

  for (const srcScript of origScripts) {
    const transRatio = transScripts[srcScript] || 0;
    const isTransPrimary = Object.entries(transScripts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] === srcScript;
    if (isTransPrimary) continue;
    if (transRatio > 0.10) return { reason: 'mixed script' };
  }
  return null;
}

function checkWrongLanguage({ trans, targetLang }) {
  if (trans.length <= 10) return null;
  const targetLower = targetLang.toLowerCase();
  const targetSig = LANG_SIGNATURES.find(s => s.aliases.some(a => targetLower.includes(a)));
  const words = trans.split(/\s+/);
  if (words.length < 4) return null;

  // Score the target language to compare against foreign candidates
  let targetScore = 0;
  if (targetSig && !['Japanese', 'Korean', 'Chinese', 'Russian', 'Arabic'].includes(targetSig.name)) {
    const targetHits = words.filter(w => targetSig.markers.test(w)).length;
    targetScore = targetHits / words.length;
  }

  let bestLang = null, bestScore = 0;
  let scriptDetection = false;
  for (const sig of LANG_SIGNATURES) {
    if (targetSig && sig.name === targetSig.name) continue;
    if (['Japanese', 'Korean', 'Chinese', 'Russian', 'Arabic'].includes(sig.name)) {
      const scriptChars = (trans.match(new RegExp(sig.markers.source, 'g')) || []).length;
      const ratio = scriptChars / trans.length;
      if (ratio > 0.3) {
        bestLang = sig.name;
        scriptDetection = true;
        break;
      }
      continue;
    }
    const matchingWords = words.filter(w => sig.markers.test(w));
    const hits = matchingWords.length;
    const uniqueHits = new Set(matchingWords.map(w => w.toLowerCase().replace(/\W/g, ''))).size;
    const score = hits / words.length;
    if (hits >= 3 && uniqueHits >= 2 && score > 0.4 && score > bestScore) {
      bestLang = sig.name;
      bestScore = score;
    }
  }
  // Script-based detections (CJK, Cyrillic, Arabic) flag directly;
  // word-based detections require foreign score to significantly exceed target score
  if (bestLang && (scriptDetection || bestScore > targetScore + 0.15)) {
    return { reason: `wrong lang (${bestLang})` };
  }
  return null;
}

/**
 * Ordered array of validation rules. Each rule is a named function that receives
 * a context and returns { reason } if the translation should be flagged, or null.
 * Rules are evaluated in order; the first match wins (short-circuit).
 */
export const VALIDATION_RULES = [
  checkMissing,
  checkUntranslated,
  checkMalformedEmDash,
  checkEmDashDropped,
  checkSpeakerLabelLost,
  checkAnnotationMismatch,
  checkQuestionMarkMismatch,
  checkExclamationMismatch,
  checkSourceLeak,
  checkSourcePrependAppend,
  checkShifted,
  checkTruncated,
  checkRubyArtifact,
  checkMixedScript,
  checkWrongLanguage,
];

export function validateTranslation(chunkCues, results, targetLang, sourceLang = '') {
  // CJK languages routinely omit ? for questions (using particles/intonation instead),
  // so adding ? in translation is a valid localization choice, not an error.
  const cjkSource = /japanese|^ja$|^jpn$|korean|^ko$|^kor$|chinese|^zh$|^zho$/i.test(sourceLang);
  const gaps = [];
  const reasons = {}; // idx -> reason string
  for (let i = 0; i < chunkCues.length; i++) {
    const context = {
      orig: chunkCues[i].text,
      trans: results[i],
      cjkSource,
      chunkCues,
      index: i,
      targetLang,
    };
    for (const rule of VALIDATION_RULES) {
      const result = rule(context);
      if (result) {
        gaps.push(i);
        reasons[i] = result.reason;
        break;
      }
    }
  }
  return { gaps, reasons };
}
