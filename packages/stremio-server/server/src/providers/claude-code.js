// Provider que usa o Claude Code em modo headless (`claude -p`), ou seja, a assinatura
// Claude (Pro/Max) logada no Claude Code em vez de uma ANTHROPIC_API_KEY.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  LOOKUP_SCHEMA,
  OUTPUT_SCHEMA,
  ProviderError,
  TRANSLATE_SCHEMA,
  TRANSLATE_SYSTEM,
  buildLookupMessage,
  buildTranslateMessage,
  buildUserMessage,
  annotateSystem,
  groupByCue,
  lookupSystem,
  retryMalformed,
} from './claude.js';

export const DEFAULT_CLI_MODEL = 'haiku';
const TIMEOUT_MS = 180_000;

// Variáveis que fariam o CLI usar outra credencial/endpoint em vez do login da assinatura
// (ou se achar dentro de outra sessão do Claude Code).
function cleanEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) {
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN' || k === 'ANTHROPIC_BASE_URL' || k.startsWith('CLAUDE_CODE_')) {
      delete out[k];
    }
  }
  return out;
}

/** Roda o CLI e devolve o stdout. Injetável nos testes. */
export function runCli(bin, args, input, { env = process.env, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: tmpdir(), env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ProviderError(err.code === 'ENOENT' ? `Claude Code: comando "${bin}" não encontrado` : `Claude Code: ${err.message}`, { cause: err }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new ProviderError(`Claude Code: interrompido (${signal}), passou de ${timeout / 1000}s?`));
      // Com --output-format json o CLI escreve o resultado mesmo quando sai com código ≠ 0.
      if (stdout.trim()) return resolve(stdout);
      reject(new ProviderError(`Claude Code: saiu com código ${code}: ${stderr.trim().slice(0, 300)}`));
    });
    child.stdin.end(input);
  });
}

function parseResult(stdout, valid = (d) => Array.isArray(d?.annotations)) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch (cause) {
    throw Object.assign(new ProviderError('Claude Code: saída não é JSON', { cause }), { retryable: true });
  }
  if (out.is_error) {
    const status = out.api_error_status;
    const hint = status === 401 ? ' (rode `claude` e faça login com sua conta Claude)' : '';
    throw new ProviderError(`Claude Code: ${String(out.result ?? 'erro').slice(0, 300)}${hint}`);
  }
  let data = out.structured_output;
  if (data == null) {
    try {
      data = JSON.parse(out.result);
    } catch (cause) {
      throw Object.assign(new ProviderError('Claude Code: resposta sem JSON estruturado', { cause }), { retryable: true });
    }
  }
  if (!valid(data)) {
    throw Object.assign(new ProviderError('Claude Code: resposta fora do formato'), { retryable: true });
  }
  return data;
}

function buildArgs(model, system, schema) {
  return [
    '-p',
    '--model', model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--system-prompt', system,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];
}

const isObj = (d) => d && typeof d === 'object' && !Array.isArray(d);

/** options: { model, bin, run } (run é injetável para testes) */
export function createClaudeCodeProvider({ model = DEFAULT_CLI_MODEL, bin = 'claude', run = runCli } = {}) {
  // O prompt de sistema depende dos idiomas do pedido (ADR 0004); a tradução usa um fixo.
  const translateArgs = buildArgs(model, TRANSLATE_SYSTEM, TRANSLATE_SCHEMA);

  return {
    name: 'claude-code',
    model,
    async annotate(req) {
      const annotateArgs = buildArgs(model, annotateSystem(req), OUTPUT_SCHEMA);
      const data = await retryMalformed(async () => parseResult(await run(bin, annotateArgs, buildUserMessage(req))));
      return groupByCue(data.annotations, req.texts.length);
    },
    async lookup(req) {
      const lookupArgs = buildArgs(model, lookupSystem(req), LOOKUP_SCHEMA);
      return retryMalformed(async () => parseResult(await run(bin, lookupArgs, buildLookupMessage(req)), isObj));
    },
    async translate(req) {
      const data = await retryMalformed(async () => parseResult(await run(bin, translateArgs, buildTranslateMessage(req)), isObj));
      return String(data.translation ?? '');
    },
  };
}
