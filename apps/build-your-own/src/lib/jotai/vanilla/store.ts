import { buildStore, type Store } from './internals';

/**
 * Default store for provider-less mode.
 */
let defaultStore: Store | undefined;

export function getDefaultStore(): Store {
  if (!defaultStore) {
    defaultStore = createStore();
  }
  return defaultStore;
}

export function createStore(): Store {
  return buildStore();
}
