<script lang="ts">
	// Símbolo do Linguetta, desenhado inline (funciona sem o sprite do app).
	let { class: cls = 'mark', title = '' }: { class?: string; title?: string } = $props();
</script>

<svg
	class={cls}
	viewBox="0 0 218 236"
	fill="currentColor"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title || undefined}
>
	<path d="M0 0H31V130A36 36 0 0 0 67 166H133L125.25 197H67A67 67 0 0 1 0 130Z" />
	<path
		d="M70 30H117A67 67 0 0 1 184 97L152.1 89A36 36 0 0 0 117 61H76L57 43.5C52.5 39 55 30 70 30Z"
	/>
	<path
		d="M73.2 155A67 67 0 0 1 139 100.5H150A67 67 0 0 1 217 167.5A67 67 0 0 1 150 234.5H126.25L134 203.5H150A36 36 0 0 0 186 167.5A36 36 0 0 0 150 131.5H139A36 36 0 0 0 105.2 155Z"
	/>
</svg>
