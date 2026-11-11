// Listas pequenas, escritas à mão: palavras comuns (matéria-prima para opções
// erradas) e palavras funcionais (que não viram lacuna). Não são letras de música.

import type { Lang } from '../words.ts';

const words = (s: string) => [...new Set(s.trim().split(/\s+/))];

export const COMMON_WORDS: Record<Lang, readonly string[]> = {
	en: words(`
		time year people way day man thing woman life child world school state family student group
		country problem hand part place case week company system program question work government number
		night point home water room mother area money story fact month lot right study book eye job
		word business issue side kind head house service friend father power hour game line end member
		law car city community name president team minute idea kid body information back parent face
		others level office door health person art war history party result change morning reason research
		girl guy moment air teacher force education foot boy age policy music market sense nation plan
		college interest death experience effect use class control care field development role effort rate
		heart drug show leader light voice wife police mind price report decision son view relationship
		town road arm difference value building action model season society tax director position player
		record paper space ground form event official matter center couple site project activity star
		table need court oil situation cost industry figure street image phone data picture practice
		piece land product doctor wall patient worker news test movie north love support technology step
		baby computer type attention film tree source organization hair window culture chance brother
		energy period course summer plant garden bridge flower window river mountain forest ocean island
		valley shadow silver golden winter spring autumn breeze thunder lightning cloud sunrise sunset
		dream wonder journey memory promise secret whisper silence harbor lantern meadow candle blanket
		ribbon pillow mirror feather pocket saddle ticket kettle basket puzzle tunnel anchor bottle castle
		engine bright quiet gentle broken golden hollow lonely simple wander travel gather follow listen
		remember forget believe imagine whisper borrow carry bring leave return waiting running falling
		walking talking singing dancing shining burning turning holding calling
	`),
	it: words(`
		tempo anno giorno uomo donna vita mondo cosa mano parte luogo caso settimana sistema programma
		domanda lavoro governo numero notte punto casa acqua stanza madre area denaro storia fatto mese
		libro occhio parola affare problema lato tipo testa servizio amico padre potere ora gioco linea
		fine membro legge macchina citta comunita nome squadra minuto idea bambino corpo informazione
		schiena genitore faccia livello ufficio porta salute persona arte guerra storia partito risultato
		cambio mattina ragione ricerca ragazza ragazzo momento aria maestro forza educazione piede eta
		politica musica mercato senso nazione piano interesse morte esperienza effetto uso classe cura
		campo sviluppo ruolo sforzo tasso cuore voce luce mente prezzo rapporto figlio vista relazione
		differenza valore edificio azione modello stagione societa tassa direttore posizione giocatore
		spazio terra forma evento ufficiale centro coppia sito progetto attivita stella tavolo bisogno
		corte olio situazione costo industria figura strada immagine telefono dato quadro pratica pezzo
		dottore muro paziente lavoratore notizia prova film nord amore sostegno tecnologia passo albero
		fonte organizzazione capelli finestra cultura occasione fratello energia periodo corso estate
		pianta giardino ponte fiore fiume montagna foresta oceano isola valle ombra argento inverno
		primavera autunno brezza tuono fulmine nuvola alba tramonto sogno meraviglia viaggio memoria
		promessa segreto sussurro silenzio porto lanterna prato candela coperta nastro cuscino specchio
		piuma tasca sella biglietto bollitore cestino enigma tunnel ancora bottiglia castello motore
		luminoso tranquillo gentile rotto dorato vuoto solitario semplice vagare viaggiare raccogliere
		seguire ascoltare ricordare dimenticare credere immaginare prestare portare lasciare tornare
		aspettare correre cadere camminare parlare cantare ballare brillare bruciare girare tenere
		chiamare tardo piano fretta pioggia strada tazza gente caldo freddo sveglia rallenta fermata
	`)
};

/** Palavras funcionais: ficam de fora das lacunas (artigos, preposições, pronomes, auxiliares). */
export const STOPWORDS: Record<Lang, ReadonlySet<string>> = {
	en: new Set(
		words(`
		the and but for with that this these those from into onto upon over under about after before
		while where when what which who whom whose whether because since until than then there here
		their them they theirs your yours mine ours his her hers its our you she him himself herself
		myself yourself itself ourselves themselves have has had having been being were was are will
		would could should shall must might may can cannot does did doing done just only also even
		still very much many some any more most such each every other another both either neither
		not nor now all one two three out off down too own same like well yet ever never always
		don't doesn't didn't won't wouldn't can't couldn't shouldn't isn't aren't wasn't weren't
		i'm i'll i've i'd you're you'll you've you'd he's she's it's we're we'll we've we'd they're
		they'll they've they'd that's there's here's what's let's who's
	`)
	),
	it: new Set(
		words(`
		il lo la le gli uno una dei degli delle del dello della dell nel nello nella nell sul sullo
		sulla sull dal dallo dalla dall con per tra fra che chi cui non come ma anche poi ancora gia
		sempre mai molto tanto troppo poco piu meno tutto tutti tutte ogni altro altra altri altre
		questo questa questi queste quello quella quelli quelle quel quest quell mio mia miei mie
		tuo tua tuoi tue suo sua suoi sue nostro nostra nostri nostre vostro vostra vostri vostre
		loro sono sei siamo siete essere stato stata stati state era ero eri erano ho hai hanno
		abbiamo avete avere ebbe sia fosse sara saro faro fai fanno fatto fare dove quando perche
		cosi quindi dunque allora ecco ciao
	`)
	)
};
