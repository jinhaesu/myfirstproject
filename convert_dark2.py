# -*- coding: utf-8 -*-
import os, glob

SRC_DIR = 'C:/Users/lion9/myfirstproject/frontend/src'

# 2nd pass - patterns missed in first pass
REPLACEMENTS = [
    # Border blue variants
    ('border-blue-600', 'border-[#5E6AD2]'),
    ('border-blue-400', 'border-[#5E6AD2]/50'),
    ('border-blue-100', 'border-[#5E6AD2]/20'),

    # bg blue extra variants
    ('bg-blue-400', 'bg-[#4EA7FC]'),
    ('bg-blue-300', 'bg-[#4EA7FC]/70'),
    ('bg-blue-200', 'bg-[#5E6AD2]/25'),
    ('hover:bg-blue-200', 'hover:bg-[#5E6AD2]/25'),

    # text blue extra variants
    ('text-blue-900', 'text-[#F7F8F8]'),
    ('text-blue-400', 'text-[#4EA7FC]'),
    ('text-blue-200', 'text-[#7070FF]/60'),
    ('text-blue-100', 'text-[#7070FF]/40'),

    # gradient blue
    ('from-blue-50', 'from-[#08090A]'),
    ('from-blue-100', 'from-[#5E6AD2]/15'),
    ('to-blue-50', 'to-[#08090A]'),
    ('to-blue-400', 'to-[#5E6AD2]'),
    ('to-blue-100', 'to-[#5E6AD2]/15'),

    # emerald
    ('bg-emerald-700', 'bg-[#1E8A3A]'),
    ('bg-emerald-600', 'bg-[#27A644]'),
    ('bg-emerald-500', 'bg-[#27A644]'),
    ('from-emerald-500', 'from-[#27A644]'),
    ('from-emerald-50', 'from-[#27A644]/10'),

    # indigo gradient
    ('from-indigo-500', 'from-[#5E6AD2]'),

    # red extra
    ('bg-red-400', 'bg-[#EB5757]/80'),
    ('hover:text-red-400', 'hover:text-[#EB5757]'),

    # orange extra
    ('bg-orange-600', 'bg-[#FC7840]'),
    ('bg-orange-400', 'bg-[#FC7840]/80'),

    # amber extra
    ('bg-amber-400', 'bg-[#F0BF00]/80'),

    # yellow extra
    ('bg-yellow-400', 'bg-[#F0BF00]/80'),

    # slate extra
    ('text-slate-200', 'text-[#62666D]'),
    ('border-slate-50', 'border-[#23252A]'),

    # white remnant
    ('bg-white', 'bg-[#0F1011]'),
    ('from-white', 'from-[#0F1011]'),
]

REPLACEMENTS.sort(key=lambda x: -len(x[0]))

total = 0
files_changed = 0
for pattern in ['**/*.tsx', '**/*.ts']:
    for filepath in glob.glob(os.path.join(SRC_DIR, pattern), recursive=True):
        if 'node_modules' in filepath:
            continue
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        original = content
        count = 0
        for old, new in REPLACEMENTS:
            occ = content.count(old)
            if occ > 0:
                content = content.replace(old, new)
                count += occ
        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            rel = os.path.relpath(filepath, SRC_DIR)
            print(f'  {rel}: {count}')
            total += count
            files_changed += 1

print(f'\nTotal: {total} across {files_changed} files')
