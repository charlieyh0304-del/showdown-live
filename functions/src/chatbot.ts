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

**대회는 반드시 1개만 생성 (매우 중요):**
- 하나의 대회 요청에 setup_full_tournament는 **딱 1번만** 호출한다.
- setup_full_tournament가 예선 스테이지 + 본선 스테이지 + 조편성 + 예선 경기를 모두 생성한다.
- 이후 simulate_matches, generate_finals 등은 **같은 tournamentId**에서 실행한다.
- **절대로 본선용, 순위결정전용 등으로 별도 대회를 생성하지 마라.**
- 전체 워크플로우: setup_full_tournament(1회) → simulate_matches(예선) → generate_finals(같은 대회) → simulate_matches(본선, 같은 대회)

**심판 관리 (매우 중요):**
- 심판 추가 전에 **반드시 list_referees로 기존 심판 목록을 조회**한다.
- 사용자가 요청한 심판 이름이 이미 존재하면 **추가하지 않고 기존 심판을 사용**한다.
- 이름이 정확히 일치하는 심판만 기존 심판으로 판단한다.
- 새 심판은 시스템에 존재하지 않는 이름만 추가한다.

대회 관련 정보:
- 대회 유형: individual(개인전), team(팀전), randomTeamLeague(랜덤 팀 리그)
- 대진 방식: round_robin(라운드로빈), single_elimination(싱글엘리미), group_knockout(조별+토너먼트), manual(수동)
- 스케줄: 코트별 시간 배정, 경기 간격 설정 가능

**세트 용어 (중요):**
- "3세트" = 3세트 경기 = 2세트 선승 (setsToWin=2)
- "5세트" = 5세트 경기 = 3세트 선승 (setsToWin=3)
- setsToWin은 "이기는 데 필요한 세트 수"이다. 사용자가 "3세트"라고 하면 setsToWin=2로 설정.
- simulate_matches 사용 시 setsToWin을 명시하지 않으면 대회 설정값을 자동 사용함.
- winScore: 세트당 승리 점수 (기본 11)

**본선 대진:**
- setup_full_tournament는 예선 경기만 자동 생성.
- 예선 완료 후 generate_finals 도구로 본선 대진을 자동 생성 (조별 순위 계산 → 진출자 추출 → 교차 시드 배치 → 16강/8강/결승 + 순위결정전).
- 워크플로우: setup_full_tournament → simulate_matches(예선) → generate_finals → simulate_matches(본선)`;

const MAX_TOOL_LOOPS = 10;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const chatbot = onRequest(
  {
    cors: true,
    timeoutSeconds: 300,
    memory: "1GiB",
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

    const { messages, tournamentId, userRole } = req.body as {
      messages: ChatMessage[];
      tournamentId?: string;
      userRole?: "admin" | "referee" | "spectator";
    };
    const role = userRole || "admin";

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

    // Build system prompt with role and context
    const ROLE_PROMPTS: Record<string, string> = {
      admin: "\n\n사용자 역할: 관리자. 모든 도구 사용 가능. 대회 생성, 수정, 삭제, 선수/경기/스케줄 관리 등 전체 권한.",
      referee: "\n\n사용자 역할: 심판. 읽기 도구만 사용 가능 (list_tournaments, get_tournament, list_players, list_matches, list_courts, list_referees, get_schedule). 데이터 수정 불가. 경기 배정, 일정, 선수 정보 조회만 도와주세요.",
      spectator: "\n\n사용자 역할: 관람자. 읽기 도구만 사용 가능 (list_tournaments, get_tournament, list_players, list_matches, get_schedule). 선수 정보, 경기 일정, 순위, 결과 조회만 도와주세요. 친절하고 이해하기 쉽게 설명하세요.",
    };
    let systemPrompt = SYSTEM_PROMPT + (ROLE_PROMPTS[role] || ROLE_PROMPTS.admin);
    if (tournamentId) {
      systemPrompt += `\n현재 컨텍스트: tournamentId = "${tournamentId}"`;
    }

    // Convert to Anthropic message format
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const actions: Array<{ tool: string; input: Record<string, unknown>; result: string }> = [];

    // Role-based tool filtering
    const READ_ONLY_TOOLS = new Set(["list_tournaments", "get_tournament", "list_players", "list_matches", "list_courts", "list_referees", "get_schedule", "list_teams"]);
    const availableTools = role === "admin"
      ? TOOL_DEFINITIONS
      : TOOL_DEFINITIONS.filter((t) => READ_ONLY_TOOLS.has(t.name));

    // Retry with model fallback on overload
    const MODELS = ["claude-haiku-4-5-20251001"];
    const MAX_RETRIES = 2;

    async function callClaude(msgs: Anthropic.MessageParam[], model: string): Promise<Anthropic.Message> {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await client.messages.create({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: msgs,
            tools: availableTools,
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
