# ADR 0001: O servidor decide o FSRS pelo log de revisões

- Status: Accepted
- Date: 2026-11-11

## Decisão

- Atividades e integrações (Stremio, CrossNext, Anki, app) enviam revisões: cartão, nota de 1 a 4 e momento. Elas nunca enviam o estado do cartão.
- O servidor reaplica todas as revisões em ordem de momento e guarda o cronograma. O cronograma que um aparelho calcula offline vale só até o próximo sync.
- Quando um item é apagado, a exclusão vence: as revisões que chegarem atrasadas para ele são descartadas.

## Porquê

O usuário revisa offline em vários aparelhos. Se o estado mais recente vencesse, revisões se perderiam. Com o log, as revisões dos dois lados contam.

## Recusada

- **O estado mais recente vence:** perde revisões feitas offline em paralelo.
- **Cada aparelho com cronograma próprio:** o mesmo item ficaria com vencimentos diferentes em cada lugar.
