# ADR 0002: Anki entra por importação, sem fork

- Status: Accepted
- Date: 2026-11-11

## Decisão

- Os flashcards usam a interface própria do Linguarudo, com o mesmo FSRS do Anki, incluindo as etapas de aprendizado.
- O Linguarudo importa `.apkg`/`.colpkg` com o histórico de revisões e exporta de volta. Só entram notas que forem palavra ou expressão.
- O Linguarudo pode virar servidor de sync dos apps oficiais do Anki mais tarde, como opção.

## Porquê

Os objetivos são uma interface melhor que a do Anki, trazer quem já usa Anki e ter um motor maduro. O FSRS dá o motor. A importação com histórico traz os usuários sem que o cronograma recomece.

## Recusada

- **Fork do Anki desktop/AnkiDroid:** manutenção pesada, sem iOS (o AnkiMobile é fechado) e obriga a pessoa a instalar outro app.
- **Núcleo Rust do Anki (rslib) no servidor:** a infra fica mais complexa para uma paridade que o FSRS já entrega.
