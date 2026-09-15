import { NextRequest } from "next/server";
import Groq from "groq-sdk";

const SYSTEM_PROMPT =
  "You are an expert pair programmer inside an in-browser IDE. Keep explanations concise, diagnose the bug directly, and provide the clean patched code snippet.";

export async function POST(req: NextRequest) {
  try {
    const { code, language, error } = await req.json();

    if (
      typeof code !== "string" ||
      typeof language !== "string" ||
      typeof error !== "string"
    ) {
      return new Response("Request must include `code`, `language`, and `error` strings.", {
        status: 400,
      });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return new Response("Server is missing GROQ_API_KEY.", { status: 500 });
    }

    const groq = new Groq({ apiKey });

    const userPrompt = `Language: ${language}

Source code:
\`\`\`${language}
${code}
\`\`\`

Terminal output / error log:
\`\`\`
${error}
\`\`\`

Diagnose the bug and provide the fixed code.`;

    let completion;
    try {
      completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status?: number }).status)
          : 500;
      if (status === 429) {
        return new Response(
          "Rate limit reached on the AI provider. Please wait a moment and try again.",
          { status: 429 }
        );
      }
      const message = err instanceof Error ? err.message : "Failed to reach AI provider.";
      return new Response(message, { status: 502 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const token = chunk.choices?.[0]?.delta?.content ?? "";
            if (token) {
              controller.enqueue(encoder.encode(token));
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Streaming error from AI provider.";
          controller.enqueue(encoder.encode(`\n\n[stream error: ${message}]`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(message, { status: 500 });
  }
}
