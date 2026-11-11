<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { languageInline } from '#lib/languages.ts';
	import { estimateMinutes, formatAgo, formatToday } from '#lib/review.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import LanguagePicker from '#lib/ui/LanguagePicker.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import { openSave } from '#lib/ui/app-state.svelte.ts';
	import { ORIGIN_ICONS } from '#lib/ui/origins.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const now = $derived(new Date(data.now));
	const T = {
		pickTitle: 'Qual idioma você estuda?',
		pickText:
			'Escolha o primeiro. Cada idioma tem as próprias palavras e revisões; dá para adicionar outros depois.'
	} as const;

	const uiLanguage = $derived(data.shell?.uiLanguage ?? 'pt');
	const timeZone = $derived(data.shell?.clock.timeZone);
	const language = $derived(data.shell?.active ?? null);
	const langName = $derived(language ? languageInline(language, uiLanguage) : '');
	const summary = $derived(
		data.shell?.summary?.languages.find((l) => l.language === language) ?? null
	);
	const toReview = $derived(summary?.toReview ?? 0);
	const empty = $derived(summary?.items === 0);
	const minutes = $derived(estimateMinutes(toReview));
	const fresh = $derived(Math.min(toReview, summary?.fresh ?? 0));

	function onSave(e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		openSave();
	}

	const words = (n: number) => (n === 1 ? 'palavra' : 'palavras');
	const sub = $derived.by(() => {
		const time = minutes <= 1 ? 'Leva um minuto.' : `Leva uns ${minutes} minutos.`;
		if (fresh === 0) return time;
		if (fresh === toReview) return `${time} São todas novas, para conhecer.`;
		return `${time} ${fresh} ${fresh === 1 ? 'é nova' : 'são novas'}, o resto já está na memória.`;
	});
</script>

<svelte:head>
	<title>Início · Linguetta</title>
</svelte:head>

{#if data.needsLanguage || !language}
	<div class="empty welcome pick-first">
		<div>
			<Mark class="mark mark-hero" />
			<h1>{T.pickTitle}</h1>
			<p>{T.pickText}</p>
			<div class="picker-box" data-testid="escolher-idioma">
				<LanguagePicker
					id="primeiro-idioma"
					action="/perfil?/adicionarIdioma"
					name="idioma"
					ui={uiLanguage}
					exclude={data.shell?.nativeLanguage ? [data.shell.nativeLanguage] : []}
					hidden={{ voltar: '/inicio' }}
					submit={() =>
						async ({ result, update }) => {
							if (result.type === 'redirect' || result.type === 'success') await invalidateAll();
							else await update();
						}}
				/>
			</div>
		</div>
	</div>
{:else if empty}
	<div class="empty welcome">
		<div>
			<Mark class="mark mark-hero" />
			<h1>Boas-vindas ao {langName}</h1>
			<p>
				Guarde a primeira palavra que te chamar atenção. Ela volta para a revisão na hora certa.
			</p>
			<div class="acts">
				<a class="btn btn-primary btn-lg" href={resolve('/inicio?guardar')} onclick={onSave}
					><Icon name="plus" />Guardar primeira palavra</a
				>
				{#if !data.stremioConnected}
					<a class="btn btn-soft btn-lg" href={resolve('/integracoes')}
						><Icon name="tv" />Conectar o Stremio</a
					>
				{/if}
			</div>
			<div class="how">
				<div>
					<span class="qi"><Icon name="pencil" size="sm" /></span><b>Guarde à mão</b><span
						>Aperte N em qualquer tela</span
					>
				</div>
				<div>
					<span class="qi"><Icon name="tv" size="sm" /></span><b>Ou pela legenda</b><span
						>Toque na palavra no Stremio</span
					>
				</div>
				<div>
					<span class="qi"><Icon name="repeat" size="sm" /></span><b>Revise um pouco</b><span
						>Ela volta no dia certo</span
					>
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="h1-wrap">
		<div class="h1-top"><span>{formatToday(now, timeZone)}</span></div>
		<div class="h1-hero">
			<div>
				{#if toReview > 0}
					<div class="eyebrow due"><span class="dot-terra"></span>Para revisar hoje</div>
					<h1 class="big" data-testid="para-revisar">
						<span class="n">{toReview}</span>
						{words(toReview)}<br />para revisar
					</h1>
					<p class="sub">{sub}</p>
					<div class="h1-cta">
						<a class="btn btn-primary btn-lg" href={resolve('/flashcards/estudar')}
							><Icon name="play" size="sm" />Revisar agora</a
						>
						<span class="hint">ou aperte <kbd>R</kbd></span>
					</div>
				{:else}
					<div class="eyebrow">Revisão em dia</div>
					<h1 class="big calm" data-testid="para-revisar">Nada para<br />revisar agora</h1>
					<p class="sub">
						{#if data.nextDue}A próxima palavra volta {data.nextDue}.{:else}Guarde palavras novas e
							elas entram na revisão de amanhã.{/if}
					</p>
					<div class="h1-cta">
						<a class="btn btn-soft btn-lg" href={resolve('/inicio?guardar')} onclick={onSave}
							><Icon name="plus" size="sm" />Guardar palavra</a
						>
						<span class="hint">ou aperte <kbd>N</kbd></span>
					</div>
				{/if}
			</div>
			{#if data.next && toReview > 0}
				<div class="fan" aria-hidden="true">
					<div class="fc"></div>
					<div class="fc"></div>
					<div class="fc">
						<div>
							<b>{data.next.lemma}</b>
							{#if data.next.ipa}<div class="ipa">{data.next.ipa}</div>{/if}
						</div>
						<span class="src"
							><Icon name={ORIGIN_ICONS[data.next.origin]} size="sm" />{data.next.source ||
								(data.next.origin === 'manual' ? 'Guardada à mão' : 'Sem obra')}</span
						>
					</div>
				</div>
			{/if}
		</div>
		<div class="h1-foot">
			<a class="quiet" href={resolve('/palavras')}>
				<span class="qi"><Icon name="book" size="sm" /></span>
				<span class="qt">
					<b
						>{#if data.savedThisWeek > 0}{data.savedThisWeek}
							{data.savedThisWeek === 1 ? 'guardada' : 'guardadas'} esta semana{:else}{summary?.items ??
								''}
							{words(summary?.items ?? 0)} no banco{/if}</b
					>
					{#if data.lastItem}<span
							>A última foi “{data.lastItem.lemma}”, {formatAgo(
								new Date(data.lastItem.at),
								now,
								timeZone
							)}</span
						>{/if}
				</span>
			</a>
			{#if data.song}
				<a class="quiet" href={resolve('/musica/[id]', { id: data.song.id })}>
					<span class="qi"><Icon name="music" size="sm" /></span>
					<span class="qt"
						><b>Continuar {data.song.title}</b><span>{data.song.subtitle || 'Jogo de música'}</span
						></span
					>
				</a>
			{:else}
				<a class="quiet" href={resolve('/musica')}>
					<span class="qi"><Icon name="music" size="sm" /></span>
					<span class="qt"><b>Jogo de música</b><span>Aprenda com a letra de uma canção</span></span
					>
				</a>
			{/if}
			<a class="quiet" href={resolve('/integracoes')}>
				<span class="qi"><Icon name="tv" size="sm" /></span>
				<span class="qt">
					{#if data.stremioConnected}
						<b>Stremio conectado</b><span>Toque na legenda para guardar</span>
					{:else}
						<b>Conectar o Stremio</b><span>Guarde palavras direto da legenda</span>
					{/if}
				</span>
			</a>
		</div>
	</div>
{/if}

<style>
	.picker-box {
		width: min(420px, 100%);
		margin: 18px auto 0;
		padding: 10px;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-card);
		text-align: start;
	}
	.welcome {
		min-height: calc(100vh - 160px);
	}
	.welcome h1 {
		margin: 0;
		font: 600 28px/1.2 var(--f-head);
		letter-spacing: -0.02em;
	}
	.how {
		display: grid;
		grid-template-columns: repeat(3, 180px);
		gap: 12px;
		justify-content: center;
		margin-top: 52px;
		padding-top: 28px;
		border-top: 1px solid var(--line);
	}
	.how > div {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		font-size: 14px;
		color: var(--ink-3);
	}
	.how b {
		color: var(--ink);
		font-weight: 500;
		font-size: 15px;
		margin-top: 10px;
	}

	.h1-wrap {
		min-height: calc(100vh - 20px - 100px);
		display: flex;
		flex-direction: column;
	}
	.h1-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--ink-3);
		font-size: 14.5px;
	}
	.h1-hero {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		align-items: center;
		gap: 56px;
		padding: 40px 0;
	}
	.big {
		margin: 16px 0 0;
		font: 600 clamp(48px, 5.8vw, 76px)/1.02 var(--f-head);
		letter-spacing: -0.04em;
	}
	.big .n {
		letter-spacing: -0.02em;
	}
	.big.calm {
		font-size: clamp(40px, 4.6vw, 60px);
	}
	.sub {
		margin: 22px 0 32px;
		font-size: 17.5px;
		color: var(--ink-2);
		max-width: 440px;
		text-wrap: pretty;
	}
	.h1-cta {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.h1-cta .hint {
		font-size: 14px;
		color: var(--ink-3);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.fan {
		position: relative;
		height: 260px;
	}
	.fc {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 240px;
		height: 150px;
		margin: -75px 0 0 -120px;
		background: var(--raise);
		border-radius: var(--r-l);
		box-shadow: var(--sh-lift);
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		transition: transform 0.5s var(--ease);
	}
	:global(.tema-escuro) .fc {
		background: var(--raise-2);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not(.tema-claro)) .fc {
			background: var(--raise-2);
		}
	}
	.fc b {
		font: 600 26px/1.1 var(--f-head);
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.fc .src {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13.5px;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fc .ipa {
		font-size: 14.5px;
		color: var(--ink-3);
		margin-top: 4px;
	}
	.fc:nth-child(1) {
		transform: translateY(-24px) scale(0.9);
		box-shadow: var(--sh-card);
	}
	.fc:nth-child(2) {
		transform: translateY(-12px) scale(0.95);
		box-shadow: var(--sh-card);
	}
	.fc:nth-child(-n + 2)::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--panel);
		opacity: 0.45;
	}
	.fan:hover .fc:nth-child(1) {
		transform: translateY(-32px) scale(0.9);
	}
	.fan:hover .fc:nth-child(2) {
		transform: translateY(-16px) scale(0.95);
	}
	.h1-foot {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		border-top: 1px solid var(--line);
		padding-top: 18px;
	}
	.quiet {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-radius: var(--r-m);
		text-align: left;
		text-decoration: none;
		transition: background-color 0.15s;
		min-width: 0;
	}
	.quiet:hover {
		background: var(--hover);
	}
	.qi {
		width: 32px;
		height: 32px;
		border-radius: var(--r-m);
		display: grid;
		place-items: center;
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
		flex: none;
	}
	.qt {
		min-width: 0;
		line-height: 1.35;
	}
	.qt b {
		display: block;
		font-weight: 500;
		font-size: 15px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.qt span {
		font-size: 14px;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
	}

	@media (max-width: 1180px) {
		.h1-hero {
			grid-template-columns: minmax(0, 1fr) 250px;
			gap: 32px;
		}
	}
	@media (max-width: 980px) {
		.fan {
			display: none;
		}
		.h1-hero {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 768px) {
		.h1-wrap {
			min-height: calc(100dvh - 50px - var(--tab-h) - 120px);
		}
		.h1-hero {
			padding: 24px 0 28px;
		}
		.big {
			font-size: 49.5px;
		}
		.big.calm {
			font-size: 43px;
		}
		.sub {
			font-size: 16.5px;
			margin: 16px 0 26px;
		}
		.h1-cta {
			flex-direction: column;
			align-items: stretch;
		}
		.h1-cta .btn {
			width: 100%;
		}
		.h1-cta .hint {
			display: none;
		}
		.h1-foot {
			grid-template-columns: 1fr;
			gap: 2px;
			padding-top: 10px;
		}
		.how {
			grid-template-columns: 1fr;
			gap: 18px;
			margin-top: 36px;
		}
		.welcome {
			min-height: 0;
		}
	}
</style>
