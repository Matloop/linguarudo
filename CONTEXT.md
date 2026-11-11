# Linguetta

O lar do vocabulário do usuário: recolhe itens de tudo que ele lê, assiste e ouve, e faz eles ficarem por revisão em qualquer aparelho.

## Banco

- **Banco**: o conjunto de itens e fichas de um usuário, em todos os decks. _Evite_: baralho, lista.
- **Deck**: grupo de itens e fichas de um idioma de estudo, com ordem de novas e teto próprios. Cada item e cada ficha está em exatamente um deck. Um nível só (Pai › Filho). O padrão de cada idioma, "Minhas palavras", recebe tudo que é capturado. Decks do Anki e CSVs importados viram decks. _Evite_: baralho, coleção, pasta.
- **Item**: palavra ou expressão de um idioma de estudo, identificada pelo lema. Frase inteira, gramática ou conteúdo livre não é item: vira Ficha. _Evite_: palavra (como conceito), termo, vocábulo, nota.
- **Lema**: forma de dicionário que identifica o item ("run", "to figure out"). _Evite_: headword, termo, raiz.
- **Encontro**: uma vez em que o item apareceu ao usuário, com forma, frase, obra, posição e data. _Evite_: contexto, ocorrência, captura.
- **Forma**: a grafia exata vista no encontro ("ran", "running"). _Evite_: surface, flexão.
- **Sentido**: tradução do item naquele encontro, na língua nativa ("bank" = margem ou banco). _Evite_: acepção, significado.
- **Sentido principal**: o sentido que o item mostra quando não há encontro em foco; é o que o flashcard pergunta. _Evite_: tradução, definição.
- **Conhecido**: item que o usuário declarou que já sabe; sai da revisão e das atividades. _Evite_: dominado, aprendido, já sei.
- **Dominado**: item cujos flashcards têm estabilidade alta no FSRS; continua em revisão, só que raramente. _Evite_: conhecido, aprendido.
- **Obra**: livro, episódio, filme ou música de onde vem um encontro. _Evite_: fonte, mídia, conteúdo.

## Usuário

- **Idioma de estudo**: idioma que o usuário aprende (qualquer tag BCP 47); cada item pertence a um. _Evite_: língua alvo, lang.
- **Língua nativa**: língua em que o usuário lê sentidos e traduções. Qualquer idioma. _Evite_: idioma base.
- **Idioma da interface**: idioma dos textos do app (PT ou EN por enquanto), separado da língua nativa.
- **Perfil de idioma**: o que o app sabe de um idioma (escrita, direção, se usa espaços, maiúsculas, elisão, recursos disponíveis). Recurso ausente fica escondido.

## Prática e conexões

- **Flashcard**: uma direção de prática de um item ou de uma ficha, com cronograma FSRS próprio. No item: Reconhecer (lema → sentido) ou Produzir (sentido → lema). Na ficha: frente → verso, o inverso, ou uma lacuna. _Evite_: cartão, card, nota.
- **Ficha**: conteúdo livre de frente e verso (texto, imagem, áudio) que não é item: frase, regra, conjugação, nota não vocabular vinda do Anki. Pertence a um idioma de estudo e gera um ou mais flashcards. É revisada na tela Flashcards e, em versão só texto, no e-reader; fica fora das atividades. _Evite_: cartão livre, nota, flashcard livre.
- **Tag**: rótulo livre num item ou numa ficha, que cruza os decks e serve para filtrar a revisão. Tags do Anki chegam como tags; decks do Anki chegam como decks. _Evite_: baralho, coleção, pasta.
- **Mídia**: imagem ou áudio guardado com o usuário. O item tem no máximo uma imagem e uma pronúncia; a ficha tem mídia em cada lado. _Evite_: anexo, arquivo.
- **Revisão**: uma resposta do usuário a um flashcard (Errei, Difícil, Bom, Fácil), feita em qualquer aparelho. _Evite_: repetição, estudo.
- **Dia de estudo**: o dia que conta para o orçamento de novas, o "vence hoje" e as estatísticas. Vira na hora escolhida pelo usuário (padrão 4 h), no fuso dele. _Evite_: dia, data, 24 h.
- **Irmãos**: os flashcards do mesmo item. Um irmão revisado no dia de estudo deixa o outro para amanhã, exceto em aprendizado. _Evite_: par, gêmeo.
- **Orçamento de novas**: quantos flashcards novos ainda podem começar no dia de estudo, num idioma, somando todos os decks e aparelhos: novas por dia + extras do dia ("+5 hoje") − novas já começadas. Revisões nunca são recusadas pelo orçamento. Quem decide é o servidor (ADR 0005). _Evite_: limite diário, cota.
- **Teimosa**: item ou ficha com um flashcard errado várias vezes depois de aprendido (8 por padrão, configurável). O que acontece depende da configuração: entra em espera (padrão), só ganha uma marca, ou é suspensa. _Evite_: sanguessuga, leech, difícil.
- **Teimosa em espera**: teimosa que saiu da fila até o usuário ter um encontro novo com frase, ou até tocar em "Voltar para a fila". A frase nova aparece no cartão quando ela volta. _Evite_: suspensa, pausada.
- **Atividade**: prática dentro do app que lê e escreve no banco (música, blend). _Evite_: módulo, jogo, modo.
- **Blend**: atividade que devolve uma obra na língua nativa com itens do banco trocados para o idioma de estudo. _Evite_: mistura, leitura misturada, LingoBlend (é o nome do fork do Stremio).
- **Integração**: aparelho ou serviço externo ligado à conta que lê e escreve no banco (Stremio, CrossNext, Anki). _Evite_: plugin, conector, extensão.

## Relações

- **Item** → **Encontro**: um item tem zero ou mais encontros; vários sentidos convivem num só item.
- **Item** → **Flashcard**: todo item tem um flashcard Reconhecer; o Produzir liga depois que o reconhecer vai bem (ou já chega do Anki como card inverso).
- **Ficha** → **Flashcard**: uma ficha gera frente → verso, mais o inverso se marcado; um cloze gera um por lacuna.
- **Item**/**Ficha** → **Deck**: exatamente um deck do mesmo idioma; os flashcards seguem o deck do item ou da ficha.
- **Item**/**Ficha** → **Tag**: zero ou mais tags.
- **Encontro** → **Obra**: todo encontro vem de uma obra, ou de "à mão".
- **Forma** → **Lema**: ao salvar, o app sugere o lema da forma vista e o usuário confirma.
- **Revisão** → **Flashcard**: o cronograma do flashcard é recalculado no servidor a partir de todas as revisões, de todos os aparelhos.
- **Atividade** e **Integração**: as duas são clientes do banco e falam com ele do mesmo jeito.
