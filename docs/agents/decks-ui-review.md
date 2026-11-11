# Revisão de UI do hub de decks (aplicar na fatia 2)

Regra: NÃO copiar o CSS do protótipo. Reusar o que existe: `.ph`, `.btn`/`.btn-soft`/`.btn-ghost`/`.icon-btn`, `.bar`, `.count`, `.seg`, `.chip`, `.empty`, `.code`, `kbd`, `Icon`, `Toast`, `--sel` para linha selecionada, `--r-m`/`--r-l`, linhas no estilo `.wrow` de /palavras.

## Hub /flashcards
1. Números coerentes: a coluna Novas mostra o que a sessão serviria de fato (limitado por newAllowance e new_cap). "N para hoje" vem da fila do servidor, e o badge da sidebar usa o mesmo número.
2. Faixa: "14 para hoje" + "4 novas · 10 revisões" (--ink-3), com `.bar` fina. Mostrar o atalho `<kbd>R</kbd>` em "Estudar tudo". No tema claro usar `.tile.lift`.
3. Checkbox real: `<input type=checkbox aria-label="Selecionar …">`. Visível no hover, no focus-within e sempre com `@media (hover:none)`.
4. A linha abre o deck por um `<a>` esticado sobre o nome, como `.wrow`, e não por um onclick no tr.
5. Teclado: Shift+clique seleciona um intervalo, X marca, Esc limpa, Ctrl/⌘+A seleciona tudo.
6. Barra de seleção:
   - Estudar · Pausar/Retomar (conforme a seleção) · Renomear (só com 1 selecionado) · Mover… · ✕ (aria-label "Limpar seleção").
   - `role=toolbar`; a contagem fica em `aria-live`.
   - `position:sticky; bottom:20px`. No mobile, acima da tab bar.
7. Zeros em --ink-3 com opacidade .6, e não --line-2. Revisar com valor usa --terra-ink.
8. Deck pausado: nome em --ink-3 e pill "Pausado" neutra. Não esmaecer a linha inteira. Sai do total e da sidebar.
9. Nomes longos com ellipsis e `title`. Subdeck do Anki "B::C" aparece como "B › C".
10. Novo deck:
    - popover com input em autofocus; Enter cria, Esc cancela, máximo 60 caracteres;
    - erro "Já existe um deck com esse nome";
    - mostrar o idioma em `.code`;
    - depois de criar, toast "Deck “X” criado" e destaque rápido da linha nova;
    - no mobile, bottom sheet.
11. Sidebar:
    - subitens alinhados com o rótulo do nav (indent 40px, altura 32px), contagem em --ink-3;
    - só decks com algo para hoje; esconder se houver um deck só; esconder na sidebar mini;
    - conflito de nome entre o deck padrão e o nav "Minhas palavras": no subitem, mostrar o deck padrão como "Capturadas"? Não: manter o nome, mas o subitem só aparece quando há 2+ decks.
12. Cabeçalho: "3 decks · 1 subdeck · 63 flashcards".
13. Mobile (<560px): uma célula "para hoje" por linha e o detalhamento sob o nome; botão "Selecionar"; Importar e Fichas vão para um menu "···".

## Mudança do player para /flashcards/estudar
- Os atalhos do player (Espaço, 1–4, Z) estão em `SCREENS` no `+layout.svelte` ligados a /flashcards: mover para /flashcards/estudar.
- O atalho R no Início leva ao player.
- O botão "Fichas" e o filtro de tags (tagBar) da página atual vão para o menu "···" do hub e para a página do deck.

## Estados de borda
- **Só o deck padrão:** uma linha, sem cabeçalho de tabela, com a dica "Separe por tema ou importe do Anki."
- **Sem nada:** `.empty` no padrão de /palavras.
- **Tudo feito hoje:** "Tudo em dia · amanhã, cerca de N"; sem botão primário e com a barra cheia.
- **Orçamento esgotado:** "8 revisões para hoje · as 10 novas de hoje já foram"; células Novas em 0, com `title` dizendo quantas esperam.
- **Deck vazio:** "Vazio".

## Página do deck
1. Cabeçalho:
   - link de volta "Flashcards ›" (e o pai, se houver), depois o h1;
   - subtítulo "48 flashcards · teto de 5 novas/dia";
   - "Estudar 12" como primário e um "···" (icon-btn) que abre as opções.
   - Renomear fica só nas opções.
2. Abas `.seg` com contagem, como em /palavras: Todas · Na fila hoje · Novas · Aprendendo · Teimosas (escondida se for 0). Rolagem horizontal no mobile.
3. Lista:
   - `.wrow` mais o drawer existente; fichas com o ícone cards;
   - seleção e barra num componente compartilhado entre hub, página do deck e /palavras;
   - "Mover para deck…" abre um combobox filtrável com "Novo deck…" no fim.
4. Opções (popover; drawer no mobile):
   - Ordem com `.seg`.
   - Teto com placeholder "Sem teto (usa as 10 do idioma)".
   - Switches Pausado · No leitor · Tornar padrão. No deck padrão, "Tornar padrão" fica desabilitado com a dica "Palavras guardadas caem aqui".
   - "Apagar deck…" com `.btn-danger` abre um diálogo de rádio: "Mover N para Minhas palavras" (padrão) ou "Apagar junto". O padrão não tem Apagar.
5. Deck pausado: faixa "Pausado: fora do Estudar tudo." com o botão Retomar.

## Diálogo de fim de cota
1. Aparece só quando a fila da sessão esvazia. Usar `<dialog>` nativo, porque o player já bloqueia 1–4 com dialogOpen.
2. Botões, do primário ao ghost:
   - "Concluir por hoje": primário, com foco; Enter e Esc acionam.
   - "Estudar 7 de <obra>": soft, com o ícone de ORIGIN_ICONS e ellipsis; some se não houver novas daquela obra.
   - "+5 só hoje": ghost.
3. Texto: "As 10 novas de hoje acabaram" e "Amanhã: cerca de 23 revisões." Sem comemoração nem streak.
4. Depois do +5: a sessão continua sem recarregar, com o toast "+5 novas hoje". Da próxima vez, o diálogo diz "10 + 5 extras".
5. Mobile: bottom sheet com botões de largura total.
