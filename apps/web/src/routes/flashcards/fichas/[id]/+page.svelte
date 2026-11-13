<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import FichaDialog from '#lib/ui/FichaDialog.svelte';
	import type { PageProps } from './$types';

	// Link direto para a ficha (ex.: tela do baralho): o mesmo diálogo da lista, já aberto.
	// Fechar (salvando, apagando ou não) volta para a lista de fichas.

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Editar ficha · Linguetta</title>
</svelte:head>

<FichaDialog
	mode="edit"
	open
	ssrOpen
	edit={data.ficha}
	language={data.ficha.language}
	uiLanguage={data.ui}
	ondeleted={() => {}}
	onclose={() => goto(resolve('/flashcards/fichas'))}
/>
