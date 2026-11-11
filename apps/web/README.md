# web

App SvelteKit do Linguetta. Instruções de uso no [README da raiz](../../README.md).

- `src/lib/words.ts`, `src/lib/auth.ts`: regras puras (testes em `*.test.ts`, `bun test src`)
- `src/hooks.server.ts`: cliente Supabase por request e proteção de `/palavras`
- `src/routes/*/**.e2e.ts`: Playwright (`bun run test:e2e`)
