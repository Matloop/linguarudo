import { execFileSync } from 'node:child_process';
import { createMockProvider } from './providers/mock.js';
import { createClaudeProvider, DEFAULT_EFFORT, DEFAULT_MODEL } from './providers/claude.js';
import { createClaudeCodeProvider, DEFAULT_CLI_MODEL } from './providers/claude-code.js';
import { createOpusMtTranslator, DEFAULT_MT_THREADS } from './mt/opus-mt.js';
import { openDictionaries } from './dict/wiktionary.js';

const PROVIDERS = ['claude', 'claude-code', 'mock'];

function hasClaudeCli(bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ordem quando LINGOBLEND_PROVIDER não está definido:
 *   ANTHROPIC_API_KEY → claude (API);  Claude Code instalado → claude-code (assinatura);  senão → mock.
 * opts.claudeCli: força a detecção do CLI (testes).
 */
export function selectProvider(env = process.env, { claudeCli } = {}) {
  const forced = (env.LINGOBLEND_PROVIDER ?? '').trim().toLowerCase();
  if (forced && !PROVIDERS.includes(forced)) {
    throw new Error(`LINGOBLEND_PROVIDER inválido: "${forced}" (use ${PROVIDERS.map((p) => `"${p}"`).join(', ')})`);
  }
  const bin = env.LINGOBLEND_CLAUDE_BIN || 'claude';
  const kind =
    forced ||
    (env.ANTHROPIC_API_KEY ? 'claude' : (claudeCli ?? hasClaudeCli(bin)) ? 'claude-code' : 'mock');

  if (kind === 'mock') return createMockProvider();
  if (kind === 'claude-code') return createClaudeCodeProvider({ model: env.LINGOBLEND_MODEL || DEFAULT_CLI_MODEL, bin });
  return createClaudeProvider({
    model: env.LINGOBLEND_MODEL || DEFAULT_MODEL,
    effort: env.LINGOBLEND_EFFORT ?? DEFAULT_EFFORT,
  });
}

/**
 * Tradutor local (OPUS-MT em ONNX). LINGOBLEND_MT_DIR: pasta raiz dos modelos, um por subpasta
 * (padrão: defaultDir); LINGOBLEND_MT_THREADS: threads do onnxruntime por fala (padrão 4). Sem
 * modelo instalado o tradutor volta com available: false e o servidor sobe do mesmo jeito.
 */
export function selectTranslator(env = process.env, { defaultDir, log = console } = {}) {
  const raw = (env.LINGOBLEND_MT_THREADS ?? '').trim();
  const threads = raw ? Number(raw) : DEFAULT_MT_THREADS;
  if (!Number.isInteger(threads) || threads < 1) throw new Error(`LINGOBLEND_MT_THREADS inválido: "${raw}" (use um inteiro ≥ 1)`);
  return createOpusMtTranslator({ root: env.LINGOBLEND_MT_DIR || defaultDir, threads, log });
}

/**
 * Dicionários locais do cartão de palavra (Wiktionary). LINGOBLEND_DICT_DIR: pasta dos
 * <idioma>.sqlite (padrão: defaultDir). Pasta vazia ou ausente: nenhum dicionário, o servidor sobe igual.
 */
export function selectDictionaries(env = process.env, { defaultDir, log = console } = {}) {
  return openDictionaries({ dir: env.LINGOBLEND_DICT_DIR || defaultDir, log });
}
