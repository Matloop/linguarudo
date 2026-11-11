import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANGUAGE_TAG_RE,
  canonicalLanguage,
  countWords,
  findWord,
  isLanguageTag,
  languageEndonym,
  languageName,
  languageProfile,
  lemmaKey,
  listLanguages,
  segmentWords,
} from '../src/index.js';

const words = (text, tag) => segmentWords(text, tag).filter((s) => s.isWord).map((s) => s.segment);

test('canonicalLanguage normaliza caixa, códigos antigos e separador', () => {
  assert.equal(canonicalLanguage('PT-br'), 'pt-BR');
  assert.equal(canonicalLanguage('  pt_br '), 'pt-BR');
  assert.equal(canonicalLanguage('iw'), 'he');
  assert.equal(canonicalLanguage('in'), 'id');
  assert.equal(canonicalLanguage('it'), 'it');
  assert.equal(canonicalLanguage('EN-us'), 'en-US');
  assert.equal(canonicalLanguage('es-419'), 'es-419');
});

test('canonicalLanguage aceita ISO 639-2 (/B e /T) e códigos do OpenSubtitles', () => {
  for (const [input, want] of [
    ['ita', 'it'], ['por', 'pt'], ['eng', 'en'], ['ger', 'de'], ['deu', 'de'], ['fre', 'fr'],
    ['chi', 'zh'], ['cmn', 'zh'], ['heb', 'he'], ['gre', 'el'], ['tgl', 'fil'], ['tl', 'fil'],
    ['pob', 'pt-BR'], ['pb', 'pt-BR'], ['zht', 'zh-Hant'], ['zhe', 'zh'], ['por-BR', 'pt-BR'],
  ]) {
    assert.equal(canonicalLanguage(input), want, input);
  }
});

test('canonicalLanguage preserva escrita e região', () => {
  assert.equal(canonicalLanguage('zh-hant'), 'zh-Hant');
  assert.equal(canonicalLanguage('zh-Hant-TW'), 'zh-Hant-TW');
  assert.equal(canonicalLanguage('sr-latn'), 'sr-Latn');
  assert.equal(canonicalLanguage('zh-TW'), 'zh-TW');
});

test('canonicalLanguage rejeita nomes, lixo e und', () => {
  for (const bad of ['português', 'italian', 'xx!!', '', '   ', 'und', 'root', 'a', 'x-foo', 'pt--BR', null, 42, undefined]) {
    assert.equal(canonicalLanguage(bad), null, String(bad));
  }
  assert.equal(canonicalLanguage('a'.repeat(36)), null);
});

test('LANGUAGE_TAG_RE e isLanguageTag conferem o formato, até 35 caracteres', () => {
  for (const ok of ['fil', 'pt', 'pt-BR', 'zh-Hant-TW', 'es-419', 'grc', 'sl-rozaj-biske', 'de-CH-1901', 'en-US-u-ca-gregory', 'en-x-private', 'yue']) {
    assert.ok(isLanguageTag(ok), ok);
  }
  for (const bad of ['p', 'italian', 'português', 'pt_BR', 'pt-', '-pt', '1a', 'x-foo', 'abcd', 'pt--BR', 'pt BR', 'en-' + 'a'.repeat(33), 42, null]) {
    assert.ok(!isLanguageTag(bad), String(bad));
  }
  assert.equal(typeof LANGUAGE_TAG_RE, 'string');
  // Sem flags nem sintaxe exclusiva do JS: a mesma fonte vai para o check do Postgres.
  assert.doesNotMatch(LANGUAGE_TAG_RE, /\\[dpu]|\(\?<|\(\?!/);
});

test('languageProfile: direção rtl para ar, he, fa, ur, yi, dv', () => {
  for (const tag of ['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ckb']) {
    assert.equal(languageProfile(tag).dir, 'rtl', tag);
  }
  for (const tag of ['pt', 'ja', 'ru', 'el', 'hi', 'az-Arab']) {
    assert.equal(languageProfile(tag).dir, tag === 'az-Arab' ? 'rtl' : 'ltr', tag);
  }
});

test('languageProfile: espaços, caixa, escrita', () => {
  for (const tag of ['ja', 'zh', 'zh-Hant', 'th', 'lo', 'km', 'my']) {
    assert.equal(languageProfile(tag).spaces, false, tag);
  }
  assert.equal(languageProfile('ko').spaces, true);
  assert.equal(languageProfile('ko').script, 'Kore');
  assert.equal(languageProfile('ja').script, 'Jpan');
  assert.equal(languageProfile('zh-TW').script, 'Hant');
  assert.equal(languageProfile('grc').script, 'Grek');
  assert.equal(languageProfile('sr-Latn').script, 'Latn');
  for (const tag of ['de', 'ru', 'el', 'hy']) assert.equal(languageProfile(tag).cased, true, tag);
  for (const tag of ['ka', 'ar', 'ja', 'hi', 'th']) assert.equal(languageProfile(tag).cased, false, tag);
});

test('languageProfile: elisão, wordlist, tag e base canônicas', () => {
  const pt = languageProfile('PT-br');
  assert.deepEqual({ ...pt }, {
    tag: 'pt-BR', base: 'pt', script: 'Latn', dir: 'ltr', spaces: true, cased: true, elision: false, wordlist: false,
  });
  for (const tag of ['it', 'fr', 'ca']) assert.equal(languageProfile(tag).elision, true, tag);
  assert.equal(languageProfile('en').elision, false);
  assert.equal(languageProfile('en').wordlist, true);
  assert.equal(languageProfile('it-CH').wordlist, true);
  assert.equal(languageProfile('de').wordlist, false);
});

test('languageProfile não quebra com tag inválida', () => {
  const p = languageProfile('xx!!');
  assert.equal(p.dir, 'ltr');
  assert.equal(p.spaces, true);
  assert.equal(p.script, 'Zzzz');
});

test('languageName e languageEndonym usam Intl.DisplayNames e caem na tag', () => {
  // A inicial varia entre motores (V8 'italiano', JSC 'Italiano').
  assert.equal(languageName('it', 'pt').toLowerCase(), 'italiano');
  assert.equal(languageName('de', 'en'), 'German');
  assert.equal(languageEndonym('de'), 'Deutsch');
  assert.equal(languageEndonym('ja'), '日本語');
  assert.equal(languageName('qaa', 'pt'), 'qaa');
  assert.equal(languageName('it', 'xx!!'), 'Italian'); // locale de exibição inválido → inglês
});

test('listLanguages: idiomas base nomeados, ordenados pelo nome', () => {
  const list = listLanguages('pt');
  assert.ok(list.length > 150, `só ${list.length}`);
  const tags = list.map((o) => o.tag);
  assert.equal(new Set(tags).size, tags.length);
  for (const t of ['pt', 'it', 'ja', 'ar', 'yue', 'grc', 'haw']) assert.ok(tags.includes(t), t);
  for (const t of ['iw', 'in', 'ji']) assert.ok(!tags.includes(t), t);
  const it = list.find((o) => o.tag === 'it');
  assert.deepEqual(it, { tag: 'it', name: 'Italiano', endonym: 'Italiano' });
  const collator = new Intl.Collator('pt');
  for (let i = 1; i < list.length; i++) {
    assert.ok(collator.compare(list[i - 1].name, list[i].name) <= 0, `${list[i - 1].name} > ${list[i].name}`);
  }
  for (const o of list) assert.notEqual(o.name, o.tag);
  assert.equal(listLanguages('en').find((o) => o.tag === 'de').name, 'German');
});

test('lemmaKey: NFC e minúsculas conforme o idioma, acentos mantidos', () => {
  assert.equal(lemmaKey('Haus', 'de'), 'haus');
  assert.equal(lemmaKey('İstanbul', 'tr'), 'istanbul');
  assert.equal(lemmaKey('IŞIK', 'tr'), 'ışık');
  assert.equal(lemmaKey('ΣΟΦΟΣ', 'el'), 'σοφος'.slice(0, 4) + 'ς');
  assert.equal(lemmaKey('Café', 'fr'), 'café'); // NFD → NFC
  assert.notEqual(lemmaKey('pará', 'pt'), lemmaKey('para', 'pt'));
  assert.equal(lemmaKey('食べる', 'ja'), '食べる');
  assert.equal(lemmaKey('Haus', 'xx!!'), 'haus');
});

test('segmentWords não perde caracteres', () => {
  for (const [text, tag] of [
    ["L'amico dell'acqua, guarda-chuva!", 'it'],
    ['私は毎朝パンを食べます。', 'ja'],
    ["Qu'il vienne aujourd'hui", 'fr'],
    ['مرحبا بالعالم', 'ar'],
  ]) {
    const segs = segmentWords(text, tag);
    assert.equal(segs.map((s) => s.segment).join(''), text);
    for (const s of segs) assert.equal(text.slice(s.index, s.index + s.segment.length), s.segment);
  }
});

test('segmentWords: japonês, chinês e tailandês sem espaços', () => {
  const ja = words('私は毎朝パンを食べます', 'ja');
  assert.ok(ja.length > 3, ja.join('|'));
  assert.ok(ja.some((w) => w.startsWith('食')), ja.join('|'));
  assert.ok(words('我每天早上吃面包', 'zh').length > 3);
  assert.ok(words('ฉันกินข้าวทุกวัน', 'th').length > 3);
});

test('segmentWords: elisão italiana separa o clítico com apóstrofo', () => {
  assert.deepEqual(words("l'amico dell'acqua l’uomo un'altra", 'it'), [
    "l'", 'amico', "dell'", 'acqua', 'l’', 'uomo', "un'", 'altra',
  ]);
  assert.deepEqual(words("C'è un po' di sale", 'it'), ["C'", 'è', 'un', 'po', 'di', 'sale']);
});

test('segmentWords: elisão francesa só para clíticos; inglês e português não separam', () => {
  assert.deepEqual(words("Qu'il l'aime aujourd'hui jusqu'à", 'fr'), ["Qu'", 'il', "l'", 'aime', "aujourd'hui", "jusqu'", 'à']);
  assert.deepEqual(words("don't rock'n'roll", 'en'), ["don't", "rock'n'roll"]);
  assert.deepEqual(words("copo d'água", 'pt'), ['copo', "d'água"]);
});

test('segmentWords: hífen junta palavras (como em words.js)', () => {
  assert.deepEqual(words('um guarda-chuva e a E-Mail-Adresse', 'pt'), ['um', 'guarda-chuva', 'e', 'a', 'E-Mail-Adresse']);
  assert.deepEqual(words('dia - noite', 'pt'), ['dia', 'noite']);
});

test('countWords', () => {
  assert.equal(countWords('Ciao, come stai?', 'it'), 3);
  assert.equal(countWords("l'amico", 'it'), 2);
  assert.equal(countWords('guarda-chuva', 'pt'), 1);
  assert.equal(countWords('', 'pt'), 0);
  assert.ok(countWords('私は毎朝パンを食べます', 'ja') > 3);
});

test('findWord: palavra inteira, caixa exata antes', () => {
  assert.deepEqual(findWord('Ich sehe das Haus.', 'Haus', 'de'), { index: 13, length: 4 });
  assert.deepEqual(findWord('HAUS und Haus', 'Haus', 'de'), { index: 9, length: 4 });
  assert.deepEqual(findWord('Das HAUS ist alt', 'haus', 'de'), { index: 4, length: 4 });
  assert.equal(findWord('Hausaufgaben', 'Haus', 'de'), null);
  assert.equal(findWord('Das Haus', '', 'de'), null);
});

test('findWord: caixa pela regra do idioma (turco)', () => {
  assert.deepEqual(findWord('İSTANBUL güzel', 'istanbul', 'tr'), { index: 0, length: 8 });
});

test('findWord: acentos distinguem; NFD casa com NFC', () => {
  assert.equal(findWord('Ele vem do Pará', 'para', 'pt'), null);
  assert.deepEqual(findWord('Vou para casa', 'para', 'pt'), { index: 4, length: 4 });
  const nfd = 'o café quente';
  assert.deepEqual(findWord(nfd, 'café', 'pt'), { index: 2, length: 5 });
});

test('findWord: hífen e expressão de várias palavras', () => {
  assert.equal(findWord('um guarda-chuva', 'chuva', 'pt'), null);
  assert.deepEqual(findWord('um guarda-chuva', 'guarda-chuva', 'pt'), { index: 3, length: 12 });
  assert.deepEqual(findWord('Devi tirare   fuori tutto', 'tirare fuori', 'it'), { index: 5, length: 14 });
});

test('findWord: elisão italiana', () => {
  assert.deepEqual(findWord("Dov'è l'amico?", 'amico', 'it'), { index: 8, length: 5 });
  assert.deepEqual(findWord("Dov'è l'amico?", "l'amico", 'it'), { index: 6, length: 7 });
  assert.deepEqual(findWord("Dov'è l’amico?", "L'amico", 'it'), { index: 6, length: 7 });
});

test('findWord: japonês e chinês por fronteira de segmento, com recurso a substring', () => {
  const ja = '私は毎朝パンを食べます';
  assert.deepEqual(findWord(ja, 'パン', 'ja'), { index: 4, length: 2 });
  assert.deepEqual(findWord(ja, '毎', 'ja'), { index: 2, length: 1 }); // dentro de 毎朝: substring
  assert.equal(findWord(ja, '飲む', 'ja'), null);
  assert.deepEqual(findWord('我每天早上吃面包', '面包', 'zh'), { index: 6, length: 2 });
  // Em idiomas com espaço não há recurso a substring.
  assert.equal(findWord('casamento', 'casa', 'pt'), null);
});

test('findWord: árabe', () => {
  assert.deepEqual(findWord('مرحبا بالعالم', 'مرحبا', 'ar'), { index: 0, length: 5 });
});
