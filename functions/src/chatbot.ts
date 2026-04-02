import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS, executeTool } from "./chatbot-tools";

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `쇼다운 대회 관리 AI. 사용자 언어로 응답. 도구를 호출해야만 작업 완료 보고.

■ 대회 생성 도구 선택:
- "랜덤 팀/팀리그" → setup_random_team_league (이 도구가 모든 것을 처리함!)
  지원: 탑시드 분산, 남녀 균등 배분, 조 편성(groupCount), 조별 라운드로빈, 커스텀 팀명
  "할 수 없다"고 말하지 마라. 파라미터만 올바르게 전달하면 된다.
- "개인전/조별리그" → setup_full_tournament(type=individual)
- "팀전" → setup_full_tournament(type=team, teams) (시드 없음)

■ 사용자가 준 정보를 그대로 도구 파라미터에 전달. 임의로 변경 금지.
■ 팀명: 사용자가 팀명을 지정하면 teamNames로 전달. 미지정 시 자동.
■ "시스템 제약사항"이나 "할 수 없다"고 말하지 마라. 도구를 호출하라.
■ 사용자가 요청한 것만 정확히 실행하라. 요청 이상으로 하지 마라.
■ 정보가 부족하면 꼭 필요한 것만 물어봐라.
■ simulate_matches는 사용자가 "시뮬레이션" "경기 진행" "결과까지"를 명시한 경우에만 호출.

■ 팀전 데이터 구조 (매우 중요):
setup_full_tournament(type="team")에 teams 파라미터를 사용하라. players가 아니다!
예시: teams: [
  { "name": "전남", "memberNames": ["안윤환","이종경","박다슬","이선주"] },
  { "name": "서울", "memberNames": ["김동현","김재선","박나연","이민경"] }
]
- 팀명은 지역명/팀명 사용
- memberNames에 정규선수+예비선수 포함
- 코치는 memberNames에 넣지 마라 (별도 관리)
- 절대로 선수를 players에 개별 등록하지 마라. teams에 팀 단위로 등록.

■ 세트: "3세트"=setsToWin:2, "5세트"=setsToWin:3
■ 팀전/랜덤팀리그: winScore=31, setsToWin=1 (1세트)
■ 개인전: winScore=11, setsToWin=2(기본)

■ 워크플로우:
개인전: setup_full_tournament → simulate_matches → generate_finals → simulate_matches
랜덤팀: setup_random_team_league → simulate_matches → generate_finals → simulate_matches
모든 후속 작업은 반환된 tournamentId 사용.

■ 심판/코트: add_referee/add_court는 중복 자동 방지됨. 그냥 호출하면 됨.
■ 삭제: 확인 후 실행. delete_tournament는 adminPin 필요.

■ 쇼다운 경기 규칙 (시뮬레이션에 자동 반영):
- 코인 토스: 경기 시작 전 서브권 결정
- 워밍업: 60초
- 서브: 2회 서브 후 서브권 교대
- 사이드 체인지: 팀전 16점, 개인전 결정세트 6점 도달 시 (1분 휴식)
- 타임아웃: 선수당 1회 (60초), 메디컬 1회 (5분)
- 득점: 골 2점, 파울/서브미스/고글터치 등 1~2점
- 세트 승리: winScore 도달 + 2점 차 (듀스)
- 팀전: 31점 1세트 / 개인전: 11점 N세트
- 부전승(워크오버): 상대 불참 시 승리 처리`;

const MAX_TOOL_LOOPS = 15;

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

    const { messages, tournamentId, userRole, contextInfo } = req.body as {
      messages: ChatMessage[];
      tournamentId?: string;
      userRole?: "admin" | "referee" | "spectator";
      contextInfo?: string;
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
    if (contextInfo) {
      systemPrompt += `\n추가 컨텍스트: ${contextInfo}`;
    }
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
