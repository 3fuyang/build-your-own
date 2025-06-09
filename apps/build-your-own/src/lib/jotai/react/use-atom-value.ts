import { useEffect, useReducer } from 'react';

import type { Atom } from '../vanilla/atom';
import { useStore } from './provider';
import type { Store } from '../vanilla/internals';

export function useAtomValue<Value>(atom: Atom<Value>): Value {
  const store = useStore();

  const [[valueFromReducer, storeFromReducer, atomFromReducer], rerender] =
    useReducer<readonly [Value, Store, typeof atom], undefined, []>(
      (prev) => {
        const nextValue = store.get(atom);
        if (
          Object.is(nextValue, prev[0]) &&
          prev[1] === store &&
          prev[2] === atom
        ) {
          return prev;
        }
        return [nextValue as Value, store, atom];
      },
      undefined,
      () => [store.get(atom), store, atom]
    );

  let value = valueFromReducer;
  if (storeFromReducer !== store || atomFromReducer !== atom) {
    rerender();
    value = store.get(atom);
  }

  useEffect(() => {
    // subscribe
    const unsub = store.sub(atom, () => {
      rerender();
    });

    rerender();

    // unsubscribe
    return unsub;
  }, [atom, store]);

  return value;
}
