# Decks e fila do dia — especificação (2026-11-11)

Fonte da verdade para a implementação em fatias. Protótipos: `prototypes/decks.html` (proposta completa) e `prototypes/decks-v2.html` (tela Flashcards aprovada, versão enxuta). Ninguém usa o app ainda: sem compatibilidade com dados ou campos antigos (remover o que sobrar), mas o leitor já instalado deve continuar a funcionar lendo campos opcionais.

## Regra geral
- Capturar não tem limite. Começar novas tem orçamento diário. Revisar não tem limite.
- A web (servidor) decide a fila: orçamento, ordem das novas, irmãos ocultos, teimosas, retenção. Leitor, Stremio e web só executam.
- Revisão enviada nunca é recusada por limite (offline pode passar um pouco do orçamento; aceito).

## Modelo
- `decks`: id uuid, user_id, language (BCP 47, mesmo campo dos itens), name, parent_id (um nível só: Pai › Filho), is_default bool (exatamente um por usuário+idioma), paused bool, new_order `importance|deck|random` (padrão importance; decks vindos do Anki/CSV = deck), new_cap int null (teto próprio dentro do orçamento do idioma), on_reader bool default true, position int, created_at. RLS por user_id.
- Cada item e cada ficha pertence a exatamente um deck: `items.deck_id`, `fichas.deck_id` NOT NULL. Reconhecer/Produzir da mesma palavra ficam juntos (o deck é do item/ficha, não do flashcard).
- Deck padrão do idioma se chama "Minhas palavras", criado automaticamente (trigger ou função ao criar o primeiro item/idioma), não pode ser apagado; pode-se trocar qual é o padrão.
- Captura (save do leitor, Stremio, música, web "Guardar palavra") sempre cai no deck padrão.
- Importar .apkg: cada deck do Anki vira um deck (`Pai::Filho` → subdeck; níveis mais fundos achatados em `Filho` com nome "B::C"). Deixa de virar tag de deck.
- Importar CSV (web, ou op `deckImport` do leitor): vira deck com new_order=deck.
- Tags continuam como filtro transversal.
- Apagar deck não padrão: mover conteúdo para o padrão ou apagar junto (escolha na UI).

## Fila do dia
- Orçamento por idioma: `user_settings.new_flashcards_per_day` (já existe) + `extra_new` do dia (tabela ou coluna por usuário+idioma+dia lógico; dia lógico usa time_zone e day_start_hour existentes).
- newDoneToday = novas começadas hoje em qualquer cliente (pelo review_logs).
- newAllowance = max(0, perDay + extraNew − newDoneToday).
- Ordem das novas, "importância": score = encontros + 2×obras distintas + bônus se a obra do encontro mais recente é a obra ativa (último encontro do usuário nas últimas 48h); empate por created_at. Decks com new_order=deck usam a ordem do deck (created_at/posição de import); random usa hash estável por dia.
- "Estudar tudo": vencidas de todos os decks não pausados + novas até newAllowance, intercalando decks pela regra acima respeitando new_cap de cada deck.
- Estudar um deck: mesma regra restrita ao deck (e subdecks).
- Extras: "+5 hoje" (incrementa extra_new) e "Desta obra" (sessão filtrada por work_id: novas daquela obra, conta como extra automaticamente) — oferecidos só no fim da sessão quando as novas acabam.
- Irmãos ocultos: já existe para itens; manter.

## Teimosas
- LEECH_LAPSES = 8 (configurável em user_settings: leech_lapses int default 8, leech_action `wait|tag|suspend` default wait).
- wait: ao atingir o limite o item fica `em espera` (flag no item/flashcard, ex. `leech_waiting_since timestamptz`); sai da fila. Um encontro NOVO (save/seen de qualquer cliente com frase) devolve à fila e a frase nova fica disponível no cartão. Manual: "Voltar para a fila".
- tag: só avisa (comportamento atual). suspend: suspende até ação manual.

## Contrato de sync (leitor) — campos novos opcionais
Header do snapshot:
```
"settings":{"newCardsPerDay":10,"newOrder":"importance","desiredRetention":0.9,"buryRelated":true,"leech":{"lapses":8,"action":"wait"}},
"today":{"newDoneToday":6,"extraNew":0,"newAllowance":4},
"decks":[{"id":"…","name":"Minhas palavras","default":true,"parentId":null,"newOrder":"importance","newCap":null}]
```
Só decks com on_reader=true e paused=false. Cada item: `"deckId"`, `"queueRank"` (inteiro, 1 = primeira nova; null para não-novas), `"leechWaiting": bool`. Fichas: passam a ir no snapshot em versão só texto (frente/verso renderizados em texto, sem mídia) como `{"t":"ficha","id","deckId","front","back","queueRank","flashcard":{…}}`.
Ops novas: `extraNew {n}`; `deckImport {name, hash, rows:[{front,back}]}` (idempotente por hash). Review de ficha usa `flashcardId` como hoje.
ADR 0005: "A fila do dia é decisão do servidor" (complementa ADR 0001).

## UI web (fatia 2)
- `/flashcards` vira o hub enxuto de `decks-v2.html`: título + "N decks · M flashcards", Importar (ghost) + "+ Novo deck" (popover com nome), faixa "N para hoje" com barra "X de Y novas começadas" + "Estudar tudo", tabela de decks (Deck | Novas | Aprendendo | Revisar, zeros apagados, subdeck indentado, pausado esmaecido), checkbox no hover, barra flutuante de seleção (Estudar / Pausar / Renomear / Mover…/ ✕). Clique na linha abre o deck.
- Revisão vai para `/flashcards/estudar?deck=…|obra=…` (o player atual, sem regressão).
- Sidebar: sob Flashcards, subitens por deck com contagem para hoje.
- Página do deck `/flashcards/deck/[id]`: mesma lista de "Minhas palavras" filtrada, abas (Todas/Na fila hoje/Novas/Aprendendo/Teimosas), seleção com "Mover para deck…", opções do deck num popover/drawer (ordem, teto, pausar, padrão, no leitor, renomear, apagar).
- "Minhas palavras" (/palavras): filtro por deck e ação em massa "Mover para deck…".
- Fim de cota no player: diálogo "As N novas de hoje acabaram" com "Estudar as de <obra recente>" e "+5 só hoje" + estimativa de revisões amanhã.
- Perfil → Estudo: novas por dia, ordem, retenção, início do dia, ocultar irmãos, teimosas (limite + ação).
- Estilo: tokens existentes (`apps/web/src/lib/styles/tokens.css`), calmo/premium, nada de cara de Duolingo.
