<script lang="ts">
	import FichaForm from '#lib/ui/FichaForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const values = $derived(
		form?.values ?? { language: data.language, front: '', back: '', reverse: false, tags: '' }
	);
</script>

<svelte:head>
	<title>Nova ficha · Linguetta</title>
</svelte:head>

<div class="ph">
	<div>
		<h1>Nova ficha</h1>
		<p>Frente e verso livres, para gramática, frases ou o que não cabe numa palavra.</p>
	</div>
</div>

<FichaForm
	{values}
	mediaUrls={form?.mediaUrls}
	errors={form?.errors}
	languages={data.languages}
	ui={data.ui}
/>
