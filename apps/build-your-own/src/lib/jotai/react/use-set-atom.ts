import { useCallback } from 'react';

import type { WritableAtom } from '../atom';
import { useStore } from '../provider';

export function useSetAtom<Value, Args extends unknown[], Result>(
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
