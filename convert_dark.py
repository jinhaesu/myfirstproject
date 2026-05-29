# -*- coding: utf-8 -*-
import os, glob

SRC_DIR = 'C:/Users/lion9/myfirstproject/frontend/src'

REPLACEMENTS = [
    # Backgrounds
    ('bg-white/80', 'bg-[#0F1011]/80'),
    ('bg-white/50', 'bg-[#0F1011]/50'),
    ('bg-white', 'bg-[#0F1011]'),
    ('bg-gray-950', 'bg-[#08090A]'), ('bg-gray-900', 'bg-[#08090A]'),
    ('bg-gray-800', 'bg-[#0F1011]'), ('bg-gray-700', 'bg-[#141516]'),
    ('bg-gray-600', 'bg-[#1C1C1F]'), ('bg-gray-500', 'bg-[#232326]'),
    ('bg-gray-400', 'bg-[#28282C]'), ('bg-gray-300', 'bg-[#28282C]'),
    ('bg-gray-200', 'bg-[#232326]'), ('bg-gray-100', 'bg-[#141516]'),
    ('bg-gray-50', 'bg-[#08090A]'),
    # Slate backgrounds
    ('bg-slate-950', 'bg-[#08090A]'), ('bg-slate-900', 'bg-[#08090A]'),
    ('bg-slate-800', 'bg-[#0F1011]'), ('bg-slate-700', 'bg-[#141516]'),
    ('bg-slate-600', 'bg-[#1C1C1F]'), ('bg-slate-500', 'bg-[#232326]'),
    ('bg-slate-400', 'bg-[#28282C]'), ('bg-slate-300', 'bg-[#28282C]'),
    ('bg-slate-200', 'bg-[#232326]'), ('bg-slate-100', 'bg-[#141516]'),
    ('bg-slate-50', 'bg-[#08090A]'),
    # Hover bg
    ('hover:bg-white', 'hover:bg-[#141516]'),
    ('hover:bg-gray-900', 'hover:bg-white/5'), ('hover:bg-gray-800', 'hover:bg-white/5'),
    ('hover:bg-gray-700', 'hover:bg-white/5'), ('hover:bg-gray-600', 'hover:bg-white/7'),
    ('hover:bg-gray-500', 'hover:bg-white/7'), ('hover:bg-gray-400', 'hover:bg-white/7'),
    ('hover:bg-gray-300', 'hover:bg-white/7'), ('hover:bg-gray-200', 'hover:bg-white/7'),
    ('hover:bg-gray-100', 'hover:bg-white/5'), ('hover:bg-gray-50', 'hover:bg-white/5'),
    ('hover:bg-slate-900', 'hover:bg-white/5'), ('hover:bg-slate-800', 'hover:bg-white/5'),
    ('hover:bg-slate-700', 'hover:bg-white/5'), ('hover:bg-slate-600', 'hover:bg-white/7'),
    ('hover:bg-slate-500', 'hover:bg-white/7'), ('hover:bg-slate-400', 'hover:bg-white/7'),
    ('hover:bg-slate-300', 'hover:bg-white/7'), ('hover:bg-slate-200', 'hover:bg-white/7'),
    ('hover:bg-slate-100', 'hover:bg-white/5'), ('hover:bg-slate-50', 'hover:bg-white/5'),
    # Text - gray
    ('text-black', 'text-[#F7F8F8]'),
    ('text-gray-950', 'text-[#F7F8F8]'), ('text-gray-900', 'text-[#F7F8F8]'),
    ('text-gray-800', 'text-[#F7F8F8]'), ('text-gray-700', 'text-[#D0D6E0]'),
    ('text-gray-600', 'text-[#8A8F98]'), ('text-gray-500', 'text-[#8A8F98]'),
    ('text-gray-400', 'text-[#62666D]'), ('text-gray-300', 'text-[#62666D]'),
    # Text - slate
    ('text-slate-950', 'text-[#F7F8F8]'), ('text-slate-900', 'text-[#F7F8F8]'),
    ('text-slate-800', 'text-[#F7F8F8]'), ('text-slate-700', 'text-[#D0D6E0]'),
    ('text-slate-600', 'text-[#8A8F98]'), ('text-slate-500', 'text-[#8A8F98]'),
    ('text-slate-400', 'text-[#62666D]'), ('text-slate-300', 'text-[#62666D]'),
    # Border - gray
    ('border-gray-900', 'border-[#34343A]'), ('border-gray-800', 'border-[#34343A]'),
    ('border-gray-700', 'border-[#34343A]'), ('border-gray-600', 'border-[#34343A]'),
    ('border-gray-500', 'border-[#34343A]'), ('border-gray-400', 'border-[#34343A]'),
    ('border-gray-300', 'border-[#23252A]'), ('border-gray-200', 'border-[#23252A]'),
    ('border-gray-100', 'border-[#23252A]'),
    # Border - slate
    ('border-slate-900', 'border-[#34343A]'), ('border-slate-800', 'border-[#34343A]'),
    ('border-slate-700', 'border-[#34343A]'), ('border-slate-600', 'border-[#34343A]'),
    ('border-slate-500', 'border-[#34343A]'), ('border-slate-400', 'border-[#34343A]'),
    ('border-slate-300', 'border-[#23252A]'), ('border-slate-200', 'border-[#23252A]'),
    ('border-slate-100', 'border-[#23252A]'),
    # Divide
    ('divide-gray-300', 'divide-[#23252A]'), ('divide-gray-200', 'divide-[#23252A]'),
    ('divide-gray-100', 'divide-[#23252A]'),
    ('divide-slate-300', 'divide-[#23252A]'), ('divide-slate-200', 'divide-[#23252A]'),
    ('divide-slate-100', 'divide-[#23252A]'),
    # Ring
    ('ring-gray-300', 'ring-[#23252A]'), ('ring-gray-200', 'ring-[#23252A]'),
    ('ring-slate-300', 'ring-[#23252A]'), ('ring-slate-200', 'ring-[#23252A]'),
    ('focus:ring-gray-300', 'focus:ring-[#5E6AD2]'), ('focus:ring-gray-200', 'focus:ring-[#5E6AD2]'),
    # Hover text
    ('hover:text-gray-900', 'hover:text-[#F7F8F8]'), ('hover:text-gray-800', 'hover:text-[#F7F8F8]'),
    ('hover:text-gray-700', 'hover:text-[#D0D6E0]'), ('hover:text-gray-600', 'hover:text-[#D0D6E0]'),
    ('hover:text-slate-900', 'hover:text-[#F7F8F8]'), ('hover:text-slate-800', 'hover:text-[#F7F8F8]'),
    ('hover:text-slate-700', 'hover:text-[#D0D6E0]'), ('hover:text-slate-600', 'hover:text-[#D0D6E0]'),
    # Focus border
    ('focus:border-gray-300', 'focus:border-[#5E6AD2]'),
    ('focus:border-slate-300', 'focus:border-[#5E6AD2]'),
    # Primary/blue
    ('bg-primary-50', 'bg-[#5E6AD2]/10'), ('bg-primary-100', 'bg-[#5E6AD2]/15'),
    ('bg-primary-600', 'bg-[#5E6AD2]'), ('bg-primary-700', 'bg-[#4B55A5]'),
    ('hover:bg-primary-700', 'hover:bg-[#828FFF]'),
    ('text-primary-600', 'text-[#7070FF]'), ('text-primary-700', 'text-[#828FFF]'),
    ('border-primary-600', 'border-[#5E6AD2]'),
    # Blue
    ('bg-blue-50', 'bg-[#5E6AD2]/10'), ('bg-blue-100', 'bg-[#5E6AD2]/15'),
    ('bg-blue-500', 'bg-[#5E6AD2]'), ('bg-blue-600', 'bg-[#5E6AD2]'),
    ('bg-blue-700', 'bg-[#4B55A5]'),
    ('hover:bg-blue-600', 'hover:bg-[#828FFF]'), ('hover:bg-blue-700', 'hover:bg-[#828FFF]'),
    ('text-blue-600', 'text-[#7070FF]'), ('text-blue-700', 'text-[#828FFF]'),
    ('text-blue-800', 'text-[#828FFF]'), ('text-blue-500', 'text-[#7070FF]'),
    ('border-blue-200', 'border-[#5E6AD2]/30'), ('border-blue-500', 'border-[#5E6AD2]'),
    # Indigo
    ('bg-indigo-50', 'bg-[#5E6AD2]/10'), ('bg-indigo-100', 'bg-[#5E6AD2]/15'),
    ('bg-indigo-500', 'bg-[#5E6AD2]'), ('bg-indigo-600', 'bg-[#5E6AD2]'),
    ('from-indigo-600', 'from-[#5E6AD2]'), ('to-indigo-600', 'to-[#5E6AD2]'),
    ('text-indigo-600', 'text-[#7070FF]'), ('text-indigo-700', 'text-[#828FFF]'),
    ('border-indigo-200', 'border-[#5E6AD2]/30'),
    # Green
    ('bg-green-50', 'bg-[#27A644]/10'), ('bg-green-100', 'bg-[#27A644]/15'),
    ('bg-green-500', 'bg-[#27A644]'), ('bg-green-600', 'bg-[#27A644]'),
    ('text-green-600', 'text-[#27A644]'), ('text-green-700', 'text-[#27A644]'),
    ('text-green-800', 'text-[#27A644]'), ('text-green-500', 'text-[#27A644]'),
    ('border-green-200', 'border-[#27A644]/30'), ('border-green-500', 'border-[#27A644]'),
    ('bg-emerald-50', 'bg-[#27A644]/10'), ('bg-emerald-100', 'bg-[#27A644]/15'),
    ('bg-emerald-400', 'bg-[#27A644]'), ('bg-emerald-500', 'bg-[#27A644]'),
    ('from-emerald-400', 'from-[#27A644]'), ('to-teal-500', 'to-[#00B8CC]'),
    ('text-emerald-600', 'text-[#27A644]'), ('text-emerald-700', 'text-[#27A644]'),
    # Red
    ('bg-red-50', 'bg-[#EB5757]/10'), ('bg-red-100', 'bg-[#EB5757]/15'),
    ('bg-red-500', 'bg-[#EB5757]'), ('bg-red-600', 'bg-[#EB5757]'),
    ('hover:bg-red-600', 'hover:bg-[#F07070]'), ('hover:bg-red-700', 'hover:bg-[#F07070]'),
    ('text-red-500', 'text-[#EB5757]'), ('text-red-600', 'text-[#EB5757]'),
    ('text-red-700', 'text-[#EB5757]'), ('text-red-800', 'text-[#EB5757]'),
    ('border-red-200', 'border-[#EB5757]/30'), ('border-red-500', 'border-[#EB5757]'),
    ('hover:text-red-500', 'hover:text-[#EB5757]'), ('hover:text-red-600', 'hover:text-[#EB5757]'),
    # Yellow/Amber
    ('bg-yellow-50', 'bg-[#F0BF00]/10'), ('bg-yellow-100', 'bg-[#F0BF00]/15'),
    ('bg-yellow-500', 'bg-[#F0BF00]'),
    ('text-yellow-600', 'text-[#F0BF00]'), ('text-yellow-700', 'text-[#F0BF00]'),
    ('text-yellow-800', 'text-[#F0BF00]'), ('text-yellow-500', 'text-[#F0BF00]'),
    ('border-yellow-200', 'border-[#F0BF00]/30'),
    ('bg-amber-50', 'bg-[#F0BF00]/10'), ('bg-amber-100', 'bg-[#F0BF00]/15'),
    ('text-amber-600', 'text-[#F0BF00]'), ('text-amber-700', 'text-[#F0BF00]'),
    ('border-amber-200', 'border-[#F0BF00]/30'),
    # Orange
    ('bg-orange-50', 'bg-[#FC7840]/10'), ('bg-orange-100', 'bg-[#FC7840]/15'),
    ('bg-orange-500', 'bg-[#FC7840]'),
    ('text-orange-600', 'text-[#FC7840]'), ('text-orange-700', 'text-[#FC7840]'),
    ('text-orange-500', 'text-[#FC7840]'),
    ('border-orange-200', 'border-[#FC7840]/30'),
    # Purple
    ('bg-purple-50', 'bg-[#5E6AD2]/10'), ('bg-purple-100', 'bg-[#5E6AD2]/15'),
    ('text-purple-600', 'text-[#7070FF]'), ('text-purple-700', 'text-[#828FFF]'),
    ('border-purple-200', 'border-[#5E6AD2]/30'),
    # Teal/Cyan
    ('bg-teal-50', 'bg-[#00B8CC]/10'), ('bg-teal-100', 'bg-[#00B8CC]/15'),
    ('text-teal-600', 'text-[#00B8CC]'), ('text-teal-700', 'text-[#00B8CC]'),
    # Shadows
    ('shadow-sm', 'shadow-[0px_1px_3px_rgba(0,0,0,0.2)]'),
    ('shadow-md', 'shadow-[0px_3px_12px_rgba(0,0,0,0.2)]'),
    ('shadow-lg', 'shadow-[0px_7px_32px_rgba(0,0,0,0.35)]'),
    ('shadow-xl', 'shadow-[0px_7px_32px_rgba(0,0,0,0.35)]'),
    # Gradients
    ('from-white', 'from-[#0F1011]'), ('via-white', 'via-[#0F1011]'), ('to-white', 'to-[#0F1011]'),
    ('from-gray-50', 'from-[#08090A]'), ('from-gray-100', 'from-[#0F1011]'),
    ('from-blue-500', 'from-[#5E6AD2]'), ('to-blue-500', 'to-[#5E6AD2]'),
    ('from-blue-600', 'from-[#5E6AD2]'), ('to-blue-600', 'to-[#5E6AD2]'),
    # Placeholder
    ('placeholder-gray-400', 'placeholder-[#62666D]'),
    ('placeholder-gray-500', 'placeholder-[#62666D]'),
    ('placeholder-slate-400', 'placeholder-[#62666D]'),
    ('placeholder:text-gray-400', 'placeholder:text-[#62666D]'),
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
            print(f'  {rel}: {count} replacements')
            total += count
            files_changed += 1

print(f'\nTotal: {total} replacements across {files_changed} files')
