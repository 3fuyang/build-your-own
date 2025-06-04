import { useAtom } from '../lib/jotai/use-atom';
import { atom } from '../lib/jotai/atom';

const counter = atom(0);

export function App() {
  const [count, setCounter] = useAtom(counter);
  const onClick = () => setCounter((prev) => prev + 1);

  return (
    <div>
      <h1>{count}</h1>
      <button onClick={onClick}>Click</button>
    </div>
  );
}

export default App;
