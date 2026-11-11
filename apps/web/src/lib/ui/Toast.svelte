<script lang="ts">
	import Icon from './Icon.svelte';
	import { ui } from './app-state.svelte.ts';

	// O texto continua lá enquanto o aviso some, para não piscar vazio.
	let shown = $state('');
	$effect(() => {
		if (ui.toast) shown = ui.toast;
	});
</script>

<div class="toast" class:on={!!ui.toast} role="status" aria-live="polite">
	{#if shown}<span class="ok"><Icon name="check" /></span>{shown}{/if}
</div>

<style>
	.toast {
		position: fixed;
		z-index: 70;
		left: 50%;
		bottom: 28px;
		translate: -50% 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 14px 9px 11px;
		border-radius: var(--r-m);
		background: var(--toast-bg);
		color: var(--toast-ink);
		font-size: 15px;
		box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.35);
		opacity: 0;
		transform: translateY(8px);
		transition:
			opacity 0.25s var(--ease),
			transform 0.35s var(--ease);
		pointer-events: none;
		white-space: nowrap;
		max-width: calc(100vw - 32px);
	}
	.toast.on {
		opacity: 1;
		transform: none;
	}
	.ok {
		width: 18px;
		height: 18px;
		display: grid;
		place-items: center;
		color: var(--salvia);
	}
	.ok :global(.ic) {
		width: 15px;
		height: 15px;
		stroke-width: 2.2;
	}
	@media (max-width: 768px) {
		.toast {
			bottom: calc(var(--tab-h) + var(--safe-b) + 58px);
		}
	}
</style>
