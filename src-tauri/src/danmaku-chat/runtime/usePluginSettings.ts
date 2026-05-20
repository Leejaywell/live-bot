import { useEffect, useState } from 'react';
import { fetchJson } from './fetch';
import { DanmakuChatSettings, PluginSettings } from './types';

const EMPTY_SETTINGS: PluginSettings = {};
const PREVIEW_SETTINGS_MESSAGE = 'streamix-preview-settings';

function mergePreviewSettings(settings: PluginSettings, preview: DanmakuChatSettings): PluginSettings {
  return {
    ...settings,
    DanmakuChat: {
      ...(settings.DanmakuChat || {}),
      ...preview,
    },
  };
}

export function usePluginSettings(): PluginSettings {
  const [settings, setSettings] = useState<PluginSettings>(EMPTY_SETTINGS);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      const nextSettings = await fetchJson<PluginSettings>('/plugin-settings', EMPTY_SETTINGS);
      if (!disposed) {
        setSettings(nextSettings);
      }
    }

    function scheduleRetry() {
      if (disposed || retryTimeout) {
        return;
      }

      retryTimeout = setTimeout(async () => {
        const previousSocket = socket;
        socket = undefined;
        retryTimeout = undefined;
        previousSocket?.close();
        await load();
        if (!disposed) {
          connect();
        }
      }, 1000);
    }

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket = nextSocket;

      nextSocket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?._plugin_settings_update || message?._danmaku_chat_cfg_update) {
            load();
          }
        } catch {
          // OBS browser sources should stay quiet when unrelated websocket payloads arrive.
        }
      });

      nextSocket.addEventListener('close', () => {
        if (socket === nextSocket) {
          scheduleRetry();
        }
      });
      nextSocket.addEventListener('error', () => {
        if (socket === nextSocket) {
          scheduleRetry();
        }
      });
    }

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (data?.type !== PREVIEW_SETTINGS_MESSAGE || !data?.settings) {
        return;
      }
      setSettings((prev) => mergePreviewSettings(prev, data.settings as DanmakuChatSettings));
    }

    load();
    connect();
    window.addEventListener('message', handleMessage);

    return () => {
      disposed = true;
      window.removeEventListener('message', handleMessage);
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      socket?.close();
    };
  }, []);

  return settings;
}
