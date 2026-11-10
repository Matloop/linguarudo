<!-- Quadro ilustrado da aba Filme (cena original, noite de chuva). -->
<svg class="cena" viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
	<defs>
		<linearGradient id="lp-ceu" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#132F44" />
			<stop offset="1" stop-color="#2A5563" />
		</linearGradient>
		<radialGradient id="lp-luz">
			<stop offset="0" stop-color="#FFE7A8" stop-opacity=".55" />
			<stop offset="1" stop-color="#FFE7A8" stop-opacity="0" />
		</radialGradient>
		<pattern id="lp-chuva" width="60" height="60" patternUnits="userSpaceOnUse">
			<path
				d="M50 0 l-8 16 M20 28 l-8 16 M38 44 l-6 12"
				stroke="#BFD8E8"
				stroke-opacity=".35"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</pattern>
	</defs>
	<rect width="800" height="450" fill="url(#lp-ceu)" />
	<circle cx="690" cy="70" r="30" fill="#FDF4E3" opacity=".85" />
	<rect x="0" y="150" width="140" height="300" fill="#16404A" />
	<rect x="30" y="180" width="18" height="24" fill="#E0A458" opacity=".45" />
	<rect x="80" y="230" width="18" height="24" fill="#E0A458" opacity=".3" />
	<rect x="600" y="140" width="130" height="310" fill="#16404A" />
	<rect x="730" y="200" width="70" height="250" fill="#123840" />
	<rect x="630" y="175" width="18" height="24" fill="#E0A458" opacity=".4" />
	<rect x="680" y="250" width="18" height="24" fill="#E0A458" opacity=".25" />
	<rect x="160" y="80" width="430" height="370" fill="#0C4033" />
	<rect x="160" y="80" width="430" height="18" fill="#073026" />
	<rect x="420" y="140" width="120" height="96" rx="6" fill="#E0A458" />
	<path d="M480 140v96M420 188h120" stroke="#073026" stroke-width="6" />
	<path d="M424 144h52v20c-18 4-34 2-52-6z" fill="#F07C7C" opacity=".8" />
	<rect x="210" y="140" width="80" height="60" rx="5" fill="#0A3329" />
	<path d="M235 410V290a45 45 0 0 1 90 0v120z" fill="#6C8EBF" />
	<circle cx="310" cy="352" r="5" fill="#E0A458" />
	<circle cx="280" cy="222" r="70" fill="url(#lp-luz)" />
	<circle cx="280" cy="222" r="9" fill="#FFE7A8" />
	<rect y="405" width="800" height="45" fill="#082A22" />
	<g>
		<rect x="372" y="300" width="56" height="108" rx="28" fill="#F07C7C" />
		<rect x="392" y="296" width="16" height="12" fill="#D8A27C" />
		<circle cx="400" cy="276" r="24" fill="#E3B48E" />
		<path d="M376 272a24 24 0 0 1 48-4c-10-8-30-10-48 4z" fill="#3A2A22" />
		<circle cx="410" cy="278" r="2.6" fill="#1F2A26" />
		<path
			d="M366 330c10-6 24-4 32 4"
			stroke="#C95A5A"
			stroke-width="8"
			stroke-linecap="round"
			fill="none"
		/>
	</g>
	<g>
		<rect x="454" y="322" width="50" height="86" rx="25" fill="#7FA886" />
		<circle cx="479" cy="300" r="21" fill="#A8764F" />
		<path d="M457 296c2-16 16-24 30-20 8 2 14 10 13 20-8-8-26-10-43 0z" fill="#1F2A26" />
		<circle cx="470" cy="302" r="2.4" fill="#1F2A26" />
		<rect x="498" y="350" width="22" height="30" rx="5" fill="#E0A458" />
	</g>
	<rect class="chuva" x="-60" y="-60" width="920" height="570" fill="url(#lp-chuva)" />
</svg>

<style>
	.cena {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.chuva {
		animation: chove 1.1s linear infinite;
	}

	@keyframes chove {
		to {
			transform: translate(-30px, 60px);
		}
	}
</style>
