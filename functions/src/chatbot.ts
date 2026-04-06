import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS, executeTool } from "./chatbot-tools";
import { SYSTEM_PROMPT } from "./chatbot-prompt";

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const MAX_TOOL_LOOPS = 15;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const chatbot = onRequest(
  {
    cors: true,
    timeoutSeconds: 540,
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

    // 역할별 모델 선택: 관리자=Opus(정교한 처리), 관람자/심판=Haiku(빠른 조회)
    const MODELS = role === "admin"
      ? ["claude-opus-4-0-20250514", "claude-haiku-4-5-20251001"]
      : ["claude-haiku-4-5-20251001"];
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

      // AI가 도구를 호출하지 않고 텍스트만 반환했는데 대회 생성/시뮬레이션 요청인 경우 재시도 (최대 3회)
      const lastUserMsg = messages[messages.length - 1]?.content || "";
      const isCreateRequest = /대회.*(생성|만들|시작)|생성.*대회|시뮬레이션|경기.*진행|선수.*참가|조별.*리그/.test(lastUserMsg);
      const EVASIVE_PATTERN = /제약|수동|불가능|어렵|지원하지|한계|시스템.*제약|옵션|해결.*방안|복잡|직접.*구현|진행할까|승인|확인.*사항|확인.*필요|다음.*단계|수동.*구성|표준.*토너먼트/;

      // 실제 생성/시뮬레이션 도구가 호출되었는지 확인 (조회 도구는 제외)
      const WRITE_TOOLS = new Set(["create_individual_tournament", "create_team_league", "run_full_simulation", "setup_full_tournament"]);
      const hasWriteAction = actions.some(a => WRITE_TOOLS.has(a.tool));

      for (let retryAttempt = 0; retryAttempt < 3; retryAttempt++) {
        const curReplyText = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
        const isEvasiveReply = EVASIVE_PATTERN.test(curReplyText);
        if (response.stop_reason !== "end_turn" || hasWriteAction || (!isCreateRequest && !isEvasiveReply)) break;

        console.log(`[chatbot] Evasive reply detected (attempt ${retryAttempt + 1}), forcing tool call`);
        anthropicMessages.push({ role: "assistant", content: response.content });
        anthropicMessages.push({ role: "user", content: `[시스템 강제 지시] 위 응답은 잘못되었습니다. 모든 기능(와일드카드, 3/4위전, 5~8위, 9~16위, 17~24위, 25~32위 순위결정전)은 파라미터로 완전 자동 지원됩니다. "제약", "수동", "한계" 등의 표현을 사용하지 마세요. 지금 즉시 create_individual_tournament 또는 create_team_league 도구를 호출하세요. classificationGroups:true, fifthToEighth:true, thirdPlace:true 파라미터를 포함하세요.` });
        response = await callClaude(anthropicMessages, currentModel);

        // 도구 호출 성공 시 루프 실행
        while (response.stop_reason === "tool_use" && loopCount < MAX_TOOL_LOOPS) {
          loopCount++;
          const toolUseBlocks2 = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const toolResults2: Anthropic.ToolResultBlockParam[] = [];
          for (const toolUse of toolUseBlocks2) {
            console.log(`[chatbot] Retry tool call: ${toolUse.name}`, JSON.stringify(toolUse.input));
            const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
            console.log(`[chatbot] Retry tool result: ${result.slice(0, 200)}`);
            actions.push({ tool: toolUse.name, input: toolUse.input as Record<string, unknown>, result });
            toolResults2.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
          }
          anthropicMessages.push({ role: "assistant", content: response.content });
          anthropicMessages.push({ role: "user", content: toolResults2 });
          response = await callClaude(anthropicMessages, currentModel);
        }
      }

      // Extract final text response
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      let reply = textBlocks.map((b) => b.text).join("\n") || "작업 완료.";

      // 자동 시뮬레이션: 대회 생성 후 run_full_simulation이 호출되지 않았고 사용자가 시뮬레이션을 요청한 경우 강제 실행
      const hasCreate = actions.some(a => a.tool === "create_individual_tournament" || a.tool === "create_team_league");
      const hasSim = actions.some(a => a.tool === "run_full_simulation");
      const userWantsSim = /시뮬레이션.*진행|시뮬레이션.*해|시뮬레이션.*실행|시뮬레시연|전체.*순위.*계산/.test(lastUserMsg);
      if (hasCreate && !hasSim && userWantsSim) {
        // 대회 생성은 했지만 시뮬레이션을 안 했음 → 강제 실행
        const createAction = actions.find(a => a.tool === "create_individual_tournament" || a.tool === "create_team_league");
        if (createAction) {
          try {
            const createResult = JSON.parse(createAction.result);
            if (createResult.success && createResult.tournamentId) {
              console.log(`[chatbot] Auto-running simulation for tournament ${createResult.tournamentId}`);
              const simResult = await executeTool("run_full_simulation", { tournamentId: createResult.tournamentId });
              actions.push({ tool: "run_full_simulation", input: { tournamentId: createResult.tournamentId }, result: simResult });
            }
          } catch (e2) { console.error("[chatbot] Auto-sim error:", e2); }
        }
      }

      // 후처리: 대회 생성/시뮬레이션 도구가 호출된 경우 항상 도구 결과 기반 응답 생성
      // AI 텍스트 의존 제거 — 도구 결과만 신뢰
      if (hasWriteAction) {
        // AI 텍스트 무시 → 도구 결과로 직접 응답 생성
        const parts: string[] = [];
        for (const action of actions) {
          try {
            const r = JSON.parse(action.result);
            if (action.tool === "create_individual_tournament" || action.tool === "create_team_league") {
              if (r.success) {
                parts.push(`✅ 대회 생성 완료\n대회 ID: ${r.tournamentId}\n총 ${r.matchCount}경기 (${r.groupCount}개 조)`);
                if (r.groupAssignment) parts.push(`\n조 배치:\n${r.groupAssignment}`);
                if (r.scheduleDetail) parts.push(`\n스케줄:\n${(r.scheduleDetail as string).split("\n").slice(0, 10).join("\n")}${(r.scheduleDetail as string).split("\n").length > 10 ? "\n..." : ""}`);
              }
            } else if (action.tool === "run_full_simulation") {
              if (r.success) {
                parts.push(`\n🏆 시뮬레이션 완료 (총 ${r.totalMatches}경기, 완료 ${r.completedMatches}경기)`);
                if (r.steps) parts.push(`\n📋 진행 단계:\n${(r.steps as string[]).map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`);
                if (r.groupRankings) parts.push(`\n📊 조별 순위:\n${r.groupRankings}`);
                if (r.finalsResults) parts.push(`\n🎯 본선 결과:\n${r.finalsResults}`);
                if (r.finalRanking) parts.push(`\n🏅 최종 순위:\n${r.finalRanking}`);
              } else {
                parts.push(`\n❌ 시뮬레이션 오류: ${r.error || JSON.stringify(r)}`);
              }
            }
          } catch { /* ignore parse errors */ }
        }
        if (parts.length > 0) {
          reply = parts.join("\n");
        }
      }

      res.json({ reply, actions });
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number };
      console.error("[chatbot] Error:", e.message);
      res.status(500).json({ error: e.message || "AI 요청 실패" });
    }
  },
);
