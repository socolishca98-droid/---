#!/usr/bin/env python3
"""prisma/schema.prisma → SQLite DDL.

Зачем: движки Prisma скачиваются с binaries.prisma.sh, а в закрытых
окружениях (наш случай) это недоступно — `prisma db push` и `migrate diff`
не работают. Для локального стенда достаточно собрать DDL самим: типы в схеме
простые (String/Int/Float/Boolean/DateTime), enum'ов и массивов нет.

Использование:
    python3 scripts/e2e/mkddl.py prisma/schema.prisma > /tmp/schema.sql
"""

import re
import sys

TYPE_MAP = {
    "String": "TEXT",
    "Int": "INTEGER",
    "BigInt": "BIGINT",
    "Float": "REAL",
    "Boolean": "BOOLEAN",
    "DateTime": "DATETIME",
}

ON_DELETE = {
    "Cascade": "CASCADE",
    "SetNull": "SET NULL",
    "Restrict": "RESTRICT",
    "NoAction": "NO ACTION",
    "Default": "NO ACTION",
}


def strip_type(raw: str) -> str:
    return raw.rstrip("?[]!")


def parse_default(line: str):
    """@default(now()) → ('literal' | 'client', SQL-значение)"""
    match = re.search(r"@default\(([^)]*)\)", line)
    if not match:
        return None
    raw = match.group(1).strip()
    if raw.startswith("now()"):
        return ("literal", "CURRENT_TIMESTAMP")
    if raw in ("cuid()", "uuid()", "nanoid()", "autoincrement()"):
        return ("client", None)
    if raw in ("true", "false"):
        return ("literal", raw.upper())
    if re.fullmatch(r"-?\d+(\.\d+)?", raw):
        return ("literal", raw)
    if raw.startswith('"') and raw.endswith('"'):
        return ("literal", "'" + raw[1:-1].replace("'", "''") + "'")
    return ("client", None)


def parse_relation(line: str):
    """@relation(fields: [a], references: [b], onDelete: Cascade)"""
    match = re.search(r"@relation\((.*)\)", line)
    if not match:
        return None
    body = match.group(1)
    fields = re.search(r"fields:\s*\[([^\]]*)\]", body)
    refs = re.search(r"references:\s*\[([^\]]*)\]", body)
    if not fields or not refs:
        return None
    action = re.search(r"onDelete:\s*(\w+)", body)
    return (
        [part.strip() for part in fields.group(1).split(",")],
        [part.strip() for part in refs.group(1).split(",")],
        ON_DELETE.get(action.group(1) if action else "Cascade", "CASCADE"),
    )


def parse_models(text: str):
    return {
        match.group(1): match.group(2)
        for match in re.finditer(r"^model\s+(\w+)\s*\{(.*?)^\}", text, re.S | re.M)
    }


def build(schema: str):
    models = parse_models(schema)
    tables, indexes = [], []

    for model, body in models.items():
        columns, constraints = [], []

        for raw_line in body.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("//") or line.startswith("@@"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue

            name, raw_type = parts[0], parts[1]
            base = strip_type(raw_type)
            optional = raw_type.endswith("?")
            is_list = raw_type.endswith("[]")

            if base not in TYPE_MAP:
                # поле-связи: колонки нет, но здесь же объявлен внешний ключ
                relation = parse_relation(line)
                if relation:
                    local, remote, on_delete = relation
                    cols = ", ".join(f'"{c}"' for c in local)
                    targets = ", ".join(f'"{c}"' for c in remote)
                    constraint = f"{model}_{'_'.join(local)}_fkey"
                    constraints.append(
                        f'  CONSTRAINT "{constraint}" FOREIGN KEY ({cols}) '
                        f'REFERENCES "{base}" ({targets}) ON DELETE {on_delete} '
                        "ON UPDATE CASCADE"
                    )
                continue

            if is_list:
                continue  # массивов скаляров в SQLite-схеме нет

            sql_type = TYPE_MAP[base]
            column = f'"{name}" {sql_type}'

            default = parse_default(line)
            if default and default[0] == "literal":
                column += f" DEFAULT {default[1]}"

            if "@id" in line:
                if re.search(r"@default\(autoincrement\(\)\)", line):
                    column = f'"{name}" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT'
                else:
                    column += " PRIMARY KEY"
            elif not optional:
                column += " NOT NULL"

            columns.append(column)

            if "@unique" in line and "@id" not in line:
                indexes.append(
                    f'CREATE UNIQUE INDEX "{model}_{name}_key" ON "{model}"("{name}");'
                )

        for match in re.finditer(r"@@unique\(\[([^\]]*)\]", body):
            cols = [c.strip() for c in match.group(1).split(",")]
            joined = ", ".join(f'"{c}"' for c in cols)
            indexes.append(
                f'CREATE UNIQUE INDEX "{model}_{"_".join(cols)}_key" '
                f'ON "{model}"({joined});'
            )

        for match in re.finditer(r"@@index\(\[([^\]]*)\]", body):
            cols = [c.strip() for c in match.group(1).split(",")]
            joined = ", ".join(f'"{c}"' for c in cols)
            indexes.append(
                f'CREATE INDEX "{model}_{"_".join(cols)}_idx" ON "{model}"({joined});'
            )

        table = f'CREATE TABLE "{model}" (\n  ' + ",\n  ".join(columns + constraints) + "\n);"
        tables.append(table)

    return tables, indexes


def main() -> int:
    schema = open(sys.argv[1], encoding="utf-8").read()
    tables, indexes = build(schema)
    print("-- Сгенерировано scripts/e2e/mkddl.py: стенд без движков Prisma")
    print("PRAGMA foreign_keys = ON;\n")
    print("\n".join(tables))
    print()
    print("\n".join(indexes))
    print(f"\n-- таблиц: {len(tables)}, индексов: {len(indexes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
