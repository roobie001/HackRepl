"use client";

import { useCallback, useState } from "react";
import Editor from "@monaco-editor/react";
import { Sparkles, Play, Terminal, Bot, Loader2, Zap } from "lucide-react";

type Language = "javascript" | "python";

const STARTER_CODE: Record<Language, string> = {
  javascript: `function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    // Bug: "pric" is undefined, should be "item.price"
    total += pric;
  }
  return total;
}

const cart = [
  { name: "Keyboard", price: 49.99 },
  { name: "Mouse", price: 19.99 },
];

console.log("Total:", calculateTotal(cart));
`,
  python: `def calculate_total(items):
    total = 0
    for item in items:
        # Bug: "pric" is undefined, should be item["price"]
        total += pric
    return total


cart = [
    {"name": "Keyboard", "price": 49.99},
    {"name": "Mouse", "price": 19.99},
]

print("Total:", calculate_total(cart))
`,
};

const LANGUAGE_LABELS: Record<Language, string> = {
  javascript: "JavaScript (Node.js)",
  python: "Python 3",
};

export default function Home() {
  const [language, setLanguage] = useState<Language>("javascript");
  const [code, setCode] = useState<string>(STARTER_CODE.javascript);
  const [output, setOutput] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [aiResponse, setAiResponse] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);

  const handleLanguageChange = (next: Language) => {
    setLanguage(next);
    setCode(STARTER_CODE[next]);
    setOutput("");
    setAiResponse("");
  };

  const runCode = useCallback(async () => {
    setIsRunning(true);
    setOutput("");
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutput(`Error: ${data.error ?? "Unknown error"}`);
      } else {
        setOutput(data.output ?? "");
      }
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : "Failed to run code"}`);
    } finally {
      setIsRunning(false);
    }
  }, [code, language]);

  const fixWithAI = useCallback(async () => {
    setIsStreaming(true);
    setAiResponse("");
    try {
      const res = await fetch("/api/ai-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          error: output || "No terminal output yet. Analyze the code for potential bugs.",
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        setAiResponse(`Error: ${text || res.statusText}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        setAiResponse(buffer);
      }
    } catch (err) {
      setAiResponse(`Error: ${err instanceof Error ? err.message : "Failed to reach AI"}`);
    } finally {
      setIsStreaming(false);
    }
  }, [code, language, output]);

  return (
    <div className="flex flex-col flex-1 h-screen bg-neutral-950 text-neutral-100">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900/60 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
            <Zap className="h-5 w-5 text-yellow-400" fill="currentColor" />
            HackRepl
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as Language)}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          >
            {(Object.keys(LANGUAGE_LABELS) as Language[]).map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>

          <button
            onClick={fixWithAI}
            disabled={isRunning || isStreaming}
            className="flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            AI Fix & Explain
          </button>

          <button
            onClick={runCode}
            disabled={isRunning || isStreaming}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run
          </button>
        </div>
      </header>

      {/* Split Workspace */}
      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-12">
        {/* Editor */}
        <div className="col-span-1 md:col-span-6 h-full min-h-[320px] border-b border-neutral-800 md:border-b-0 md:border-r">
          <Editor
            height="100%"
            language={language}
            value={code}
            onChange={(value) => setCode(value ?? "")}
            theme="vs-dark"
            options={{
              fontSize: 14,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 12 },
            }}
          />
        </div>

        {/* Right Column: Terminal + AI Assistant */}
        <div className="col-span-1 md:col-span-6 flex flex-col h-full min-h-[320px]">
          {/* Terminal */}
          <div className="flex flex-1 flex-col overflow-hidden border-b border-neutral-800">
            <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
              <Terminal className="h-3.5 w-3.5" />
              Terminal
            </div>
            <div className="flex-1 overflow-auto bg-neutral-950 p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-sm text-neutral-200">
                {output ||
                  (isRunning
                    ? "Running..."
                    : "Press Run to execute your code.")}
              </pre>
            </div>
          </div>

          {/* AI Assistant */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
              <Bot className="h-3.5 w-3.5" />
              AI Assistant
            </div>
            <div className="flex-1 overflow-auto bg-neutral-950 p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-sm text-neutral-200">
                {aiResponse ||
                  (isStreaming
                    ? "Thinking..."
                    : "Click \"AI Fix & Explain\" to diagnose bugs in your code.")}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
