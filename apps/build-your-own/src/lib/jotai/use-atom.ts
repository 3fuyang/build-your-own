import { useCallback, useEffect, useReducer } from 'react';

import type { Atom, WritableAtom } from './atom';
import { useStore } from './provider';
import type { Store } from './store';

/**
 * The real `useAtom` actually has many overloads for better ergonomics.
 * @see https://newsletter.daishikato.com/p/how-jotai-hooks-use-function-overload-in-typescript
 */
export function useAtom<Value, Args extends unknown[], Result>(
  atom: Atom<Value> | WritableAtom<Value, Args, Result>
) {
  return [
    useAtomValue(atom),
    useSetAtom(atom as WritableAtom<Value, Args, Result>),
  ] as const;
}

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

function useSetAtom<Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>
) {
  const store = useStore();

  const setAtom = useCallback(
    (...args: Args) => {
      if (!('write' in atom)) {
        throw new Error('atom not writable');
      }
      return store.set(atom, ...args);
    },
    [store, atom]
  );

  return setAtom;
}
