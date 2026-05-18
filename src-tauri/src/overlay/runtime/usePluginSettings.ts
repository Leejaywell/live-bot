import { useEffect, useState } from 'react';
import { fetchJson } from './fetch';
import { PluginSettings } from './types';

const EMPTY_SETTINGS: PluginSettings = {};

export function usePluginSettings(): PluginSettings {
  const [settings, setSettings] = useState<PluginSettings>(EMPTY_SETTINGS);

  useEffect(() => {
    let disposed = false;

    async function load() {
      const nextSettings = await fetchJson<PluginSettings>('/plugin-settings', EMPTY_SETTINGS);
      if (!disposed) {
        setSettings(nextSettings);
      }
    }

    load();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?._plugin_settings_update || message?._overlay_cfg_update) {
          load();
        }
      } catch {
        // OBS overlays should stay quiet when unrelated websocket payloads arrive.
      }
    });

    socket.addEventListener('close', () => {
      if (!disposed) {
        setTimeout(load, 1000);
      }
    });

    return () => {
      disposed = true;
      socket.close();
    };
  }, []);

  return settings;
}
