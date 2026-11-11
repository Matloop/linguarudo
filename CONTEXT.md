# Linguarudo

O lar do vocabulário do usuário: recolhe itens de tudo que ele lê, assiste e ouve, e faz eles ficarem por revisão em qualquer aparelho.

## Banco

- **Banco**: o conjunto de itens de um usuário. _Evite_: baralho, deck, lista.
- **Item**: palavra ou expressão de um idioma de estudo, identificada pelo lema. Frase inteira, gramática ou cartão livre não é item. _Evite_: palavra (como conceito), termo, vocábulo, nota.
- **Lema**: forma de dicionário que identifica o item ("run", "to figure out"). _Evite_: headword, termo, raiz.
- **Encontro**: uma vez em que o item apareceu ao usuário, com forma, frase, obra, posição e data. _Evite_: contexto, ocorrência, captura.
- **Forma**: a grafia exata vista no encontro ("ran", "running"). _Evite_: surface, flexão.
- **Sentido**: tradução do item naquele encontro, na língua nativa ("bank" = margem ou banco). _Evite_: acepção, significado.
- **Sentido principal**: o sentido que o item mostra quando não há encontro em foco; é o que o cartão pergunta. _Evite_: tradução, definição.
- **Conhecido**: item que o usuário declarou que já sabe; sai da revisão e das atividades. _Evite_: dominado, aprendido, já sei.
- **Dominado**: item cujos cartões têm estabilidade alta no FSRS; continua em revisão, só que raramente. _Evite_: conhecido, aprendido.
- **Obra**: livro, episódio, filme ou música de onde vem um encontro. _Evite_: fonte, mídia, conteúdo.

## Usuário

- **Idioma de estudo**: idioma que o usuário aprende; cada item pertence a um. _Evite_: língua alvo, lang.
- **Língua nativa**: língua em que o usuário lê traduções e a interface. _Evite_: idioma base.

## Prática e conexões

- **Cartão**: uma direção de prática de um item, com cronograma próprio: Reconhecer (lema → sentido) ou Produzir (sentido → lema). _Evite_: card, flashcard, nota.
- **Revisão**: uma resposta do usuário a um cartão (Errei, Difícil, Bom, Fácil), feita em qualquer aparelho. _Evite_: repetição, estudo.
- **Atividade**: prática dentro do app que lê e escreve no banco (música, blend). _Evite_: módulo, jogo, modo.
- **Blend**: atividade que devolve uma obra na língua nativa com itens do banco trocados para o idioma de estudo. _Evite_: mistura, leitura misturada, LingoBlend (é o nome do fork do Stremio).
- **Integração**: aparelho ou serviço externo ligado à conta que lê e escreve no banco (Stremio, CrossNext, Anki). _Evite_: plugin, conector, extensão.

## Relações

- **Item** → **Encontro**: um item tem zero ou mais encontros; vários sentidos convivem num só item.
- **Item** → **Cartão**: todo item tem um cartão Reconhecer; o Produzir liga depois que o reconhecer vai bem.
- **Encontro** → **Obra**: todo encontro vem de uma obra, ou de "à mão".
- **Forma** → **Lema**: ao salvar, o app sugere o lema da forma vista e o usuário confirma.
- **Revisão** → **Cartão**: o cronograma do cartão é recalculado no servidor a partir de todas as revisões, de todos os aparelhos.
- **Atividade** e **Integração**: as duas são clientes do banco e falam com ele do mesmo jeito.
