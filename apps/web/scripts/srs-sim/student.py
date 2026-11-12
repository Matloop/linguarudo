# Aluno virtual. Espelho exato de student.ts: mesmo hash, mesmas fórmulas.
# A memória NÃO é FSRS (curva exponencial com ganho por espaçamento), para não
# favorecer nenhum dos agendadores por construção.
import math

DAY = 86400.0


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def uniform(key: str) -> float:
    # mulberry32, primeira saída
    t = (fnv1a(key) + 0x6D2B79F5) & 0xFFFFFFFF
    t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
    t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
    return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


class Student:
    def __init__(self, seed: str):
        self.seed = seed
        self.mem = {}  # key -> [S (dias), last (s), n]

    def difficulty(self, key: str) -> float:
        return uniform(f"{self.seed}:{key}:d")

    def recall_prob(self, key: str, now: float) -> float:
        m = self.mem.get(key)
        if m is None:
            return 0.0
        return 0.9 ** (((now - m[1]) / DAY) / m[0])

    def answer(self, key: str, now: float):
        """Responde ao cartão no instante now (s). Devolve (nota 1-4, segundos gastos)."""
        d = self.difficulty(key)
        m = self.mem.get(key)
        n = 0 if m is None else m[2]
        u = uniform(f"{self.seed}:{key}:{n}:r")
        if m is None:
            ok = u < 0.2 * (1 - d)
            S = 3.0 if ok else 0.6 * (1.2 - d)
            spent = 20
        else:
            R = 0.9 ** (((now - m[1]) / DAY) / m[0])
            ok = u < R
            if ok:
                S = m[0] * (1 + 5.0 * (1 - 0.5 * d) * (1 - R) ** 0.35)
            else:
                S = max(0.05, 0.3 * m[0])
            spent = 8 if ok else 20
        self.mem[key] = [S, now, n + 1]
        if not ok:
            return 1, spent
        g = uniform(f"{self.seed}:{key}:{n}:g")
        return (2 if g < 0.15 else 3 if g < 0.90 else 4), spent

    def known(self, now: float) -> float:
        """Quantos cartões vistos o aluno lembraria agora (soma das probabilidades)."""
        return sum(self.recall_prob(k, now) for k in self.mem)
