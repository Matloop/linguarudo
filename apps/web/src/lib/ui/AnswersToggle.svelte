<script lang="ts">
	import { answers } from './answers.svelte.ts';
	import Icon from './Icon.svelte';
</script>

<button
	class="btn btn-ghost answers"
	type="button"
	aria-pressed={answers.shown}
	title="Atalho: H"
	onclick={() => answers.toggle()}
	><Icon name="eye" size="sm" />{answers.shown ? 'Ocultar respostas' : 'Mostrar respostas'}</button
>

<style>
	.answers {
		flex: none;
	}
	.answers[aria-pressed='true'] {
		color: var(--ink);
	}
</style>
