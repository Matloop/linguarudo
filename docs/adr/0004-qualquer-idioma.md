# ADR 0004: Qualquer idioma por design

- Status: Accepted
- Date: 2026-11-11
- Mockup: [prototypes/multi-idioma.html](../../prototypes/multi-idioma.html)

## Contexto

O banco aceitava 11 códigos ISO 639-1 fixos e partia de PT como língua nativa. As palavras eram separadas por espaço, e o lema era forçado para minúscula. Com isso, o alemão perdia a maiúscula dos substantivos, japonês, chinês e tailandês quebravam, e árabe e hebraico apareciam sem `dir`.

## Decisão

- **Conjunto aberto com níveis.** Qualquer idioma funciona no núcleo: itens, encontros, flashcards e sync. Lookup, segmentação especial, voz e wordlists se ligam conforme as capacidades de cada idioma. Se um recurso falta, ele fica escondido e o usuário preenche à mão.
- **Três eixos separados**, cada um com sua configuração:
  - idioma de estudo, aberto;
  - língua nativa, aberta;
  - idioma da interface, em PT e EN por enquanto.
- **Código de idioma: BCP 47 canônico.**
  - O app e o servidor normalizam com `Intl.getCanonicalLocales` (`PT-br` vira `pt-BR`, `iw` vira `he`).
  - O domínio `language_code` só confere o formato, por regex.
  - O teto de idiomas de estudo é 20.
  - Por enquanto não há lógica de variantes: o seletor mostra idiomas base.
- **Seletor** (Perfil, para estudo e nativa): busca com nomes de `Intl.DisplayNames`, no idioma da interface, mais "outro código" para qualquer tag válida.
- **Padrões para usuário novo:**
  - A interface e a nativa vêm do `Accept-Language`. A interface cai em PT ou EN.
  - O idioma de estudo começa vazio, e o primeiro uso pede um.
  - Somem os defaults `pt` e `{en,it}` do banco, das RPCs e dos contratos.
- **Lema e identidade.**
  - O lema é guardado como foi escrito ("Haus").
  - A unicidade usa `lemma_key = toLocaleLowerCase(NFC(lemma), idioma)`, e os acentos continuam distinguindo.
  - **Só o servidor calcula** `lemma_key`, e os contratos o devolvem no pull. O import do Anki herda a mesma regra.
- **Leitura.** O campo novo `reading` guarda furigana, pinyin ou romanização. Fica separado de `ipa` e aparece acima do lema.
- **Perfil de idioma.** O pacote `@linguetta/language` expõe `languageProfile(tag)` e é usado pela web e pelo stremio-server.
  - Ele combina `Intl.Locale.maximize()` com uma tabela pequena de exceções.
  - Devolve: escrita, direção, se usa espaços, se tem maiúsculas, regra de elisão, se há wordlist e o nome do idioma.
- **Segmentação.** `Intl.Segmenter(idioma, {granularity: 'word'})` substitui as regex de espaço no blend, no destaque da revisão, no Só língua-alvo e na música. A elisão (it, fr) vira uma regra do perfil.
- **Direção e fontes.**
  - Todo texto de estudo ou da nativa recebe `lang` e `dir` a partir do perfil.
  - O CSS usa propriedades lógicas.
  - Escritas sem fonte própria usam a fonte do sistema.
  - A UI inteira em RTL fica para quando existir interface num idioma RTL.
- **i18n da interface.** Paraglide (inlang) com catálogos PT, que é a fonte, e EN. Datas, plurais e intervalos vêm de `Intl`. As rotas continuam em PT. A API devolve códigos de erro, e a UI traduz. O e-mail de login fica bilíngue.
- **LLM.**
  - `nativeLanguage` é obrigatório em `/lookup` e `/annotate`, sem default `pt`.
  - Os prompts ficam neutros: "speaker of {native}", com regras de lema tiradas do perfil.
  - O lookup e o blend tentam qualquer idioma, e o resultado é sempre editável.
- **Música** fica só em en/it até haver wordlists de frequência. A **voz** aparece se o navegador tiver uma voz do idioma.
- **E-reader** (fork CrossPoint):
  - Em idiomas sem espaço, a seleção é por caractere com arrastar. A fila no SD guarda a forma e a frase, e o servidor tira o lema, a leitura e o sentido no sync.
  - As fontes vêm em um pacote por escrita no SD, e o sync avisa qual falta.
  - RTL fica fora da primeira versão.

## Consequências

- O contrato v1 do sync e o do Stremio mudam no lugar, ainda sem clientes externos. O fork do LingoBlend é atualizado junto.
- Sem usuários, o prod pode ser resetado.
- `lower(lemma)` sai do banco. O índice único passa a ser `(user_id, language, lemma_key)`.
