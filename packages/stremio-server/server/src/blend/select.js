// Quais falas ganham troca e qual palavra entra em cada uma. Vale para os dois motores: o local e a
// IA entregam candidatas por fala (já validadas) e esta escolha decide o que vai para a tela.
//
//   1. cobertura: wordCoverage (0–MAX_WORD_COVERAGE) é a parte das PALAVRAS da legenda trocadas. A
//      cota do lote é round(wordCoverage × palavras do lote), contando todas as palavras da troca
//      ("de novo" vale 2).
//   2. curva (blendPlan): enquanto a cota cabe em uma troca por fala (cota ≤ falas, ≈ 16% com 6,3
//      palavras por fala), mais falas ganham uma troca, espaçadas: a legenda vira janelas de
//      falas/cota falas pela posição global (cueOffset + índice), uma troca por janela, e a janela
//      que começa num lote é dele. Acima disso toda fala ganha uma e o teto de cada fala cresce com o
//      tamanho dela: round(wordCoverage × palavras da fala), no mínimo 1 e no máximo metade das
//      palavras (50% → metade).
//   3. o teto é limite, não obrigação: uma troca extra na fala (a 2ª, 3ª…) só entra com candidata
//      boa (nota ≥ EXTRA_MIN: fora da lista de frequência não entra; o desempate pela ordem do motor
//      não conta aqui, só na escolha entre candidatas). Trocas vizinhas na mesma fala valem
//      ("coppie sposate").
//   4. compensação: o que não coube (janela ou fala sem candidata) vai, enquanto faltar cota e houver
//      candidata, para a fala sem troca mais longe das já escolhidas (fica espaçado); sem fala livre,
//      para a fala com mais espaço proporcional (trocas abaixo do teto antes), até metade das
//      palavras dela.
//   5. nota da candidata: banco do usuário (preferWords) muito acima de tudo; depois a frequência
//      do lema na língua de estudo (legendas do OpenSubtitles, src/dict/frequency.js): a faixa
//      intermediária ensina mais, as muito comuns valem menos e as fora da lista (raras) só entram
//      sem alternativa; empate: a ordem em que o motor entregou (a preferência dele).
//   6. repetição: o mesmo lema (do banco ou não) só volta a REPEAT_GAP falas de distância da última
//      vez em que apareceu (repetição espaçada).
import { countWords, lemmaKey } from '@linguetta/language';

export const DEFAULT_WORD_COVERAGE = 0.1;
export const MAX_WORD_COVERAGE = 0.5;
export const REPEAT_GAP = 20;
// Faixas de frequência (posição na lista; 1 = a mais comum).
export const VERY_COMMON = 300;
export const COMMON = 5000;

const BANK = 100;
// Nota mínima de uma troca extra na mesma fala: fora da lista (rara) não entra.
const EXTRA_MIN = 1.5;

/** Nota da frequência de um lema: rank(palavra) → posição ou null; frequency null = sem lista. */
export function frequencyScore(frequency, ...words) {
  if (!frequency) return 2;
  const ranks = words.filter(Boolean).map((w) => frequency.rank(w)).filter((r) => r !== null);
  if (!ranks.length) return 0.5;
  const r = Math.min(...ranks);
  if (r <= VERY_COMMON) return 2;
  if (r <= COMMON) return 3;
  return 1.5;
}

/** Limite de palavras trocadas numa fala: metade das palavras (a primeira troca sempre cabe). */
const halfOf = (words) => Math.max(1, Math.floor(words / 2));

/**
 * O alvo do lote, igual para a escolha e para o pedido à IA. words: palavras por fala; quota: palavras
 * a trocar; perCue: false = uma troca em parte das falas (cueFraction delas), true = toda fala com
 * troca e caps[i] trocas no máximo.
 */
export function blendPlan({ texts, sourceLang, wordCoverage }) {
  const perText = texts.map((t) => countWords(t, sourceLang));
  const words = perText.reduce((a, b) => a + b, 0);
  const quota = wordCoverage > 0 ? Math.round(wordCoverage * words) : 0;
  const perCue = quota > texts.length;
  const caps = perText.map((w) => (perCue ? Math.max(1, Math.min(Math.floor(w / 2), Math.round(wordCoverage * w))) : 1));
  return { perText, words, quota, perCue, cueFraction: texts.length ? Math.min(1, quota / texts.length) : 0, caps };
}

/**
 * texts: string[] do lote; candidates: Array<ann[]> (validadas, na ordem de preferência do motor).
 * frequency: { rank(word) } da língua de estudo ou null. Devolve Array<ann[]> com o que fica.
 */
export function selectSwaps({ texts, candidates, sourceLang, targetLang, wordCoverage, cueOffset = 0, preferWords = [], frequency = null }) {
  const out = texts.map(() => []);
  const plan = blendPlan({ texts, sourceLang, wordCoverage });
  if (!plan.quota) return out;
  const prefer = new Set(preferWords.map((w) => lemmaKey(w, targetLang)));
  const scored = texts.map((_, i) =>
    (candidates[i] ?? []).map((ann, k) => {
      const key = lemmaKey(ann.lemma, targetLang);
      const bank = prefer.has(key);
      // base decide se a candidata pode entrar (EXTRA_MIN); score = base com o desempate pela ordem do
      // motor, só para escolher entre elas.
      const base = (bank ? BANK : 0) + frequencyScore(frequency, ann.lemma, ann.target);
      return { ann, key, base, score: base - k * 0.01, words: Math.max(1, countWords(ann.source, sourceLang)) };
    }),
  );

  const seenAt = new Map(); // lema → posições globais das trocas dele
  const used = texts.map(() => 0); // palavras trocadas por fala
  const dist = texts.map(() => Infinity); // distância até a fala com troca mais perto
  let total = 0;
  const eligible = (c, g) => (seenAt.get(c.key) ?? []).every((p) => Math.abs(g - p) >= REPEAT_GAP);
  // Melhor candidata ainda possível na fala i: a primeira troca aceita qualquer nota; uma extra precisa
  // ser boa, de outro lema e caber na metade das palavras.
  const best = (i) => {
    const g = cueOffset + i;
    const first = out[i].length === 0;
    let top = null;
    for (const c of scored[i]) {
      if (out[i].includes(c.ann) || !eligible(c, g)) continue;
      if (!first && (c.base < EXTRA_MIN || used[i] + c.words > halfOf(plan.perText[i]))) continue;
      if (!top || c.score > top.score) top = c;
    }
    return top;
  };
  const take = (i, c) => {
    out[i].push(c.ann);
    used[i] += c.words;
    total += c.words;
    const g = cueOffset + i;
    seenAt.set(c.key, [...(seenAt.get(c.key) ?? []), g]);
    for (let j = 0; j < texts.length; j++) dist[j] = Math.min(dist[j], Math.abs(i - j));
  };

  // Primeira passada: uma troca por janela (perCue: cada fala é a própria janela), a melhor delas.
  const f = plan.cueFraction;
  const windowOf = (g) => Math.floor(g * f + 1e-9);
  const startOf = (k) => Math.ceil(k / f - 1e-9);
  const windows = new Map();
  texts.forEach((_, i) => {
    const k = windowOf(cueOffset + i);
    if (startOf(k) < cueOffset) return; // começou no lote anterior: é dele
    if (!windows.has(k)) windows.set(k, []);
    windows.get(k).push(i);
  });
  for (const cues of windows.values()) {
    let pick = null;
    for (const i of cues) {
      const c = best(i);
      if (c && (!pick || c.score > pick.c.score)) pick = { i, c };
    }
    if (pick) take(pick.i, pick.c);
  }

  // Depois, até fechar a cota: fala sem troca mais longe das escolhidas; sem nenhuma, a fala abaixo do
  // teto e, por fim, qualquer uma, sempre a com menos palavras trocadas em proporção ao tamanho.
  while (total < plan.quota) {
    let pick = null;
    for (let i = 0; i < texts.length; i++) {
      const c = best(i);
      if (!c) continue;
      const free = out[i].length === 0;
      const rank = [
        free ? 1 : 0,
        free ? dist[i] : out[i].length < plan.caps[i] ? 1 : 0,
        free ? 0 : -(used[i] + c.words) / Math.max(1, plan.perText[i]),
        c.score,
      ];
      if (!pick || greater(rank, pick.rank)) pick = { i, c, rank };
    }
    if (!pick) break;
    take(pick.i, pick.c);
  }
  // Ordem de leitura dentro da fala.
  return out.map((anns, i) => anns.sort((a, b) => texts[i].indexOf(a.source) - texts[i].indexOf(b.source)));
}

const greater = (a, b) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k];
  return false;
};
