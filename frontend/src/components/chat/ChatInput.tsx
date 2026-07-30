'use client';

import { useState, FormEvent, KeyboardEvent } from 'react';

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
            className="w-full p-4 pr-12 border border-border-primary rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent disabled:bg-bg-0 disabled:text-text-quaternary transition-all shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="px-6 py-4 bg-gradient-to-r from-brand to-brand text-white rounded-xl font-semibold hover:from-brand hover:to-[#4B55A5] disabled:from-bg-secondary disabled:to-bg-tertiary disabled:cursor-not-allowed transition-all shadow-[0px_3px_12px_rgba(0,0,0,0.2)] hover:shadow-[0px_7px_32px_rgba(0,0,0,0.35)] disabled:shadow-none flex items-center gap-2"
        >
          {disabled ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              분석 중
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
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
