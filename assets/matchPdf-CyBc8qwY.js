function k(t){return t?Array.isArray(t)?t:Object.keys(t).sort((p,o)=>Number(p)-Number(o)).map(p=>t[p]):[]}const P=new Set(["pause","resume","timeout","timeout_player","timeout_medical","timeout_referee","substitution","dead_ball","walkover","side_change","coin_toss","warmup_start","match_start","player_rotation","lineup","serve"]),W={goal:"common.scoreActions.goal",irregular_serve:"common.scoreActions.irregularServe",centerboard:"common.scoreActions.centerboard",body_touch:"common.scoreActions.bodyTouch",illegal_defense:"common.scoreActions.illegalDefense",out:"common.scoreActions.out",ball_holding:"common.scoreActions.ballHolding",mask_touch:"common.scoreActions.maskTouch",penalty:"common.scoreActions.penalty",penalty_table_pushing:"common.scoreActions.penaltyTablePushing",penalty_electronic:"common.scoreActions.penaltyElectronic",penalty_talking:"common.scoreActions.penaltyTalking",walkover:"common.scoreActions.walkover",coin_toss:"common.matchHistory.coinToss",warmup_start:"common.matchHistory.warmup",match_start:"common.matchHistory.matchStart",substitution:"common.matchHistory.substitution",player_rotation:"common.matchHistory.playerRotation",lineup:"common.matchHistory.lineup",side_change:"common.matchHistory.sideChange"};function e(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function O(t,p,o){const y=t.type==="team",l=e(y?t.team1Name||"Team 1":t.player1Name||"Player 1"),m=e(y?t.team2Name||"Team 2":t.player2Name||"Player 2"),u=k(t.sets),N=k(t.scoreHistory),x=o("common.appName")==="쇼다운"?"ko":"en",d=[];p?.date&&d.push(`<dt>${e(o("common.pdf.date"))}</dt><dd>${e(p.date)}</dd>`),t.scheduledDate&&d.push(`<dt>${e(o("common.pdf.matchDate"))}</dt><dd>${e(t.scheduledDate)} ${e(t.scheduledTime||"")}</dd>`),t.courtName&&d.push(`<dt>${e(o("common.pdf.court"))}</dt><dd>${e(t.courtName)}</dd>`),t.refereeName&&d.push(`<dt>${e(o("common.pdf.referee"))}</dt><dd>${e(t.refereeName)}</dd>`),t.assistantRefereeName&&d.push(`<dt>${e(o("common.pdf.assistantReferee"))}</dt><dd>${e(t.assistantRefereeName)}</dd>`),t.roundLabel&&d.push(`<dt>${e(o("common.pdf.round"))}</dt><dd>${e(t.roundLabel)}</dd>`);const g=t.player1Coach?e(t.player1Coach):"",$=t.player2Coach?e(t.player2Coach):"";let b="";if(t.coinTossWinner){const r=t.coinTossWinner==="player1"?l:m,c=t.coinTossWinner==="player1"?m:l,s=t.coinTossChoice==="serve"?o("common.pdf.serve"):o("common.pdf.receive"),a=t.courtChangeByLoser?o("common.pdf.courtChangeYes"):o("common.pdf.courtChangeNo");b=`<p class="coin-toss">${e(o("common.pdf.coinToss"))}: ${r} - ${e(s)} / ${e(o("common.pdf.courtChange"))}: ${c} - ${e(a)}</p>`}const H=u.map((r,c)=>{const s=r.winnerId?r.player1Score>r.player2Score?l:m:"-",a=r.winnerId?' class="winner"':"";return`<tr>
      <td>${c+1}</td>
      <td${r.player1Score>r.player2Score?a:""}>${r.player1Score}</td>
      <td${r.player2Score>r.player1Score?a:""}>${r.player2Score}</td>
      <td>${s}</td>
    </tr>`}).join("");let h="";if(t.winnerId){const r=t.winnerId===(y?t.team1Id:t.player1Id)?l:m;let c=0,s=0;u.forEach(a=>{a.winnerId&&(a.player1Score>a.player2Score?c++:s++)}),h=`<div class="final-result" role="status" aria-label="${e(o("common.pdf.finalResult"))}: ${r} (${c}-${s})">
      <strong>${e(o("common.pdf.finalResult"))}:</strong> ${r} (${c} - ${s})
    </div>`}const _=N.filter(r=>r.points>0||r.penaltyWarning||P.has(r.actionType||""));let v="";if(_.length>0){const r=new Map;_.forEach(s=>{const a=s.set||1;r.has(a)||r.set(a,[]),r.get(a).push(s)});const c=Array.from(r.entries()).sort((s,a)=>s[0]-a[0]).map(([s,a])=>{const C=[...a].reverse().map(n=>{const R=e(n.time||""),T=W[n.actionType||""];let i;T?i=o(T):n.actionType==="dead_ball"?i=o("common.matchHistory.deadBall",{server:n.server||""}):n.actionType==="timeout_player"?i=o("common.matchHistory.playerTimeout",{player:n.actionPlayer||""}):n.actionType==="timeout_medical"?i=o("common.matchHistory.medicalTimeout",{player:n.actionPlayer||""}):n.actionType==="timeout_referee"?i=o("common.matchHistory.refereeTimeout"):n.actionType==="pause"?i=o("common.matchHistory.pause",{player:n.actionPlayer||""}):n.actionType==="resume"?i=n.actionPlayer||"Resume":i=n.actionType||"";const w=e(i),f=P.has(n.actionType||""),z=new Set(["foul","irregular_serve","centerboard","body_touch","illegal_defense","out","ball_holding","mask_touch","penalty","penalty_table_pushing","penalty_electronic","penalty_talking","serve_miss"]).has(n.actionType||""),E=f?"":e((z?n.actionPlayer:n.scoringPlayer)||""),L=!f&&n.points?n.points>0?`+${n.points}`:`${n.points}`:"";let A="";if(!f&&n.scoreAfter){const S=n.serverSide==="player2",I=S?n.scoreAfter.player2:n.scoreAfter.player1,D=S?n.scoreAfter.player1:n.scoreAfter.player2;A=`${I}:${D}`}const j=n.actionType==="serve",B=f?n.actionLabel?e(n.actionLabel):w:`${E} ${w}`;return`<tr${f?' style="background:#f9f9f9;color:#666"':""}${j?' style="background:#e8f4fd;font-weight:bold"':""}>
            <td>${R}</td>
            <td>${B}</td>
            <td>${L}</td>
            <td style="text-align:center;font-weight:bold">${A}</td>
          </tr>`}).join("");return`<h3>${e(o("common.pdf.setNum"))} ${s}</h3>
        <table aria-label="${e(o("common.pdf.playByPlay"))} - ${e(o("common.pdf.setNum"))} ${s}">
          <thead><tr>
            <th scope="col">${e(o("common.pdf.time"))}</th>
            <th scope="col">${e(o("common.pdf.action"))}</th>
            <th scope="col">${e(o("common.pdf.pts"))}</th>
            <th scope="col">${e(o("common.pdf.scoreServerReceiver"))}</th>
          </tr></thead>
          <tbody>${C}</tbody>
        </table>`}).join("");v=`<section aria-label="${e(o("common.pdf.playByPlay"))}">
      <h2>${e(o("common.pdf.playByPlay"))}</h2>
      ${c}
    </section>`}return`<!DOCTYPE html>
<html lang="${x}">
<head>
  <meta charset="UTF-8">
  <title>${e(o("common.pdf.matchScoresheet"))} - ${l} vs ${m}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      @page { margin: 15mm; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif;
      max-width: 800px; margin: 0 auto; padding: 2rem;
      color: #111; background: #fff; line-height: 1.6;
    }
    h1 { font-size: 1.5rem; border-bottom: 3px solid #333; padding-bottom: 0.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.15rem; margin-top: 1.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    h3 { font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #1e3a5f; }
    .actions { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .actions button {
      padding: 0.5rem 1.5rem; border: none; border-radius: 0.25rem;
      cursor: pointer; font-size: 0.9rem; color: #fff;
    }
    .btn-print { background: #333; }
    .btn-print:hover { background: #555; }
    .btn-pdf { background: #1e40af; }
    .btn-pdf:hover { background: #1e3a8a; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0 1rem; }
    dt { font-weight: bold; color: #555; }
    dd { margin: 0; }
    .players {
      display: flex; align-items: center; justify-content: center; gap: 1.5rem;
      background: #f5f5f5; padding: 1rem; border-radius: 0.5rem; margin: 1rem 0;
      font-size: 1.25rem; font-weight: bold;
    }
    .players .vs { color: #999; font-size: 1rem; }
    .coach { font-size: 0.85rem; font-weight: normal; color: #666; }
    .coin-toss { text-align: center; color: #555; font-size: 0.9rem; margin: 0.5rem 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.85rem; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: center; }
    th { background: #f0f0f0; font-weight: bold; }
    .winner { font-weight: bold; color: #16a34a; }
    .final-result {
      background: #16a34a; color: #fff; text-align: center;
      padding: 0.75rem; border-radius: 0.5rem; font-size: 1.1rem; margin: 1rem 0;
    }
    footer { margin-top: 2rem; padding-top: 0.5rem; border-top: 1px solid #ccc; font-size: 0.75rem; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="actions no-print">
    <button class="btn-print" onclick="window.print()" aria-label="${e(o("common.pdf.printButton")||"Print")}">${e(o("common.pdf.printButton")||"Print")}</button>
  </div>

  <main>
    <h1>${e(p?.name||o("common.pdf.matchScoresheet"))}</h1>
    <p style="color:#666; margin-top:0;">${e(o("common.pdf.matchScoresheet"))}</p>

    ${d.length>0?`<dl>${d.join("")}</dl>`:""}

    <div class="players" aria-label="${l} vs ${m}">
      <div>
        ${l}
        ${g?`<div class="coach">${e(o("common.pdf.coach"))}: ${g}</div>`:""}
      </div>
      <span class="vs">vs</span>
      <div>
        ${m}
        ${$?`<div class="coach">${e(o("common.pdf.coach"))}: ${$}</div>`:""}
      </div>
    </div>

    ${b}

    <section aria-label="${e(o("common.pdf.setResults"))}">
      <h2>${e(o("common.pdf.setResults"))}</h2>
      <table aria-label="${e(o("common.pdf.setResults"))}">
        <thead><tr>
          <th scope="col">${e(o("common.pdf.setNum"))}</th>
          <th scope="col">${l}</th>
          <th scope="col">${m}</th>
          <th scope="col">${e(o("common.pdf.winner"))}</th>
        </tr></thead>
        <tbody>${H}</tbody>
      </table>
    </section>

    ${h}

    ${v}
  </main>

  <footer>${e(o("common.pdf.generatedAt"))}: ${new Date().toLocaleString()}</footer>
</body>
</html>`}export{O as generateMatchHtml};
