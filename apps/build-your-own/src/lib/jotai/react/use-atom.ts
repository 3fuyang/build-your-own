import type { Atom, WritableAtom } from '../vanilla/atom';
import { useAtomValue } from './use-atom-value';
import { useSetAtom } from './use-set-atom';

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
