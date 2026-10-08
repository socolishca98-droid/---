#!/usr/bin/env python3
"""Второй проход приведения мобильной панели к палитре компьютерной версии.

Первый проход (scripts/theme-mobile-to-desktop.py) правил атрибуты className.
Остались строки-константы: INPUT_CLASS, наборы тонов, подписи статусов — они
лежат отдельными литералами. Этот проход применяет те же правила ко всем
строковым литералам, в которых есть классы Tailwind.

Плюс один смысловой момент: состояние нажатия раньше задавалось сменой фона
(«active:bg-white/8»), а теперь фон и так из темы. Поэтому нажатие выражаем
прозрачностью — отклик виден на любой подложке и не зависит от цвета.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]  # корень репозитория
TARGETS = sorted(
    list((ROOT / "app/lm").rglob("*.tsx")) + list((ROOT / "components/logist-mobile").glob("*.tsx"))
)

# Строка считается «классовой», если в ней есть класс Tailwind.
CLASSY = re.compile(
    r"(?:^|[\s\"'`])(?:text|bg|border|divide|ring|focus|active|hover|placeholder|shadow|rounded|px|py|mt|mb|min-h|flex|grid|w-|h-)"
)
LITERAL = re.compile(r'"([^"\n]*)"|\'([^\'\n]*)\'|`([^`]*)`')

RULES: list[tuple[str, str]] = [
    # нажатие — прозрачностью, а не сменой цвета
    (r"active:bg-[\w/().\[\]]+", "active:opacity-70"),

    # акцент темы
    (r"bg-orange-500/(\d+)", r"bg-primary/\1"),
    (r"bg-orange-500(?![/\w-])", "bg-primary"),
    (r"bg-orange-600(?![/\w-])", "bg-primary/90"),
    (r"border-orange-500/(\d+)", r"border-primary/\1"),
    (r"border-orange-500(?![/\w-])", "border-primary"),
    (r"ring-orange-500/(\d+)", r"ring-primary/\1"),
    (r"text-orange-(?:50|100|200|300|400|500)", "text-primary"),
    (r"accent-orange-500", "accent-primary"),

    # успех
    (r"text-emerald-(?:100|200|300|400)", "text-success"),
    (r"bg-emerald-(?:400|500)/(\d+)", r"bg-success/\1"),
    (r"bg-emerald-(?:400|500)(?![/\w-])", "bg-success"),
    (r"border-emerald-500/(\d+)", r"border-success/\1"),

    # внимание
    (r"text-amber-(?:100|200|300|400)", "text-warning"),
    (r"bg-amber-(?:400|500)/(\d+)", r"bg-warning/\1"),
    (r"bg-amber-(?:400|500)(?![/\w-])", "bg-warning"),
    (r"border-amber-500/(\d+)", r"border-warning/\1"),

    # информация (голубой акцент темы)
    (r"text-sky-(?:100|200|300|400)", "text-chart-2"),
    (r"bg-sky-(?:400|500)/(\d+)", r"bg-chart-2/\1"),
    (r"bg-sky-(?:400|500)(?![/\w-])", "bg-chart-2"),

    # ошибка
    (r"text-(?:red|rose)-(?:100|200|300|400|500)", "text-destructive"),
    (r"bg-(?:red|rose)-(?:400|500)/(\d+)", r"bg-destructive/\1"),
    (r"bg-(?:red|rose)-(?:400|500)(?![/\w-])", "bg-destructive"),
    (r"border-(?:red|rose)-500/(\d+)", r"border-destructive/\1"),

    # нейтральное
    (r"text-zinc-(?:50|100|200)", "text-foreground"),
    (r"text-zinc-300", "text-foreground/90"),
    (r"text-zinc-(?:400|500)", "text-muted-foreground"),
    (r"text-zinc-(?:600|700|800)", "text-muted-foreground/80"),
    (r"bg-zinc-(?:400|500|600|700|800)/(\d+)", "bg-secondary"),
    (r"bg-zinc-(?:400|500|600|700|800)(?![/\w-])", "bg-secondary"),
    (r"border-zinc-\d+/(\d+)", "border-border"),

    # полупрозрачные белые подложки и границы
    (r"bg-white/\[0\.0[0-4]\]", "bg-card"),
    (r"bg-white/\[0\.0[5-9]\]", "bg-secondary"),
    (r"bg-white/\[0\.\d+\]", "bg-secondary"),
    (r"bg-white/\d+", "bg-secondary"),
    (r"border-white/\d+", "border-border"),
    (r"divide-white/\d+", "divide-border"),

    # старые тёмные подложки — на токены темы
    (r"bg-\[#0b0b0e\]/95", "surface-glass"),
    (r"bg-\[#0b0b0e\]", "bg-background"),
    (r"bg-\[#1[0-9a-f]{5}\]", "bg-card"),
    (r"text-white", "text-foreground"),
]


def convert(value: str) -> str:
    out = value
    for pattern, repl in RULES:
        out = re.sub(pattern, repl, out)
    # кнопки на плотном акценте: текст должен быть контрастным к primary
    if re.search(r"\bbg-primary(?![/\w-])", out) or re.search(r"\bbg-success(?![/\w-])", out) or re.search(
        r"\bbg-destructive(?![/\w-])", out
    ):
        out = out.replace("text-foreground", "text-primary-foreground")
    return out


def process(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        body = match.group(0)
        inner = match.group(1) or match.group(2) or match.group(3) or ""
        if not CLASSY.search(inner):
            return body
        converted = convert(inner)
        if converted == inner:
            return body
        if match.group(1) is not None:
            return f'"{converted}"'
        if match.group(2) is not None:
            return f"'{converted}'"
        return f"`{converted}`"

    return LITERAL.sub(repl, text)


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
