'use client';

import { useEffect, useRef, useState } from 'react';

const LANGUAGES = [
  { value: 'Japanese', label: '日本語' },
  { value: 'English',  label: 'English' },
  { value: 'Chinese',  label: '中文' },
  { value: 'Korean',   label: '한국어' },
];

const STORAGE_KEY = 'suggestion_language';

export function getSuggestionLanguage(): string {
  if (typeof window === 'undefined') return 'Japanese';
  return localStorage.getItem(STORAGE_KEY) ?? 'Japanese';
}

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [language, setLanguage] = useState('Japanese');
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLanguage(getSuggestionLanguage());
  }, []);

  function save() {
    localStorage.setItem(STORAGE_KEY, language);
    onClose();
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
    >
      <div className="bg-white rounded-2xl shadow-xl w-[340px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-800">Settings</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-base leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-gray-700 font-medium">Todo generation language</p>
              <p className="text-xs text-gray-400 mt-0.5">Language used for AI suggestions</p>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {LANGUAGES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-3 border-t border-gray-100">
          <button
            onClick={save}
            className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
