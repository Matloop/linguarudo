# ADR 0006: Áudio da palavra gerado no servidor

- Status: Accepted
- Date: 2026-11-12
- Substitui em parte: [ADR 0003](0003-flashcards-ficha-midia-apkg.md), na frase "Não há TTS nem gravação nesta etapa"; [ADR 0004](0004-qualquer-idioma.md), na regra de que a voz aparece só se o navegador tiver voz do idioma.

## Decisão

- O botão "Ouvir" toca `GET /audio?lang=<tag>&text=<palavra>`. A rota pede sessão e responde com redirect 302 para um arquivo público.
- O texto tem até 80 caracteres. A chave é `<base do idioma>/<sha256 do texto em NFC, sem espaço nas pontas e em minúsculas>`.
- Os arquivos ficam no bucket público `audio` do Supabase Storage. O mesmo texto é um arquivo só para todos os usuários. O arquivo não muda depois de criado.
- A ordem das fontes:
  1. O arquivo que já está no bucket.
  2. A gravação humana do Lingua Libre no Wikimedia Commons, achada pelo título exato do arquivo. O servidor guarda o MP3 transcodificado.
  3. O Supertonic 3 fp32, voz F1, 8 passos, velocidade 1.0. O servidor guarda um WAV PCM 16 bits mono (cerca de 130 KB por palavra).
- O Supertonic fala 31 idiomas. Fora deles a rota responde 404.
- O servidor envia o arquivo com o cliente do usuário logado. Não há service key. Quem está logado pode inserir no bucket, mas não pode trocar nem apagar.
- O modelo roda no onnxruntime-node, numa função própria da Vercel (2 GB, 60 s). O primeiro uso de cada instância baixa 380 MB do Hugging Face para o `/tmp`.
- O modelo tem licença OpenRAIL-M. O repositório no Hugging Face foi arquivado em 2026-09-09, então a revisão fica fixa no código.

## Porquê

O Brave, o Chromium e o Electron no Linux não têm nenhuma voz no `speechSynthesis`. Lá o "Ouvir" ficava mudo.

O usuário ouviu um teste A/B e escolheu o Supertonic 3 fp32. A gravação humana vem antes porque soa melhor quando existe.

O cache no bucket faz cada palavra ser gerada uma vez só. O CPU e o tempo de geração ficam no primeiro pedido.

## Recusadas

- **Web Speech:** não tem voz no Chromium do Linux.
- **Supertonic INT8:** o usuário achou a qualidade pior. No CPU também é mais lento (1,9 s contra 1,1 s por palavra).
- **Piper:** o motor é GPL e falhou na palavra curta "gli" (0,09 s de áudio).
- **Google Cloud TTS:** exige conta de cobrança.
- **Supabase Edge Functions:** o limite é 256 MB de RAM, 2 s de CPU e 20 MB de bundle. O modelo não cabe.
- **Modelo no Supabase Storage:** ocuparia 380 MB do 1 GB do plano gratuito.
