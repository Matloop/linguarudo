#!/usr/bin/env bash
# Gera prototypes/musica-sincronia-v2.html com o cérebro de verdade embutido.
set -euo pipefail
cd "$(dirname "$0")/.."
js=$(mktemp)
bun build prototypes/musica-sincronia-v2.ts --target=browser --format=iife --outfile="$js" >/dev/null
out=prototypes/musica-sincronia-v2.html
cat >"$out" <<'HTML'
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Linguetta · nova sincronia (protótipo)</title>
<style>
:root{--bg:#f6f1e7;--card:#fffdf8;--ink:#2b2622;--mute:#8a8178;--line:#e6ddcf;--acc:#b5532f;--ok:#3f7d4e;--err:#b23a3a;--sel:#2f5d8a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
header{display:flex;gap:16px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:15px;margin:0;font-weight:600}
header .sp{flex:1}
header label{color:var(--mute);font-size:13px}
main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:20px;padding:20px;max-width:1200px;margin:auto}
.video{background:#1f1b18;color:#f3ead9;border-radius:14px;padding:16px 18px;margin-bottom:14px}
.video .row{display:flex;justify-content:space-between;font-size:13px;opacity:.85}
.bar{height:4px;background:#ffffff22;border-radius:2px;margin-top:10px}
#fill{height:100%;background:#e8b48a;border-radius:2px;width:0}
#sung{font-size:16px;margin-top:6px}
.lyrics{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 8px}
.lin{margin:0;padding:6px 12px;border-radius:10px;color:var(--mute);font-size:17px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;transition:color .2s,background .2s}
.lin.on{color:var(--ink);background:#f3e6d6;font-weight:600}
.lin.sel{outline:2px solid var(--sel);outline-offset:-2px}
.lin.cut{opacity:.45}
.lin small{font-size:12px;font-style:italic}
.pick{all:unset;cursor:pointer;flex:1}
.w{all:unset;cursor:pointer;border-radius:4px}
.w:hover{background:#0000000d}
.ok{color:var(--ok)}.err{color:var(--err);text-decoration:line-through}
.gap{display:inline-block;width:4.2em;border-bottom:2px solid currentColor;height:1em;vertical-align:-2px}
.anc{font-size:12px;font-weight:500;padding:1px 7px;border-radius:999px;background:#2f5d8a1a;color:var(--sel)}
.anc.auto{background:#b5532f1a;color:var(--acc)}
aside{display:flex;flex-direction:column;gap:12px}
.box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
.box h2{font-size:13px;margin:0 0 8px;color:var(--mute);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;padding:6px 10px}
button:hover:not(:disabled){border-color:var(--ink)}
button:disabled{opacity:.4;cursor:default}
button.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
#ops{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.op.ok{border-color:var(--ok);color:var(--ok)}.op.err{border-color:var(--err);color:var(--err)}.op.dim{opacity:.4}
kbd{font:11px ui-monospace,monospace;border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--mute)}
#notice{min-height:1.5em;color:var(--acc);font-size:14px}
#status{font-weight:600}
#score{color:var(--mute);font-size:13px}
#panel{border-color:var(--sel)}
#mark{width:100%;text-align:left;padding:10px;margin:6px 0}
#segs{list-style:none;margin:8px 0;padding:0;font-size:14px}
#segs li{display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-radius:8px}
#segs li.cur{background:#2f5d8a12}
#segs .vazio{color:var(--mute);font-style:italic}
.x{padding:0 6px;border:none;color:var(--mute)}
#strip{position:relative;height:34px;background:#f0e8db;border-radius:8px;margin:10px 0;overflow:hidden}
#strip i{position:absolute;top:6px;height:12px;background:#2b262255;border-radius:3px}
#strip i.sel{background:var(--sel)}
#strip i.cut{background:none;border:1px dashed var(--mute)}
#strip b{position:absolute;top:20px;width:2px;height:10px;background:var(--acc)}
#strip em{position:absolute;top:0;bottom:0;width:2px;background:var(--ink)}
.legend{font-size:12px;color:var(--mute)}
#rate{background:#b5532f12;border-radius:10px;padding:8px;font-size:14px;margin:8px 0}
#log{font:12px ui-monospace,monospace;color:var(--mute);padding-left:16px;margin:0}
#over,#card{border-color:var(--acc)}
body[data-mode=sync] #game-box{opacity:.5}
.hint{font-size:13px;color:var(--mute)}
</style>
</head>
<body>
<header>
  <h1>Nova sincronia · protótipo sobre o cérebro real</h1>
  <span class="hint">clipe com intro 10 s maior e pausa de 8 s antes da linha 5</span>
  <span class="sp"></span>
  <label><input type="checkbox" id="quirks" checked /> player com manias (seek lento, keyframe 2 s, buffering)</label>
  <button id="reset">Recomeçar tudo</button>
</header>
<main>
  <section>
    <div class="video">
      <div class="row"><span>▶ vídeo (falso)</span><span id="clock"></span></div>
      <div id="sung"></div>
      <div class="bar"><div id="fill"></div></div>
    </div>
    <div class="lyrics" id="lyrics"></div>
  </section>
  <aside>
    <div class="box" id="game-box">
      <div class="row" style="justify-content:space-between"><span id="status"></span><span id="wait"></span></div>
      <div id="score"></div>
      <div id="ops"></div>
      <div id="notice"></div>
      <div class="row">
        <button id="pause"></button><button id="repeat">Repetir linha</button><button id="speed">0,75×</button>
      </div>
      <div class="row" style="margin-top:8px">
        <span class="hint">Sincronia</span><button id="minus">−</button><b id="offset"></b><button id="plus">+</button>
        <button id="open" class="pri">Sincronizar <kbd>S</kbd></button>
      </div>
    </div>
    <div class="box" id="panel" hidden>
      <h2>Sincronizar</h2>
      <p class="hint" style="margin:0">Toque numa linha quando ela começar a ser cantada. <kbd>↑</kbd><kbd>↓</kbd> escolhem, <kbd>Espaço</kbd> marca de novo.</p>
      <button id="mark"></button>
      <div class="row">
        <span class="hint">Trecho atual</span>
        <button id="n-1">−1 s</button><button id="n-01">−0,1</button><b id="seg-offset"></b><button id="n+01">+0,1</button><button id="n+1">+1 s</button>
      </div>
      <div id="rate" hidden><span id="rate-text"></span> <button id="accept">Usar</button></div>
      <ul id="segs"></ul>
      <div id="strip"></div>
      <div class="legend">barras = linhas no vídeo (azul = escolhida, tracejada = cortada) · laranja = onde é cantada de verdade</div>
      <div class="row" style="margin-top:8px">
        <button id="play"></button><button id="back">−5 s</button><button id="restart">Do início</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button id="auto"></button>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="undo">Desfazer</button><button id="zero">Zerar</button><span class="sp" style="flex:1"></span>
        <button id="cancel">Cancelar</button><button id="conclude" class="pri">Concluir</button>
      </div>
    </div>
    <div class="box" id="over" hidden>
      <h2>Fim de jogo</h2>
      <p id="over-line"></p>
      <div class="row"><button id="continue" class="pri">Continuar</button><button id="retry">Tentar de novo</button><button id="leave">Sair</button></div>
    </div>
    <div class="box" id="card" hidden>
      <h2>Cartão da palavra</h2>
      <p id="card-text"></p>
      <button id="close-card">Fechar</button>
    </div>
    <div class="box"><h2>O que o jogo mandou o player fazer</h2><ol id="log"></ol></div>
  </aside>
</main>
<script>
HTML
cat "$js" >>"$out"
printf '\n</script>\n</body>\n</html>\n' >>"$out"
rm "$js"
echo "$out"
