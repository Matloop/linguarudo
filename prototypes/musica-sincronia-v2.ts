// Protótipo da nova sincronia: roda o cérebro de verdade (MusicController) sobre o
// player falso com relógio, sem YouTube. Gerar o HTML:
//   bash prototypes/musica-sincronia-v2.build.sh

import {
  MusicController,
  type Effect,
  type MusicEvent,
} from "../apps/web/src/lib/music/controller.ts";
import { mulberry32 } from "../apps/web/src/lib/music/rng.ts";
import { buildSession } from "../apps/web/src/lib/music/session.ts";
import { FakePlayer } from "../apps/web/src/lib/music/sim/fake-player.ts";
import { SIM_LYRICS } from "../apps/web/src/lib/music/sim/simulator.ts";
import { formatOffset } from "../apps/web/src/lib/music/timeline.ts";
import type { LinePart } from "../apps/web/src/lib/music/mask.ts";

// O "clipe": intro 10 s maior que a faixa e uma pausa de 8 s antes da 5ª linha.
const INTRO = 10;
const BREAK_AT = 4;
const BREAK = 8;
const truth = (i: number) =>
  SIM_LYRICS[i].start + INTRO + (i >= BREAK_AT ? BREAK : 0);
const truthEnd = (i: number) =>
  SIM_LYRICS[i].end + INTRO + (i >= BREAK_AT ? BREAK : 0);
const DURATION = truthEnd(SIM_LYRICS.length - 1) + 4;

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;
const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

let player: FakePlayer;
let ctl: MusicController;
let session = buildSession({
  lyrics: SIM_LYRICS,
  lang: "en",
  difficulty: "medio",
  bank: new Map(),
  rng: mulberry32(5),
});
const log: string[] = [];
let autoOn = false;
let autoNext = 0;
const rnd = mulberry32(11);

function quirks() {
  const q = $<HTMLInputElement>("#quirks").checked;
  return q
    ? {
        seekLagMs: 450,
        keyframeS: 2,
        bufferMs: 300,
        stateLagMs: 80,
        jitterS: 0.12,
      }
    : {};
}

function reset() {
  player = new FakePlayer({
    duration: DURATION,
    random: mulberry32(7),
    ...quirks(),
  });
  ctl = new MusicController({
    lines: SIM_LYRICS,
    stored: {
      v: 1,
      rate: 1,
      anchors: [],
      hintDismissed: false,
      lrclibId: null,
    },
  });
  session = buildSession({
    lyrics: SIM_LYRICS,
    lang: "en",
    difficulty: "medio",
    bank: new Map(),
    rng: mulberry32(5),
  });
  log.length = 0;
  autoOn = false;
  lastRev = "";
  send({ type: "start", session });
}

function apply(effects: Effect[], origin: string) {
  for (const e of effects) {
    if (e.type === "play") player.play();
    else if (e.type === "pause") player.pause();
    else if (e.type === "seek") player.seekTo(e.to);
    else if (e.type === "rate") player.setRate(e.rate);
    else {
      log.unshift(`salvo: ${e.sync.anchors.length} âncora(s)`);
      ctl.send({ type: "saved", ok: true }, performance.now());
      continue;
    }
    log.unshift(
      `${origin} → ${e.type}${e.type === "seek" ? ` ${e.to.toFixed(1)}` : ""}`,
    );
  }
  if (log.length > 8) log.length = 8;
}

function send(event: MusicEvent) {
  player.userGesture();
  apply(ctl.send(event, performance.now()), event.type);
  render();
}

// ---------- relógio ----------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(100, now - last);
  last = now;
  for (const s of player.advance(dt)) {
    const ev: MusicEvent =
      s.type === "state"
        ? { type: "playerState", state: s.state }
        : s.type === "ended"
          ? { type: "ended" }
          : { type: "autoplayBlocked" };
    apply(ctl.send(ev, now), "player");
  }
  apply(ctl.frame(player.currentTime(), now), "jogo");
  if (autoOn && ctl.mode === "sync" && now >= autoNext) {
    autoNext = now + 2_500;
    const t = player.trueTime;
    const sung = SIM_LYRICS.findIndex(
      (_, i) => truth(i) <= t && t < truthEnd(i),
    );
    if (sung >= 0) {
      const video = truth(sung) + (rnd() - 0.5) * 0.3;
      apply(ctl.send({ type: "autoAnchor", line: sung, video }, now), "auto");
    }
  }
  render();
  requestAnimationFrame(frame);
}

// ---------- desenho ----------
let lastRev = "";
function partsHtml(parts: LinePart[], line: number, sync: boolean) {
  return parts
    .map((p) => {
      if (p.kind === "sep") return esc(p.text);
      if (p.kind === "gap")
        return '<span class="gap" aria-label="lacuna"></span>';
      const cls = p.mark ? ` class="${p.mark}"` : "";
      return sync
        ? `<span${cls}>${esc(p.text)}</span>`
        : `<button class="w${p.mark ? ` ${p.mark}` : ""}" data-card="${line}:${p.token}">${esc(p.text)}</button>`;
    })
    .join("");
}

function render() {
  const now = performance.now();
  const t = player.trueTime;
  const sung = SIM_LYRICS.findIndex((_, i) => truth(i) <= t && t < truthEnd(i));
  $("#clock").textContent =
    `${t.toFixed(1)} s · ${player.state}${player.rate !== 1 ? " · 0,75×" : ""}`;
  $("#sung").textContent =
    sung >= 0 ? `♪ cantando agora: linha ${sung + 1}` : "♪ (instrumental)";
  $("#fill").style.width = `${(t / DURATION) * 100}%`;
  const wait = ctl.waitMs(now);
  $("#wait").textContent = wait === null ? "" : `${Math.ceil(wait / 1000)} s`;
  $("#log").innerHTML = log.map((l) => `<li>${esc(l)}</li>`).join("");

  const rev = ctl.revision;
  if (rev === lastRev) return;
  lastRev = rev;
  const v = ctl.view();
  const sync = v.sync;
  document.body.dataset.mode = v.mode;

  $("#lyrics").innerHTML = v.lines
    .map((l) => {
      const cls = [
        "lin",
        l.index === v.shownLine ? "on" : "",
        sync && l.index === sync.selected ? "sel" : "",
        !l.present ? "cut" : "",
      ].join(" ");
      const anchor = sync?.anchors.find((a) => a.line === l.index);
      const chip = anchor
        ? `<span class="anc ${anchor.source}">${anchor.source === "auto" ? "auto · " : ""}${formatOffset(anchor.offset)}</span>`
        : "";
      const cut = !l.present ? "<small>não está no vídeo</small>" : "";
      const inner = partsHtml(l.parts, l.index, !!sync);
      return sync
        ? `<p class="${cls}"><button class="pick" data-line="${l.index}">${inner}</button>${chip}${cut}</p>`
        : `<p class="${cls}">${inner}${cut}</p>`;
    })
    .join("");

  $("#score").textContent =
    `${v.score} pts ×${v.combo} · lacuna ${Math.max(1, v.gapNumber)} de ${v.totalGaps}`;
  $("#status").textContent =
    v.mode === "sync"
      ? "Ajustando a sincronia (o jogo está congelado)"
      : v.phase === "waiting"
        ? "A música espera você"
        : v.phase === "paused"
          ? "Pausado"
          : v.phase === "gameover"
            ? "Fim de jogo"
            : v.phase === "finished"
              ? "Fim da música"
              : v.answerable
                ? "Escolha a palavra que falta"
                : "Tocando";
  $("#notice").textContent = v.notice.text;
  $("#offset").textContent = formatOffset(v.offset);
  $("#pause").textContent = v.phase === "paused" ? "Continuar" : "Pausar";

  const options = v.answerable?.options ?? v.feedback?.options ?? [];
  $("#ops").innerHTML = options
    .map((o, i) => {
      const st = v.answerable
        ? ""
        : o === v.feedback?.answer
          ? "ok"
          : o === v.feedback?.chosen
            ? "err"
            : "dim";
      return `<button class="op ${st}" data-op="${esc(o)}" ${v.answerable ? "" : "disabled"}><kbd>${i + 1}</kbd> ${esc(o)}</button>`;
    })
    .join("");

  const over = v.gameOver;
  $("#over").hidden = !over;
  if (over) $("#over-line").innerHTML = partsHtml(over.parts, over.line, true);

  $("#card").hidden = !v.card;
  if (v.card)
    $("#card-text").textContent = v.card.tokens.map((t) => t.text).join("");

  $("#panel").hidden = !sync;
  if (sync) {
    const sel = session.lines[sync.selected];
    const selParts = v.lines[sync.selected]?.parts ?? [];
    $("#mark").innerHTML =
      `Começou agora · ${sel ? partsHtml(selParts, sync.selected, true) : ""} <kbd>Espaço</kbd>`;
    $("#seg-offset").textContent = formatOffset(sync.offset);
    $("#undo").toggleAttribute("disabled", !sync.canUndo);
    $("#auto").textContent = autoOn
      ? "✦ Ouvindo… (parar)"
      : "✦ Sincronizar sozinho";
    $("#play").textContent = sync.videoPlaying ? "Pausar vídeo" : "Tocar vídeo";
    $("#rate").hidden = sync.rateSuggestion === null;
    if (sync.rateSuggestion !== null)
      $("#rate-text").textContent =
        `O vídeo parece tocar a ${sync.rateSuggestion.toFixed(3).replace(".", ",")}× da letra.`;
    $("#segs").innerHTML =
      sync.anchors.length === 0
        ? '<li class="vazio">Nenhuma âncora ainda: toque numa linha quando ela começar.</li>'
        : sync.anchors
            .map(
              (a, i) =>
                `<li class="${i === sync.segment ? "cur" : ""}"><span>Linha ${a.line + 1} → em diante ${a.source === "auto" ? '<span class="anc auto">auto</span>' : ""}</span><span>${formatOffset(a.offset)} <button class="x" data-del="${i}" aria-label="Apagar âncora">✕</button></span></li>`,
            )
            .join("");
    $("#strip").innerHTML =
      v.lines
        .map(
          (l) =>
            `<i class="${l.present ? "" : "cut"} ${l.index === sync.selected ? "sel" : ""}" style="left:${(Math.max(0, l.start) / DURATION) * 100}%;width:${(Math.max(0.2, l.end - l.start) / DURATION) * 100}%"></i>`,
        )
        .join("") +
      SIM_LYRICS.map(
        (_, i) =>
          `<b style="left:${(truth(i) / DURATION) * 100}%" title="onde a linha ${i + 1} é cantada de verdade"></b>`,
      ).join("") +
      `<em style="left:${(ctl.time / DURATION) * 100}%"></em>`;
  }
}

// ---------- entrada ----------
document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest("button");
  if (!el) return;
  const d = el.dataset;
  if (d.line !== undefined)
    return send({ type: "selectLine", line: Number(d.line) });
  if (d.del !== undefined)
    return send({ type: "deleteAnchor", index: Number(d.del) });
  if (d.op !== undefined) return send({ type: "answer", option: d.op });
  if (d.card !== undefined) {
    const [line, token] = d.card.split(":").map(Number);
    return send({ type: "openCard", line, token });
  }
  const map: Record<string, MusicEvent> = {
    pause: { type: "togglePause" },
    repeat: { type: "repeat" },
    speed: { type: "toggleSpeed" },
    minus: { type: "nudge", delta: -0.1 },
    plus: { type: "nudge", delta: 0.1 },
    open: { type: "openSync" },
    mark: { type: "mark" },
    undo: { type: "undo" },
    zero: { type: "zero" },
    cancel: { type: "closeSync", conclude: false },
    conclude: { type: "closeSync", conclude: true },
    "n-1": { type: "nudge", delta: -1 },
    "n-01": { type: "nudge", delta: -0.1 },
    "n+01": { type: "nudge", delta: 0.1 },
    "n+1": { type: "nudge", delta: 1 },
    play: { type: "syncTogglePlay" },
    back: { type: "syncBack", seconds: 5 },
    restart: { type: "syncRestart" },
    accept: { type: "acceptRate" },
    retry: { type: "retry" },
    continue: { type: "continue" },
    leave: { type: "leave" },
    "close-card": { type: "closeCard" },
  };
  if (el.id === "auto") {
    autoOn = !autoOn;
    autoNext = 0;
    lastRev = "";
    render();
    return;
  }
  if (el.id === "reset") return reset();
  const ev = map[el.id];
  if (ev) send(ev);
});

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const step = e.shiftKey ? 1 : 0.1;
  const k = e.key;
  if (ctl.mode === "sync") {
    const keys: Record<string, MusicEvent> = {
      " ": { type: "mark" },
      ArrowUp: { type: "moveSelection", delta: -1 },
      ArrowDown: { type: "moveSelection", delta: 1 },
      ArrowLeft: { type: "nudge", delta: -step },
      ArrowRight: { type: "nudge", delta: step },
      Enter: { type: "closeSync", conclude: true },
      Escape: { type: "closeSync", conclude: false },
      p: { type: "syncTogglePlay" },
    };
    if (keys[k]) {
      e.preventDefault();
      send(keys[k]);
    }
    return;
  }
  const v = ctl.view();
  if (k >= "1" && k <= "4" && v.answerable) {
    const o = v.answerable.options[Number(k) - 1];
    if (o) send({ type: "answer", option: o });
  } else if (k === " ") {
    e.preventDefault();
    send({ type: "togglePause" });
  } else if (k === "s") send({ type: "openSync" });
  else if (k === "r") send({ type: "repeat" });
  else if (k === "Escape") send({ type: "closeCard" });
});

$<HTMLInputElement>("#quirks").addEventListener("change", reset);
reset();
requestAnimationFrame(frame);
