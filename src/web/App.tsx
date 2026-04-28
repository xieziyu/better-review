import { Link, Routes, Route } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { HealthBanner } from "@/components/HealthBanner";
import { Sidebar } from "@/components/Sidebar";
import { Home } from "@/pages/Home";
import { PRDetail } from "@/pages/PRDetail";
import { PromptEditor } from "@/pages/PromptEditor";

function TopBar() {
  return (
    <header className="h-12 flex items-center px-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <Link
        to="/"
        className="font-semibold tracking-tight text-gray-900 dark:text-gray-100"
      >
        better-review
      </Link>
      <div className="flex-1 mx-4">
        <HealthBanner />
      </div>
      <nav className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
        <Link to="/prompt" className="hover:text-gray-900 dark:hover:text-gray-100">
          Prompt
        </Link>
        <Link
          to="/settings"
          className="hover:text-gray-900 dark:hover:text-gray-100 inline-flex items-center"
          aria-label="Settings"
        >
          <SettingsIcon size={16} />
        </Link>
      </nav>
    </header>
  );
}

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/pr/:id" element={<PRDetail />} />
            <Route path="/prompt" element={<PromptEditor />} />
            <Route path="/settings" element={<div className="p-6">Settings (TBD)</div>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
