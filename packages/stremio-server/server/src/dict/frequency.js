// Lista de frequência de um idioma: <pasta>/<base>.freq.txt, uma palavra por linha ("palavra
// contagem"), da mais comum para a menos comum. Fonte padrão (scripts/setup-dict.sh): FrequencyWords
// de Hermit Dave, contagens das legendas do OpenSubtitles 2018 (CC BY-SA 4.0), as 50 mil primeiras.
// Legenda é exatamente o que o Blend lê, então a ordem dela vale mais que a de um corpus escrito.
import { existsSync, readFileSync } from 'node:fs';
import { dictKey } from './key.js';

/** Abre a lista; null se o arquivo não existe. rank(palavra) → 1 (a mais comum)… ou null. */
export function openFrequency(file, lang) {
  if (!existsSync(file)) return null;
  const ranks = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const word = line.trim().split(/\s+/)[0];
    if (!word) continue;
    const key = dictKey(word, lang);
    if (!ranks.has(key)) ranks.set(key, ranks.size + 1);
  }
  return { size: ranks.size, rank: (word) => ranks.get(dictKey(word, lang)) ?? null };
}
