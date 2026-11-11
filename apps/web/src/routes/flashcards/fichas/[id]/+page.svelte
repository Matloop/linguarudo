<script lang="ts">
	import { enhance } from '$app/forms';
	import FichaForm from '#lib/ui/FichaForm.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const values = $derived(form?.values ?? data.values);
</script>

<svelte:head>
	<title>Editar ficha · Linguetta</title>
</svelte:head>

<div class="ph">
	<div>
		<h1>Editar ficha</h1>
		{#if data.cloze}
			<p>Ficha de lacunas: cada <code>{'{{c1::…}}'}</code> é um flashcard.</p>
		{/if}
	</div>
	<form
		method="POST"
		action="?/delete"
		use:enhance={({ cancel }) => {
			if (!confirm('Apagar esta ficha e os flashcards dela?')) cancel();
		}}
	>
		<button class="btn btn-ghost"><Icon name="x" size="sm" />Apagar ficha</button>
	</form>
</div>

<FichaForm
	{values}
	errors={form?.errors}
	languages={data.languages}
	ui={data.ui}
	action="?/save"
	cloze={data.cloze}
/>
