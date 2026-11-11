<script lang="ts" module>
	export type IconName =
		| 'sidebar'
		| 'home'
		| 'book'
		| 'repeat'
		| 'music'
		| 'plug'
		| 'plus'
		| 'search'
		| 'user'
		| 'moon'
		| 'sun'
		| 'x'
		| 'sound'
		| 'tv'
		| 'pencil'
		| 'check'
		| 'down'
		| 'clock'
		| 'play'
		| 'calendar'
		| 'arrow'
		| 'sparks'
		| 'leaf'
		| 'undo'
		| 'right'
		| 'refresh'
		| 'settings'
		| 'bookmark'
		| 'globe'
		| 'archive'
		| 'tag'
		| 'cards'
		| 'image'
		| 'upload'
		| 'chart'
		| 'more'
		| 'pause'
		| 'folder';
</script>

<script lang="ts">
	let { name, size = '' }: { name: IconName; size?: '' | 'sm' | 'lg' | 'sm flip' } = $props();
</script>

<svg class="ic {size}" aria-hidden="true"><use href="#i-{name}" /></svg>
