# -*- coding: utf-8 -*-
"""Final comprehensive pass: fix hover states, surface hierarchy, recharts remnants."""
import os, glob

SRC_DIR = 'C:/Users/lion9/myfirstproject/frontend/src'

REPLACEMENTS = [
    # ═══ HOVER STATES: #141516 barely visible on #0F1011 → use white/5 ═══
    ('hover:bg-[#141516]', 'hover:bg-white/5'),
    ('hover:bg-[#0F1011]', 'hover:bg-white/5'),

    # ═══ RECHARTS: remaining old Tailwind colors in fill/stroke ═══
    # Greens
    ("fill=\"#10b981\"", "fill=\"#27A644\""),
    ("fill='#10b981'", "fill='#27A644'"),
    ("fill=\"#10B981\"", "fill=\"#27A644\""),
    ("fill=\"#6ee7b7\"", "fill=\"#27A644\""),
    ("fill=\"#059669\"", "fill=\"#27A644\""),
    ("stroke=\"#10b981\"", "stroke=\"#27A644\""),
    ("stroke=\"#10B981\"", "stroke=\"#27A644\""),
    ("stroke=\"#059669\"", "stroke=\"#27A644\""),
    ("'#10b981'", "'#27A644'"),
    ("'#10B981'", "'#27A644'"),
    ("'#059669'", "'#27A644'"),
    ("'#6ee7b7'", "'#68CC58'"),

    # Oranges
    ("fill=\"#f97316\"", "fill=\"#FC7840\""),
    ("fill=\"#F97316\"", "fill=\"#FC7840\""),
    ("stroke=\"#f97316\"", "stroke=\"#FC7840\""),
    ("stroke=\"#F97316\"", "stroke=\"#FC7840\""),
    ("'#f97316'", "'#FC7840'"),
    ("'#F97316'", "'#FC7840'"),

    # Purples
    ("fill=\"#8b5cf6\"", "fill=\"#7070FF\""),
    ("fill=\"#8B5CF6\"", "fill=\"#7070FF\""),
    ("stroke=\"#8b5cf6\"", "stroke=\"#7070FF\""),
    ("stroke=\"#8B5CF6\"", "stroke=\"#7070FF\""),
    ("'#8b5cf6'", "'#7070FF'"),
    ("'#8B5CF6'", "'#7070FF'"),

    # Reds
    ("fill=\"#F43F5E\"", "fill=\"#EB5757\""),
    ("fill=\"#f43f5e\"", "fill=\"#EB5757\""),
    ("stroke=\"#F43F5E\"", "stroke=\"#EB5757\""),
    ("stroke=\"#f43f5e\"", "stroke=\"#EB5757\""),
    ("fill=\"#ef4444\"", "fill=\"#EB5757\""),
    ("fill=\"#EF4444\"", "fill=\"#EB5757\""),
    ("stroke=\"#EF4444\"", "stroke=\"#EB5757\""),
    ("stroke=\"#ef4444\"", "stroke=\"#EB5757\""),
    ("'#F43F5E'", "'#EB5757'"),
    ("'#f43f5e'", "'#EB5757'"),
    ("'#ef4444'", "'#EB5757'"),
    ("'#EF4444'", "'#EB5757'"),

    # Blues
    ("fill=\"#3b82f6\"", "fill=\"#5E6AD2\""),
    ("fill=\"#60a5fa\"", "fill=\"#4EA7FC\""),
    ("stroke=\"#3b82f6\"", "stroke=\"#5E6AD2\""),
    ("stroke=\"#60a5fa\"", "stroke=\"#4EA7FC\""),
    ("'#60a5fa'", "'#4EA7FC'"),

    # Yellows
    ("fill=\"#f59e0b\"", "fill=\"#F0BF00\""),
    ("fill=\"#F59E0B\"", "fill=\"#F0BF00\""),
    ("fill=\"#fbbf24\"", "fill=\"#F0BF00\""),
    ("stroke=\"#f59e0b\"", "stroke=\"#F0BF00\""),
    ("stroke=\"#F59E0B\"", "stroke=\"#F0BF00\""),
    ("'#f59e0b'", "'#F0BF00'"),
    ("'#F59E0B'", "'#F0BF00'"),

    # Stroke white (chart grid on dark = invisible)
    ("stroke: '#fff'", "stroke: '#23252A'"),
    ("stroke: \"#fff\"", "stroke: '#23252A'"),
    ('stroke="#fff"', 'stroke="#23252A"'),

    # ═══ REMAINING TAILWIND OLD COLORS ═══
    # focus:ring with old blue
    ('focus:ring-blue-500', 'focus:ring-[#5E6AD2]'),
    ('focus:ring-blue-600', 'focus:ring-[#5E6AD2]'),
    ('focus:ring-2 focus:ring-blue-500', 'focus:ring-2 focus:ring-[#5E6AD2]'),
    ('focus:ring-indigo-500', 'focus:ring-[#5E6AD2]'),
    ('focus:ring-red-500', 'focus:ring-[#EB5757]'),
    ('focus:ring-orange-500', 'focus:ring-[#FC7840]'),
    ('focus:ring-green-500', 'focus:ring-[#27A644]'),

    # focus:border
    ('focus:border-blue-500', 'focus:border-[#5E6AD2]'),
    ('focus:border-indigo-500', 'focus:border-[#5E6AD2]'),

    # ring-offset
    ('focus:ring-offset-2', 'focus:ring-offset-2 focus:ring-offset-[#08090A]'),

    # Any remaining hover:text with old colors
    ('hover:text-blue-500', 'hover:text-[#828FFF]'),
    ('hover:text-blue-600', 'hover:text-[#828FFF]'),
    ('hover:text-indigo-500', 'hover:text-[#828FFF]'),
    ('hover:text-indigo-600', 'hover:text-[#828FFF]'),

    # Active states
    ('active:bg-gray-200', 'active:bg-white/10'),
    ('active:bg-gray-300', 'active:bg-white/10'),

    # Odd/even table rows
    ('odd:bg-gray-50', 'odd:bg-[#0F1011]'),
    ('even:bg-gray-50', 'even:bg-[#0F1011]'),
    ('odd:bg-white', 'odd:bg-[#0F1011]'),
    ('even:bg-white', 'even:bg-[#141516]'),
    ('even:bg-gray-100', 'even:bg-[#141516]'),

    # Disabled states
    ('disabled:bg-gray-100', 'disabled:bg-[#141516]'),
    ('disabled:bg-gray-200', 'disabled:bg-[#141516]'),
    ('disabled:text-gray-400', 'disabled:text-[#62666D]'),
    ('disabled:text-gray-500', 'disabled:text-[#62666D]'),
    ('disabled:border-gray-200', 'disabled:border-[#23252A]'),

    # Peer/group states
    ('peer-focus:text-blue-600', 'peer-focus:text-[#7070FF]'),
    ('group-hover:text-gray-700', 'group-hover:text-[#D0D6E0]'),
    ('group-hover:text-gray-600', 'group-hover:text-[#D0D6E0]'),
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
