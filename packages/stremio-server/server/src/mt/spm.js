// Tokenizador SentencePiece Unigram (Viterbi) em JS, para os modelos Marian/OPUS-MT.
//
// O source.spm do modelo vira peças + scores no setup (spm-pieces.json); aqui só refazemos o
// que o sentencepiece faz no encode: normalização nmt_nfkc, espaços colapsados, prefixo "▁" e o
// caminho de maior score (empate: a peça mais curta, como no sentencepiece). Caracteres sem peça
// viram <unk>, e <unk> seguidos se fundem num só. As peças viram ids pelo vocab.json do Marian
// (peça fora do vocab → <unk>), como o MarianTokenizer do transformers.
//
// Não usamos o tokenizador do @huggingface/transformers: ele quebra os tokens >>xxx<< em pedaços.

export const SPACE = '\u2581'; // ▁
const UNK_PENALTY = 10; // kUnkPenalty do sentencepiece
const NORMAL = 1;
const USER_DEFINED = 4;

// nmt_nfkc = NFKC + regras do sentencepiece (normalization_rule.h): controles ASCII somem e
// espaços "estranhos" (tab, quebra de linha, zero-width, BOM, U+FFFD...) viram espaço comum.
// eslint-disable-next-line no-control-regex
const NMT_REMOVE = /[\u0001-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/g;
const NMT_SPACE = /[\u0009\u000A\u000C\u000D\u1680\u200B-\u200F\u2028\u2029\u2581\uFEFF\uFFFD]/g;

/** Normaliza como o sentencepiece com nmt_nfkc + remove_extra_whitespaces (sem o prefixo). */
export function normalizeNmt(text) {
  return String(text)
    .replace(NMT_REMOVE, '')
    .replace(NMT_SPACE, ' ')
    .normalize('NFKC')
    .replace(/ +/g, ' ')
    .trim();
}

/**
 * pieces: Array<[peça, score, tipo]> na ordem do .spm (tipo 1 normal, 2 unk, 3 controle,
 * 4 definido pelo usuário, 5 não usado). vocab: { peça: id } do Marian.
 */
export function createSpmTokenizer({ pieces, vocab, unkToken = '<unk>', eosToken = '</s>', padToken = '<pad>' }) {
  const unkId = vocab[unkToken];
  const eosId = vocab[eosToken];
  const padId = vocab[padToken];
  if (unkId === undefined || eosId === undefined) throw new Error('vocab sem <unk> ou </s>');

  // Índice das peças por primeiro caractere (code point); cada entrada guarda o comprimento em
  // code units para o casamento direto com slice/startsWith.
  const byFirst = new Map();
  let minScore = Infinity;
  for (const [piece, score, type] of pieces) {
    if (type !== NORMAL && type !== USER_DEFINED) continue;
    if (!piece) continue;
    if (type === NORMAL && score < minScore) minScore = score;
    const first = String.fromCodePoint(piece.codePointAt(0));
    let list = byFirst.get(first);
    if (!list) byFirst.set(first, (list = []));
    // Peça definida pelo usuário sempre ganha (score fixo alto, como no sentencepiece).
    list.push({ piece, score: Math.fround(type === USER_DEFINED ? 0 : score), len: piece.length });
  }
  for (const list of byFirst.values()) list.sort((a, b) => a.len - b.len);
  const unkScore = Math.fround((Number.isFinite(minScore) ? minScore : 0) - UNK_PENALTY);

  /** Peças do texto normalizado (com o "▁" inicial), pelo Viterbi. */
  function segment(norm) {
    const n = norm.length;
    // Float32 como no sentencepiece: em empates, o arredondamento da soma decide o caminho.
    const best = new Float32Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    const unk = new Uint8Array(n + 1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      const cp = norm.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      const list = byFirst.get(ch);
      let single = false;
      if (list) {
        for (const p of list) {
          const j = i + p.len;
          if (j > n || !norm.startsWith(p.piece, i)) continue;
          if (p.len === ch.length) single = true;
          const s = Math.fround(best[i] + p.score);
          if (s > best[j]) {
            best[j] = s;
            from[j] = i;
            unk[j] = 0;
          }
        }
      }
      if (!single) {
        const j = i + ch.length;
        const s = Math.fround(best[i] + unkScore);
        if (s > best[j]) {
          best[j] = s;
          from[j] = i;
          unk[j] = 1;
        }
      }
    }
    const out = [];
    for (let j = n; j > 0; j = from[j]) {
      const piece = norm.slice(from[j], j);
      out.push({ piece, unk: unk[j] === 1 });
    }
    out.reverse();
    // <unk> seguidos viram um só
    const merged = [];
    for (const p of out) {
      const last = merged.at(-1);
      if (p.unk && last?.unk) last.piece += p.piece;
      else merged.push({ ...p });
    }
    return merged.map((p) => p.piece);
  }

  /** Peças do texto (como spm.encode(text, out_type=str)). */
  function tokenize(text) {
    const norm = normalizeNmt(text);
    if (!norm) return [];
    return segment(SPACE + norm.replace(/ /g, SPACE));
  }

  /** Ids do texto + </s> (sem token de idioma). */
  function encode(text) {
    return [...tokenize(text).map((p) => vocab[p] ?? unkId), eosId];
  }

  const idToPiece = [];
  for (const [piece, id] of Object.entries(vocab)) idToPiece[id] = piece;
  const special = new Set([unkId, eosId, padId]);

  /** Ids → texto: pula especiais, "▁" vira espaço, sem espaço nas pontas. */
  function decode(ids) {
    let s = '';
    for (const id of ids) {
      if (special.has(id)) continue;
      s += idToPiece[id] ?? '';
    }
    return s.replaceAll(SPACE, ' ').trim();
  }

  return { tokenize, encode, decode, tokenId: (t) => vocab[t], unkId, eosId, padId };
}
