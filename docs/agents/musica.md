# Jogo de música

- O player do YouTube não é confiável para regra de jogo: o seek chega depois (e `getCurrentTime` segue devolvendo o tempo antigo), cai no keyframe antes do alvo, `seekTo` fora da pausa dá play, e os eventos de estado chegam atrasados. Toda a regra mora no `MusicController` (`src/lib/music/controller.ts`, TS puro, efeitos como dado); o `sim/` reproduz essas manias num relógio virtual e o `fake-youtube.ts` dos e2e também. Bug novo vira teste em `sim/bugs.test.ts` antes da correção.
- Letra fora do tempo raramente é um deslocamento só: clipes têm intro, pausas e cortes. A linha do tempo é por trechos (cada âncora começa um trecho de deslocamento constante; linhas engolidas pela âncora seguinte são "não está no vídeo"). Velocidade só é sugerida com 3+ âncoras coerentes, nunca aplicada sozinha.
- O áudio do iframe não é acessível (cross-origin): a sincronia automática usa o áudio da aba (`getDisplayMedia`) com Whisper no navegador; marca manual sempre vence a automática.
