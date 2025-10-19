'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type JitsiEventName =
  | 'videoConferenceJoined'
  | 'readyToClose'
  | 'audioMuteStatusChanged'
  | 'videoMuteStatusChanged'
  | string;

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

export default function Client({ initialRoom }: { initialRoom?: string }) {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<JitsiAPI | null>(null);

  const [room, setRoom] = useState<string>(
    () => initialRoom ?? searchParams.get('room') ?? 'demo-chat-room'
  );
  const [displayName, setDisplayName] = useState<string>(
    () => searchParams.get('name') ?? ''
  );
  const [joining, setJoining] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const [audioMuted, setAudioMuted] = useState<boolean | null>(null);
  const [videoMuted, setVideoMuted] = useState<boolean | null>(null);
  const domain = process.env.NEXT_PUBLIC_JITSI_DOMAIN || 'meet.jit.si';
  const hasAutoJoinedRef = useRef(false);
  const didInitFromStorageRef = useRef(false);

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

      const api = apiRef.current;
      api?.addEventListener('videoConferenceJoined', () => {
        try {
          setConnected(true);
          api?.executeCommand?.('toggleChat');
        } catch {}
      });

      api?.addEventListener('readyToClose', () => {
        setConnected(false);
      });

      api?.addEventListener('audioMuteStatusChanged', (p: unknown) => {
        try {
          const v = (p as { muted?: boolean } | undefined)?.muted ?? null;
          if (typeof v === 'boolean') setAudioMuted(v);
        } catch {}
      });
      api?.addEventListener('videoMuteStatusChanged', (p: unknown) => {
        try {
          const v = (p as { muted?: boolean } | undefined)?.muted ?? null;
          if (typeof v === 'boolean') setVideoMuted(v);
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

  // Початкове автозаповнення зі сховища, якщо в URL немає відповідних параметрів
  useEffect(() => {
    if (didInitFromStorageRef.current) return;
    try {
      const roomParam = searchParams.get('room');
      const nameParam = searchParams.get('name');
      if (!initialRoom && !roomParam) {
        const savedRoom = localStorage.getItem('jitsi_room');
        if (savedRoom) setRoom(savedRoom);
      }
      if (!nameParam) {
        const savedName = localStorage.getItem('jitsi_name');
        if (savedName) setDisplayName(savedName);
      }
    } catch {}
    didInitFromStorageRef.current = true;
  }, [searchParams, initialRoom]);

  // Зберігати останні значення у localStorage
  useEffect(() => {
    try {
      if (room) localStorage.setItem('jitsi_room', room);
    } catch {}
  }, [room]);

  useEffect(() => {
    try {
      if (displayName) localStorage.setItem('jitsi_name', displayName);
      else localStorage.removeItem('jitsi_name');
    } catch {}
  }, [displayName]);

  // Авто-приєднання через URL: ?autojoin=1|true|yes (або ?auto=1)
  useEffect(() => {
    const autoParam = searchParams.get('autojoin') ?? searchParams.get('auto');
    const v = (autoParam ?? '').toLowerCase();
    const shouldAutoJoin =
      v === '1' || v === 'true' || v === 'yes' || v === 'y';
    if (shouldAutoJoin && room && !hasAutoJoinedRef.current) {
      hasAutoJoinedRef.current = true;
      setTimeout(() => {
        void join();
      }, 0);
    }
  }, [searchParams, room, join]);

  const leave = useCallback(() => {
    try {
      const api = apiRef.current;
      api?.executeCommand?.('hangup');
      api?.dispose?.();
    } catch {}
    apiRef.current = null;
    setConnected(false);
  }, []);

  const toggleChat = useCallback(() => {
    try {
      apiRef.current?.executeCommand?.('toggleChat');
    } catch {}
  }, []);

  const toggleAudio = useCallback(() => {
    try {
      apiRef.current?.executeCommand?.('toggleAudio');
    } catch {}
  }, []);

  const toggleVideo = useCallback(() => {
    try {
      apiRef.current?.executeCommand?.('toggleVideo');
    } catch {}
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
        <div className='flex gap-2'>
          <button
            onClick={join}
            disabled={joining}
            className='h-10 px-4 rounded bg-black text-white disabled:opacity-60'
          >
            {joining
              ? 'Підключення...'
              : connected
              ? 'Перепідключитись'
              : 'Увійти в чат'}
          </button>
          <button
            onClick={toggleChat}
            disabled={!connected}
            className='h-10 px-4 rounded border border-black/20 disabled:opacity-60'
          >
            Toggle chat
          </button>
          <button
            onClick={toggleAudio}
            disabled={!connected}
            className='h-10 px-4 rounded border border-black/20 disabled:opacity-60'
            title={
              audioMuted === true ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'
            }
          >
            {audioMuted === true ? 'Unmute mic' : 'Mute mic'}
          </button>
          <button
            onClick={toggleVideo}
            disabled={!connected}
            className='h-10 px-4 rounded border border-black/20 disabled:opacity-60'
            title={videoMuted === true ? 'Увімкнути камеру' : 'Вимкнути камеру'}
          >
            {videoMuted === true ? 'Unmute cam' : 'Mute cam'}
          </button>
          <button
            onClick={leave}
            disabled={!connected}
            className='h-10 px-4 rounded border border-black/20 text-red-600 disabled:opacity-60'
          >
            Leave
          </button>
        </div>
      </div>

      <div className='flex-1 min-h-[60vh] border rounded overflow-hidden'>
        <div ref={containerRef} className='w-full h-[70vh] sm:h-[75vh]' />
      </div>
    </div>
  );
}
