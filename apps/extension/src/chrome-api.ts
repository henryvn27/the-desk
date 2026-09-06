/**
 * The extension deliberately keeps a small local view of the Chrome/Edge API.
 * We do not need the broad @types/chrome package for this bounded bridge.
 */
export interface ChromeTab {
  id?: number;
  title?: string;
  url?: string;
}

export interface ChromeStorageArea {
  get(keys?: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChromeApi {
  tabs: {
    query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<ChromeTab[]>;
  };
  scripting: {
    executeScript<T>(details: {
      target: { tabId: number };
      func: () => T;
    }): Promise<Array<{ result?: T }>>;
  };
  storage: {
    local: ChromeStorageArea;
  };
  runtime: {
    sendMessage<T>(message: unknown): Promise<T>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
}

const extensionGlobal = globalThis as typeof globalThis & { chrome: ChromeApi };
export const chrome = extensionGlobal.chrome;
