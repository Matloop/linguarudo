# ADR 0005: A fila do dia é decisão do servidor

- Status: Accepted
- Date: 2026-11-11
- Complementa: [ADR 0001](0001-servidor-decide-o-fsrs-pelo-log.md)
- Especificação: [docs/agents/decks.md](../agents/decks.md)
- Mockups: [prototypes/decks.html](../../prototypes/decks.html), [prototypes/decks-v2.html](../../prototypes/decks-v2.html)

## Contexto

O banco tinha um baralho só por idioma. A fila era "vencidas + novas por ordem de criação até o limite do dia", e a web e o e-reader a calculavam cada um do seu lado. Com decks (do Anki, de CSV, criados à mão), a ordem das novas por importância, os tetos por deck, o "+5 hoje" e as teimosas em espera, essa regra ficou grande demais para manter igual em TypeScript, em C++ no leitor e no Stremio. Se cada cliente calcular a sua, os aparelhos mostram filas diferentes e o orçamento do dia estoura.

## Decisão

- **O servidor decide a fila do dia; os clientes só executam.** O ADR 0001 já dá ao servidor o cronograma de cada flashcard. Este ADR dá a ele também o que entra hoje e em que ordem.
- **Capturar não tem limite; novas e revisões servidas por dia têm limites, como no Anki** (2026-11-13).
  - Cada deck tem "Novas por dia" e "Revisões máximas por dia". Vale o "Só hoje" do deck (`decks.new_today`/`reviews_today` com `limits_day` = dia de estudo), senão o do deck (`decks.new_per_day`/`reviews_per_day`), senão o Geral (`user_settings.new_flashcards_per_day`, padrão 20, e `reviews_per_day`, padrão 200). A engrenagem do hub grava pela RPC `set_deck_limits`.
  - O feito hoje num subdeck conta também no pai. Um flashcard só entra se o deck dele e o pai ainda têm vaga.
  - "Estudar tudo" (e vários decks) fica também no Geral do idioma. Estudar um deck usa só os limites dele e do pai.
  - Revisões contadas por `review_done_by_deck` (log com `state_before = 2`). Aprendendo e reaprendendo nunca têm limite.
  - O orçamento do idioma ("Estudar tudo") é: `newAllowance = max(0, perDay + extraNew − newDoneToday)`.
  - `newDoneToday` conta, pelo log, as novas começadas hoje em qualquer cliente e deck.
  - `extraNew` é o "+N hoje" do dia (tabela `extra_new`). Soma no Geral e em cada deck. Ele não passa para o dia seguinte.
- **Revisão nunca é recusada por orçamento.** O limite de revisões só decide quantas vencidas a fila serve hoje. Offline, dois aparelhos podem passar um pouco do limite. Isso é aceito, e a revisão excedente conta no dia como as outras.
- **A ordem das novas é uma função pura** (`apps/web/src/lib/server/queue.ts`) sobre o estado que o banco entrega (`queue_state_for`).
  - Cada deck ordena as suas novas por `importance` (encontros + 2 × obras distintas + bônus da obra ativa), por `deck` (ordem de criação ou importação) ou por `random` (hash estável no dia).
  - Cada deck é cortado pelos limites de hoje (dele e do pai).
  - "Estudar tudo" intercala os decks não pausados pela ordem da conta (`user_settings.new_order`) e corta no orçamento.
  - Um deck estuda ele mesmo e os subdecks. "Desta obra" fica fora do orçamento.
- **O e-reader recebe a fila pronta** no snapshot:
  - `today.newAllowance`;
  - `queueRank` em cada item e ficha, numerado com os tetos já aplicados;
  - `leechWaiting`;
  - os decks "no leitor".

  Ele só corta no orçamento local e esconde as teimosas. Pedidos de mais novas viram a operação `extraNew`.
- **Teimosas também são do servidor.** Ao gravar a revisão, `apply_leech` compara os lapsos com `user_settings.leech_lapses` e aplica `leech_action`:
  - `wait`: o item ou ficha fica em espera e sai da fila até um encontro novo com frase, ou até "Voltar para a fila".
  - `tag`: só avisa.
  - `suspend`: só volta à mão.
- Vencidas e irmãos ocultos continuam em `buildQueue` (`review.ts`), que a web e o leitor já seguem.

## Consequências

- Todo cliente que mostra uma fila precisa de um sync recente. Offline, o leitor usa a última fila e o orçamento local até o próximo snapshot.
- O snapshot fica mais pesado. Toda página leva o estado da fila (decks e candidatas a nova), e a rota calcula os ranks.
- O delta continua desligado (`mode: "full"`). Com fila calculada no servidor, um delta teria de mandar `queueRank` de linhas que não mudaram.
- `queueRank` pode ter buracos: Produzir e `inverso` entram na ordem, mas não vão para o leitor. O leitor usa o rank só para ordenar.
- Mudar a regra de ordem é um deploy do servidor. Não exige firmware novo.

## Recusada

- **Cada cliente calcula a fila:** três implementações da mesma regra (TS, C++, Stremio) e filas diferentes em cada aparelho.
- **Recusar revisão acima do orçamento:** perderia estudo feito offline, contra o ADR 0001.
- **Só limites por deck, sem o Geral no "Estudar tudo":** com vários decks, a pessoa começaria novas demais por dia. Os limites do deck valem dentro do Geral quando se estuda tudo; clicando num deck, valem sozinhos (como no Anki).
