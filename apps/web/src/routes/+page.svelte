<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Linguarudo</title>
</svelte:head>

<h1>Linguarudo</h1>
<p>Seu banco de palavras em inglês e italiano. A página inicial está sendo desenhada.</p>
<p><a href={resolve('/entrar')}>Entrar</a></p>

<style>
	h1 {
		color: var(--verde);
	}
</style>
