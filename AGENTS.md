# AGENTS.md

Regras para quem (pessoa ou agente) mexe neste repositório. Vocabulário do domínio: `CONTEXT.md`. Decisões: `docs/adr/`. Specs e notas de trabalho: `docs/agents/`.

## Geral

- Prefira o padrão que já existe no código antes de inventar outro.
- Textos da interface em português do Brasil.
- Ninguém usa o app ainda: não mantenha código legado, campo antigo ou fallback "por compatibilidade". Ao trocar algo, remova o antigo.

## Interface (apps/web)

- **Nunca use `<select>` nativo.** Use `apps/web/src/lib/ui/Select.svelte`:
  - `variant="field"` (padrão) dentro de formulários; `variant="inline"` com `prefix` em barras de ferramentas ("Ordem: Mais recentes").
  - `name` gera um `<input hidden>` para o `<form>`; `onchange(value)` recebe o valor já escolhido.
  - Com poucas opções fixas e sempre visíveis, um controle segmentado também serve.
- Popovers e menus: `lib/ui/Popover.svelte`. Ícones: `lib/ui/Icon.svelte`.
- Cores, raios e sombras só pelas variáveis de `lib/styles/tokens.css` (o tema escuro vem de `.tema-escuro`).
- Criar e editar a mesma coisa usa o mesmo componente de formulário (ex.: palavra usa os campos de `lib/ui/word/`).

## Verificação

Em `apps/web`:

- `bun run check`: svelte-check sem erros.
- `bun test src`: testes de unidade.
- `bun run test:e2e`: Playwright (precisa do Supabase local).

Migrações novas vão em `supabase/migrations/`. Aplique só no Supabase local; produção só com o OK do dono.
