// Dicionário PT→IT embutido para o provider mock.
// Formato de cada linha: português | italiano | IPA | classe (em português) | significado | exemplo (italiano)
// Palavras idênticas nas duas línguas (casa, porta, grande...) ficam de fora de propósito.

const RAW = `
de novo|di nuovo|/di ˈnwɔ.vo/|loc. adv.|outra vez, novamente|Proviamo di nuovo domani.
por favor|per favore|/per faˈvo.re/|expr.|pedido educado|Un caffè, per favore.
bom dia|buongiorno|/bwonˈdʒor.no/|expr.|saudação da manhã|Buongiorno, come stai?
tudo bem|tutto bene|/ˈtut.to ˈbɛ.ne/|expr.|está tudo certo|Tranquillo, va tutto bene.
com certeza|di sicuro|/di siˈku.ro/|loc. adv.|certamente, sem dúvida|Di sicuro arriverà presto.
de repente|all'improvviso|/al.lim.provˈvi.zo/|loc. adv.|subitamente, sem aviso|All'improvviso è andata via la luce.
sinto muito|mi dispiace|/mi disˈpja.tʃe/|expr.|lamento, peço desculpas|Mi dispiace per il ritardo.
muito obrigado|grazie mille|/ˈɡrat.tsje ˈmil.le/|expr.|agradecimento enfático|Grazie mille per l'aiuto.
obrigado|grazie|/ˈɡrat.tsje/|expr.|agradecimento|Grazie, sei molto gentile.
obrigada|grazie|/ˈɡrat.tsje/|expr.|agradecimento|Grazie, sei molto gentile.
dia|giorno|/ˈdʒor.no/|subst. masc.|dia, período de 24 horas|È un bel giorno per uscire.
dias|giorni|/ˈdʒor.ni/|subst. masc. plural|dias|Sono partiti tre giorni fa.
noite|notte|/ˈnɔt.te/|subst. fem.|noite|Buona notte a tutti.
noites|notti|/ˈnɔt.ti/|subst. fem. plural|noites|Le notti d'estate sono corte.
manhã|mattina|/matˈti.na/|subst. fem.|manhã|Mi sveglio presto la mattina.
ano|anno|/ˈan.no/|subst. masc.|ano|Quest'anno vado in Italia.
anos|anni|/ˈan.ni/|subst. masc. plural|anos; idade|Ho trent'anni.
semana|settimana|/set.tiˈma.na/|subst. fem.|semana|Ci vediamo la prossima settimana.
mês|mese|/ˈme.ze/|subst. masc.|mês|Il mese scorso ha piovuto molto.
hora|ora|/ˈo.ra/|subst. fem.|hora|È ora di andare.
vez|volta|/ˈvɔl.ta/|subst. fem.|vez, ocasião|C'era una volta un re.
vezes|volte|/ˈvɔl.te/|subst. fem. plural|vezes|Te l'ho detto mille volte.
coisa|cosa|/ˈkɔ.za/|subst. fem.|coisa|Che cosa vuoi?
coisas|cose|/ˈkɔ.ze/|subst. fem. plural|coisas|Ho molte cose da fare.
homem|uomo|/ˈwɔ.mo/|subst. masc.|homem|Quell'uomo è mio zio.
homens|uomini|/ˈwɔ.mi.ni/|subst. masc. plural|homens|Gli uomini parlano di calcio.
mulher|donna|/ˈdɔn.na/|subst. fem.|mulher|Quella donna è un medico.
mulheres|donne|/ˈdɔn.ne/|subst. fem. plural|mulheres|Le donne del paese ballano.
filho|figlio|/ˈfiʎ.ʎo/|subst. masc.|filho|Mio figlio ha cinque anni.
filha|figlia|/ˈfiʎ.ʎa/|subst. fem.|filha|Sua figlia studia a Roma.
filhos|figli|/ˈfiʎ.ʎi/|subst. masc. plural|filhos|Hanno due figli.
pai|padre|/ˈpa.dre/|subst. masc.|pai|Mio padre lavora in banca.
mãe|madre|/ˈma.dre/|subst. fem.|mãe|Sua madre cucina benissimo.
irmão|fratello|/fraˈtɛl.lo/|subst. masc.|irmão|Mio fratello vive a Milano.
irmã|sorella|/soˈrɛl.la/|subst. fem.|irmã|Mia sorella è più grande di me.
amigo|amico|/aˈmi.ko/|subst. masc.|amigo|Marco è il mio migliore amico.
amiga|amica|/aˈmi.ka/|subst. fem.|amiga|Esco con un'amica stasera.
amigos|amici|/aˈmi.tʃi/|subst. masc. plural|amigos|Ceniamo con gli amici.
criança|bambino|/bamˈbi.no/|subst. masc.|criança|Il bambino dorme.
crianças|bambini|/bamˈbi.ni/|subst. masc. plural|crianças|I bambini giocano nel parco.
menino|bambino|/bamˈbi.no/|subst. masc.|menino|Il bambino ha fame.
menina|bambina|/bamˈbi.na/|subst. fem.|menina|La bambina ride.
garoto|ragazzo|/raˈɡat.tso/|subst. masc.|garoto, rapaz|Quel ragazzo è simpatico.
garota|ragazza|/raˈɡat.tsa/|subst. fem.|garota, moça|La ragazza legge un libro.
namorado|fidanzato|/fi.danˈtsa.to/|subst. masc.|namorado|Il suo fidanzato è di Napoli.
namorada|fidanzata|/fi.danˈtsa.ta/|subst. fem.|namorada|Ho conosciuto la sua fidanzata.
vizinho|vicino|/viˈtʃi.no/|subst. masc.|vizinho|Il mio vicino è molto gentile.
chefe|capo|/ˈka.po/|subst. masc.|chefe|Il capo è in riunione.
cidade|città|/tʃitˈta/|subst. fem.|cidade|Roma è una città bellissima.
rua|strada|/ˈstra.da/|subst. fem.|rua|Attraversa la strada con attenzione.
caminho|cammino|/kamˈmi.no/|subst. masc.|caminho, percurso|Il cammino è ancora lungo.
carro|macchina|/ˈmak.ki.na/|subst. fem.|carro, automóvel|Ho parcheggiato la macchina qui.
dinheiro|soldi|/ˈsɔl.di/|subst. masc. plural|dinheiro|Non ho abbastanza soldi.
trabalho|lavoro|/laˈvo.ro/|subst. masc.|trabalho, emprego|Vado al lavoro in bici.
escola|scuola|/ˈskwɔ.la/|subst. fem.|escola|I bambini vanno a scuola.
janela|finestra|/fiˈnɛs.tra/|subst. fem.|janela|Apri la finestra, fa caldo.
mesa|tavolo|/ˈta.vo.lo/|subst. masc.|mesa|Il pranzo è sul tavolo.
cama|letto|/ˈlɛt.to/|subst. masc.|cama|Vado a letto presto.
quarto|camera|/ˈka.me.ra/|subst. fem.|quarto, cômodo|La mia camera è piccola.
cozinha|cucina|/kuˈtʃi.na/|subst. fem.|cozinha|Siamo in cucina.
comida|cibo|/ˈtʃi.bo/|subst. masc.|comida, alimento|Il cibo italiano è famoso.
água|acqua|/ˈak.kwa/|subst. fem.|água|Vorrei un bicchiere d'acqua.
café|caffè|/kafˈfɛ/|subst. masc.|café|Prendiamo un caffè?
pão|pane|/ˈpa.ne/|subst. masc.|pão|Compro il pane ogni mattina.
vinho|vino|/ˈvi.no/|subst. masc.|vinho|Un bicchiere di vino rosso.
cachorro|cane|/ˈka.ne/|subst. masc.|cachorro, cão|Il cane abbaia.
gato|gatto|/ˈɡat.to/|subst. masc.|gato|Il gatto dorme sul divano.
livro|libro|/ˈli.bro/|subst. masc.|livro|Sto leggendo un libro.
palavra|parola|/paˈrɔ.la/|subst. fem.|palavra|Non capisco questa parola.
palavras|parole|/paˈrɔ.le/|subst. fem. plural|palavras|Le parole sono importanti.
mundo|mondo|/ˈmon.do/|subst. masc.|mundo|Voglio girare il mondo.
vida|vita|/ˈvi.ta/|subst. fem.|vida|La vita è bella.
amor|amore|/aˈmo.re/|subst. masc.|amor|L'amore vince tutto.
coração|cuore|/ˈkwɔ.re/|subst. masc.|coração|Ti ringrazio di cuore.
cabeça|testa|/ˈtɛs.ta/|subst. fem.|cabeça|Mi fa male la testa.
mão|mano|/ˈma.no/|subst. fem.|mão|Dammi la mano.
mãos|mani|/ˈma.ni/|subst. fem. plural|mãos|Lavati le mani.
olho|occhio|/ˈɔk.kjo/|subst. masc.|olho|Ho qualcosa nell'occhio.
olhos|occhi|/ˈɔk.ki/|subst. masc. plural|olhos|Ha gli occhi azzurri.
rosto|viso|/ˈvi.zo/|subst. masc.|rosto, cara|Ha un viso simpatico.
festas|feste|/ˈfɛs.te/|subst. fem. plural|festas, celebrações|Andiamo alle feste di Roma.
problemas|problemi|/proˈblɛ.mi/|subst. masc. plural|problemas|Non ci sono problemi.
verdade|verità|/ve.riˈta/|subst. fem.|verdade|Dimmi la verità.
pergunta|domanda|/doˈman.da/|subst. fem.|pergunta|Posso farti una domanda?
resposta|risposta|/risˈpos.ta/|subst. fem.|resposta|Aspetto una risposta.
história|storia|/ˈstɔ.rja/|subst. fem.|história|È una lunga storia.
lugar|posto|/ˈpos.to/|subst. masc.|lugar|È un posto tranquillo.
país|paese|/paˈe.ze/|subst. masc.|país|L'Italia è un bel paese.
mar|mare|/ˈma.re/|subst. masc.|mar|Andiamo al mare.
céu|cielo|/ˈtʃɛ.lo/|subst. masc.|céu|Il cielo è sereno.
sol|sole|/ˈso.le/|subst. masc.|sol|C'è il sole oggi.
chuva|pioggia|/ˈpjɔd.dʒa/|subst. fem.|chuva|Domani arriva la pioggia.
polícia|polizia|/po.litˈtsi.a/|subst. fem.|polícia|Chiama la polizia!
hospital|ospedale|/o.speˈda.le/|subst. masc.|hospital|È ancora in ospedale.
telefone|telefono|/teˈlɛ.fo.no/|subst. masc.|telefone|Rispondi al telefono.
jogo|gioco|/ˈdʒɔ.ko/|subst. masc.|jogo, brincadeira|È solo un gioco.
chave|chiave|/ˈkja.ve/|subst. fem.|chave|Ho perso la chiave.
roupas|vestiti|/vesˈti.ti/|subst. masc. plural|roupas|Metti i vestiti nell'armadio.
sapato|scarpa|/ˈskar.pa/|subst. fem.|sapato|Mi fa male la scarpa.
fome|fame|/ˈfa.me/|subst. fem.|fome|Ho una fame da lupo.
medo|paura|/paˈu.ra/|subst. fem.|medo|Non avere paura.
sonho|sogno|/ˈsoɲ.ɲo/|subst. masc.|sonho|Ho fatto un bel sogno.
ideia|idea|/iˈdɛ.a/|subst. fem.|ideia|Che bella idea!
casamento|matrimonio|/ma.triˈmɔ.njo/|subst. masc.|casamento|Il matrimonio è a giugno.
igreja|chiesa|/ˈkjɛ.za/|subst. fem.|igreja|La chiesa è in piazza.
loja|negozio|/neˈɡɔt.tsjo/|subst. masc.|loja|Il negozio chiude alle otto.
praia|spiaggia|/ˈspjad.dʒa/|subst. fem.|praia|Passiamo la giornata in spiaggia.
trem|treno|/ˈtrɛ.no/|subst. masc.|trem|Il treno parte alle nove.
avião|aereo|/aˈɛ.re.o/|subst. masc.|avião|L'aereo è in ritardo.
viagem|viaggio|/ˈvjad.dʒo/|subst. masc.|viagem|Buon viaggio!
almoço|pranzo|/ˈpran.dzo/|subst. masc.|almoço|Il pranzo è pronto.
erro|errore|/erˈro.re/|subst. masc.|erro|Ho fatto un errore.
sorte|fortuna|/forˈtu.na/|subst. fem.|sorte|Buona fortuna!
segredo|segreto|/seˈɡre.to/|subst. masc.|segredo|È un segreto tra noi.
dor|dolore|/doˈlo.re/|subst. masc.|dor|Sento un forte dolore.
força|forza|/ˈfɔr.tsa/|subst. fem.|força|Forza, ce la fai!
quero|voglio|/ˈvɔʎ.ʎo/|verbo, 1ª p. sing. presente|eu quero (querer)|Voglio un gelato.
quer|vuole|/ˈvwɔ.le/|verbo, 3ª p. sing. presente|ele/ela/você quer (querer)|Lui vuole partire.
queria|volevo|/voˈle.vo/|verbo, 1ª p. sing. imperfeito|eu queria (querer)|Volevo dirti una cosa.
preciso|ho bisogno|/ɔ biˈzoɲ.ɲo/|verbo, 1ª p. sing. presente|eu preciso (precisar)|Ho bisogno di aiuto.
precisa|ha bisogno|/a biˈzoɲ.ɲo/|verbo, 3ª p. sing. presente|ele/ela/você precisa|Ha bisogno di riposo.
sei|so|/sɔ/|verbo, 1ª p. sing. presente|eu sei (saber)|Non lo so.
sabe|sa|/sa/|verbo, 3ª p. sing. presente|ele/ela/você sabe (saber)|Lei sa tutto.
vou|vado|/ˈva.do/|verbo, 1ª p. sing. presente|eu vou (ir)|Vado a casa.
vai|va|/va/|verbo, 3ª p. sing. presente|ele/ela/você vai (ir)|Dove va il treno?
vamos|andiamo|/anˈdja.mo/|verbo, 1ª p. plural presente|nós vamos; vamos! (ir)|Andiamo al cinema.
tenho|ho|/ɔ/|verbo, 1ª p. sing. presente|eu tenho (ter)|Ho una sorella.
temos|abbiamo|/abˈbja.mo/|verbo, 1ª p. plural presente|nós temos (ter)|Abbiamo poco tempo.
fazer|fare|/ˈfa.re/|verbo, infinitivo|fazer|Cosa vuoi fare?
faz|fa|/fa/|verbo, 3ª p. sing. presente|ele/ela/você faz (fazer)|Che lavoro fa?
fiz|ho fatto|/ɔ ˈfat.to/|verbo, 1ª p. sing. passado|eu fiz (fazer)|Ho fatto i compiti.
dizer|dire|/ˈdi.re/|verbo, infinitivo|dizer|Cosa vuoi dire?
falar|parlare|/parˈla.re/|verbo, infinitivo|falar|Dobbiamo parlare.
falando|parlando|/parˈlan.do/|verbo, gerúndio|falando|Di cosa stai parlando?
ver|vedere|/veˈde.re/|verbo, infinitivo|ver|Voglio vedere il mare.
vi|ho visto|/ɔ ˈvis.to/|verbo, 1ª p. sing. passado|eu vi (ver)|Ho visto un film.
olha|guarda|/ˈɡwar.da/|verbo, imperativo|olhe, veja|Guarda che bello!
ouvir|sentire|/senˈti.re/|verbo, infinitivo|ouvir, escutar|Non riesco a sentire.
comer|mangiare|/manˈdʒa.re/|verbo, infinitivo|comer|Andiamo a mangiare.
beber|bere|/ˈbe.re/|verbo, infinitivo|beber|Vuoi bere qualcosa?
dormir|dormire|/dorˈmi.re/|verbo, infinitivo|dormir|Devo dormire un po'.
morrer|morire|/moˈri.re/|verbo, infinitivo|morrer|Non voglio morire.
viver|vivere|/ˈvi.ve.re/|verbo, infinitivo|viver|Voglio vivere al mare.
ajudar|aiutare|/a.juˈta.re/|verbo, infinitivo|ajudar|Posso aiutare?
ajuda|aiuto|/aˈju.to/|subst. masc.|ajuda, socorro|Grazie per l'aiuto.
esperar|aspettare|/as.petˈta.re/|verbo, infinitivo|esperar, aguardar|Non posso aspettare.
espera|aspetta|/asˈpɛt.ta/|verbo, imperativo|espere, aguarde|Aspetta un momento!
encontrar|trovare|/troˈva.re/|verbo, infinitivo|encontrar, achar|Devo trovare le chiavi.
acho|credo|/ˈkre.do/|verbo, 1ª p. sing. presente|eu acho, penso|Credo che pioverà.
acredito|credo|/ˈkre.do/|verbo, 1ª p. sing. presente|eu acredito|Ti credo.
entender|capire|/kaˈpi.re/|verbo, infinitivo|entender, compreender|Non riesco a capire.
entendo|capisco|/kaˈpis.ko/|verbo, 1ª p. sing. presente|eu entendo|Non capisco.
entendeu|hai capito|/ai kaˈpi.to/|verbo, 2ª p. sing. passado|você entendeu|Hai capito tutto?
lembrar|ricordare|/ri.korˈda.re/|verbo, infinitivo|lembrar, recordar|Non riesco a ricordare.
lembro|ricordo|/riˈkɔr.do/|verbo, 1ª p. sing. presente|eu lembro|Mi ricordo di te.
esquecer|dimenticare|/di.men.tiˈka.re/|verbo, infinitivo|esquecer|Non dimenticare le chiavi.
conhecer|conoscere|/koˈnoʃ.ʃe.re/|verbo, infinitivo|conhecer|Piacere di conoscerti.
conheço|conosco|/koˈnos.ko/|verbo, 1ª p. sing. presente|eu conheço|Conosco un buon ristorante.
gosto|mi piace|/mi ˈpja.tʃe/|verbo, 1ª p. sing. presente|eu gosto|Mi piace la pizza.
trabalhar|lavorare|/la.voˈra.re/|verbo, infinitivo|trabalhar|Domani devo lavorare.
chegar|arrivare|/ar.riˈva.re/|verbo, infinitivo|chegar|Quando pensi di arrivare?
chegou|è arrivato|/ɛ ar.riˈva.to/|verbo, 3ª p. sing. passado|ele chegou|Il pacco è arrivato.
sair|uscire|/uʃˈʃi.re/|verbo, infinitivo|sair|Voglio uscire stasera.
voltar|tornare|/torˈna.re/|verbo, infinitivo|voltar, retornar|Devo tornare a casa.
volto|torno|/ˈtor.no/|verbo, 1ª p. sing. presente|eu volto|Torno subito.
ficar|restare|/resˈta.re/|verbo, infinitivo|ficar, permanecer|Posso restare qui?
fica|resta|/ˈrɛs.ta/|verbo, 3ª p. sing. / imperativo|fique; ele fica|Resta con me.
correr|correre|/ˈkor.re.re/|verbo, infinitivo|correr|Mi piace correre al parco.
andar|camminare|/kam.miˈna.re/|verbo, infinitivo|andar, caminhar|Andiamo a camminare.
abrir|aprire|/aˈpri.re/|verbo, infinitivo|abrir|Puoi aprire la porta?
fechar|chiudere|/ˈkju.de.re/|verbo, infinitivo|fechar|Ricordati di chiudere la finestra.
pegar|prendere|/ˈprɛn.de.re/|verbo, infinitivo|pegar, apanhar|Devo prendere il treno.
deixar|lasciare|/laʃˈʃa.re/|verbo, infinitivo|deixar|Non lasciare la luce accesa.
deixa|lascia|/ˈlaʃ.ʃa/|verbo, imperativo|deixe|Lascia stare.
perder|perdere|/ˈpɛr.de.re/|verbo, infinitivo|perder|Non voglio perdere il treno.
ganhar|vincere|/ˈvin.tʃe.re/|verbo, infinitivo|ganhar, vencer|Vogliamo vincere la partita.
comprar|comprare|/komˈpra.re/|verbo, infinitivo|comprar|Devo comprare il latte.
pagar|pagare|/paˈɡa.re/|verbo, infinitivo|pagar|Posso pagare con la carta?
matar|uccidere|/utˈtʃi.de.re/|verbo, infinitivo|matar|Non voleva uccidere nessuno.
brincar|giocare|/dʒoˈka.re/|verbo, infinitivo|brincar, jogar|I bambini vogliono giocare.
chorar|piangere|/ˈpjan.dʒe.re/|verbo, infinitivo|chorar|Non piangere.
rir|ridere|/ˈri.de.re/|verbo, infinitivo|rir|Mi fa ridere.
começar|cominciare|/ko.minˈtʃa.re/|verbo, infinitivo|começar|Possiamo cominciare?
acabar|finire|/fiˈni.re/|verbo, infinitivo|acabar, terminar|Devo finire il lavoro.
tentar|provare|/proˈva.re/|verbo, infinitivo|tentar|Voglio provare ancora.
pode|può|/pwɔ/|verbo, 3ª p. sing. presente|ele/ela/você pode|Può venire domani.
podemos|possiamo|/posˈsja.mo/|verbo, 1ª p. plural presente|nós podemos|Possiamo andare?
estou|sono|/ˈso.no/|verbo, 1ª p. sing. presente|eu estou (estar)|Sono stanco.
somos|siamo|/ˈsja.mo/|verbo, 1ª p. plural presente|nós somos (ser)|Siamo amici.
chamo|mi chiamo|/mi ˈkja.mo/|verbo, 1ª p. sing. presente|eu me chamo|Mi chiamo Paolo.
moro|abito|/ˈa.bi.to/|verbo, 1ª p. sing. presente|eu moro|Abito a Firenze.
escrever|scrivere|/ˈskri.ve.re/|verbo, infinitivo|escrever|Devo scrivere una lettera.
ler|leggere|/ˈlɛd.dʒe.re/|verbo, infinitivo|ler|Mi piace leggere.
dançar|ballare|/balˈla.re/|verbo, infinitivo|dançar|Andiamo a ballare!
casar|sposare|/spoˈza.re/|verbo, infinitivo|casar|Vuole sposare Giulia.
mudar|cambiare|/kamˈbja.re/|verbo, infinitivo|mudar, trocar|Voglio cambiare casa.
bonito|bello|/ˈbɛl.lo/|adj. masc.|bonito, belo|Che bel posto!
bonita|bella|/ˈbɛl.la/|adj. fem.|bonita, bela|Sei molto bella.
feio|brutto|/ˈbrut.to/|adj. masc.|feio|Che brutto tempo.
pequeno|piccolo|/ˈpik.ko.lo/|adj. masc.|pequeno|Ho un cane piccolo.
pequena|piccola|/ˈpik.ko.la/|adj. fem.|pequena|È una casa piccola.
novo|nuovo|/ˈnwɔ.vo/|adj. masc.|novo|Ho un telefono nuovo.
nova|nuova|/ˈnwɔ.va/|adj. fem.|nova|È una macchina nuova.
velho|vecchio|/ˈvɛk.kjo/|adj. masc.|velho|È un vecchio amico.
velha|vecchia|/ˈvɛk.kja/|adj. fem.|velha|Abita in una casa vecchia.
bom|buono|/ˈbwɔ.no/|adj. masc.|bom|Questo vino è buono.
boa|buona|/ˈbwɔ.na/|adj. fem.|boa|Buona fortuna!
ruim|cattivo|/katˈti.vo/|adj. masc.|ruim, mau|Ha un sapore cattivo.
feliz|felice|/feˈli.tʃe/|adj.|feliz|Sono felice di vederti.
cansado|stanco|/ˈstan.ko/|adj. masc.|cansado|Sono molto stanco.
cansada|stanca|/ˈstan.ka/|adj. fem.|cansada|Lei è stanca.
rápido|veloce|/veˈlo.tʃe/|adj.|rápido, veloz|È un treno veloce.
difícil|difficile|/difˈfi.tʃi.le/|adj.|difícil|È un esame difficile.
fácil|facile|/ˈfa.tʃi.le/|adj.|fácil|Non è facile.
certo|giusto|/ˈdʒus.to/|adj. masc.|certo, correto|Hai ragione, è giusto.
errado|sbagliato|/zbaʎˈʎa.to/|adj. masc.|errado|È il numero sbagliato.
louco|pazzo|/ˈpat.tso/|adj. masc.|louco|Sei pazzo?
louca|pazza|/ˈpat.tsa/|adj. fem.|louca|È una storia pazza.
sozinho|da solo|/da ˈso.lo/|loc. adj. masc.|sozinho|Vivo da solo.
sozinha|da sola|/da ˈso.la/|loc. adj. fem.|sozinha|È venuta da sola.
quente|caldo|/ˈkal.do/|adj. masc.|quente|Il caffè è caldo.
frio|freddo|/ˈfred.do/|adj. masc.|frio|Oggi fa freddo.
cheio|pieno|/ˈpjɛ.no/|adj. masc.|cheio|Il bicchiere è pieno.
vazio|vuoto|/ˈvwɔ.to/|adj. masc.|vazio|Il frigo è vuoto.
lindo|bellissimo|/belˈlis.si.mo/|adj. masc.|lindo|È un panorama bellissimo.
linda|bellissima|/belˈlis.si.ma/|adj. fem.|linda|Sei bellissima.
estranho|strano|/ˈstra.no/|adj. masc.|estranho|È un tipo strano.
perigoso|pericoloso|/pe.ri.koˈlo.zo/|adj. masc.|perigoso|Questo posto è pericoloso.
preocupado|preoccupato|/pre.ok.kuˈpa.to/|adj. masc.|preocupado|Sono preoccupato per te.
querido|caro|/ˈka.ro/|adj. masc.|querido, caro|Caro amico, come stai?
querida|cara|/ˈka.ra/|adj. fem.|querida|Cara, sei pronta?
engraçado|divertente|/di.verˈtɛn.te/|adj.|engraçado, divertido|È un film divertente.
rico|ricco|/ˈrik.ko/|adj. masc.|rico|È un uomo ricco.
pobre|povero|/ˈpɔ.ve.ro/|adj. masc.|pobre|Povero ragazzo!
melhor|migliore|/miʎˈʎo.re/|adj.|melhor|È il mio migliore amico.
pior|peggiore|/pedˈdʒo.re/|adj.|pior|È il giorno peggiore della mia vita.
primeiro|primo|/ˈpri.mo/|adj. masc.|primeiro|È il mio primo giorno.
primeira|prima|/ˈpri.ma/|adj. fem.|primeira|È la prima volta.
agora|adesso|/aˈdɛs.so/|adv.|agora|Adesso devo andare.
hoje|oggi|/ˈɔd.dʒi/|adv.|hoje|Oggi fa caldo.
amanhã|domani|/doˈma.ni/|adv.|amanhã|Ci vediamo domani.
ontem|ieri|/ˈjɛ.ri/|adv.|ontem|Ieri sono andato al mare.
nunca|mai|/mai/|adv.|nunca|Non ho mai visto Roma.
também|anche|/ˈan.ke/|adv.|também|Vengo anche io.
muito|molto|/ˈmol.to/|adv.|muito|Grazie, sei molto gentile.
muita|molta|/ˈmol.ta/|adj. fem.|muita|C'è molta gente.
muitos|molti|/ˈmol.ti/|adj. masc. plural|muitos|Ho molti amici.
pouco|poco|/ˈpɔ.ko/|adv.|pouco|Parlo poco italiano.
aqui|qui|/kwi/|adv.|aqui|Vieni qui.
ali|lì|/li/|adv.|ali|Mettilo lì.
depois|dopo|/ˈdo.po/|adv.|depois|Ci vediamo dopo.
antes|prima|/ˈpri.ma/|adv.|antes|Prima mangiamo, poi usciamo.
ainda|ancora|/anˈko.ra/|adv.|ainda|Sei ancora qui?
já|già|/dʒa/|adv.|já|Ho già mangiato.
talvez|forse|/ˈfor.se/|adv.|talvez|Forse domani piove.
longe|lontano|/lonˈta.no/|adv.|longe|Abita lontano.
perto|vicino|/viˈtʃi.no/|adv.|perto|La stazione è vicino.
juntos|insieme|/inˈsjɛ.me/|adv.|juntos|Andiamo insieme.
realmente|davvero|/davˈve.ro/|adv.|realmente, de verdade|Sei davvero gentile.
só|solo|/ˈso.lo/|adv.|só, apenas|È solo un gioco.
nada|niente|/ˈnjɛn.te/|pron.|nada|Non ho fatto niente.
tudo|tutto|/ˈtut.to/|pron.|tudo|Ho capito tutto.
todos|tutti|/ˈtut.ti/|pron. plural|todos|Ciao a tutti!
alguém|qualcuno|/kwalˈku.no/|pron.|alguém|C'è qualcuno?
ninguém|nessuno|/nesˈsu.no/|pron.|ninguém|Non c'è nessuno.
algo|qualcosa|/kwalˈkɔ.za/|pron.|algo, alguma coisa|Vuoi qualcosa da bere?
porque|perché|/perˈke/|conj.|porque|Resto a casa perché piove.
onde|dove|/ˈdo.ve/|adv.|onde|Dove sei?
`;

// Forma de dicionário (lema) do italiano quando o target é flexionado. Chave = fonte em português.
// Sem entrada aqui, o lema é o próprio target em minúsculas.
const LEMMAS = {
  dias: 'giorno', noites: 'notte', anos: 'anno', vezes: 'volta', coisas: 'cosa', homens: 'uomo',
  mulheres: 'donna', filhos: 'figlio', amigos: 'amico', crianças: 'bambino', palavras: 'parola',
  mãos: 'mano', olhos: 'occhio', festas: 'festa', problemas: 'problema', roupas: 'vestito',
  quero: 'volere', quer: 'volere', queria: 'volere', preciso: 'avere bisogno', precisa: 'avere bisogno',
  sei: 'sapere', sabe: 'sapere', vou: 'andare', vai: 'andare', vamos: 'andare', tenho: 'avere',
  temos: 'avere', faz: 'fare', fiz: 'fare', falando: 'parlare', vi: 'vedere', olha: 'guardare',
  espera: 'aspettare', acho: 'credere', acredito: 'credere', entendo: 'capire', entendeu: 'capire',
  lembro: 'ricordare', conheço: 'conoscere', gosto: 'piacere', chegou: 'arrivare', volto: 'tornare',
  fica: 'restare', deixa: 'lasciare', pode: 'potere', podemos: 'potere', estou: 'essere', somos: 'essere',
  chamo: 'chiamarsi', moro: 'abitare', bonita: 'bello', pequena: 'piccolo', nova: 'nuovo', velha: 'vecchio',
  boa: 'buono', cansada: 'stanco', louca: 'pazzo', sozinha: 'da solo', linda: 'bellissimo', querida: 'caro',
  primeira: 'primo', muita: 'molto', muitos: 'molto', todos: 'tutto',
};

function build() {
  const entries = new Map();
  for (const line of RAW.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const [source, target, ipa, pos, meaning, example] = t.split('|').map((s) => s.trim());
    const key = source.toLowerCase();
    const lemma = LEMMAS[key] ?? target.toLowerCase();
    entries.set(key, { source, target, lemma, ipa, pos, meaning, example });
  }
  return entries;
}

export const PT_IT = build();
