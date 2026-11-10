// Textos originais da prévia da landing.
import type { Lingua, Origem } from './jogo.ts';

export type Verbete = { ipa: string; classe: string; tr: string; ex: string; exPt: string };

const v = (ipa: string, classe: string, tr: string, ex: string, exPt: string): Verbete => ({
	ipa,
	classe,
	tr,
	ex,
	exPt
});

export const DICIONARIO: Record<Lingua, Record<string, Verbete>> = {
	en: {
		key: v('/kiː/', 'substantivo', 'chave', "I can't find my key.", 'Não acho minha chave.'),
		kitchen: v(
			'/ˈkɪtʃ.ɪn/',
			'substantivo',
			'cozinha',
			'The kitchen smells like coffee.',
			'A cozinha está com cheiro de café.'
		),
		window: v(
			'/ˈwɪn.doʊ/',
			'substantivo',
			'janela',
			'Can you close the window?',
			'Pode fechar a janela?'
		),
		wait: v('/weɪt/', 'verbo', 'esperar', 'Wait for me here.', 'Me espera aqui.'),
		rain: v(
			'/reɪn/',
			'substantivo',
			'chuva',
			'The rain stopped at noon.',
			'A chuva parou ao meio-dia.'
		),
		hear: v('/hɪr/', 'verbo', 'ouvir', 'Can you hear me?', 'Você está me ouvindo?'),
		walking: v(
			'/ˈwɔː.kɪŋ/',
			'verbo (walk)',
			'andando',
			'I like walking at night.',
			'Gosto de andar à noite.'
		),
		morning: v(
			'/ˈmɔːr.nɪŋ/',
			'substantivo',
			'manhã',
			'See you in the morning.',
			'Até amanhã de manhã.'
		),
		bread: v(
			'/brɛd/',
			'substantivo',
			'pão',
			'This bread is still warm.',
			'Este pão ainda está quente.'
		),
		basket: v(
			'/ˈbæs.kɪt/',
			'substantivo',
			'cesta',
			'Put the apples in the basket.',
			'Põe as maçãs na cesta.'
		),
		slowly: v(
			'/ˈsloʊ.li/',
			'advérbio',
			'devagar',
			'Speak slowly, please.',
			'Fale devagar, por favor.'
		)
	},
	it: {
		chiave: v(
			'/ˈkja.ve/',
			'substantivo feminino',
			'chave',
			'Non trovo la chiave.',
			'Não acho a chave.'
		),
		cucina: v(
			'/kuˈtʃi.na/',
			'substantivo feminino',
			'cozinha',
			'La cucina profuma di caffè.',
			'A cozinha está com cheiro de café.'
		),
		finestra: v(
			'/fiˈnɛ.stra/',
			'substantivo feminino',
			'janela',
			'Puoi chiudere la finestra?',
			'Pode fechar a janela?'
		),
		aspettare: v('/a.spetˈta.re/', 'verbo', 'esperar', 'Aspettami qui.', 'Me espera aqui.'),
		pioggia: v(
			'/ˈpjɔd.dʒa/',
			'substantivo feminino',
			'chuva',
			'La pioggia è finita.',
			'A chuva acabou.'
		),
		sento: v(
			'/ˈsɛn.to/',
			'verbo (sentire)',
			'ouço, sinto',
			'Non ti sento bene.',
			'Não estou te ouvindo direito.'
		),
		tempo: v(
			'/ˈtɛm.po/',
			'substantivo masculino',
			'tempo, ritmo',
			'Non ho tempo oggi.',
			'Hoje não tenho tempo.'
		),
		mattina: v(
			'/matˈti.na/',
			'substantivo feminino',
			'manhã',
			'Ci vediamo domani mattina.',
			'A gente se vê amanhã de manhã.'
		),
		pane: v(
			'/ˈpa.ne/',
			'substantivo masculino',
			'pão',
			'Il pane è ancora caldo.',
			'O pão ainda está quente.'
		),
		cesto: v(
			'/ˈtʃe.sto/',
			'substantivo masculino',
			'cesta',
			'Metti le mele nel cesto.',
			'Põe as maçãs na cesta.'
		),
		piano: v(
			'/ˈpja.no/',
			'advérbio',
			'devagar, baixinho',
			'Parla piano, per favore.',
			'Fale devagar, por favor.'
		)
	}
};

export const FILME = {
	falas: [
		'— Você esqueceu a {0} de novo?',
		'— Não. Deixei na {1}, perto da {2}.',
		'— Então a gente vai {3} aqui fora.'
	],
	en: ['key', 'kitchen', 'window', 'wait'],
	it: ['chiave', 'cucina', 'finestra', 'aspettare']
} as const;

export type LinhaMusica = { t: string; pt: string; r: string; ops: string[] };

export const MUSICA: Record<Lingua, { titulo: string; linhas: LinhaMusica[] }> = {
	en: {
		titulo: 'Rain on the Roof',
		linhas: [
			{
				t: 'The {rain} is dancing on the roof',
				pt: 'A chuva está dançando no telhado',
				r: 'rain',
				ops: ['rain', 'rail', 'ran', 'brain']
			},
			{
				t: 'I {hear} your voice across the street',
				pt: 'Ouço sua voz do outro lado da rua',
				r: 'hear',
				ops: ['here', 'hear', 'hair', 'her']
			},
			{
				t: 'So I keep {walking} to the beat',
				pt: 'Então sigo andando no ritmo',
				r: 'walking',
				ops: ['working', 'waking', 'walking', 'wanting']
			}
		]
	},
	it: {
		titulo: 'Pioggia sul tetto',
		linhas: [
			{
				t: 'La {pioggia} balla sul tetto',
				pt: 'A chuva dança no telhado',
				r: 'pioggia',
				ops: ['piazza', 'pioggia', 'poggio', 'peggio']
			},
			{
				t: 'E {sento} la tua voce in strada',
				pt: 'E ouço sua voz na rua',
				r: 'sento',
				ops: ['cento', 'senso', 'sento', 'vento']
			},
			{
				t: 'Cammino a {tempo} col cuore',
				pt: 'Caminho no ritmo do coração',
				r: 'tempo',
				ops: ['tanto', 'tetto', 'tempio', 'tempo']
			}
		]
	}
};

export const LIVRO = {
	paragrafos: [
		'Dona Lúcia chegou cedo à feira, como fazia toda {0}. O cheiro de {1} quente vinha da barraca do canto, e ela parou antes mesmo de ver o preço.',
		'— Sobrou algum? — perguntou.',
		'O rapaz apontou para o {2} vazio e deu de ombros. — Volta amanhã, mais cedo que o sol.',
		'Ela riu, guardou as moedas no bolso e voltou para casa {3}, sem pressa nenhuma.'
	],
	en: ['morning', 'bread', 'basket', 'slowly'],
	it: ['mattina', 'pane', 'cesto', 'piano']
} as const;

export const ORIGEM: Record<Origem, { nome: string; icone: string }> = {
	filme: { nome: 'filme', icone: 'i-filme' },
	musica: { nome: 'música', icone: 'i-musica' },
	livro: { nome: 'livro', icone: 'i-livro' }
};
