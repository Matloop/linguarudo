# Lado Anki: cria uma coleção, estuda N dias com o agendador real do Anki
# (biblioteca oficial, backend em Rust) e exporta o .apkg com o histórico.
# O relógio é controlado pelo libfaketime (FAKETIME_TIMESTAMP_FILE), então
# rode pelo run.sh, nunca direto.
import argparse, json, os, shutil, sys, tempfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from student import DAY, Student

from anki.collection import Collection, ExportAnkiPackageOptions, DeckIdLimit
from anki.scheduler.v3 import CardAnswer

p = argparse.ArgumentParser()
p.add_argument("--mode", choices=["sm2", "fsrs"], required=True)
p.add_argument("--days", type=int, default=30)
p.add_argument("--notes", type=int, default=600)
p.add_argument("--new", type=int, default=20)
p.add_argument("--retention", type=float, default=0.9)
p.add_argument("--seed", default="1")
p.add_argument("--start", default="2026-01-05 08:00:00")
p.add_argument("--out", required=True)
a = p.parse_args()

clock = os.environ["FAKETIME_TIMESTAMP_FILE"]


def set_clock(ts: float):
    s = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with open(clock + ".tmp", "w") as f:
        f.write(s + "\n")
    os.replace(clock + ".tmp", clock)


start = datetime.strptime(a.start, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
set_clock(start - DAY)  # coleção criada na véspera
os.makedirs(a.out, exist_ok=True)
# A coleção de trabalho fica no /tmp (tmpfs): em disco, o fsync de cada resposta deixa tudo 10x mais lento.
work = tempfile.mkdtemp(prefix="srs-sim-")
path = os.path.join(work, "collection.anki2")
col = Collection(path)

deck_id = col.decks.id("Simulacao")
conf = col.decks.config_dict_for_deck_id(deck_id)
conf["new"]["perDay"] = a.new
conf["rev"]["perDay"] = 9999
conf["desiredRetention"] = a.retention
col.decks.update_config(conf)
col.set_config("fsrs", a.mode == "fsrs")

basic = col.models.by_name("Basic")
for i in range(a.notes):
    n = col.new_note(basic)
    n["Front"] = f"parola {i + 1:04d}"
    n["Back"] = f"palavra {i + 1:04d}"
    n.guid = f"sim{i + 1:04d}"  # chave estável: o aluno do Linguetta usa a mesma
    col.add_note(n, deck_id)

col.decks.select(deck_id)
student = Student(a.seed)
RATING = {1: CardAnswer.AGAIN, 2: CardAnswer.HARD, 3: CardAnswer.GOOD, 4: CardAnswer.EASY}
days = []
for day in range(a.days):
    now = start + day * DAY
    set_clock(now)
    known_morning = student.known(now)
    stats = {"day": day, "known": known_morning, "reviews": 0, "new": 0, "seconds": 0,
             "dueReviews": 0, "dueOk": 0, "byType": [0, 0, 0, 0]}
    while True:
        q = col.sched.get_queued_cards(fetch_limit=1)
        if not q.cards:
            break
        qc = q.cards[0]
        card = col.get_card(qc.card.id)
        card.start_timer()
        key = card.note().guid
        stats["byType"][card.type] += 1
        was_review = card.type == 2  # revisão de verdade (dias), não passo de aprendizado
        grade, spent = student.answer(key, now)
        now += spent
        set_clock(now)
        col.sched.answer_card(col.sched.build_answer(card=card, states=qc.states, rating=RATING[grade]))
        stats["reviews"] += 1
        stats["seconds"] += spent
        stats["new"] += card.type == 0
        if was_review:
            stats["dueReviews"] += 1
            stats["dueOk"] += grade > 1
    days.append(stats)

end = start + a.days * DAY
set_clock(end)
apkg = os.path.abspath(os.path.join(a.out, f"anki-{a.mode}.apkg"))
col.export_anki_package(
    out_path=apkg,
    options=ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=False, legacy=False),
    limit=DeckIdLimit(deck_id=deck_id),
)
result = {
    "engine": f"anki-{a.mode}",
    "params": vars(a),
    "days": days,
    "knownEnd": student.known(end),
    "knownIn30": student.known(end + 30 * DAY),
    "seen": len(student.mem),
}
col.close()
shutil.rmtree(work)
with open(os.path.join(a.out, f"anki-{a.mode}.json"), "w") as f:
    json.dump(result, f, indent=1)
print(f"anki-{a.mode}: {sum(d['reviews'] for d in days)} respostas, "
      f"{sum(d['seconds'] for d in days) / 60:.0f} min, sabe {result['knownEnd']:.0f}/{result['seen']} → {apkg}")
