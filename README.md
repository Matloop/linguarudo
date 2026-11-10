<img src="prototypes/lg-icone.png" width="64" height="64" alt="">

# Linguarudo

App para aprender inglês e italiano a partir do que você já consome: séries (via Stremio), músicas e aulas curtas. O núcleo é o banco de palavras de cada usuário.

Esta primeira fatia tem login (Google ou link mágico) e **Minhas palavras**: listar, adicionar, filtrar EN/IT e apagar.

## Estrutura

| Pasta | O que é |
|---|---|
| `apps/web` | App SvelteKit 3 (TS), hospedado na Vercel. Dados passam pelo servidor (load + form actions) |
| `supabase` | Config local, migrations (tabela `words` com RLS) e template do e-mail de login |
| `packages/stremio-server` | Servidor LingoBlend (legendas misturadas no Stremio), trazido do projeto original |
| `prototypes` | Protótipos HTML e arte da marca (referência visual) |

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

Vercel (`adapter-vercel`) + Supabase Cloud. No painel do Supabase:

- Authentication > URL Configuration: Site URL com o domínio da Vercel e `https://<domínio>/**` nos redirects.
- Authentication > Emails > Magic Link (e Confirm signup): use o HTML de `supabase/templates/magic_link.html`.
- Authentication > Providers > Google: client id e secret do Google Cloud.

Na Vercel, defina `PUBLIC_SUPABASE_URL` e `PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
