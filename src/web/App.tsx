import { Routes, Route } from "react-router-dom";

export function App() {
  return (
    <div className="min-h-screen flex">
      <main className="flex-1 p-6">
        <Routes>
          <Route path="/" element={<div>Home (TBD next phase)</div>} />
        </Routes>
      </main>
    </div>
  );
}
