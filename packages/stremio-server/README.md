<img src="assets/icon.svg" width="64" height="64" alt="">

# stremio lingo blend

Fork do Stremio para aprender línguas: a legenda fica em português e cerca de 10% das palavras aparecem em italiano (ou outra língua), sublinhadas. Clicar na palavra pausa o vídeo e mostra o significado.

| Pasta | O que é |
|---|---|
| `stremio-video/` | Fork [Matloop/stremio-video](https://github.com/Matloop/stremio-video), branch `lingoblend` |
| `stremio-web/` | Fork [Matloop/stremio-web](https://github.com/Matloop/stremio-web), branch `lingoblend` |
| `server/` | Servidor local que escolhe e traduz as palavras (Claude ou dicionário mock) |
| `docs/CONTRACT.md` | Contrato entre as três partes |
| `design/mockup.html` | Mockup da interface |

## Rodar

```sh
# tudo de uma vez, abrindo o app Stremio desktop (flatpak) com a UI do fork:
./start.sh
# traduções: Claude Code logado (assinatura, Haiku) → padrão; ANTHROPIC_API_KEY → API; LINGOBLEND_PROVIDER=mock → offline

# ou manualmente:
# 1. servidor
cd server && bun install && bun run start

# 2. web (em outro terminal)
cd stremio-video && pnpm install
cd ../stremio-web && pnpm install && pnpm start   # http://localhost:8080
```

Escolha uma legenda em português de um addon (ex: OpenSubtitles). Legendas embutidas no vídeo e ASS estilizado não são anotadas.

## Banco do Linguetta

1. No app, abra **Integrações** e gere um token.
2. No player, abra o menu do botão da língua (IT/EN). Cole o token. Se o app não for o de produção, troque a URL (ex.: `http://localhost:5173`).
3. As palavras salvas vão para **Minhas palavras** (lema, linha da legenda, título e minuto). As que você está aprendendo ou com revisão vencida aparecem primeiro na legenda.

Detalhes em `docs/CONTRACT.md`, seção 5.
