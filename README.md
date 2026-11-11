<img src="apps/web/static/icon-512.png" width="72" height="72" alt="Linguetta">

# Linguetta

Guarde as palavras que você encontra e revise no dia certo.

O Linguetta junta num banco só o vocabulário que você recolhe do que já assiste, ouve e lê: séries no Stremio, letras de música, e-reader. Cada item vira flashcard revisado com FSRS, em qualquer aparelho. Funciona com qualquer idioma de estudo (tag BCP 47, veja a [ADR 0004](docs/adr/0004-qualquer-idioma.md)).

Produção: https://linguetta-app.vercel.app

## O que tem

- **Início** (`/inicio`): o que tem para revisar hoje e os primeiros passos (guardar à mão com N, conectar o Stremio).
- **Palavras** (`/palavras`): o banco, com encontros, sentidos e filtro por idioma.
- **Flashcards** (`/flashcards`): revisão com FSRS ([ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)). Novos por dia vêm de `user_settings.new_flashcards_per_day`; o "dia" segue `REVIEW_TIME_ZONE` em `apps/web/src/lib/review.ts`.
- **Música** (`/musica`): cole o link do YouTube e complete a letra sincronizada (LRCLIB) enquanto a música toca; as palavras vão para o banco.
- **Integrações** (`/integracoes`) e **Parear** (`/parear`): token para o fork do Stremio e pareamento por QR para aparelhos via `/api/v1/sync`.
- Login com Google ou link mágico; interface em PT ou EN.

O vocabulário do domínio (Item, Encontro, Obra, Flashcard, Ficha...) está em [CONTEXT.md](CONTEXT.md). As decisões ficam em [docs/adr](docs/adr).

## Estrutura

| Pasta | O que é |
|---|---|
| `apps/web` | App SvelteKit (TS) na Vercel. Dados passam pelo servidor (load + form actions) e pela API `/api/v1` |
| `packages/language` | `@linguetta/language`: perfil de idioma, segmentação de palavras e `lemmaKey`, usado pela web e pelo servidor |
| `packages/stremio-server` | Servidor do LingoBlend (legendas misturadas e consulta de palavras no fork do Stremio). Contrato em `docs/CONTRACT.md` |
| `supabase` | Config local, migrations (com RLS) e template do e-mail de login |
| `docs/sync` | Contrato e fixtures do `/api/v1/sync` (e-reader e outros aparelhos) |
| `prototypes` | Protótipos HTML (referência visual; os mais antigos ainda são da fase Linguarudo) |

## Rodar local

Precisa de [bun](https://bun.sh), [Supabase CLI](https://supabase.com/docs/guides/cli) e Docker (ou Podman).

```sh
bun install
supabase start                    # Podman: DOCKER_HOST=unix:///run/user/$UID/podman/podman.sock
cp apps/web/.env.example apps/web/.env
# preencha PUBLIC_SUPABASE_PUBLISHABLE_KEY com o valor de `supabase status`
bun run dev                       # http://localhost:5173
```

O link mágico local chega no Mailpit: http://127.0.0.1:54324.

Fedora/SELinux com Podman: se o e-mail vier com o modelo padrão do Supabase (em inglês), o container não está conseguindo ler `supabase/templates/`. Rode `chcon -R -t container_file_t supabase/templates`.

O Google fica desligado no local; veja o comentário em `supabase/config.toml` para ligar.

Depois de mudar o banco: `supabase db reset` e `bun --filter web gen:types`.

## Testes

```sh
bun run test        # lógica pura (bun test no web, node --test no stremio-server)
bun run check       # svelte-check
bun run lint        # prettier + eslint
bun run test:e2e    # Playwright; precisa do `supabase start` rodando
```

## Produção

Vercel (projeto `linguetta-app`, `adapter-vercel`, região gru1) + Supabase Cloud (sa-east-1). No painel do Supabase:

- Authentication > URL Configuration: Site URL `https://linguetta-app.vercel.app` e `https://linguetta-app.vercel.app/**` nos redirects.
- Authentication > Emails > Magic Link (e Confirm signup): use o HTML de `supabase/templates/magic_link.html`.
- Authentication > Providers > Google: client id e secret do Google Cloud.

Na Vercel, defina `PUBLIC_SUPABASE_URL` e `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. O deploy é `vercel deploy --prod` da raiz; o `.vercelignore` impede que os `.env` subam junto.
