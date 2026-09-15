import { NextRequest, NextResponse } from "next/server";

const PISTON_URL = "https://emkc.org/api/v2/piston/execute";

const RUNTIME_VERSIONS: Record<string, string> = {
  javascript: "18.15.0",
  python: "3.10.0",
};

export async function POST(req: NextRequest) {
  try {
    const { code, language } = await req.json();

    if (typeof code !== "string" || typeof language !== "string") {
      return NextResponse.json(
        { error: "Request must include `code` and `language` strings." },
        { status: 400 }
      );
    }

    const version = RUNTIME_VERSIONS[language];
    if (!version) {
      return NextResponse.json(
        { error: `Unsupported language: ${language}` },
        { status: 400 }
      );
    }

    const pistonRes = await fetch(PISTON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language,
        version,
        files: [{ content: code }],
      }),
    });

    if (!pistonRes.ok) {
      const text = await pistonRes.text();
      return NextResponse.json(
        { error: `Piston API error: ${pistonRes.status} ${text}` },
        { status: 502 }
      );
    }

    const data = await pistonRes.json();

    const output =
      data?.run?.stdout ||
      data?.run?.stderr ||
      `Process finished with exit code ${data?.run?.code}`;

    return NextResponse.json({ output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
