// Dicionário PT→IT embutido para o provider mock.
// Formato de cada linha: português | italiano | IPA | classe (em português) | significado
// Palavras idênticas nas duas línguas (casa, porta, grande...) ficam de fora de propósito.

const RAW = `
de novo|di nuovo|/di ˈnwɔ.vo/|loc. adv.|outra vez, novamente
por favor|per favore|/per faˈvo.re/|expr.|pedido educado
bom dia|buongiorno|/bwonˈdʒor.no/|expr.|saudação da manhã
tudo bem|tutto bene|/ˈtut.to ˈbɛ.ne/|expr.|está tudo certo
com certeza|di sicuro|/di siˈku.ro/|loc. adv.|certamente, sem dúvida
de repente|all'improvviso|/al.lim.provˈvi.zo/|loc. adv.|subitamente, sem aviso
sinto muito|mi dispiace|/mi disˈpja.tʃe/|expr.|lamento, peço desculpas
muito obrigado|grazie mille|/ˈɡrat.tsje ˈmil.le/|expr.|agradecimento enfático
obrigado|grazie|/ˈɡrat.tsje/|expr.|agradecimento
obrigada|grazie|/ˈɡrat.tsje/|expr.|agradecimento
dia|giorno|/ˈdʒor.no/|subst. masc.|dia, período de 24 horas
dias|giorni|/ˈdʒor.ni/|subst. masc. plural|dias
noite|notte|/ˈnɔt.te/|subst. fem.|noite
noites|notti|/ˈnɔt.ti/|subst. fem. plural|noites
manhã|mattina|/matˈti.na/|subst. fem.|manhã
ano|anno|/ˈan.no/|subst. masc.|ano
anos|anni|/ˈan.ni/|subst. masc. plural|anos; idade
semana|settimana|/set.tiˈma.na/|subst. fem.|semana
mês|mese|/ˈme.ze/|subst. masc.|mês
hora|ora|/ˈo.ra/|subst. fem.|hora
vez|volta|/ˈvɔl.ta/|subst. fem.|vez, ocasião
vezes|volte|/ˈvɔl.te/|subst. fem. plural|vezes
coisa|cosa|/ˈkɔ.za/|subst. fem.|coisa
coisas|cose|/ˈkɔ.ze/|subst. fem. plural|coisas
homem|uomo|/ˈwɔ.mo/|subst. masc.|homem
homens|uomini|/ˈwɔ.mi.ni/|subst. masc. plural|homens
mulher|donna|/ˈdɔn.na/|subst. fem.|mulher
mulheres|donne|/ˈdɔn.ne/|subst. fem. plural|mulheres
filho|figlio|/ˈfiʎ.ʎo/|subst. masc.|filho
filha|figlia|/ˈfiʎ.ʎa/|subst. fem.|filha
filhos|figli|/ˈfiʎ.ʎi/|subst. masc. plural|filhos
pai|padre|/ˈpa.dre/|subst. masc.|pai
mãe|madre|/ˈma.dre/|subst. fem.|mãe
irmão|fratello|/fraˈtɛl.lo/|subst. masc.|irmão
irmã|sorella|/soˈrɛl.la/|subst. fem.|irmã
amigo|amico|/aˈmi.ko/|subst. masc.|amigo
amiga|amica|/aˈmi.ka/|subst. fem.|amiga
amigos|amici|/aˈmi.tʃi/|subst. masc. plural|amigos
criança|bambino|/bamˈbi.no/|subst. masc.|criança
crianças|bambini|/bamˈbi.ni/|subst. masc. plural|crianças
menino|bambino|/bamˈbi.no/|subst. masc.|menino
menina|bambina|/bamˈbi.na/|subst. fem.|menina
garoto|ragazzo|/raˈɡat.tso/|subst. masc.|garoto, rapaz
garota|ragazza|/raˈɡat.tsa/|subst. fem.|garota, moça
namorado|fidanzato|/fi.danˈtsa.to/|subst. masc.|namorado
namorada|fidanzata|/fi.danˈtsa.ta/|subst. fem.|namorada
vizinho|vicino|/viˈtʃi.no/|subst. masc.|vizinho
chefe|capo|/ˈka.po/|subst. masc.|chefe
cidade|città|/tʃitˈta/|subst. fem.|cidade
rua|strada|/ˈstra.da/|subst. fem.|rua
caminho|cammino|/kamˈmi.no/|subst. masc.|caminho, percurso
carro|macchina|/ˈmak.ki.na/|subst. fem.|carro, automóvel
dinheiro|soldi|/ˈsɔl.di/|subst. masc. plural|dinheiro
trabalho|lavoro|/laˈvo.ro/|subst. masc.|trabalho, emprego
escola|scuola|/ˈskwɔ.la/|subst. fem.|escola
janela|finestra|/fiˈnɛs.tra/|subst. fem.|janela
mesa|tavolo|/ˈta.vo.lo/|subst. masc.|mesa
cama|letto|/ˈlɛt.to/|subst. masc.|cama
quarto|camera|/ˈka.me.ra/|subst. fem.|quarto, cômodo
cozinha|cucina|/kuˈtʃi.na/|subst. fem.|cozinha
comida|cibo|/ˈtʃi.bo/|subst. masc.|comida, alimento
água|acqua|/ˈak.kwa/|subst. fem.|água
café|caffè|/kafˈfɛ/|subst. masc.|café
pão|pane|/ˈpa.ne/|subst. masc.|pão
vinho|vino|/ˈvi.no/|subst. masc.|vinho
cachorro|cane|/ˈka.ne/|subst. masc.|cachorro, cão
gato|gatto|/ˈɡat.to/|subst. masc.|gato
livro|libro|/ˈli.bro/|subst. masc.|livro
palavra|parola|/paˈrɔ.la/|subst. fem.|palavra
palavras|parole|/paˈrɔ.le/|subst. fem. plural|palavras
mundo|mondo|/ˈmon.do/|subst. masc.|mundo
vida|vita|/ˈvi.ta/|subst. fem.|vida
amor|amore|/aˈmo.re/|subst. masc.|amor
coração|cuore|/ˈkwɔ.re/|subst. masc.|coração
cabeça|testa|/ˈtɛs.ta/|subst. fem.|cabeça
mão|mano|/ˈma.no/|subst. fem.|mão
mãos|mani|/ˈma.ni/|subst. fem. plural|mãos
olho|occhio|/ˈɔk.kjo/|subst. masc.|olho
olhos|occhi|/ˈɔk.ki/|subst. masc. plural|olhos
rosto|viso|/ˈvi.zo/|subst. masc.|rosto, cara
festas|feste|/ˈfɛs.te/|subst. fem. plural|festas, celebrações
problemas|problemi|/proˈblɛ.mi/|subst. masc. plural|problemas
verdade|verità|/ve.riˈta/|subst. fem.|verdade
pergunta|domanda|/doˈman.da/|subst. fem.|pergunta
resposta|risposta|/risˈpos.ta/|subst. fem.|resposta
história|storia|/ˈstɔ.rja/|subst. fem.|história
lugar|posto|/ˈpos.to/|subst. masc.|lugar
país|paese|/paˈe.ze/|subst. masc.|país
mar|mare|/ˈma.re/|subst. masc.|mar
céu|cielo|/ˈtʃɛ.lo/|subst. masc.|céu
sol|sole|/ˈso.le/|subst. masc.|sol
chuva|pioggia|/ˈpjɔd.dʒa/|subst. fem.|chuva
polícia|polizia|/po.litˈtsi.a/|subst. fem.|polícia
hospital|ospedale|/o.speˈda.le/|subst. masc.|hospital
telefone|telefono|/teˈlɛ.fo.no/|subst. masc.|telefone
jogo|gioco|/ˈdʒɔ.ko/|subst. masc.|jogo, brincadeira
chave|chiave|/ˈkja.ve/|subst. fem.|chave
roupas|vestiti|/vesˈti.ti/|subst. masc. plural|roupas
sapato|scarpa|/ˈskar.pa/|subst. fem.|sapato
fome|fame|/ˈfa.me/|subst. fem.|fome
medo|paura|/paˈu.ra/|subst. fem.|medo
sonho|sogno|/ˈsoɲ.ɲo/|subst. masc.|sonho
ideia|idea|/iˈdɛ.a/|subst. fem.|ideia
casamento|matrimonio|/ma.triˈmɔ.njo/|subst. masc.|casamento
igreja|chiesa|/ˈkjɛ.za/|subst. fem.|igreja
loja|negozio|/neˈɡɔt.tsjo/|subst. masc.|loja
praia|spiaggia|/ˈspjad.dʒa/|subst. fem.|praia
trem|treno|/ˈtrɛ.no/|subst. masc.|trem
avião|aereo|/aˈɛ.re.o/|subst. masc.|avião
viagem|viaggio|/ˈvjad.dʒo/|subst. masc.|viagem
almoço|pranzo|/ˈpran.dzo/|subst. masc.|almoço
erro|errore|/erˈro.re/|subst. masc.|erro
sorte|fortuna|/forˈtu.na/|subst. fem.|sorte
segredo|segreto|/seˈɡre.to/|subst. masc.|segredo
dor|dolore|/doˈlo.re/|subst. masc.|dor
força|forza|/ˈfɔr.tsa/|subst. fem.|força
quero|voglio|/ˈvɔʎ.ʎo/|verbo, 1ª p. sing. presente|eu quero (querer)
quer|vuole|/ˈvwɔ.le/|verbo, 3ª p. sing. presente|ele/ela/você quer (querer)
queria|volevo|/voˈle.vo/|verbo, 1ª p. sing. imperfeito|eu queria (querer)
preciso|ho bisogno|/ɔ biˈzoɲ.ɲo/|verbo, 1ª p. sing. presente|eu preciso (precisar)
precisa|ha bisogno|/a biˈzoɲ.ɲo/|verbo, 3ª p. sing. presente|ele/ela/você precisa
sei|so|/sɔ/|verbo, 1ª p. sing. presente|eu sei (saber)
sabe|sa|/sa/|verbo, 3ª p. sing. presente|ele/ela/você sabe (saber)
vou|vado|/ˈva.do/|verbo, 1ª p. sing. presente|eu vou (ir)
vai|va|/va/|verbo, 3ª p. sing. presente|ele/ela/você vai (ir)
vamos|andiamo|/anˈdja.mo/|verbo, 1ª p. plural presente|nós vamos; vamos! (ir)
tenho|ho|/ɔ/|verbo, 1ª p. sing. presente|eu tenho (ter)
temos|abbiamo|/abˈbja.mo/|verbo, 1ª p. plural presente|nós temos (ter)
fazer|fare|/ˈfa.re/|verbo, infinitivo|fazer
faz|fa|/fa/|verbo, 3ª p. sing. presente|ele/ela/você faz (fazer)
fiz|ho fatto|/ɔ ˈfat.to/|verbo, 1ª p. sing. passado|eu fiz (fazer)
dizer|dire|/ˈdi.re/|verbo, infinitivo|dizer
falar|parlare|/parˈla.re/|verbo, infinitivo|falar
falando|parlando|/parˈlan.do/|verbo, gerúndio|falando
ver|vedere|/veˈde.re/|verbo, infinitivo|ver
vi|ho visto|/ɔ ˈvis.to/|verbo, 1ª p. sing. passado|eu vi (ver)
olha|guarda|/ˈɡwar.da/|verbo, imperativo|olhe, veja
ouvir|sentire|/senˈti.re/|verbo, infinitivo|ouvir, escutar
comer|mangiare|/manˈdʒa.re/|verbo, infinitivo|comer
beber|bere|/ˈbe.re/|verbo, infinitivo|beber
dormir|dormire|/dorˈmi.re/|verbo, infinitivo|dormir
morrer|morire|/moˈri.re/|verbo, infinitivo|morrer
viver|vivere|/ˈvi.ve.re/|verbo, infinitivo|viver
ajudar|aiutare|/a.juˈta.re/|verbo, infinitivo|ajudar
ajuda|aiuto|/aˈju.to/|subst. masc.|ajuda, socorro
esperar|aspettare|/as.petˈta.re/|verbo, infinitivo|esperar, aguardar
espera|aspetta|/asˈpɛt.ta/|verbo, imperativo|espere, aguarde
encontrar|trovare|/troˈva.re/|verbo, infinitivo|encontrar, achar
acho|credo|/ˈkre.do/|verbo, 1ª p. sing. presente|eu acho, penso
acredito|credo|/ˈkre.do/|verbo, 1ª p. sing. presente|eu acredito
entender|capire|/kaˈpi.re/|verbo, infinitivo|entender, compreender
entendo|capisco|/kaˈpis.ko/|verbo, 1ª p. sing. presente|eu entendo
entendeu|hai capito|/ai kaˈpi.to/|verbo, 2ª p. sing. passado|você entendeu
lembrar|ricordare|/ri.korˈda.re/|verbo, infinitivo|lembrar, recordar
lembro|ricordo|/riˈkɔr.do/|verbo, 1ª p. sing. presente|eu lembro
esquecer|dimenticare|/di.men.tiˈka.re/|verbo, infinitivo|esquecer
conhecer|conoscere|/koˈnoʃ.ʃe.re/|verbo, infinitivo|conhecer
conheço|conosco|/koˈnos.ko/|verbo, 1ª p. sing. presente|eu conheço
gosto|mi piace|/mi ˈpja.tʃe/|verbo, 1ª p. sing. presente|eu gosto
trabalhar|lavorare|/la.voˈra.re/|verbo, infinitivo|trabalhar
chegar|arrivare|/ar.riˈva.re/|verbo, infinitivo|chegar
chegou|è arrivato|/ɛ ar.riˈva.to/|verbo, 3ª p. sing. passado|ele chegou
sair|uscire|/uʃˈʃi.re/|verbo, infinitivo|sair
voltar|tornare|/torˈna.re/|verbo, infinitivo|voltar, retornar
volto|torno|/ˈtor.no/|verbo, 1ª p. sing. presente|eu volto
ficar|restare|/resˈta.re/|verbo, infinitivo|ficar, permanecer
fica|resta|/ˈrɛs.ta/|verbo, 3ª p. sing. / imperativo|fique; ele fica
correr|correre|/ˈkor.re.re/|verbo, infinitivo|correr
andar|camminare|/kam.miˈna.re/|verbo, infinitivo|andar, caminhar
abrir|aprire|/aˈpri.re/|verbo, infinitivo|abrir
fechar|chiudere|/ˈkju.de.re/|verbo, infinitivo|fechar
pegar|prendere|/ˈprɛn.de.re/|verbo, infinitivo|pegar, apanhar
deixar|lasciare|/laʃˈʃa.re/|verbo, infinitivo|deixar
deixa|lascia|/ˈlaʃ.ʃa/|verbo, imperativo|deixe
perder|perdere|/ˈpɛr.de.re/|verbo, infinitivo|perder
ganhar|vincere|/ˈvin.tʃe.re/|verbo, infinitivo|ganhar, vencer
comprar|comprare|/komˈpra.re/|verbo, infinitivo|comprar
pagar|pagare|/paˈɡa.re/|verbo, infinitivo|pagar
matar|uccidere|/utˈtʃi.de.re/|verbo, infinitivo|matar
brincar|giocare|/dʒoˈka.re/|verbo, infinitivo|brincar, jogar
chorar|piangere|/ˈpjan.dʒe.re/|verbo, infinitivo|chorar
rir|ridere|/ˈri.de.re/|verbo, infinitivo|rir
começar|cominciare|/ko.minˈtʃa.re/|verbo, infinitivo|começar
acabar|finire|/fiˈni.re/|verbo, infinitivo|acabar, terminar
tentar|provare|/proˈva.re/|verbo, infinitivo|tentar
pode|può|/pwɔ/|verbo, 3ª p. sing. presente|ele/ela/você pode
podemos|possiamo|/posˈsja.mo/|verbo, 1ª p. plural presente|nós podemos
estou|sono|/ˈso.no/|verbo, 1ª p. sing. presente|eu estou (estar)
somos|siamo|/ˈsja.mo/|verbo, 1ª p. plural presente|nós somos (ser)
chamo|mi chiamo|/mi ˈkja.mo/|verbo, 1ª p. sing. presente|eu me chamo
moro|abito|/ˈa.bi.to/|verbo, 1ª p. sing. presente|eu moro
escrever|scrivere|/ˈskri.ve.re/|verbo, infinitivo|escrever
ler|leggere|/ˈlɛd.dʒe.re/|verbo, infinitivo|ler
dançar|ballare|/balˈla.re/|verbo, infinitivo|dançar
casar|sposare|/spoˈza.re/|verbo, infinitivo|casar
mudar|cambiare|/kamˈbja.re/|verbo, infinitivo|mudar, trocar
bonito|bello|/ˈbɛl.lo/|adj. masc.|bonito, belo
bonita|bella|/ˈbɛl.la/|adj. fem.|bonita, bela
feio|brutto|/ˈbrut.to/|adj. masc.|feio
pequeno|piccolo|/ˈpik.ko.lo/|adj. masc.|pequeno
pequena|piccola|/ˈpik.ko.la/|adj. fem.|pequena
novo|nuovo|/ˈnwɔ.vo/|adj. masc.|novo
nova|nuova|/ˈnwɔ.va/|adj. fem.|nova
velho|vecchio|/ˈvɛk.kjo/|adj. masc.|velho
velha|vecchia|/ˈvɛk.kja/|adj. fem.|velha
bom|buono|/ˈbwɔ.no/|adj. masc.|bom
boa|buona|/ˈbwɔ.na/|adj. fem.|boa
ruim|cattivo|/katˈti.vo/|adj. masc.|ruim, mau
feliz|felice|/feˈli.tʃe/|adj.|feliz
cansado|stanco|/ˈstan.ko/|adj. masc.|cansado
cansada|stanca|/ˈstan.ka/|adj. fem.|cansada
rápido|veloce|/veˈlo.tʃe/|adj.|rápido, veloz
difícil|difficile|/difˈfi.tʃi.le/|adj.|difícil
fácil|facile|/ˈfa.tʃi.le/|adj.|fácil
certo|giusto|/ˈdʒus.to/|adj. masc.|certo, correto
errado|sbagliato|/zbaʎˈʎa.to/|adj. masc.|errado
louco|pazzo|/ˈpat.tso/|adj. masc.|louco
louca|pazza|/ˈpat.tsa/|adj. fem.|louca
sozinho|da solo|/da ˈso.lo/|loc. adj. masc.|sozinho
sozinha|da sola|/da ˈso.la/|loc. adj. fem.|sozinha
quente|caldo|/ˈkal.do/|adj. masc.|quente
frio|freddo|/ˈfred.do/|adj. masc.|frio
cheio|pieno|/ˈpjɛ.no/|adj. masc.|cheio
vazio|vuoto|/ˈvwɔ.to/|adj. masc.|vazio
lindo|bellissimo|/belˈlis.si.mo/|adj. masc.|lindo
linda|bellissima|/belˈlis.si.ma/|adj. fem.|linda
estranho|strano|/ˈstra.no/|adj. masc.|estranho
perigoso|pericoloso|/pe.ri.koˈlo.zo/|adj. masc.|perigoso
preocupado|preoccupato|/pre.ok.kuˈpa.to/|adj. masc.|preocupado
querido|caro|/ˈka.ro/|adj. masc.|querido, caro
querida|cara|/ˈka.ra/|adj. fem.|querida
engraçado|divertente|/di.verˈtɛn.te/|adj.|engraçado, divertido
rico|ricco|/ˈrik.ko/|adj. masc.|rico
pobre|povero|/ˈpɔ.ve.ro/|adj. masc.|pobre
melhor|migliore|/miʎˈʎo.re/|adj.|melhor
pior|peggiore|/pedˈdʒo.re/|adj.|pior
primeiro|primo|/ˈpri.mo/|adj. masc.|primeiro
primeira|prima|/ˈpri.ma/|adj. fem.|primeira
agora|adesso|/aˈdɛs.so/|adv.|agora
hoje|oggi|/ˈɔd.dʒi/|adv.|hoje
amanhã|domani|/doˈma.ni/|adv.|amanhã
ontem|ieri|/ˈjɛ.ri/|adv.|ontem
nunca|mai|/mai/|adv.|nunca
também|anche|/ˈan.ke/|adv.|também
muito|molto|/ˈmol.to/|adv.|muito
muita|molta|/ˈmol.ta/|adj. fem.|muita
muitos|molti|/ˈmol.ti/|adj. masc. plural|muitos
pouco|poco|/ˈpɔ.ko/|adv.|pouco
aqui|qui|/kwi/|adv.|aqui
ali|lì|/li/|adv.|ali
depois|dopo|/ˈdo.po/|adv.|depois
antes|prima|/ˈpri.ma/|adv.|antes
ainda|ancora|/anˈko.ra/|adv.|ainda
já|già|/dʒa/|adv.|já
talvez|forse|/ˈfor.se/|adv.|talvez
longe|lontano|/lonˈta.no/|adv.|longe
perto|vicino|/viˈtʃi.no/|adv.|perto
juntos|insieme|/inˈsjɛ.me/|adv.|juntos
realmente|davvero|/davˈve.ro/|adv.|realmente, de verdade
só|solo|/ˈso.lo/|adv.|só, apenas
nada|niente|/ˈnjɛn.te/|pron.|nada
tudo|tutto|/ˈtut.to/|pron.|tudo
todos|tutti|/ˈtut.ti/|pron. plural|todos
alguém|qualcuno|/kwalˈku.no/|pron.|alguém
ninguém|nessuno|/nesˈsu.no/|pron.|ninguém
algo|qualcosa|/kwalˈkɔ.za/|pron.|algo, alguma coisa
porque|perché|/perˈke/|conj.|porque
onde|dove|/ˈdo.ve/|adv.|onde
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
    const [source, target, ipa, pos, meaning] = t.split('|').map((s) => s.trim());
    const key = source.toLowerCase();
    const lemma = LEMMAS[key] ?? target.toLowerCase();
    entries.set(key, { source, target, lemma, ipa, pos, meaning });
  }
  return entries;
}

export const PT_IT = build();
