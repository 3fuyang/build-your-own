import {
  createContext,
  createElement,
  useContext,
  useRef,
  type PropsWithChildren,
} from 'react';

import { createStore, getDefaultStore } from '../vanilla/store';
import type { Store } from '../vanilla/internals';

interface Options {
  store?: Store;
}

const StoreContext = createContext<Store | undefined>(undefined);

export function useStore(options?: Options): Store {
  const store = useContext(StoreContext);
  return options?.store ?? store ?? getDefaultStore();
}

interface ProviderProps extends PropsWithChildren {
  store?: Store;
}

export function Provider(props: ProviderProps) {
  // Fallback to an internal store
  // if no store specified via props
  const storeRef = useRef<Store>(undefined);
  if (!props.store && !storeRef.current) {
    storeRef.current = createStore();
  }

  return createElement(
    StoreContext.Provider,
    {
      value: props.store ?? storeRef.current,
    },
    props.children
  );
}
