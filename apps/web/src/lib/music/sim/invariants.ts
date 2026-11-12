// Regras que valem em qualquer passo do jogo, conferidas pelos testes de propriedade
// (sequências aleatórias de ações e manias do player). Cada regra tem um nome curto
// para o erro dizer qual quebrou.

import type { Effect } from '../controller.ts';
import type { Session } from '../session.ts';
import { MAX_ANCHORS, RATE_MAX, RATE_MIN } from '../timeline.ts';
import type { Step } from './simulator.ts';

const VIDEO: ReadonlySet<Effect['type']> = new Set(['play', 'pause', 'seek', 'rate']);

export function checkStep(step: Step, session: Session): string[] {
	const out: string[] = [];
	const { event, effects, before, after } = step;
	const v = after.view;
	const fail = (name: string, detail = '') =>
		out.push(
			`${name}${detail ? `: ${detail}` : ''} (em ${step.at} ms, ${event?.type ?? 'quadro'})`
		);
	const videoEffects = effects.filter((e) => VIDEO.has(e.type));

	// I1: abrir/fechar a sincronia não mexe no vídeo.
	if ((event?.type === 'openSync' || event?.type === 'closeSync') && videoEffects.length > 0)
		fail('sincronia-mexeu-no-video', JSON.stringify(videoEffects));

	// I2: lacuna aberta nunca aparece em texto visível.
	const answered = new Set(v.results.map((r) => r.gap));
	const openTokens = (line: number) =>
		new Set(session.gaps.filter((g, i) => g.line === line && !answered.has(i)).map((g) => g.token));
	for (const line of v.lines) {
		const open = new Set(line.gaps.filter((g) => !g.result).map((g) => g.token));
		const shown = new Set(line.parts.flatMap((p) => (p.kind === 'gap' ? [p.token] : [])));
		for (const t of shown) if (!open.has(t)) fail('lacuna-fantasma', `linha ${line.index}`);
		for (const t of open) if (!shown.has(t)) fail('lacuna-aberta-a-mostra', `linha ${line.index}`);
	}
	if (v.card) {
		for (const t of openTokens(v.card.line))
			if (v.card.tokens[t]?.key !== null) fail('cartao-mostra-lacuna', `linha ${v.card.line}`);
	}
	if (v.gameOver && !v.gameOver.revealed) {
		const open = openTokens(v.gameOver.line);
		if (v.gameOver.parts.some((p) => p.kind === 'word' && open.has(p.token)))
			fail('fim-de-jogo-mostra-lacuna');
	}

	// I3: a linha escolhida só muda por toque ou ↑/↓.
	if (before.view.sync && v.sync && before.view.sync.selected !== v.sync.selected) {
		if (event?.type !== 'selectLine' && event?.type !== 'moveSelection')
			fail('linha-escolhida-mudou-sozinha', `${before.view.sync.selected} → ${v.sync.selected}`);
	}

	// I4: uma linha acesa só, e presente no vídeo.
	if (v.shownLine >= 0 && v.lines.length > 0 && !v.lines[v.shownLine]?.present)
		fail('linha-acesa-cortada', `linha ${v.shownLine}`);

	// I5: âncoras em ordem de linha e de vídeo.
	const anchors = after.timeline.anchors;
	for (let i = 1; i < anchors.length; i++) {
		if (anchors[i].line <= anchors[i - 1].line || anchors[i].video <= anchors[i - 1].video)
			fail('ancoras-fora-de-ordem', JSON.stringify(anchors));
	}

	// I6: âncora automática nunca derruba manual.
	if (event?.type === 'autoAnchor') {
		for (const a of before.timeline.anchors.filter((x) => x.source === 'manual')) {
			if (!anchors.some((b) => b.line === a.line && b.video === a.video && b.source === 'manual'))
				fail('auto-derrubou-manual', `linha ${a.line}`);
		}
		if (videoEffects.length > 0) fail('auto-mexeu-no-video');
	}

	// I7: linha cortada não tem lacuna para responder.
	if (v.answerable && !v.lines[v.answerable.line]?.present) fail('lacuna-em-linha-cortada');

	// I8: enquanto sincroniza, pontos e respostas não mudam.
	if (before.view.mode === 'sync' && v.mode === 'sync') {
		if (before.view.score !== v.score || before.view.results.length !== v.results.length)
			fail('jogo-andou-na-sincronia');
		if (v.answerable) fail('lacuna-respondivel-na-sincronia');
	}

	// I9: na sincronia, só os controles do painel (e sair da aba) mexem no vídeo.
	if (before.view.mode === 'sync' && videoEffects.length > 0) {
		const allowed = ['syncTogglePlay', 'syncBack', 'syncRestart', 'hidden'];
		if (!event || !allowed.includes(event.type)) fail('video-mexeu-sozinho-na-sincronia');
	}

	// I10: uma resposta por lacuna.
	const gaps = v.results.map((r) => r.gap);
	if (new Set(gaps).size !== gaps.length) fail('resposta-repetida');

	// I11: pontos só sobem (fora recomeçar).
	const restart =
		event?.type === 'retry' || event?.type === 'backToStart' || event?.type === 'start';
	if (!restart && v.score < before.view.score) fail('pontos-cairam');

	// I12: lacuna respondível só jogando.
	if (v.answerable && (v.mode !== 'game' || (v.phase !== 'playing' && v.phase !== 'waiting')))
		fail('lacuna-respondivel-fora-do-jogo', `${v.mode}/${v.phase}`);

	// I13: seek nunca para tempo negativo.
	for (const e of effects) if (e.type === 'seek' && !(e.to >= 0)) fail('seek-negativo');

	// I14: limites da sincronia.
	if (anchors.length > MAX_ANCHORS) fail('ancoras-demais');
	if (after.timeline.rate < RATE_MIN || after.timeline.rate > RATE_MAX) fail('velocidade-fora');

	// I15: linha escolhida existe.
	if (v.sync && (v.sync.selected < 0 || v.sync.selected >= Math.max(1, v.lines.length)))
		fail('linha-escolhida-fora');

	// I16: cartão só no jogo.
	if (v.card && v.mode !== 'game') fail('cartao-fora-do-jogo');

	// I17: respostas não passam do total de lacunas.
	if (v.results.length > v.totalGaps) fail('respostas-alem-do-total');

	// I18: o fim de jogo só revela a resposta ao sair.
	if (v.gameOver?.revealed && !before.view.gameOver?.revealed && event?.type !== 'leave')
		fail('fim-de-jogo-revelou-sozinho');

	// I19: puladas não vão para revisar.
	if (v.wrong.some((r) => r.skipped)) fail('pulada-para-revisar');

	return out;
}

export function checkAll(steps: readonly Step[], session: Session): string[] {
	return steps.flatMap((s) => checkStep(s, session));
}
