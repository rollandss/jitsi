'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Мінімальні типи для Jitsi External API, щоб уникнути any
type JitsiEventName = 'videoConferenceJoined' | string;

interface JitsiAPI {
  addEventListener: (
    event: JitsiEventName,
    listener: (...args: unknown[]) => void
  ) => void;
  executeCommand: (command: string, ...args: unknown[]) => void;
  dispose: () => void;
}

interface JitsiInitOptions {
  roomName: string;
  parentNode: Element;
  width?: string | number;
  height?: string | number;
  interfaceConfigOverwrite?: Record<string, unknown>;
  configOverwrite?: Record<string, unknown>;
  userInfo?: { displayName?: string };
}

type JitsiMeetExternalAPIConstructor = new (
  domain: string,
  options: JitsiInitOptions
) => JitsiAPI;

// Мінімальне оголошення типів для глобального об'єкта Jitsi на клієнті
declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiMeetExternalAPIConstructor;
  }
}

// Допоміжний лоадер скрипта external_api.js (запобігає дублюванню)
let jitsiScriptLoading: Promise<void> | null = null;
function loadJitsiExternalApi(domain: string) {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (jitsiScriptLoading) return jitsiScriptLoading;

  jitsiScriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load Jitsi external_api.js'));
    document.body.appendChild(script);
  });

  return jitsiScriptLoading;
}

export default function ChatPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<JitsiAPI | null>(null);

  const [room, setRoom] = useState<string>('demo-chat-room');
  const [displayName, setDisplayName] = useState<string>('');
  const [joining, setJoining] = useState<boolean>(false);
  const domain = process.env.NEXT_PUBLIC_JITSI_DOMAIN || 'meet.jit.si';

  const join = useCallback(async () => {
    if (!containerRef.current) return;
    setJoining(true);
    try {
      await loadJitsiExternalApi(domain);

      // При повторному вході закриємо попередній інстанс
      if (apiRef.current) {
        try {
          apiRef.current.dispose?.();
        } catch {}
        apiRef.current = null;
      }

      // Параметри ініціалізації Jitsi Meet
      const options: JitsiInitOptions = {
        roomName: room || 'demo-chat-room',
        parentNode: containerRef.current,
        width: '100%',
        height: '100%',
        interfaceConfigOverwrite: {
          // Мінімальний інтерфейс; чат все одно доступний
          TILE_VIEW_MAX_COLUMNS: 3,
        },
        configOverwrite: {
          prejoinConfig: {
            enabled: true,
          },
        },
        userInfo: displayName ? { displayName } : undefined,
      };

      const JitsiAPI = window.JitsiMeetExternalAPI;
      if (!JitsiAPI) throw new Error('JitsiMeetExternalAPI is not available');

      apiRef.current = new JitsiAPI(domain, options);

      // Відкриємо чат одразу після приєднання
      const api = apiRef.current;
      api?.addEventListener('videoConferenceJoined', () => {
        try {
          api?.executeCommand?.('toggleChat');
        } catch {}
      });
    } catch (err) {
      console.error(err);
      alert(
        'Не вдалося завантажити або ініціалізувати Jitsi. Перевірте мережу та домен.'
      );
    } finally {
      setJoining(false);
    }
  }, [domain, room, displayName]);

  // Очищення при демонтажі сторінки
  useEffect(() => {
    return () => {
      try {
        apiRef.current?.dispose?.();
      } catch {}
    };
  }, []);

  return (
    <div className='min-h-screen p-6 flex flex-col gap-4'>
      <h1 className='text-2xl font-semibold'>Jitsi Chat</h1>

      <div className='flex flex-col sm:flex-row gap-3 items-stretch sm:items-end'>
        <label className='flex-1'>
          <span className='block text-sm mb-1'>Назва кімнати</span>
          <input
            type='text'
            className='w-full border rounded px-3 py-2'
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder='room-name'
          />
        </label>
        <label className='flex-1'>
          <span className='block text-sm mb-1'>
            Ваше ім&apos;я (необов&apos;язково)
          </span>
          <input
            type='text'
            className='w-full border rounded px-3 py-2'
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ім'я для відображення"
          />
        </label>
        <button
          onClick={join}
          disabled={joining}
          className='h-10 px-4 rounded bg-black text-white disabled:opacity-60'
        >
          {joining ? 'Підключення...' : 'Увійти в чат'}
        </button>
      </div>

      <div className='flex-1 min-h-[60vh] border rounded overflow-hidden'>
        <div ref={containerRef} className='w-full h-[70vh] sm:h-[75vh]' />
      </div>
    </div>
  );
}
