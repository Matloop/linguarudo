// Supertonic 3 (fp32, voz F1) no onnxruntime-node. Inferência portada de
// supertone-inc/supertonic nodejs/helper.js (MIT, Copyright (c) 2025 Supertone Inc.).
// Modelo: OpenRAIL-M; o repositório foi arquivado, então a revisão fica fixa (ADR 0006).

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { InferenceSession, Tensor } from 'onnxruntime-node';

// Cópia de Supertone/supertonic-3 @ 3cadd1ee (Hugging Face) numa release do GitHub: da Vercel
// em gru1 o Hugging Face entrega 1,2 MB/s (5 min para 381 MB); o GitHub, ~50 MB/s.
const RELEASE = 'https://github.com/Matloop/linguetta/releases/download/supertonic-3-fp32';
const REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323';
const FILES = [
	'onnx/duration_predictor.onnx',
	'onnx/text_encoder.onnx',
	'onnx/vector_estimator.onnx',
	'onnx/vocoder.onnx',
	'onnx/tts.json',
	'onnx/unicode_indexer.json',
	'voice_styles/F1.json'
];
// O que o usuário aprovou no teste A/B.
const TOTAL_STEPS = 8;
const SPEED = 1.0;

type Config = {
	ae: { sample_rate: number; base_chunk_size: number };
	ttl: { chunk_compress_factor: number; latent_dim: number };
};
type StyleJson = Record<'style_ttl' | 'style_dp', { dims: number[]; data: unknown[] }>;
type Model = {
	cfg: Config;
	indexer: number[];
	styleTtl: Tensor;
	styleDp: Tensor;
	dp: InferenceSession;
	textEnc: InferenceSession;
	vectorEst: InferenceSession;
	vocoder: InferenceSession;
};

export type Speech = { samples: Float32Array; sampleRate: number };

const exists = (path: string) =>
	access(path).then(
		() => true,
		() => false
	);

/** Baixa um arquivo da release com nome temporário e renomeia no fim: nunca fica meio arquivo. */
async function download(dir: string, file: string): Promise<void> {
	const target = join(dir, file);
	if (await exists(target)) return;
	await mkdir(dirname(target), { recursive: true });
	const response = await fetch(`${RELEASE}/${basename(file)}`);
	if (!response.ok || !response.body) throw new Error(`Modelo ${response.status}: ${file}`);
	const partial = `${target}.${process.pid}.${Date.now()}.part`;
	await writeFile(partial, response.body);
	await rename(partial, target);
}

/** SUPERTONIC_DIR (dev, já baixado) ou o /tmp da função, baixado no primeiro uso. */
async function modelDir(localDir: string): Promise<string> {
	if (localDir) return localDir;
	const dir = join(tmpdir(), `supertonic-3-${REVISION}`);
	await Promise.all(FILES.map((file) => download(dir, file)));
	return dir;
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T;
}

function styleTensor(style: StyleJson[keyof StyleJson]): Tensor {
	return new Tensor(
		'float32',
		Float32Array.from(style.data.flat(Infinity) as number[]),
		style.dims
	);
}

async function loadModel(localDir: string): Promise<Model> {
	const dir = await modelDir(localDir);
	const session = (name: string) => InferenceSession.create(join(dir, 'onnx', `${name}.onnx`));
	const [cfg, indexer, style, dp, textEnc, vectorEst, vocoder] = await Promise.all([
		readJson<Config>(join(dir, 'onnx/tts.json')),
		readJson<number[]>(join(dir, 'onnx/unicode_indexer.json')),
		readJson<StyleJson>(join(dir, 'voice_styles/F1.json')),
		session('duration_predictor'),
		session('text_encoder'),
		session('vector_estimator'),
		session('vocoder')
	]);
	const styleTtl = styleTensor(style.style_ttl);
	const styleDp = styleTensor(style.style_dp);
	return { cfg, indexer, styleTtl, styleDp, dp, textEnc, vectorEst, vocoder };
}

let loading: Promise<Model> | undefined;

/** Um carregamento por instância, dividido pelos pedidos simultâneos; refeito se falhar. */
function model(localDir: string): Promise<Model> {
	loading ??= loadModel(localDir).catch((e: unknown) => {
		loading = undefined;
		throw e;
	});
	return loading;
}

const REPLACEMENTS: [RegExp, string][] = [
	[/[–‑—]/g, '-'],
	[/[_[\]|/#→←]/g, ' '],
	[/[“”]/g, '"'],
	[/[‘’´`]/g, "'"],
	[/[♥☆♡©\\]/g, ''],
	[/@/g, ' at '],
	[/e\.g\.,/g, 'for example, '],
	[/i\.e\.,/g, 'that is, '],
	[/ ([,.!?;:'])/g, '$1'],
	[/"{2,}/g, '"'],
	[/'{2,}/g, "'"],
	[/\s+/g, ' ']
];
const EMOJI =
	/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

/** Texto como o modelo espera: NFKD, símbolos trocados, ponto final e a tag do idioma. */
function preprocess(text: string, lang: string): string {
	let out = text.normalize('NFKD').replace(EMOJI, '');
	for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
	out = out.trim();
	if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(out)) out += '.';
	return `<${lang}>${out}</${lang}>`;
}

/** Ruído normal (Box-Muller) do latente inicial. */
function noise(size: number): Float32Array {
	const out = new Float32Array(size);
	for (let i = 0; i < size; i++) {
		const u1 = Math.max(1e-10, Math.random());
		out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
	}
	return out;
}

async function denoise(m: Model, textEmb: Tensor, textMask: Tensor, seconds: number) {
	const chunk = m.cfg.ae.base_chunk_size * m.cfg.ttl.chunk_compress_factor;
	const latentLen = Math.floor((seconds * m.cfg.ae.sample_rate + chunk - 1) / chunk);
	const shape = [1, m.cfg.ttl.latent_dim * m.cfg.ttl.chunk_compress_factor, latentLen];
	// Um texto só: a máscara do latente é toda 1 e não muda o ruído.
	const latentMask = new Tensor('float32', new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
	const totalStep = new Tensor('float32', Float32Array.of(TOTAL_STEPS), [1]);
	let latent = new Tensor('float32', noise(shape[1] * latentLen), shape);
	for (let step = 0; step < TOTAL_STEPS; step++) {
		const result = await m.vectorEst.run({
			noisy_latent: latent,
			text_emb: textEmb,
			style_ttl: m.styleTtl,
			text_mask: textMask,
			latent_mask: latentMask,
			total_step: totalStep,
			current_step: new Tensor('float32', Float32Array.of(step), [1])
		});
		latent = new Tensor('float32', result.denoised_latent.data as Float32Array, shape);
	}
	return latent;
}

/**
 * Fala uma palavra ou frase curta (até 80 caracteres: cabe num pedaço só, sem dividir).
 * `lang` é a base que o Supertonic fala; `localDir` é o SUPERTONIC_DIR ('' = baixar).
 */
export async function synthesize(text: string, lang: string, localDir: string): Promise<Speech> {
	const m = await model(localDir);
	const ids = Array.from(preprocess(text, lang), (c) => BigInt(m.indexer[c.charCodeAt(0)]));
	const textIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
	const textMask = new Tensor('float32', new Float32Array(ids.length).fill(1), [1, 1, ids.length]);
	const { duration } = await m.dp.run({
		text_ids: textIds,
		style_dp: m.styleDp,
		text_mask: textMask
	});
	const seconds = Number(duration.data[0]) / SPEED;
	const { text_emb } = await m.textEnc.run({
		text_ids: textIds,
		style_ttl: m.styleTtl,
		text_mask: textMask
	});
	const latent = await denoise(m, text_emb, textMask, seconds);
	const { wav_tts } = await m.vocoder.run({ latent });
	const sampleRate = m.cfg.ae.sample_rate;
	const samples = (wav_tts.data as Float32Array).slice(0, Math.floor(sampleRate * seconds));
	return { samples, sampleRate };
}
