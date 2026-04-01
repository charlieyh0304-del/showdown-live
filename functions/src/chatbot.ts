import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS, executeTool } from "./chatbot-tools";

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `당신은 태권도/쇼다운 대회 관리 앱 "Showdown Live"의 AI 어시스턴트입니다.

역할:
- 대회 생성, 선수 등록, 대진 생성, 스케줄 관리, 경기 수정 등 모든 대회 운영 작업을 수행합니다.
- 사용자의 자연어 요청을 이해하고, 제공된 도구를 사용하여 실행합니다.

규칙:
- 사용자와 같은 언어(한국어/영어)로 응답합니다.
- 삭제/취소 같은 되돌릴 수 없는 작업은 실행 전에 내용을 설명하고 확인을 구합니다.
- 복합 요청은 단계별로 실행하고 각 결과를 보고합니다.
- 데이터 조회가 필요하면 먼저 도구로 조회한 후 정확한 정보를 기반으로 답합니다.
- 간결하게 응답합니다.
- **절대로 도구를 호출하지 않고 "완료했습니다"라고 말하지 마세요. 반드시 도구를 호출하고 결과를 확인한 후에만 보고하세요.**
- **복잡한 대회 구조(조별리그+토너먼트, 시드, 순위결정전 등)는 setup_full_tournament 도구를 사용하세요.** 이 도구가 스테이지, 조 편성, 시드 배치, 순위결정전 설정을 한 번에 처리합니다.
- 대회 생성 후 반드시 list_matches로 실제 경기 수를 확인하고 보고하세요.

대회 관련 정보:
- 대회 유형: individual(개인전), team(팀전), randomTeamLeague(랜덤 팀 리그)
- 대진 방식: round_robin(라운드로빈), single_elimination(싱글엘리미), group_knockout(조별+토너먼트), manual(수동)
- 경기 설정: winScore(승리 점수), setsToWin(승리 세트 수)
- 스케줄: 코트별 시간 배정, 경기 간격 설정 가능`;

const MAX_TOOL_LOOPS = 10;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const chatbot = onRequest(
  {
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: [anthropicApiKey],
  },
  async (req, res) => {
    // Manual CORS (fallback for timeout/crash scenarios)
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { messages, tournamentId } = req.body as {
      messages: ChatMessage[];
      tournamentId?: string;
    };

    if (!messages || messages.length === 0) {
      res.status(400).json({ error: "messages required" });
      return;
    }

    const apiKey = anthropicApiKey.value();
    if (!apiKey) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return;
    }

    const client = new Anthropic({ apiKey });

    // Build system prompt with tournament context
    let systemPrompt = SYSTEM_PROMPT;
    if (tournamentId) {
      systemPrompt += `\n\n현재 컨텍스트: tournamentId = "${tournamentId}" (사용자가 현재 보고 있는 대회)`;
    }

    // Convert to Anthropic message format
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const actions: Array<{ tool: string; input: Record<string, unknown>; result: string }> = [];

    // Retry with model fallback on overload
    const MODELS = ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"];
    const MAX_RETRIES = 2;

    async function callClaude(msgs: Anthropic.MessageParam[], model: string): Promise<Anthropic.Message> {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await client.messages.create({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: msgs,
            tools: TOOL_DEFINITIONS,
          });
        } catch (err: unknown) {
          const e = err as { status?: number; message?: string };
          if (e.status === 529 || e.status === 503 || e.status === 429) {
            console.log(`[chatbot] ${model} overloaded (attempt ${attempt + 1}), retrying...`);
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          throw err;
        }
      }
      throw new Error("API overloaded after retries");
    }

    try {
      let currentModel = MODELS[0];
      let response: Anthropic.Message;
      try {
        response = await callClaude(anthropicMessages, currentModel);
      } catch {
        // Fallback to Haiku
        currentModel = MODELS[1];
        console.log(`[chatbot] Falling back to ${currentModel}`);
        response = await callClaude(anthropicMessages, currentModel);
      }

      let loopCount = 0;

      // Tool-use loop
      while (response.stop_reason === "tool_use" && loopCount < MAX_TOOL_LOOPS) {
        loopCount++;

        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          console.log(`[chatbot] Tool call: ${toolUse.name}`, JSON.stringify(toolUse.input));
          const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
          console.log(`[chatbot] Tool result: ${result.slice(0, 200)}`);

          actions.push({
            tool: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            result,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        // Continue conversation with tool results
        anthropicMessages.push({ role: "assistant", content: response.content });
        anthropicMessages.push({ role: "user", content: toolResults });

        response = await callClaude(anthropicMessages, currentModel);
      }

      // Extract final text response
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      const reply = textBlocks.map((b) => b.text).join("\n") || "작업 완료.";

      res.json({ reply, actions });
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number };
      console.error("[chatbot] Error:", e.message);
      res.status(500).json({ error: e.message || "AI 요청 실패" });
    }
  },
);
