# -*- coding: utf-8 -*-
"""3rd pass: Fix hardcoded inline colors, recharts styles, and HTML template strings."""
import os, glob

SRC_DIR = 'C:/Users/lion9/myfirstproject/frontend/src'

REPLACEMENTS = [
    # Recharts tooltip contentStyle — white bg → dark
    ("backgroundColor: 'white'", "backgroundColor: '#1C1C1F'"),
    ('backgroundColor: "white"', "backgroundColor: '#1C1C1F'"),
    ("backgroundColor: '#fff'", "backgroundColor: '#1C1C1F'"),
    ('backgroundColor: "#fff"', "backgroundColor: '#1C1C1F'"),

    # Recharts borders in tooltips
    ("border: '1px solid #E2E8F0'", "border: '1px solid #34343A'"),
    ("border: '1px solid #e2e8f0'", "border: '1px solid #34343A'"),
    ('border: "1px solid #E2E8F0"', "border: '1px solid #34343A'"),
    ('border: "1px solid #e2e8f0"', "border: '1px solid #34343A'"),

    # Recharts tooltip borderRadius
    ("borderRadius: '8px'", "borderRadius: '12px'"),
    ('borderRadius: "8px"', "borderRadius: '12px'"),

    # Recharts tooltip boxShadow — light → dark
    ("boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'", "boxShadow: '0 7px 32px rgba(0,0,0,0.5)'"),

    # Recharts grid stroke
    ('stroke="#E2E8F0"', 'stroke="#1C1C1F"'),
    ("stroke='#E2E8F0'", "stroke='#1C1C1F'"),
    ('stroke="#e2e8f0"', 'stroke="#1C1C1F"'),

    # Recharts axis tick fill — slate → Linear gray
    ("fill: '#64748B'", "fill: '#8A8F98'"),
    ('fill: "#64748B"', "fill: '#8A8F98'"),
    ("fill: '#64748b'", "fill: '#8A8F98'"),
    ("fill='#64748B'", "fill='#8A8F98'"),

    # Old blue (#3B82F6) → Linear indigo (#5E6AD2)
    ('stroke="#3B82F6"', 'stroke="#5E6AD2"'),
    ("stroke='#3B82F6'", "stroke='#5E6AD2'"),
    ('stroke: "#3B82F6"', 'stroke: "#5E6AD2"'),
    ("stroke: '#3B82F6'", "stroke: '#5E6AD2'"),
    ('fill="#3B82F6"', 'fill="#5E6AD2"'),
    ("fill='#3B82F6'", "fill='#5E6AD2'"),
    ('fill: "#3B82F6"', 'fill: "#5E6AD2"'),
    ("fill: '#3B82F6'", "fill: '#5E6AD2'"),
    ('fill="#3b82f6"', 'fill="#5E6AD2"'),
    ("fill='#3b82f6'", "fill='#5E6AD2'"),
    ('stroke="#3b82f6"', 'stroke="#5E6AD2"'),

    # In recharts <Bar fill="..." /> and <Line stroke="..." /> as JSX attr values
    ('fill="#3B82F6"', 'fill="#5E6AD2"'),
    ('stroke="#3B82F6"', 'stroke="#5E6AD2"'),

    # Other old Tailwind blue hex values used inline
    ("'#3B82F6'", "'#5E6AD2'"),
    ('"#3B82F6"', '"#5E6AD2"'),
    ("'#3b82f6'", "'#5E6AD2'"),

    # Old accent colors in COLORS arrays → Linear palette
    ("'#8B5CF6'", "'#7070FF'"),
    ("'#EC4899'", "'#EB5757'"),
    ("'#F59E0B'", "'#F0BF00'"),
    ("'#10B981'", "'#27A644'"),
    ("'#6366F1'", "'#828FFF'"),
    ("'#F97316'", "'#FC7840'"),
    ("'#14B8A6'", "'#00B8CC'"),
    ("'#EF4444'", "'#EB5757'"),
    ("'#84CC16'", "'#68CC58'"),

    # Old dark blues
    ("'#2563eb'", "'#5E6AD2'"),
    ("'#1d4ed8'", "'#4B55A5'"),
    ("'#1e3a8a'", "'#0F1011'"),
    ('"#2563eb"', '"#5E6AD2"'),
    ('"#1d4ed8"', '"#4B55A5"'),

    # Light blue tints
    ("'#93c5fd'", "'#5E6AD2'"),
    ('"#93c5fd"', '"#5E6AD2"'),

    # HTML template strings with white backgrounds (ReportSection email templates)
    ('background:#fff;', 'background:#1C1C1F;'),
    ('background:#fffbeb', 'background:#141516'),
    ('background-color: #fff !important;', 'background-color: #0F1011 !important;'),
    ('background-color: #fff', 'background-color: #0F1011'),
    ('border:1px solid #fecaca;', 'border:1px solid #EB5757;'),
    ('border:1px solid #e2e8f0', 'border:1px solid #23252A'),

    # CartesianGrid stroke inline
    ('stroke="#E5E7EB"', 'stroke="#1C1C1F"'),
    ("stroke='#E5E7EB'", "stroke='#1C1C1F'"),
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
