// Provider que usa o Claude Code em modo headless (`claude -p`), ou seja, a assinatura
// Claude (Pro/Max) logada no Claude Code em vez de uma ANTHROPIC_API_KEY.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { OUTPUT_SCHEMA, ProviderError, SYSTEM, buildUserMessage, groupByCue } from './claude.js';

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

function parseResult(stdout) {
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
  if (!Array.isArray(data?.annotations)) {
    throw Object.assign(new ProviderError('Claude Code: resposta sem "annotations"'), { retryable: true });
  }
  return data.annotations;
}

/** options: { model, bin, run } (run é injetável para testes) */
export function createClaudeCodeProvider({ model = DEFAULT_CLI_MODEL, bin = 'claude', run = runCli } = {}) {
  const args = [
    '-p',
    '--model', model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(OUTPUT_SCHEMA),
    '--system-prompt', SYSTEM,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];

  async function callOnce(req) {
    return parseResult(await run(bin, args, buildUserMessage(req)));
  }

  return {
    name: 'claude-code',
    model,
    async annotate(req) {
      let raw;
      try {
        raw = await callOnce(req);
      } catch (err) {
        if (!err?.retryable) throw err;
        raw = await callOnce(req);
      }
      return groupByCue(raw, req.texts.length);
    },
  };
}
