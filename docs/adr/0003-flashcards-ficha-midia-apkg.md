# ADR 0003: Flashcards, Ficha, mídia e import completo do .apkg

- Status: Accepted
- Date: 2026-11-11
- Amplia: [ADR 0002](0002-anki-sem-fork.md), que importava só vocabulário.

## Decisão

- **Flashcard** substitui Cartão como termo de domínio em todo lugar: CONTEXT, interface (`/revisar` → `/flashcards`), tabela `cards` → `flashcards`, tipos, API v1, sync e o fork do Stremio (CONTRACT). Sem usuários, resetar o prod é aceitável.
- **Ficha** é um conteúdo novo para o que não é item.
  - Tem frente e verso com texto simples (negrito e itálico), imagem e áudio.
  - Gera um flashcard, ou dois quando o inverso está marcado. Um cloze do Anki gera um por lacuna.
  - Tem idioma de estudo obrigatório.
  - Só é revisada na tela Flashcards da web. Fica fora das atividades, do e-reader e do export para o Anki.
- **Tags** valem para itens e fichas. Decks e tags do Anki viram tags. A revisão pode ser filtrada por tag.
- **Mídia**
  - O item tem no máximo uma imagem e um áudio de pronúncia. A ficha tem mídia em cada lado.
  - A mídia chega por upload manual ou pelo apkg. Não há TTS nem gravação nesta etapa.
  - No navegador, a imagem vira WebP de até 1024 px e o áudio pode ter até 1 MB.
  - Cada usuário tem 200 MB. Acima disso, o import segue sem mídia e avisa.
  - Os arquivos ficam num bucket privado do Supabase Storage, com URL assinada.
- **Revisão com mídia**
  - Reconhecer: lema e botão de áudio na frente, imagem no verso.
  - Produzir: imagem e sentido na frente, áudio ao revelar.
  - O áudio só toca sozinho se a opção estiver ligada no perfil.
- **Import do .apkg/.colpkg no navegador**
  - O navegador lê o pacote com sql.js. A mídia vai direto para o Storage e os dados vão em lotes pequenos para a API.
  - Para cada tipo de nota, o usuário escolhe Vocabulário (indicando os campos de lema, sentido, frase, imagem e áudio), Ficha ou Não importar. O app sugere uma escolha.
  - Na Ficha, o template do Anki é aplicado uma vez, no import, e o resultado é guardado como HTML sanitizado.
  - O revlog entra para itens e fichas.
  - **Lema que já existe:** o item é mesclado.
    - O que estiver vazio no item é preenchido.
    - Se a nota tiver frase, ela vira um encontro com origem `anki`.
    - O histórico do Anki só entra se o flashcard local nunca foi revisado.
  - **Card inverso:** a nota que tem card inverso no Anki ganha o Produzir na hora, com o histórico dele.
  - Reimportar é idempotente pelo GUID da nota.
  - Card suspenso vira conhecido. Card enterrado entra normal.
- **Ordem:** (1) rename, Ficha e tags; (2) mídia; (3) import. A fatia 1 começa depois que o `/v1/sync` e o modo língua-alvo estiverem commitados, e o rename cobre os dois.

## Porquê

Decks reais do Anki misturam vocabulário com frases, gramática, cloze e imagem com resposta. Importar só vocabulário deixaria de fora boa parte do que a pessoa estuda e afastaria quem vem do Anki. A Ficha recebe esse conteúdo sem sujar o banco de itens, que continua sendo o lugar das palavras e expressões.

O import roda no navegador porque a Vercel Hobby limita a requisição a 4,5 MB e um deck com mídia passa fácil de 100 MB. Já a cota existe porque o Supabase free tem 1 GB de Storage para o projeto todo.

## Recusadas

- **Tudo vira Item:** o banco ficaria sujo com frases e regras no lugar do lema.
- **Guardar campos e templates do Anki e renderizar a cada exibição:** seria fiel ao Anki e exportável sem perda, mas exigiria um motor de templates do Anki.
- **Processar o .apkg numa Edge Function:** esbarra nos limites de tempo e memória e dá mais infra para manter.
