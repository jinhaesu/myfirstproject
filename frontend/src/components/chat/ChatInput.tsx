'use client';

import { useState, FormEvent, KeyboardEvent } from 'react';
import { SendIcon } from '@/components/nd/icons';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border-primary bg-bg-1 p-4">
      <div className="flex gap-3 items-end">
        <div className="flex-1 relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || '데이터에 대해 질문하세요...'}
            disabled={disabled}
            rows={2}
            className="w-full p-4 pr-12 border border-border-primary rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent disabled:bg-bg-0 disabled:text-text-quaternary transition-colors shadow-nd-s"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="px-6 py-4 bg-brand text-on-brand rounded-xl font-semibold hover:bg-brand-hover disabled:bg-bg-secondary disabled:cursor-not-allowed transition-colors shadow-nd-f hover:shadow-nd-f disabled:shadow-none flex items-center gap-2"
        >
          {disabled ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              분석 중
            </>
          ) : (
            <>
              <SendIcon className="w-5 h-5" />
              전송
            </>
          )}
        </button>
      </div>
      <p className="text-xs text-text-quaternary mt-2 flex items-center gap-4">
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-bg-2 rounded text-text-tertiary font-mono text-xs">Enter</kbd>
          전송
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-bg-2 rounded text-text-tertiary font-mono text-xs">Shift</kbd>
          +
          <kbd className="px-1.5 py-0.5 bg-bg-2 rounded text-text-tertiary font-mono text-xs">Enter</kbd>
          줄바꿈
        </span>
      </p>
    </form>
  );
}
