import { useAtom } from '../lib/jotai/use-atom';
import { atom } from '../lib/jotai/atom';

const countAtom = atom(0);
const doubleAtom = atom<number>((get) => get(countAtom) * 2);

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  const inc = () => setCount(count + 1);

  return (
    <div className="flex items-center gap-4">
      count: {count}{' '}
      <button
        className="border text-sm rounded px-2 py-0.5 hover:border-gray-300 focus-visible:border-gray-300 outline-none transition-colors"
        onClick={inc}
      >
        +1
      </button>
    </div>
  );
}

function DoubleCounter() {
  const [count] = useAtom(doubleAtom);

  return <div>doubled count(derived): {count}</div>;
}

function App() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold">Mini Jotai</h1>
      <h2 className="text-lg font-semibold mb-2">Derived Atoms</h2>
      <section className="border border-dashed p-2 mb-2">
        <h3 className="font-semibold">{'<Counter />'}</h3>
        <Counter />
      </section>
      <section className="border border-dashed p-2">
        <h3 className="font-semibold">{'<DoubleCounter />'}</h3>
        <DoubleCounter />
      </section>
    </div>
  );
}

export default App;
