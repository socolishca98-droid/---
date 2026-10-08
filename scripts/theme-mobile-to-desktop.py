#!/usr/bin/env python3
"""Приведение мобильной панели логиста к палитре и стилю компьютерной версии.

Мобильные экраны рисовались на «сырых» цветах Tailwind (zinc, orange, emerald,
amber, sky) и на полупрозрачных белых подложках. Компьютерная версия живёт на
токенах темы из app/globals.css: --card, --border, --primary, --success,
--warning, --muted-foreground, --foreground.

Скрипт заменяет цвета мобильных экранов на те же токены — тогда смена темы
(цвета, радиусы) одинаково меняет оба контура, а вид совпадает.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]  # корень репозитория
TARGETS = sorted(
    list((ROOT / "app/lm").rglob("*.tsx")) + list((ROOT / "components/logist-mobile").glob("*.tsx"))
)

# Порядок важен: сначала составные строки, потом отдельные куски.
RULES: list[tuple[str, str]] = [
    # ── состояния ─────────────────────────────────────────────────────────────
    ("active:bg-white/[0.03]", "active:bg-secondary"),
    ("active:bg-white/[0.02]", "active:bg-secondary"),
    ("active:bg-white/[0.04]", "active:bg-secondary"),
    ("active:bg-white/[0.05]", "active:bg-secondary"),
    ("active:bg-white/[0.06]", "active:bg-secondary"),
    ("active:bg-white/[0.08]", "active:bg-secondary"),
    ("active:bg-white/5", "active:bg-secondary"),
    ("active:bg-white/8", "active:bg-secondary"),
    ("active:bg-white/10", "active:bg-secondary"),
    ("active:bg-white/12", "active:bg-secondary"),
    ("hover:bg-white/[0.06]", "hover:bg-secondary"),
    ("hover:bg-white/8", "hover:bg-secondary"),

    # ── поверхности ───────────────────────────────────────────────────────────
    ("border border-white/8 bg-white/[0.03]", "border border-border bg-card"),
    ("border-white/8 bg-white/[0.03]", "border-border bg-card"),
    ("bg-white/[0.03]", "bg-card"),
    ("bg-white/[0.02]", "bg-card/60"),
    ("bg-white/[0.04]", "bg-secondary"),
    ("bg-white/[0.05]", "bg-secondary"),
    ("bg-white/[0.06]", "bg-secondary"),
    ("bg-white/[0.07]", "bg-secondary"),
    ("bg-white/[0.08]", "bg-secondary"),
    ("bg-white/8", "bg-secondary"),
    ("bg-white/5", "bg-secondary"),
    ("bg-white/10", "bg-secondary"),
    ("bg-white/12", "bg-secondary"),

    # ── границы ───────────────────────────────────────────────────────────────
    ("border-white/6", "border-border"),
    ("border-white/8", "border-border"),
    ("border-white/10", "border-border"),
    ("border-white/12", "border-border"),
    ("border-white/15", "border-border"),
    ("border-white/20", "border-border"),
    ("border-white/25", "border-border"),
    ("divide-white/8", "divide-border"),

    # ── фоны и панели как в компьютерной версии ───────────────────────────────
    ("bg-[#0b0b0e]/95", "surface-glass"),
    ("bg-[#0b0b0e]", "bg-background"),
    ("bg-[#111114]", "bg-card"),
    ("bg-[#15151a]", "bg-card"),
    ("bg-[#101012]", "bg-card"),
    ("bg-[#151419]", "bg-card"),
    ("bg-[#17171b]", "bg-card"),

    # ── акцент: оранжевый компьютера = primary темы ────────────────────────────
    ("border-orange-500/40 bg-orange-500/15 text-orange-300", "border-primary/40 bg-primary/15 text-primary"),
    ("bg-orange-500/15 text-orange-300", "bg-primary/15 text-primary"),
    ("bg-orange-500/10 text-orange-300", "bg-primary/10 text-primary"),
    ("bg-orange-500 text-white", "bg-primary text-primary-foreground"),
    ("active:bg-orange-600", "active:bg-primary/90"),
    ("active:bg-orange-500/25", "active:bg-primary/25"),
    ("active:bg-orange-500", "active:bg-primary"),
    ("bg-orange-600", "bg-primary/90"),
    ("bg-orange-500/25", "bg-primary/25"),
    ("bg-orange-500/20", "bg-primary/20"),
    ("bg-orange-500/15", "bg-primary/15"),
    ("bg-orange-500/10", "bg-primary/10"),
    ("bg-orange-500", "bg-primary"),
    ("text-orange-300", "text-primary"),
    ("text-orange-400", "text-primary"),
    ("text-orange-200", "text-primary"),
    ("text-orange-100", "text-primary"),
    ("border-orange-500/40", "border-primary/40"),
    ("border-orange-500/30", "border-primary/30"),
    ("border-orange-500/25", "border-primary/25"),
    ("ring-orange-500/40", "ring-primary/40"),
    ("accent-orange-500", "accent-primary"),

    # ── смысловые цвета: те же токены, что в компьютерной версии ──────────────
    ("text-emerald-300", "text-success"),
    ("text-emerald-200", "text-success"),
    ("text-emerald-400", "text-success"),
    ("text-emerald-100", "text-success"),
    ("bg-emerald-500/[0.06]", "bg-success/10"),
    ("bg-emerald-500/25", "bg-success/25"),
    ("bg-emerald-500/20", "bg-success/20"),
    ("bg-emerald-500/15", "bg-success/15"),
    ("bg-emerald-500/10", "bg-success/10"),
    ("bg-emerald-400", "bg-success"),
    ("bg-emerald-500", "bg-success"),
    ("border-emerald-500/30", "border-success/30"),
    ("border-emerald-500/40", "border-success/40"),

    ("text-amber-300", "text-warning"),
    ("text-amber-200", "text-warning"),
    ("text-amber-100", "text-warning"),
    ("text-amber-400", "text-warning"),
    ("bg-amber-500/[0.08]", "bg-warning/10"),
    ("bg-amber-500/[0.06]", "bg-warning/10"),
    ("bg-amber-500/25", "bg-warning/25"),
    ("bg-amber-500/20", "bg-warning/20"),
    ("bg-amber-500/15", "bg-warning/15"),
    ("bg-amber-500/10", "bg-warning/10"),
    ("bg-amber-400", "bg-warning"),
    ("bg-amber-500", "bg-warning"),
    ("border-amber-500/40", "border-warning/40"),
    ("border-amber-500/30", "border-warning/40"),
    ("border-amber-500/25", "border-warning/40"),

    ("text-sky-300", "text-chart-2"),
    ("text-sky-200", "text-chart-2"),
    ("text-sky-400", "text-chart-2"),
    ("bg-sky-500/25", "bg-chart-2/25"),
    ("bg-sky-500/15", "bg-chart-2/15"),
    ("bg-sky-400", "bg-chart-2"),
    ("bg-sky-500", "bg-chart-2"),

    ("text-rose-300", "text-destructive"),
    ("text-rose-200", "text-destructive"),
    ("text-red-300", "text-destructive"),
    ("text-red-400", "text-destructive"),
    ("text-red-200", "text-destructive"),
    ("bg-red-500/15", "bg-destructive/15"),
    ("bg-rose-500/15", "bg-destructive/15"),
    ("bg-red-500/10", "bg-destructive/10"),
    ("bg-red-500", "bg-destructive"),
    ("border-red-500/30", "border-destructive/40"),
    ("border-red-500/40", "border-destructive/40"),

    # ── текст ─────────────────────────────────────────────────────────────────
    ("text-zinc-100", "text-foreground"),
    ("text-zinc-200", "text-foreground"),
    ("text-zinc-300", "text-foreground/90"),
    ("text-zinc-400", "text-muted-foreground"),
    ("text-zinc-500", "text-muted-foreground"),
    ("text-zinc-600", "text-muted-foreground/80"),

    # ── форма: радиусы и чипы как в компьютерной версии ───────────────────────
    ("rounded-2xl", "rounded-xl"),
    ("rounded-full border", "rounded-md border"),
]

CLASSNAME_RE = re.compile(r'className=(?:"([^"]*)"|\{`([^`]*)`\})')


def convert_class_string(value: str) -> str:
    out = value
    for old, new in RULES:
        out = out.replace(old, new)
    return out


def finalize_class_string(value: str) -> str:
    """Кнопки темы и приподнятые карточки — как в компьютерной версии.

    1. Сначала акцентные правила уже превратили «bg-orange-500 text-white»
       в «bg-primary text-primary-foreground».
    2. Оставшийся text-white — обычный светлый текст: в теме это --foreground.
    3. Карточки на bg-card получают shadow-sm, как у Card в компонентах ui/.
    """
    out = value.replace("text-white", "text-foreground")
    if "bg-card" in out and "shadow-" not in out:
        out = re.sub(r"\bbg-card(?![\w-])", "bg-card shadow-sm", out, count=1)
    return out


def process(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        body = match.group(1) if match.group(1) is not None else match.group(2)
        converted = finalize_class_string(convert_class_string(body))
        return f'className="{converted}"' if match.group(1) is not None else f"className={{`{converted}`}}"

    return CLASSNAME_RE.sub(repl, text)


def main() -> int:
    changed = 0
    for path in TARGETS:
        src = path.read_text(encoding="utf-8")
        dst = process(src)
        if dst != src:
            path.write_text(dst, encoding="utf-8")
            changed += 1
    print(f"файлов изменено: {changed} из {len(TARGETS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
