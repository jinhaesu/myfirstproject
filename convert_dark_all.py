# -*- coding: utf-8 -*-
"""Exhaustive final pass: every remaining Tailwind color class → Linear dark palette."""
import os, glob

SRC_DIR = '.'

# Map every Tailwind color shade to Linear equivalent
def build_map():
    m = []

    # Helper: for each color name, map shades
    def add_color(names, hex_map):
        """hex_map: {50: x, 100: x, 200: x, 300: x, 400: x, 500: x, 600: x, 700: x, 800: x, 900: x}"""
        for name in names:
            for shade, val in hex_map.items():
                # bg-
                m.append((f'bg-{name}-{shade}', f'bg-{val}'))
                m.append((f'hover:bg-{name}-{shade}', f'hover:bg-{val}'))
                m.append((f'active:bg-{name}-{shade}', f'active:bg-{val}'))
                m.append((f'disabled:bg-{name}-{shade}', f'disabled:bg-{val}'))
                m.append((f'odd:bg-{name}-{shade}', f'odd:bg-{val}'))
                m.append((f'even:bg-{name}-{shade}', f'even:bg-{val}'))
                # text-
                m.append((f'text-{name}-{shade}', f'text-{val}'))
                m.append((f'hover:text-{name}-{shade}', f'hover:text-{val}'))
                m.append((f'disabled:text-{name}-{shade}', f'disabled:text-{val}'))
                # border-
                m.append((f'border-{name}-{shade}', f'border-{val}'))
                m.append((f'focus:border-{name}-{shade}', f'focus:border-{val}'))
                m.append((f'disabled:border-{name}-{shade}', f'disabled:border-{val}'))
                # ring-
                m.append((f'ring-{name}-{shade}', f'ring-{val}'))
                m.append((f'focus:ring-{name}-{shade}', f'focus:ring-{val}'))
                # divide-
                m.append((f'divide-{name}-{shade}', f'divide-{val}'))
                # gradient
                m.append((f'from-{name}-{shade}', f'from-{val}'))
                m.append((f'via-{name}-{shade}', f'via-{val}'))
                m.append((f'to-{name}-{shade}', f'to-{val}'))
                # shadow
                m.append((f'shadow-{name}-{shade}', f'shadow-{val}'))
                # placeholder
                m.append((f'placeholder-{name}-{shade}', f'placeholder-{val}'))
                m.append((f'placeholder:text-{name}-{shade}', f'placeholder:text-{val}'))

    # Gray/Slate → dark surfaces
    gray_map = {
        50: '[#08090A]', 100: '[#0F1011]', 200: '[#141516]', 300: '[#1C1C1F]',
        400: '[#232326]', 500: '[#28282C]', 600: '[#34343A]',
        700: '[#8A8F98]', 800: '[#D0D6E0]', 900: '[#F7F8F8]', 950: '[#F7F8F8]'
    }
    add_color(['gray', 'slate'], gray_map)

    # Blue/Indigo → Linear brand indigo
    brand_map = {
        50: '[#5E6AD2]/10', 100: '[#5E6AD2]/15', 200: '[#5E6AD2]/25', 300: '[#5E6AD2]/40',
        400: '[#4EA7FC]', 500: '[#5E6AD2]', 600: '[#5E6AD2]', 700: '[#4B55A5]',
        800: '[#828FFF]', 900: '[#F7F8F8]'
    }
    add_color(['blue', 'indigo'], brand_map)

    # Violet/Purple → Linear accent
    violet_map = {
        50: '[#5E6AD2]/10', 100: '[#5E6AD2]/15', 200: '[#5E6AD2]/25', 300: '[#5E6AD2]/40',
        400: '[#7070FF]', 500: '[#5E6AD2]', 600: '[#5E6AD2]', 700: '[#828FFF]',
        800: '[#828FFF]', 900: '[#F7F8F8]'
    }
    add_color(['violet', 'purple', 'fuchsia'], violet_map)

    # Green/Emerald → Linear green
    green_map = {
        50: '[#27A644]/10', 100: '[#27A644]/15', 200: '[#27A644]/25', 300: '[#27A644]/40',
        400: '[#68CC58]', 500: '[#27A644]', 600: '[#27A644]', 700: '[#1E8A3A]',
        800: '[#27A644]', 900: '[#F7F8F8]'
    }
    add_color(['green', 'emerald', 'lime'], green_map)

    # Red/Rose → Linear red
    red_map = {
        50: '[#EB5757]/10', 100: '[#EB5757]/15', 200: '[#EB5757]/25', 300: '[#EB5757]/40',
        400: '[#EB5757]', 500: '[#EB5757]', 600: '[#EB5757]', 700: '[#D04040]',
        800: '[#EB5757]', 900: '[#F7F8F8]'
    }
    add_color(['red', 'rose'], red_map)

    # Yellow/Amber → Linear yellow
    yellow_map = {
        50: '[#F0BF00]/10', 100: '[#F0BF00]/15', 200: '[#F0BF00]/25', 300: '[#F0BF00]/40',
        400: '[#F0BF00]', 500: '[#F0BF00]', 600: '[#F0BF00]', 700: '[#D4A800]',
        800: '[#F0BF00]', 900: '[#F7F8F8]'
    }
    add_color(['yellow', 'amber'], yellow_map)

    # Orange → Linear orange
    orange_map = {
        50: '[#FC7840]/10', 100: '[#FC7840]/15', 200: '[#FC7840]/25', 300: '[#FC7840]/40',
        400: '[#FC7840]', 500: '[#FC7840]', 600: '[#FC7840]', 700: '[#E06830]',
        800: '[#FC7840]', 900: '[#F7F8F8]'
    }
    add_color(['orange'], orange_map)

    # Pink → Linear red variant
    pink_map = {
        50: '[#EB5757]/10', 100: '[#EB5757]/15', 200: '[#EB5757]/25', 300: '[#EB5757]/40',
        400: '[#EB5757]', 500: '[#EB5757]', 600: '[#EB5757]', 700: '[#D04040]',
        800: '[#EB5757]', 900: '[#F7F8F8]'
    }
    add_color(['pink'], pink_map)

    # Cyan/Teal → Linear teal
    cyan_map = {
        50: '[#00B8CC]/10', 100: '[#00B8CC]/15', 200: '[#00B8CC]/25', 300: '[#00B8CC]/40',
        400: '[#00B8CC]', 500: '[#00B8CC]', 600: '[#00B8CC]', 700: '[#009AAA]',
        800: '[#00B8CC]', 900: '[#F7F8F8]'
    }
    add_color(['cyan', 'teal'], cyan_map)

    # Sort by length desc for correct matching
    m.sort(key=lambda x: -len(x[0]))
    return m

REPLACEMENTS = build_map()

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
