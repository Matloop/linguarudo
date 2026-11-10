<!-- Rudo pegando uma mosca (ou uma palavra) com a língua. Mesmo loader do app de música. -->
<script lang="ts">
	import mascote from '#lib/assets/mascote.png';

	let { palavra }: { palavra?: string } = $props();
</script>

<div class="cena" aria-hidden="true">
	<img src={mascote} alt="" width="160" height="151" />
	<i class="lng"></i>
	{#if palavra}
		<span class="palavra">{palavra}</span>
	{:else}
		<svg class="mosca" viewBox="0 0 22 22">
			<g class="asa" fill="#BFD8E8" fill-opacity=".85" stroke="#7FA0B5" stroke-width=".8">
				<ellipse cx="7" cy="6" rx="5" ry="3.4" transform="rotate(-25 7 6)" />
				<ellipse cx="15" cy="6" rx="5" ry="3.4" transform="rotate(25 15 6)" />
			</g>
			<ellipse cx="11" cy="13" rx="4.6" ry="5.4" fill="#1F2A26" />
			<circle cx="11" cy="8.6" r="3" fill="#1F2A26" />
			<circle cx="9.7" cy="8.2" r="1" fill="#E86A6A" />
			<circle cx="12.3" cy="8.2" r="1" fill="#E86A6A" />
		</svg>
	{/if}
</div>

<style>
	.cena {
		position: relative;
		width: 270px;
		height: 152px;
		flex: none;
	}

	img {
		position: absolute;
		left: 0;
		top: 0;
		width: 160px;
		height: auto;
		transform-origin: 40% 95%;
		animation: engole 2.2s infinite;
	}

	.lng {
		position: absolute;
		left: 124px;
		top: 80px;
		height: 10px;
		width: 0;
		border-radius: 99px;
		background: linear-gradient(90deg, #e86a6a, var(--coral));
		animation: lingua 2.2s infinite;
	}

	.lng::after {
		content: '';
		position: absolute;
		right: -7px;
		top: -5px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--coral);
	}

	.mosca {
		position: absolute;
		left: 0;
		top: 0;
		width: 22px;
		height: 22px;
		margin: -11px 0 0 -11px;
		animation: voa 2.2s infinite;
		transform: translate(214px, 62px);
	}

	.asa {
		transform-origin: 11px 11px;
		animation: bate 0.07s linear infinite alternate;
	}

	.palavra {
		position: absolute;
		left: 0;
		top: 0;
		font-size: 12px;
		font-weight: 850;
		background: var(--ouro);
		color: #073026;
		border-radius: 99px;
		padding: 1px 7px;
		white-space: nowrap;
		animation: voa-p 2.2s infinite;
		transform: translate(195px, 34px);
	}

	@keyframes bate {
		to {
			transform: scaleY(0.35);
		}
	}

	@keyframes voa {
		0% {
			transform: translate(255px, 14px);
			opacity: 0;
		}
		8% {
			opacity: 1;
		}
		20% {
			transform: translate(208px, 42px);
		}
		34% {
			transform: translate(250px, 104px);
		}
		47% {
			transform: translate(214px, 62px);
		}
		55%,
		60% {
			transform: translate(236px, 85px);
		}
		74% {
			transform: translate(134px, 85px) scale(0.5);
			opacity: 1;
		}
		76%,
		100% {
			transform: translate(134px, 85px) scale(0.5);
			opacity: 0;
		}
	}

	@keyframes voa-p {
		0% {
			transform: translate(236px, -14px);
			opacity: 0;
		}
		8% {
			opacity: 1;
		}
		20% {
			transform: translate(189px, 14px);
		}
		34% {
			transform: translate(231px, 76px);
		}
		47% {
			transform: translate(195px, 34px);
		}
		55%,
		60% {
			transform: translate(217px, 57px);
		}
		74% {
			transform: translate(118px, 62px) scale(0.4);
			opacity: 1;
		}
		76%,
		100% {
			transform: translate(118px, 62px) scale(0.4);
			opacity: 0;
		}
	}

	@keyframes lingua {
		0%,
		54% {
			width: 0;
		}
		60% {
			width: 112px;
		}
		74%,
		100% {
			width: 0;
		}
	}

	@keyframes engole {
		0%,
		74% {
			transform: none;
		}
		80% {
			transform: scale(1.05, 0.94);
		}
		88% {
			transform: scale(0.98, 1.03);
		}
		94%,
		100% {
			transform: none;
		}
	}
</style>
